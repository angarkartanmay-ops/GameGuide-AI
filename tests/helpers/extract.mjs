// Slices pure, dependency-free functions out of the chat-proxy edge function
// so they can be unit tested under Node.
//
// Why slicing rather than a plain import: `index.ts` is a Deno module — it
// imports `npm:@google/genai` and calls `Deno.serve()` at load time, so
// importing it under Node executes a server. The functions under test
// (classification, correction detection, follow-up suppression) are pure and
// have no imports of their own, so lifting them out is safe.
//
// The proper long-term fix is to move these into their own module (e.g.
// `queryCortex.ts`) and import them directly. Until then, this keeps them
// covered instead of untested.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..');
const SOURCE = join(REPO_ROOT, 'supabase', 'functions', 'chat-proxy', 'index.ts');
const ROUTER_SOURCE = join(REPO_ROOT, 'supabase', 'functions', 'chat-proxy', 'meshRouter.ts');
// Sits beside the test files (tests/.generated), not beside this helper —
// the suites import it as './.generated/...' relative to tests/.
const OUT_DIR = join(HERE, '..', '.generated');

/** Text between two markers; throws loudly if the source has drifted. */
function slice(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  const j = src.indexOf(endMarker);
  if (i < 0) throw new Error(`extract: start marker not found: ${startMarker}`);
  if (j < 0) throw new Error(`extract: end marker not found: ${endMarker}`);
  if (j <= i) throw new Error(`extract: markers out of order: ${startMarker}`);
  return src.slice(i, j);
}

/**
 * Writes the sliced modules and returns their paths.
 * Regenerated on every run, so a rename in index.ts fails the test rather
 * than silently testing a stale copy.
 */
export function generateModules() {
  const src = readFileSync(SOURCE, 'utf8');
  mkdirSync(OUT_DIR, { recursive: true });

  const detection =
    slice(src, 'const KNOWN_GAMES', 'function scoreComplexity') +
    '\nexport { detectGame, extendWithInstallment, guessUnknownTitle };\n';

  const behaviour =
    slice(src, 'const CORRECTION_LEAD_RX', 'function scoreComplexity') +
    '\n' +
    slice(src, 'const EMOTIONAL_RX', 'function ensureFollowUps') +
    '\nexport { isCorrection, shouldSkipAutoFollowUps, EMOTIONAL_RX };\n';

  const detectionPath = join(OUT_DIR, 'detection.ts');
  const behaviourPath = join(OUT_DIR, 'behaviour.ts');
  writeFileSync(detectionPath, detection);
  writeFileSync(behaviourPath, behaviour);

  // meshRouter.ts imports `MeshState` (a type-only interface) from meshDb.ts,
  // and meshDb.ts calls Deno.env.get() at module TOP LEVEL — so a real ESM
  // import of meshRouter.ts crashes under plain Node before any test even
  // runs. planGeminiRoute() itself is pure (its `state` param is only ever
  // used as a plain object, and its `candidates` param is optional+overridable
  // specifically so tests never need real env access), so slice it out the
  // same way as the index.ts functions above.
  //
  // geminiCandidates() is intentionally NOT re-exported here: its body calls
  // envInt(), which is defined above this slice's boundary and calls
  // Deno.env.get(). Defining-but-never-calling it is harmless (JS doesn't
  // resolve identifiers inside an unexecuted function body), but exporting it
  // would invite a future test to call it and hit a ReferenceError. Tests that
  // need the real candidate LIST read meshRouter.ts as text instead — see
  // tests/gemini.test.ts.
  // Both `GeminiCandidate` and `planGeminiRoute` already carry their own
  // `export` keyword at the declaration in meshRouter.ts (unlike the index.ts
  // slices above, whose functions are declared un-exported and need an
  // appended `export {}` to become importable) — so no trailing export
  // statement here; adding one would double-export and throw a SyntaxError.
  const routerSrc = readFileSync(ROUTER_SOURCE, 'utf8');
  const gemini = slice(routerSrc, 'export interface GeminiCandidate', 'export const GEMINI_OCR_MODEL');
  const geminiPath = join(OUT_DIR, 'gemini.ts');
  writeFileSync(geminiPath, gemini);

  return { detectionPath, behaviourPath, geminiPath };
}

// ── Tiny assertion helper (no test framework dependency) ───────────────────
export function makeChecker(name) {
  let pass = 0;
  const failures = [];
  return {
    check(label, got, want) {
      if (JSON.stringify(got) === JSON.stringify(want)) pass++;
      else failures.push(`  ${label}\n    expected ${JSON.stringify(want)}\n    got      ${JSON.stringify(got)}`);
    },
    report() {
      if (failures.length) {
        console.log(`\n${name} FAILURES:\n${failures.join('\n')}`);
      }
      console.log(`${name}: ${pass} passed, ${failures.length} failed`);
      return failures.length;
    },
  };
}
