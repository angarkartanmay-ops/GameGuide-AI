import { isCorrection, shouldSkipAutoFollowUps } from './.generated/behaviour.ts';

const HIST = [{ sender: 'user', text: 'what game is this' }, { sender: 'ai', text: 'Forza Horizon 4' }];
const NO_HIST: any[] = [];

const corrections: Array<[string, any[], boolean]> = [
  // The exact reported case.
  ['But This is from forza horizon 6.', HIST, true],
  ["no, I meant Elden Ring", HIST, true],
  ["you're wrong about the damage numbers", HIST, true],
  ["that's not right, it's actually 850", HIST, true],
  ['nope', HIST, true],

  // Not corrections.
  ["what's the best build for a mage?", HIST, false],
  ['how do I beat this boss', HIST, false],
  // No prior assistant turn -> cannot be correcting anything.
  ['But This is from forza horizon 6.', NO_HIST, false],
  ['', HIST, false],
];

const skips: Array<[string, string, boolean, boolean]> = [
  // [prompt, reply, isCorrectionTurn, expectSkip]
  ['But this is FH6', 'Ah, you are right.', true, true],
  ["I'm so burnt out on this game", 'x'.repeat(600), false, true],
  ['I feel empty after finishing it', 'x'.repeat(600), false, true],
  ['best build?', 'x'.repeat(600), false, false],   // long informational -> chips ok
  ['best build?', 'short answer', false, true],      // short -> no padding
];

let pass = 0, fail = 0;
for (const [p, h, exp] of corrections) {
  const got = isCorrection(p, h);
  if (got === exp) pass++;
  else { fail++; console.log(`FAIL isCorrection(${JSON.stringify(p)}, hist=${h.length}) expected=${exp} got=${got}`); }
}
for (const [p, r, c, exp] of skips) {
  const got = shouldSkipAutoFollowUps(p, r, c);
  if (got === exp) pass++;
  else { fail++; console.log(`FAIL shouldSkip(${JSON.stringify(p)}, reply=${r.length}ch, corr=${c}) expected=${exp} got=${got}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
