import { detectGame, isSmallTalk } from './.generated/detection.ts';

const cases: Array<[string, string | null]> = [
  // The actual reported bug: installment number must survive.
  ['But This is from forza horizon 6.', 'forza horizon 6'],
  ['forza horizon 5 best cars', 'forza horizon 5'],
  ['is forza horizon good', 'forza horizon'],

  // Plain allowlist hits stay intact.
  ["what's the best build in elden ring", 'elden ring'],
  ['minecraft bedrock vs java', 'minecraft bedrock'],

  // Prose after a title must NOT be glued on as a roman numeral.
  ['minecraft i love it so much', 'minecraft'],
  ['elden ring is very hard', 'elden ring'],

  // Version strings must not be truncated into an installment.
  ['minecraft 1.20 update', 'minecraft'],

  // Roman numerals that ARE installments.
  ['gta v heists', 'gta v'],

  // Unknown / brand-new titles recovered by the frame heuristic.
  ['how do I beat the second boss in Nine Sols', 'nine sols'],
  ['any tips for playing Blue Prince', 'blue prince'],

  // Must not fire on platform / vendor nouns.
  ["I'm playing on PC", null],
  ['this crashes for me', null],

  // A sentence-initial preposition is not part of the title: "In Hollow
  // Knight" was researched as the game "in hollow knight".
  ['In Hollow Knight, which charm makes you heal faster?', 'hollow knight'],
  // Nor is a possessive.
  ["What changed in Valorant's latest patch?", 'valorant'],
];

let pass = 0, fail = 0;
for (const [input, expected] of cases) {
  const got = detectGame(input);
  const ok = got === expected;
  if (ok) { pass++; }
  else { fail++; console.log(`FAIL  ${JSON.stringify(input)}\n      expected=${JSON.stringify(expected)}  got=${JSON.stringify(got)}`); }
}
// ── Small talk skips live retrieval ────────────────────────────────────────
// "what can you do" used to run a web search for "what can you do 2026",
// inherit GTA VI from history, and sit under "Thinking in depth".
const smallTalk: Array<[string, boolean]> = [
  ['what can you do', true],
  ['What can you do?', true],
  ['hi', true],
  ['heyyy', true],
  ['thanks bro', true],
  ['thank you so much!', true],
  ['who are you?', true],
  ['how can you help me', true],
  ['what is gameguide ai', true],
  // Real questions, even short ones, still get retrieval.
  ['what can you do in elden ring', false],
  ['when is it coming out?', false],
  ['help me beat malenia', false],
  ['hi, best build for elden ring?', false],
  ['thanks, and what about the dlc?', false],
  ['minecraft', false],
];
for (const [input, expected] of smallTalk) {
  const got = isSmallTalk(input);
  if (got === expected) pass++;
  else { fail++; console.log(`FAIL  isSmallTalk(${JSON.stringify(input)}) expected=${expected} got=${got}`); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
