// Discord answer formatting — discord-bot/discordFormat.js.
//
// Discord renders no markdown tables at all: a comparison the model writes as
// a table arrives as literal pipes, which on a phone wraps into nonsense.
// These assert the rewrite is readable AND lossless — every cell's text has
// to survive, especially ||spoiler|| bars, which must stay balanced or the
// next chunk reveals them.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'discord-bot', 'package.json'));
const { forDiscord, tablesToLines, _internals } = require(join(ROOT, 'discord-bot', 'discordFormat.js'));
const { splitForDiscord } = require(join(ROOT, 'discord-bot', 'textsplit.js'));

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

// ── Row parsing ──────────────────────────────────────────────────────────
const { splitRow, isDelimiter, isRule } = _internals;
check('splits a fenced row', JSON.stringify(splitRow('| a | b | c |')) === '["a","b","c"]');
check('splits a row without outer pipes', JSON.stringify(splitRow('a | b')) === '["a","b"]');
check('an escaped pipe stays in the cell', JSON.stringify(splitRow('| a \\| b | c |')) === '["a | b","c"]');
check('delimiter row recognised', isDelimiter('| --- | :---: |') && isDelimiter('|---|---|'));
check('alignment colons recognised', isDelimiter('| :--- | ---: |'));
check('a normal row is not a delimiter', !isDelimiter('| Weapon | Where |'));
check('a rule is a rule', isRule('---') && isRule('***') && isRule('___'));
check('a table delimiter is not treated as a rule', !isRule('| --- | --- |'));
check('a sentence with a dash is not a rule', !isRule('Use it — then roll'));

// ── Two-column tables collapse to one line each ──────────────────────────
const two = tablesToLines([
  'Here are the bosses:',
  '',
  '| Boss | Weakness |',
  '| --- | --- |',
  '| Margit | Bleed |',
  '| Godrick | Frost |',
].join('\n'));
check('two-column: no pipes left', !two.includes('|'), two);
check('two-column: one line per row', two.includes('**Margit** — Weakness: Bleed'), two);
check('two-column: keeps the lead-in text', two.startsWith('Here are the bosses:'), two);

// ── Wide tables become one block per row ─────────────────────────────────
const wide = tablesToLines([
  '| Weapon | Where | Scaling | Notes |',
  '| --- | --- | --- | --- |',
  '| Uchigatana | Deathtouched Catacombs | D/D | Bleed build-up |',
  '| Flail | Lofty Lake | E/D | Innate blood loss |',
].join('\n'));
check('wide: no pipes left', !wide.includes('|'), wide);
check('wide: row title is bold', wide.includes('**Uchigatana**'), wide);
check('wide: each value carries its column name', wide.includes('Where: Deathtouched Catacombs') && wide.includes('Scaling: D/D'), wide);
check('wide: rows are separated by a blank line', /Bleed build-up\n\n\*\*Flail\*\*/.test(wide), wide);
check('wide: every cell survives', ['Uchigatana', 'Deathtouched Catacombs', 'D/D', 'Bleed build-up', 'Flail', 'Lofty Lake', 'E/D', 'Innate blood loss'].every(v => wide.includes(v)), wide);

// ── Empty cells are dropped, not printed as blank labels ─────────────────
const holes = tablesToLines('| A | B | C |\n| --- | --- | --- |\n| one |  | three |');
check('an empty cell prints nothing', !/B:/.test(holes), holes);
check('the cells around it are kept', holes.includes('C: three') && holes.includes('**one**'), holes);

// ── Spoilers survive intact ──────────────────────────────────────────────
const spoilery = forDiscord([
  '| Boss | Twist |',
  '| --- | --- |',
  '| Margit | ||He is actually Morgott|| |',
].join('\n'));
const bars = (spoilery.match(/\|\|/g) || []).length;
check('spoiler bars survive the rewrite', bars === 2, spoilery);
check('spoiler text is not leaked out of its bars', /\|\|He is actually Morgott\|\|/.test(spoilery), spoilery);
check('spoiler chunks stay balanced after splitting', splitForDiscord(spoilery).every(c => ((c.match(/\|\|/g) || []).length % 2) === 0));
// The trailing "| ||hidden|| |" case: the bars belong to the cell, and the
// row's own closing pipe must not be mistaken for half of one.
check('a spoiler at the end of a row keeps both bars', JSON.stringify(splitRow('| Margit | ||Morgott|| |')) === '["Margit","||Morgott||"]', JSON.stringify(splitRow('| Margit | ||Morgott|| |')));
check('a spoiler at the start of a row keeps both bars', JSON.stringify(splitRow('| ||Morgott|| | Margit |')) === '["||Morgott||","Margit"]', JSON.stringify(splitRow('| ||Morgott|| | Margit |')));

// ── Fenced code is left alone ────────────────────────────────────────────
const fenced = forDiscord(['```', '| a | b |', '| --- | --- |', '| 1 | 2 |', '```'].join('\n'));
check('a table inside a code fence is untouched', fenced.includes('| a | b |') && fenced.includes('| --- | --- |'), fenced);
const fencedRule = forDiscord(['```', '---', '```'].join('\n'));
check('a rule inside a code fence is untouched', fencedRule.includes('---'), fencedRule);

// ── Rules and blank runs ─────────────────────────────────────────────────
const ruled = forDiscord('One\n\n---\n\nTwo');
check('horizontal rules are dropped', !ruled.includes('---'), ruled);
check('the text either side is kept', ruled.includes('One') && ruled.includes('Two'), ruled);
check('blank runs collapse to one', !/\n{3,}/.test(forDiscord('a\n\n\n\n\nb')));

// ── Left alone when there is nothing to do ───────────────────────────────
const plain = 'Just a paragraph with a | pipe in it.\nAnd a second line.';
check('a stray pipe is not a table', forDiscord(plain) === plain, forDiscord(plain));
check('a header with no rows is dropped, not half-rendered', !forDiscord('| A | B |\n| --- | --- |').includes('|'));
check('non-strings pass through', forDiscord(null) === null && forDiscord(undefined) === undefined);
check('empty string is safe', forDiscord('') === '');

// ── The whole path a real answer takes ───────────────────────────────────
const answer = forDiscord([
  '## Best early weapons',
  '',
  '| Weapon | Where | Requires |',
  '| --- | --- | --- |',
  '| Uchigatana | Deathtouched Catacombs | 11 STR / 15 DEX |',
  '',
  '---',
  '',
  'Two-hand it for the **strength** discount.',
].join('\n'));
check('end to end: heading kept', answer.includes('## Best early weapons'), answer);
check('end to end: table rewritten', !answer.includes('|'), answer);
check('end to end: closing line kept', answer.includes('Two-hand it for the **strength** discount.'), answer);
check('end to end: fits a Discord message', splitForDiscord(answer).every(c => c.length <= 2000));

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
