// Retrieval-targeting regressions.
//
// All three bugs guarded here shipped to production at once and together made
// the assistant deny that real games existed:
//
//   1. promptSubject's `\b` escapes were saved as literal 0x08 BACKSPACE bytes
//      and its whitespace collapse was `/s+/g` (the LETTER s). "tell me about
//      silksong" became "ilk ong", which was then used as the live search
//      query and returned nothing.
//   2. TEMPORAL_HINT_RX had the same corrupted escape, so it matched NOTHING —
//      `profile.temporal` was permanently false and wantsAgentic() therefore
//      never once routed a "latest / release date" question to the web-search
//      models.
//   3. detectGame returns on its first allowlist hit, so a comparison only
//      ever researched one of the two games.
//
// Reproduced live: asked to compare 007 First Light (released 27 May 2026)
// with Forza Horizon 6, the assistant said "Nothing's coming back for 007
// First Light" and then invented a 9/10 review for Forza.

import {
  detectGame,
  detectGames,
  gamesFromHistory,
  promptSubject,
  TEMPORAL_HINT_RX,
} from './.generated/detection.ts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}`);
}

function eq(name: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) console.error(`  FAIL: ${name}\n        got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// ── promptSubject: no letters may be eaten ────────────────────────────────
// The canonical symptom. If any of these lose an "s", the /s+/ bug is back.
eq('silksong survives intact', promptSubject('tell me about silksong'), 'silksong');
eq('strips question scaffolding', promptSubject('is elden ring nightreign good'), 'elden ring nightreign');
check('counter strike keeps both esses', promptSubject('what is new in counter strike') === 'new counter strike');
check('no subject is null, not gibberish', promptSubject('hi') === null);

// Belt and braces: whatever the prompt, every "s" in a title must survive.
for (const title of ['silksong', 'super smash bros', 'assassins creed shadows', 'stardew valley']) {
  const out = promptSubject(`tell me about ${title}`) ?? '';
  check(`"${title}" not mangled`, out.includes(title));
}

// ── TEMPORAL_HINT_RX: must actually match ─────────────────────────────────
// A literal-backspace regression makes every one of these false.
for (const q of [
  "what's the latest patch for elden ring",
  'newest hero in clash royale',
  'is 007 first light out yet release date',
  'current meta for rank',
  'just released games',
  'upcoming 2027 titles',
]) check(`temporal: ${JSON.stringify(q)}`, TEMPORAL_HINT_RX.test(q));

// ...and must not fire on evergreen questions, or every turn pays for an
// agentic web-search round trip it does not need.
for (const q of [
  'tell me a story about geralt',
  'how do I beat the first boss',
  'what is the lore of hallownest',
]) check(`not temporal: ${JSON.stringify(q)}`, !TEMPORAL_HINT_RX.test(q));

// ── detectGames: both sides of a comparison ───────────────────────────────
{
  const g = detectGames('Compare gameplay of 007 first light and forza horizon 6. What would you rate them?');
  check('comparison finds forza horizon 6', g.some(x => x.includes('forza horizon 6')));
  check('comparison also finds 007 first light', g.some(x => x.includes('007')));
  check('comparison yields at least two subjects', g.length >= 2);
}
{
  const g = detectGames('elden ring vs dark souls 3');
  check('vs-form finds elden ring', g.some(x => x.includes('elden ring')));
  check('vs-form finds dark souls', g.some(x => x.includes('dark souls')));
}

// A single-game prompt must stay single — no invented second subject, which
// would double the scrape cost of an ordinary question.
{
  const g = detectGames("what's the best build in elden ring");
  eq('single game stays single', g.length, 1);
  check('and it is the right one', g[0].includes('elden ring'));
}

// Overlapping allowlist entries must not both be returned: searching "forza"
// and "forza horizon 6" separately wastes a fetch and splits the context.
{
  const g = detectGames('forza horizon 6 best cars');
  eq('no overlapping duplicate subjects', g.length, 1);
}

// detectGame must keep its existing single-value contract — the profile, the
// context card and the cache key all still depend on it.
eq('detectGame unchanged', detectGame('But This is from forza horizon 6.'), 'forza horizon 6');
eq('detectGame still returns null when nothing matches', detectGame("I'm playing on PC"), null);

// ── follow-up turns must not lose the game ────────────────────────────────
// Reported live: "Compare Forza Horizon 6 and 007 First Light" answered well,
// then "When were they released?" replied that its training cutoff didn't
// reach the dates — because the subject extracted from that turn was the word
// "they", and Wikipedia was searched for it.
for (const q of ['When were they released?', 'what about them', 'when did it come out', 'is it good']) {
  check(`pronoun follow-up yields no subject: ${JSON.stringify(q)}`, promptSubject(q) === null);
}

{
  const history = [
    { sender: 'user', text: 'Compare and tell me about Forza horizon 6 and 007 First Light.' },
    { sender: 'ai', text: 'Forza Horizon 6 launched in May 2026 ... 007 First Light is developed by IO Interactive ...' },
  ];
  const carried = gamesFromHistory(history, 3);
  check('history carries forza horizon 6', carried.some(g => g.includes('forza horizon 6')));
  check('history carries 007 first light', carried.some(g => g.includes('007')));
}

// Only the user's turns are mined: assistant prose name-drops comparison
// titles in passing, which would drag unrelated games into the next scrape.
{
  const history = [
    { sender: 'user', text: 'tell me about silksong' },
    { sender: 'ai', text: 'If you liked Hollow Knight and Elden Ring you will enjoy it.' },
  ];
  const carried = gamesFromHistory(history, 3);
  check('history ignores titles the assistant merely mentioned',
    carried.every(g => !g.includes('elden ring')));
  check('history still finds the user-named game', carried.some(g => g.includes('silksong')));
}

check('empty history is harmless', gamesFromHistory([], 3).length === 0);
check('malformed history is harmless', gamesFromHistory([null, {}, { text: 42 }] as any, 3).length === 0);

console.log(`retrieval: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
