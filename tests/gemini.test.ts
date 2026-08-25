// Gemini multi-model rotation.
//
// The premise being tested: Google tracks free-tier request quota PER MODEL,
// not pooled across models on one key (verified 2026-08-25 — flash-lite and
// flash have different documented RPD numbers, which is only possible if
// they're separate pools). So cycling across several distinct model ids turns
// one free GOOGLE_API_KEY into several independent daily budgets instead of
// one. planGeminiRoute() is the function that makes that real: it decides,
// per request, which candidate to try first.
//
// Also guards three concrete bugs found while building this:
//   1. noteLocalFailure('Gemini', 'vision') used a hardcoded literal instead
//      of the real model id, so ONE model's 429 silently cooled down Gemini
//      for every OTHER model too (including unrelated text queries).
//   2. geminiFirst() checked that same single hardcoded cooldown key for
//      every routing decision, so a single rate-limited model could make the
//      router think Gemini was unavailable entirely.
//   3. resolveGameFromImage()'s fallback path was hardcoded to
//      'gemini-2.0-flash', a model already confirmed retired — every call
//      there was a guaranteed 404 that failed silently into `return null`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateModules, REPO_ROOT } from './helpers/extract.mjs';

generateModules();
const { planGeminiRoute } = await import('./.generated/gemini.ts');

let pass = 0;
const failures: string[] = [];
const check = (label: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else failures.push(`  ${label}\n    expected ${JSON.stringify(want)}\n    got      ${JSON.stringify(got)}`);
};

const state = (usage: Record<string, number> = {}, cooldowns: Record<string, number> = {}) => ({ usage, cooldowns });

const FIVE = [
  { id: 'model-a', dailyCap: 100 },
  { id: 'model-b', dailyCap: 100 },
  { id: 'model-c', dailyCap: 100 },
  { id: 'model-d', dailyCap: 100 },
  { id: 'model-e', dailyCap: 100 },
];

// ── Empty state: nothing used, nothing cooling down ────────────────────────
// Array.prototype.sort is stable (ES2019+), so when every used/cap ratio ties
// at 0 the original declaration order must survive untouched.
check('fresh day preserves declared order',
  planGeminiRoute(state(), FIVE).map((c: any) => c.id),
  ['model-a', 'model-b', 'model-c', 'model-d', 'model-e']);

// ── Hard cap: excluded outright, not just deprioritised ────────────────────
check('model at its daily cap is excluded entirely',
  planGeminiRoute(state({ 'Gemini|model-b': 100 }), FIVE).map((c: any) => c.id),
  ['model-a', 'model-c', 'model-d', 'model-e']);

check('model past its daily cap is excluded entirely',
  planGeminiRoute(state({ 'Gemini|model-c': 150 }), FIVE).map((c: any) => c.id),
  ['model-a', 'model-b', 'model-d', 'model-e']);

check('every model over cap yields an empty route (the "skip Gemini" signal)',
  planGeminiRoute(state({
    'Gemini|model-a': 100, 'Gemini|model-b': 100, 'Gemini|model-c': 100,
    'Gemini|model-d': 100, 'Gemini|model-e': 100,
  }), FIVE),
  []);

// ── Cooldown: deprioritised, NOT excluded ───────────────────────────────────
// A cooldown is a temporary backoff (e.g. a transient 429), not proof the
// day's quota is spent — unlike the hard cap, it must still be usable as a
// last resort if literally everything else is worse off.
check('cooling-down model drops to the back but is not removed',
  planGeminiRoute(state({}, { 'Gemini|model-a': 45 }), FIVE).map((c: any) => c.id),
  ['model-b', 'model-c', 'model-d', 'model-e', 'model-a']);

// ── The core mechanic: sort by FRACTION used, not raw count ────────────────
// This is what makes the rotation self-balancing across models with different
// caps: a lite model at 80/1000 has more real headroom than a flash model at
// 15/200, even though 80 > 15 in absolute terms.
const MIXED_CAPS = [
  { id: 'lite',  dailyCap: 1000 },
  { id: 'flash', dailyCap: 200 },
];
check('lower USAGE FRACTION goes first, not lower absolute count',
  planGeminiRoute(state({ 'Gemini|lite': 800, 'Gemini|flash': 15 }), MIXED_CAPS).map((c: any) => c.id),
  ['flash', 'lite']); // flash: 15/200=0.075 vs lite: 800/1000=0.8 -> flash has LESS headroom, so...

// Sanity-check the assertion above actually encodes the intended direction:
// flash's fraction (0.075) is LOWER than lite's (0.8), so flash goes first —
// "most headroom left" means lowest used/cap ratio, confirmed by construction.
check('fraction math backs the ordering above',
  15 / 200 < 800 / 1000,
  true);

// Sharper version: lite's RAW usage (100) is higher than flash's (30), but
// lite's FRACTION (10%) is lower than flash's (15%) — a sort by raw count
// would wrongly put flash first; sorting by fraction correctly puts lite
// first, since it has more real headroom left today.
check('spreads load toward whichever model has more PROPORTIONAL room, even against a higher raw count',
  planGeminiRoute(state({ 'Gemini|lite': 100, 'Gemini|flash': 30 }), MIXED_CAPS).map((c: any) => c.id),
  ['lite', 'flash']); // lite: 100/1000=0.10 vs flash: 30/200=0.15 -> lite has MORE headroom -> lite first

// ── Precedence: hard cap beats cooldown beats fraction ──────────────────────
check('hard-capped models are gone even if others are cooling down',
  planGeminiRoute(state(
    { 'Gemini|model-a': 100 },
    { 'Gemini|model-b': 30 },
  ), FIVE).map((c: any) => c.id),
  ['model-c', 'model-d', 'model-e', 'model-b']);

// ── Zero candidates in, zero out (no crash on an empty registry) ───────────
check('empty candidate list returns empty route', planGeminiRoute(state(), []), []);

// ═══════════════════════════════════════════════════════════════════════════
//  Structural sanity check on the REAL candidate list.
//  Reads meshRouter.ts as text rather than executing geminiCandidates() —
//  that function calls Deno.env.get() internally, and this suite runs under
//  plain Node. Matches the precedent in tests/catalog.test.mjs.
// ═══════════════════════════════════════════════════════════════════════════
const routerSrc = readFileSync(join(REPO_ROOT, 'supabase', 'functions', 'chat-proxy', 'meshRouter.ts'), 'utf8');
const fnStart = routerSrc.indexOf('export function geminiCandidates');
const fnEnd = routerSrc.indexOf('\n}', fnStart);
const fnBody = routerSrc.slice(fnStart, fnEnd);
const ids = [...fnBody.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);

check('at least 5 distinct Gemini candidates configured (the multiplication this feature relies on)',
  ids.length >= 5, true);
check('no duplicate candidate ids', new Set(ids).size, ids.length);
check('no empty/placeholder ids', ids.every(id => id.length > 5), true);
check('no Pro-tier model snuck into the free rotation (unverified free-tier availability)',
  ids.some(id => /pro/i.test(id)), false);
check('the retired gemini-2.0-* generation is not still referenced anywhere in the router',
  /gemini-2\.0-/.test(routerSrc), false);

// The specific bug this session found and fixed: resolveGameFromImage() must
// no longer hardcode a single dead model id.
const idxSrc = readFileSync(join(REPO_ROOT, 'supabase', 'functions', 'chat-proxy', 'index.ts'), 'utf8');
// Checks the LIVE usage pattern (`model: 'gemini-2.0-flash'`), not a bare
// mention of the string — the fix's own explanatory comment legitimately
// names the retired id in prose ("previously hardcoded to..."), and a naive
// substring check would flag that documentation as if it were the bug.
check('index.ts never hardcodes the retired gemini-2.0-flash id as a live model value',
  /model:\s*'gemini-2\.0-flash'/.test(idxSrc), false);
check('noteLocalFailure is never called with the literal "vision" as a model id (the cooldown-bucket bug)',
  /noteLocalFailure\('Gemini',\s*'vision'\)/.test(idxSrc), false);
check('geminiFirst no longer keys off a single hardcoded cooldown bucket',
  routerSrc.includes("state.cooldowns['Gemini|vision']"), false);

if (failures.length) console.log(`\nGEMINI ROTATION FAILURES:\n${failures.join('\n')}`);
console.log(`gemini: ${pass} passed, ${failures.length} failed`);
process.exitCode = failures.length ? 1 : 0;
