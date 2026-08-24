// Golden-set eval for the retrieval and routing layer.
//
// Asserts on what is deterministic and reproducible offline: did we resolve
// the right game, will we gather live data, do we classify corrections and
// emotional turns correctly. It does NOT grade LLM prose — that is not
// reproducible and belongs in the live eval (tests/eval/live.mjs).
//
// The premise: almost every "the bot is dumb" report traces to the retrieval
// layer, not the model. If the game is misdetected or nothing is scraped, no
// amount of prompt tuning saves the answer.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateModules } from '../helpers/extract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
generateModules();

const { detectGame } = await import('../.generated/detection.ts');
const { isCorrection, shouldSkipAutoFollowUps, EMOTIONAL_RX } = await import('../.generated/behaviour.ts');

const { cases } = JSON.parse(readFileSync(join(HERE, 'questions.json'), 'utf8'));

// Mirrors the server exactly: a detected game OR a substantive prompt, but
// never on an emotional turn — searching the web for "I am burnt out on
// ranked" returns noise that only pollutes the answer.
const willScrape = (prompt, game) =>
  (!!game || prompt.trim().length >= 12) && !EMOTIONAL_RX.test(prompt);

let pass = 0;
const failures = [];
const fail = (id, msg) => failures.push(`  [${id}] ${msg}`);

for (const c of cases) {
  const game = detectGame(c.prompt);

  if ('expectGame' in c) {
    if (game === c.expectGame) pass++;
    else fail(c.id, `game: expected ${JSON.stringify(c.expectGame)}, got ${JSON.stringify(game)}`);
  }

  if ('mustScrape' in c) {
    const got = willScrape(c.prompt, game);
    if (got === c.mustScrape) pass++;
    else fail(c.id, `scrape: expected ${c.mustScrape}, got ${got}`);
  }

  if ('isCorrection' in c) {
    // A correction only registers when there is a prior assistant turn.
    const hist = [{ sender: 'user', text: 'q' }, { sender: 'ai', text: 'a' }];
    const got = isCorrection(c.prompt, hist);
    if (got === c.isCorrection) pass++;
    else fail(c.id, `correction: expected ${c.isCorrection}, got ${got}`);
  }

  if ('skipFollowUps' in c) {
    const got = shouldSkipAutoFollowUps(c.prompt, 'x'.repeat(600), false);
    if (got === c.skipFollowUps) pass++;
    else fail(c.id, `skipFollowUps: expected ${c.skipFollowUps}, got ${got}`);
  }
}

// ── Hallucination guards on the system prompt itself ──────────────────────
// The reported failure was the model asserting a real game did not exist.
// These assert the instruction is actually present, so a future prompt edit
// cannot silently drop it.
const SYS = readFileSync(
  join(HERE, '..', '..', 'supabase', 'functions', 'chat-proxy', 'index.ts'),
  'utf8',
);
const guards = [
  ['never-claim-nonexistent', 'NEVER CLAIM A GAME DOESN\'T EXIST'],
  ['forbids-unable-to-find', "I'm unable to find any information about a game titled"],
  ['forbids-title-correction', 'Correcting the user\'s title to a different game'],
  ['trusts-user-assertion', 'A user asserting a game exists is strong evidence'],
  ['live-block-wins', 'If ANY live block mentions the title'],
  ['no-canned-refusal', 'NEVER output a templated'],
  ['correction-protocol', 'WHEN THE USER CORRECTS YOU'],
];
for (const [id, needle] of guards) {
  if (SYS.includes(needle)) pass++;
  else fail(id, `system prompt is missing its guard: "${needle.slice(0, 50)}…"`);
}

if (failures.length) console.log(`\nEVAL FAILURES:\n${failures.join('\n')}`);
console.log(`eval: ${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
