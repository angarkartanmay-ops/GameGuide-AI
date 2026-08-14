import { detectGame } from './.generated/detection.ts';

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
];

let pass = 0, fail = 0;
for (const [input, expected] of cases) {
  const got = detectGame(input);
  const ok = got === expected;
  if (ok) { pass++; }
  else { fail++; console.log(`FAIL  ${JSON.stringify(input)}\n      expected=${JSON.stringify(expected)}  got=${JSON.stringify(got)}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
