// Web spoiler rendering — ||text|| → [text](#spoiler).
//
// The two failures that would turn the feature into a spoiler machine:
// streaming (the answer is on screen before the closing "||" arrives) and
// markdown that legitimately contains "||" (code, table rows).

import { toSpoilerMarkdown, SPOILER_HREF } from '../src/utils/spoilerText.js';

let passed = 0;
let failed = 0;
function eq(name, got, want) {
  if (got === want) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
}
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

const H = SPOILER_HREF;

eq('plain text untouched', toSpoilerMarkdown('no spoilers here'), 'no spoilers here');
eq('empty', toSpoilerMarkdown(''), '');
eq('basic span', toSpoilerMarkdown('The final boss is ||Radagon||.'), `The final boss is [Radagon](${H}).`);
eq('two spans on one line', toSpoilerMarkdown('||A|| and ||B||'), `[A](${H}) and [B](${H})`);
eq('bold inside stays markdown', toSpoilerMarkdown('||**Ranni** betrays you||'), `[**Ranni** betrays you](${H})`);
eq('brackets inside are escaped', toSpoilerMarkdown('||see [this]||'), `[see \\[this\\]](${H})`);
eq('span across a soft line break', toSpoilerMarkdown('||line one\nline two||'), `[line one\nline two](${H})`);
eq('span across paragraphs becomes one spoiler per paragraph',
  toSpoilerMarkdown('||para one\n\npara two||'), `[para one](${H})\n\n[para two](${H})`);
eq('empty spoiler dropped', toSpoilerMarkdown('a |||| b'), 'a  b');

// ── streaming: an unclosed span must stay hidden ───────────────────────────
{
  const partial = 'Heads up. ||The final boss is Rada';
  const out = toSpoilerMarkdown(partial);
  check('streaming: unclosed span is hidden', !/The final boss is Rada(?!\]\(#spoiler\))/.test(out.replace(`[The final boss is Rada](${H})`, '')), out);
  eq('streaming: rendered as a pending spoiler', out, `Heads up. [The final boss is Rada](${H})`);
}
{
  // Every prefix of a spoiler-bearing answer must hide the secret.
  const full = 'Here is the thing: ||Radagon is Marika|| — told you.';
  for (let n = 1; n <= full.length; n++) {
    const out = toSpoilerMarkdown(full.slice(0, n));
    const visible = out.replace(/\[[^\]]*\]\(#spoiler\)/g, '');
    if (/Radagon|is Marika|Mari/.test(visible)) {
      check(`streaming prefix ${n} never shows the secret`, false, JSON.stringify(visible));
      break;
    }
  }
  passed++;   // reached here without a leak
}

// ── code and tables are left alone ─────────────────────────────────────────
eq('inline code untouched', toSpoilerMarkdown('use `a || b` in code'), 'use `a || b` in code');
eq('inline code next to a spoiler', toSpoilerMarkdown('`x||y` then ||secret||'), `\`x||y\` then [secret](${H})`);
{
  const fenced = '```\nif (a || b) {}\n```\nand ||hidden||';
  eq('fenced code untouched, spoiler after it still works', toSpoilerMarkdown(fenced), `\`\`\`\nif (a || b) {}\n\`\`\`\nand [hidden](${H})`);
}
{
  const table = '| a || c |\n|---|---|---|\n| 1 || 3 |';
  eq('GFM table rows (empty cells are "||") untouched', toSpoilerMarkdown(table), table);
}
eq('escaped pipes are literal', toSpoilerMarkdown('a \\|| b'), 'a \\|| b');
// A line that STARTS with a spoiler looks like a table row by its first char.
eq('line starting with a spoiler is not a table row',
  toSpoilerMarkdown('||Radagon|| is the final boss'), `[Radagon](${H}) is the final boss`);
{
  const mixed = 'Intro ||twist||\n\n| a | b |\n|---|---|\n| 1 || 2 |\n\n||after||';
  eq('table protected, spoilers around it still hidden', toSpoilerMarkdown(mixed),
    `Intro [twist](${H})\n\n| a | b |\n|---|---|\n| 1 || 2 |\n\n[after](${H})`);
}

// ── detection ──────────────────────────────────────────────────────────────

{
  const out = toSpoilerMarkdown('x ||**Radagon** [wiki](https://w.com/Radagon)|| y');
  check('a link inside a spoiler is flattened, not left as raw markdown', out.includes('wiki (https://w.com/Radagon)') && !out.includes('](https://w.com'), out);
}

console.log(`spoiler-text: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
