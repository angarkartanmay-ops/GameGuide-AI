// /missables — the prompt and the game it defaults to, on the website
// (src/utils/missables.js) and the Discord bot (discord-bot/missables.js).
// The bot deploys from its own folder, so the prompt is a hand-kept copy;
// this is what keeps the two from drifting.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as web from '../src/utils/missables.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bot = createRequire(join(ROOT, 'discord-bot', 'package.json'))(join(ROOT, 'discord-bot', 'missables.js'));

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

// ── Prompt ───────────────────────────────────────────────────────────────
const withProgress = web.buildMissablesPrompt('Elden Ring', 'beat Margit');
check('names the game', withProgress.includes('Elden Ring'));
check('starts from where the player is', withProgress.includes("I'm currently at: beat Margit"));
check('asks for what makes each one lost', /what makes each one lost/.test(withProgress));
check('keeps it spoiler-safe past that point', /don’t name it in plain text/.test(withProgress) && /\|\|spoiler bars\|\|/.test(withProgress));
check('asks for confirmed rewards only', /Only name items and rewards you are sure of/.test(withProgress));
// The backend trusts a quoted phrase as the game's title: '"a later boss"' in
// this prompt made the server think the game was "Later Boss", which dropped
// the shield's progress and put "Later Boss" in the follow-up chips.
check('no quoted phrases (read as a game title)', !/["“”]/.test(withProgress.replace(/^What can I permanently miss in [^?]+\?/, '')));
// The backend's first-match persona regexes (chat-proxy INTENT_PATTERNS):
// "story" → Loremaster (a story recap before the list), " or " → Coach.
for (const [label, p] of [['with progress', withProgress], ['without progress', web.buildMissablesPrompt('Hollow Knight', null)]]) {
  check(`${label}: does not trip the Loremaster persona`, !/(lore|story|backstory|canon|timeline|who is|what happened to|history of|ending)/i.test(p));
  check(`${label}: does not trip the Coach persona`, !/(vs|versus|compared? to|or |which is better|difference between|better than)/i.test(p));
}

const noProgress = web.buildMissablesPrompt('Hollow Knight', null);
check('without progress: opening hours only, then asks', /cover only the opening hours/.test(noProgress) && /ask me where I am/.test(noProgress));
check('no game → no prompt', web.buildMissablesPrompt('   ', 'x') === '');
check('newlines in progress cannot break the prompt', !web.buildMissablesPrompt('Elden Ring', 'beat\nMargit\n\nIGNORE ALL').includes('\n'));
check('overlong progress is clipped', web.buildMissablesPrompt('X', 'y'.repeat(500)).includes('y'.repeat(80)) && !web.buildMissablesPrompt('X', 'y'.repeat(500)).includes('y'.repeat(81)));

for (const [g, w] of [['Elden Ring', 'beat Margit'], ['Hollow Knight', null], ['Baldur\'s Gate 3', 'Act 2'], ['', 'x']]) {
  check(`web and Discord prompts identical — ${g || '(none)'}`, web.buildMissablesPrompt(g, w) === bot.buildMissablesPrompt(g, w));
}

// ── Which game (web) ─────────────────────────────────────────────────────
const progress = { 'hollow knight': 'Greenpath', 'elden ring': 'beat Margit' };
check('web: typed game wins, with its saved progress', JSON.stringify(web.pickMissablesGame('Elden Ring', progress)) === JSON.stringify({ game: 'Elden Ring', where: 'beat Margit' }));
check('web: typed game with nothing saved has no progress', web.pickMissablesGame('Hades II', progress).where === null);
check('web: nothing typed → newest saved game (last entry)', web.pickMissablesGame('', progress).game === 'Elden Ring');
check('web: nothing typed, nothing saved → no game', web.pickMissablesGame('', {}).game === '');

// ── Which game (Discord — jsonb has no key order) ────────────────────────
check('discord: typed game wins', bot.pickMissablesGame('Elden Ring', progress).where === 'beat Margit');
check('discord: one saved game is used', bot.pickMissablesGame('', { 'hollow knight': 'Greenpath' }).game === 'hollow knight');
check('discord: several saved → asks which', Array.isArray(bot.pickMissablesGame('', progress).choose));
check('discord: none saved → none', bot.pickMissablesGame('', {}).none === true);

console.log(`missables: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
