// Spoiler-safe share links (src/utils/share.js). The fragment is written by
// anyone who wants to, so decoding is tested as an attack surface: garbage,
// wrong versions, oversized fields and a deflate bomb must all come back as
// null or clipped — never thrown, never passed through as-is.

import { encodeShare, decodeShare, normalizeShare, buildShareUrl, SHARE_PREFIX } from '../src/utils/share.js';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

const SAMPLE = {
  q: 'How do I beat Margit?',
  a: '## Beating Margit\n\n- **Bring help.** Spirit Jellyfish.\n\nLore: ||Margit is Morgott||\n\n**Next:**\n- → What drops from him?',
  g: 'Elden Ring',
  s: ['web-search', 'fandom-wiki'],
};

// ── Round trip ───────────────────────────────────────────────────────────
const encoded = await encodeShare(SAMPLE);
check('encodes to base64url with a format tag', /^[zj][A-Za-z0-9_-]+$/.test(encoded), encoded.slice(0, 20));
const back = await decodeShare(encoded);
check('round trip keeps the question', back?.q === SAMPLE.q);
check('round trip keeps the answer, spoiler markup included', back?.a === SAMPLE.a);
check('round trip keeps the game', back?.g === 'Elden Ring');
check('round trip keeps the sources', JSON.stringify(back?.s) === JSON.stringify(SAMPLE.s));
check('compressed form is used where available', encoded[0] === 'z');

// A realistic long answer still makes a link people can paste.
const long = { q: 'Best mage build?', a: ('Intelligence scaling and the Moonveil katana are the core. '.repeat(60)).trim() };
const longEncoded = await encodeShare(long);
check('a 3.5k-character answer compresses to well under 2k characters', longEncoded.length < 2000, String(longEncoded.length));

const url = await buildShareUrl(SAMPLE, 'https://example.test', '/');
check('link puts the payload in the fragment', url.startsWith(`https://example.test/#${SHARE_PREFIX}z`));
check('link payload decodes', (await decodeShare(url.split(`#${SHARE_PREFIX}`)[1]))?.a === SAMPLE.a);

// ── Hostile / broken input ───────────────────────────────────────────────
check('empty → null', (await decodeShare('')) === null);
check('unknown format tag → null', (await decodeShare('x' + encoded.slice(1))) === null);
check('non-base64url characters → null', (await decodeShare('z<script>alert(1)</script>')) === null);
check('truncated link → null (does not throw)', (await decodeShare(encoded.slice(0, Math.floor(encoded.length / 2)))) === null);
check('absurdly long fragment → null without decoding', (await decodeShare('z' + 'A'.repeat(60_000))) === null);

const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
check('plain-JSON form with the wrong version → null', (await decodeShare('j' + b64(JSON.stringify({ v: 2, a: 'hi' })))) === null);
check('plain-JSON form without an answer → null', (await decodeShare('j' + b64(JSON.stringify({ v: 1, q: 'hi' })))) === null);
check('plain-JSON form that is not JSON → null', (await decodeShare('j' + b64('{nope'))) === null);
check('plain-JSON form with a non-string answer → null', (await decodeShare('j' + b64(JSON.stringify({ v: 1, a: { html: '<img>' } })))) === null);

// Deflate bomb: a few KB of stream that inflates past the cap must stop at
// the cap instead of allocating the whole thing.
const bombSource = new TextEncoder().encode(JSON.stringify({ v: 1, a: 'A'.repeat(2_000_000) }));
const bombStream = new Blob([bombSource]).stream().pipeThrough(new CompressionStream('deflate-raw'));
const bombBytes = new Uint8Array(await new Response(bombStream).arrayBuffer());
let bin = '';
for (const b of bombBytes) bin += String.fromCharCode(b);
const bomb = 'z' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
check('the bomb itself is small enough to get past the length check', bomb.length < 48_000, String(bomb.length));
check('a deflate bomb decodes to null instead of 2 MB', (await decodeShare(bomb)) === null);

// ── Normalisation clips and drops, never trusts ──────────────────────────
const clipped = normalizeShare({ v: 1, q: 'q'.repeat(5000), a: 'a'.repeat(50_000), g: 'g'.repeat(500), s: ['x'.repeat(100), 7, null, 'wiki', 'wiki'] });
check('question clipped', clipped.q.length === 1500);
check('answer clipped', clipped.a.length === 16_000);
check('game clipped', clipped.g.length === 80);
check('sources: non-strings dropped, duplicates merged, each clipped', JSON.stringify(clipped.s) === JSON.stringify(['x'.repeat(40), 'wiki']));
check('missing game becomes null, not ""', normalizeShare({ v: 1, a: 'ok' }).g === null);
check('nothing to share throws on encode', await encodeShare({ a: '   ' }).then(() => false, () => true));

console.log(`share: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
