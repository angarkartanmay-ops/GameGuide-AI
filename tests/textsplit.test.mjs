// Discord splitting must never expose half a spoiler.
//
// A Spoiler Shield answer longer than one Discord message is sent in chunks.
// If a chunk boundary falls inside ||…||, the next message would start with
// the rest of the secret in plain sight.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { splitForDiscord } = require(join(dirname(fileURLToPath(import.meta.url)), '..', 'discord-bot', 'textsplit.js'));

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

const bars = (s) => (s.replace(/`+[^`]*`+/g, '').match(/\|\|/g) || []).length;

check('empty input', splitForDiscord('').length === 0);
{
  const c = splitForDiscord('short answer with ||a spoiler||');
  check('short text is one chunk, unchanged', c.length === 1 && c[0] === 'short answer with ||a spoiler||');
}

// A long answer whose spoiler spans the split point.
{
  const before = 'intro line\n'.repeat(170);            // ~1870 chars
  const secret = 'The final boss is Radagon of the Golden Order\n'.repeat(4);
  const text = `${before}||${secret}|| and then the rest.`;
  const chunks = splitForDiscord(text);
  check('long answer splits', chunks.length >= 2, String(chunks.length));
  chunks.forEach((c, i) => {
    check(`chunk ${i + 1} has balanced bars`, bars(c) % 2 === 0, `${bars(c)} bars`);
    check(`chunk ${i + 1} fits Discord's limit`, c.length <= 2000, String(c.length));
  });
  // Nothing of the secret may appear outside bars in any chunk.
  const leak = chunks.some(c => /Radagon/.test(c.replace(/\|\|[\s\S]*?\|\|/g, '')));
  check('the secret never appears outside bars', !leak);
}

// Randomised: spoilers of random length at random positions, many sizes.
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let bad = 0;
  for (let t = 0; t < 300; t++) {
    const parts = [];
    for (let k = 0; k < 8; k++) {
      const plain = 'word '.repeat(Math.floor(rnd() * 180)) + (rnd() < 0.3 ? '\n' : '');
      const hidden = 'SECRET '.repeat(1 + Math.floor(rnd() * 120)) + (rnd() < 0.3 ? '\n' : '');
      parts.push(plain, `||${hidden}||`);
    }
    const chunks = splitForDiscord(parts.join(' '));
    for (const c of chunks) {
      if (bars(c) % 2 !== 0 || /SECRET/.test(c.replace(/\|\|[\s\S]*?\|\|/g, '')) || c.length > 2000) { bad++; break; }
    }
  }
  check('300 randomised answers: no chunk ever shows a secret or breaks the limit', bad === 0, `${bad} bad`);
}

// Bars inside code are literal and must not flip the state.
{
  const text = 'use `a || b` here\n' + 'x\n'.repeat(1000) + 'then ||real spoiler||';
  const chunks = splitForDiscord(text);
  check('bars inside inline code are not treated as spoilers', chunks.every(c => bars(c) % 2 === 0));
  check('no bars were invented around code', !chunks[0].startsWith('||'));
}

console.log(`textsplit: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
