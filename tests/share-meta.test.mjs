// The preview card for a shared link (api/_shareMeta.js, api/share.js).
// A share is written by whoever made the link, so the contract is mostly about
// what must NOT happen: a spoiler in the card, markup from the payload in the
// page, a shared answer in a search index.

import { encodeShare, MAX_PATH_PAYLOAD } from '../src/utils/share.js';
import {
  escapeHtml, clip, withoutSpoilers, plainText, describeShare, previewTags, renderShell,
  FALLBACK_DESCRIPTION, SHARE_BASE, SITE,
} from '../api/_shareMeta.js';
import { handleShare } from '../api/share.js';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

// ── escaping ───────────────────────────────────────────────────────────────
check('escapes the five characters that matter', escapeHtml(`<a href="x" onclick='y'>&`) === '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
check('null and undefined become empty text', escapeHtml(null) === '' && escapeHtml(undefined) === '');

// ── clipping ───────────────────────────────────────────────────────────────
check('short text is untouched', clip('hello world', 50) === 'hello world');
check('long text is cut at a word with an ellipsis', clip('one two three four five six', 15) === 'one two three…', clip('one two three four five six', 15));
check('a cut never exceeds the limit', clip('x'.repeat(500), 70).length <= 70);
check('no trailing punctuation before the ellipsis', !/[,;:.\s]…$/.test(clip('alpha beta, gamma delta, epsilon zeta', 20)));

// ── spoilers never reach the card ──────────────────────────────────────────
const strip = (t) => plainText(withoutSpoilers(t));
check('a closed span is gone', strip('Bring help. ||Margit is Morgott.|| It is hard.') === 'Bring help. It is hard.', strip('Bring help. ||Margit is Morgott.|| It is hard.'));
check('several spans are all gone', !/secret|twist/.test(strip('a ||secret|| b ||twist|| c')) && strip('a ||secret|| b ||twist|| c') === 'a b c');
check('an unclosed span hides everything after it', strip('Safe part. ||The final boss is Radagon and then') === 'Safe part.', strip('Safe part. ||The final boss is Radagon and then'));
check('a span with markdown inside is still gone', !/Morgott/.test(strip('Lore: ||**Margit** is [Morgott](https://x.test)||. End.')));
check('a span with brackets inside is still gone', !/ending/.test(strip('x ||the [true] ending|| y')));
check('a span across lines is gone', !/hidden/.test(strip('start ||first line\nhidden second line|| end')));
check('pipes in a table are not mistaken for a spoiler', /Boss/.test(strip('| Boss | HP |\n| --- | --- |\n| Margit | 900 |\n\nOutside.')) === false && /Outside/.test(strip('| Boss | HP |\n| --- | --- |\n| Margit | 900 |\n\nOutside.')));
check('inline code with bars is kept literal, not a spoiler', /a\|\|b/.test(strip('use `a||b` here')) || /a\|\|b/.test(withoutSpoilers('use `a||b` here')));
check('a spoiler-only answer leaves nothing', strip('||everything||') === '');

// ── markdown to plain words ────────────────────────────────────────────────
check('headings, bold and bullets lose their marks', plainText('## Beating Margit\n\n- **Bring help.** Spirit Jellyfish.\n- Roll late.') === 'Beating Margit. Bring help. Spirit Jellyfish. Roll late.', plainText('## Beating Margit\n\n- **Bring help.** Spirit Jellyfish.\n- Roll late.'));
check('links keep their text, not their address', plainText('See [the wiki](https://elden.test/margit) now.') === 'See the wiki now.');
check('images and code blocks vanish', plainText('a ![alt](x.png) b\n```js\nsecret()\n```\nc') === 'a b c');
check('html tags are removed', !/</.test(plainText('hi <b>there</b> <img src=x onerror=alert(1)>')));
check('the follow-up block is not part of the answer', plainText('Roll.\n\n**Next:**\n- → What drops from him?') === 'Roll.');
check('"Next" in a sentence is kept', plainText('Next: go left.') === 'Next: go left.');
check('control and bidi characters are dropped', plainText('a‮b​c\u0007d') === 'abcd');

// ── what a link says about itself ──────────────────────────────────────────
const SAMPLE = {
  q: 'How do I beat Margit?',
  a: '## Beating Margit\n\n- **Bring help.** Spirit Jellyfish makes the fight far easier.\n\nLore: ||Margit is Morgott in disguise||\n\n**Next:**\n- → What drops from him?',
  g: 'Elden Ring',
  s: ['web-search'],
};
{
  const d = describeShare({ v: 1, ...SAMPLE });
  check('the title is the question', d.title === 'How do I beat Margit?');
  check('the description opens with the game, then the safe lead', d.description.startsWith('Elden Ring: Beating Margit. Bring help.'), d.description);
  check('no spoiler in the description', !/Morgott|disguise/.test(d.description));
  check('the label before a hidden spoiler is dropped too', !/Lore/.test(d.description) && d.description.endsWith('easier.'), d.description);
  check('no follow-up chip in the description', !/drops from him/.test(d.description));
  check('the description is a sentence or two', d.description.length <= 200);
}
check('a question that names the game does not repeat it', !describeShare({ v: 1, q: 'Best Elden Ring build?', a: 'Strength and faith.', g: 'Elden Ring' }).description.startsWith('Elden Ring:'));
check('no question: the game makes the title', describeShare({ v: 1, q: '', a: 'Go left.', g: 'Hades' }).title === 'A GameGuide answer about Hades');
check('no question, no game: a plain title', describeShare({ v: 1, q: '', a: 'Go left.', g: null }).title === 'A shared GameGuide answer');
check('an answer that is all spoiler falls back to the standing line', describeShare({ v: 1, q: 'Who wins?', a: '||The hero.||', g: null }).description === FALLBACK_DESCRIPTION);
check('a link that did not decode has generic words', describeShare(null).title === 'Shared answer' && describeShare(null).description === FALLBACK_DESCRIPTION);
check('a long question is clipped for the title', describeShare({ v: 1, q: 'why '.repeat(100), a: 'x', g: null }).title.length <= 70);

// ── hostile input never becomes markup ─────────────────────────────────────
{
  const evil = { v: 1, q: '"><script>alert(1)</script>', a: '<img src=x onerror=alert(2)> **bold** ' + '"onmouseover="alert(3)', g: "'><svg onload=alert(4)>", s: [] };
  const tags = previewTags({ payload: 'zAbC', share: evil });
  check('no script tag from the payload', !/<script/i.test(tags));
  check('no image or svg tag from the payload', !/<img|<svg/i.test(tags));
  check('every attribute stays inside its quotes', (tags.match(/content="[^"]*"/g) || []).length === (tags.match(/content=/g) || []).length);
  check('quotes in the payload are escaped, not closing the attribute', !/content="[^"]*"onmouseover/.test(tags));
  const lines = tags.split('\n').map(l => l.trim());
  check('every line is one tag (a newline in the payload cannot start another)', lines.every(l => /^<(title|meta|link)\b[^>]*>(<\/title>)?$|^<title>[^<]*<\/title>$/.test(l)), lines.find(l => !/^<(title|meta|link)\b[^>]*>(<\/title>)?$|^<title>[^<]*<\/title>$/.test(l)));
  const nl = previewTags({ payload: 'zAbC', share: { v: 1, q: 'a\n<meta name="robots" content="index">\nb', a: 'x', g: null } });
  check('a newline-and-tag in a question cannot add a robots tag', (nl.match(/name="robots"/g) || []).length === 1 && /noindex/.test(nl));
}

// ── the tags themselves ────────────────────────────────────────────────────
{
  const tags = previewTags({ payload: 'zAbC_-9', share: { v: 1, ...SAMPLE } });
  const one = (rx) => (tags.match(rx) || []).length === 1;
  check('one of each head tag', one(/<title>/g) && one(/name="description"/g) && one(/property="og:title"/g) && one(/property="og:description"/g) && one(/property="og:url"/g) && one(/property="og:image"/g) && one(/name="twitter:card"/g));
  check('title carries the site name', /<title>How do I beat Margit\? \| GameGuide<\/title>/.test(tags));
  check('og:title has no suffix (the site name is its own tag)', /property="og:title" content="How do I beat Margit\?"/.test(tags));
  check('og:url is the share path on the production origin', new RegExp(`property="og:url" content="${SHARE_BASE}/zAbC_-9"`).test(tags));
  check('the card image is the site card', tags.includes(`${SITE}/og.png`));
  check('never indexed, and no canonical', /name="robots" content="noindex, nofollow"/.test(tags) && !/rel="canonical"/.test(tags));
  check('the referrer is not sent onward', /name="referrer" content="no-referrer"/.test(tags));
  check('the locale is there', /property="og:locale" content="en_US"/.test(tags));
  check('no em-dash in anything we add', !/[—–]/.test(tags.replace(/<[^>]*content="How[^"]*"[^>]*>/g, '')));
}

// ── dressing the shell ─────────────────────────────────────────────────────
const SHELL = `<!doctype html><html><head><meta charset="UTF-8" />
    <title>GameGuide: ask anything about any game</title>
    <meta name="description" content="landing words" />
    <link rel="canonical" href="https://gameguide.online/" />
    <meta property="og:title" content="landing" />
    <meta property="og:image" content="https://gameguide.online/og.png" />
    <meta name="twitter:title" content="landing" />
    <meta name="robots" content="index" />
    <script type="application/ld+json">{"@type":"WebApplication"}</script>
    <link rel="icon" href="/favicon.svg" />
  </head><body><div id="root"></div></body></html>`;
{
  const out = renderShell(SHELL, previewTags({ payload: 'zAbC', share: { v: 1, ...SAMPLE } }));
  const n = (rx) => (out.match(rx) || []).length;
  check('exactly one title', n(/<title>/g) === 1 && /How do I beat Margit\?/.test(out) && !/landing words|anything about any game<\/title>/.test(out));
  check('exactly one description, one og:title, one robots', n(/name="description"/g) === 1 && n(/property="og:title"/g) === 1 && n(/name="robots"/g) === 1);
  check('the landing canonical and structured data are gone', !/rel="canonical"/.test(out) && !/ld\+json/.test(out));
  check('unrelated tags and the body survive', /rel="icon"/.test(out) && /<meta charset="UTF-8" \/>/.test(out) && /<div id="root">/.test(out));
  check('the tags sit inside the head', out.indexOf('<title>') < out.indexOf('</head>') && out.indexOf('</head>') < out.indexOf('<body>'));
  check('a shell with no head still gets the tags', /<title>/.test(renderShell('<div id="root"></div>', '<title>x</title>')));
}

// ── the handler ────────────────────────────────────────────────────────────
const encoded = await encodeShare({ q: SAMPLE.q, a: SAMPLE.a, g: SAMPLE.g, s: SAMPLE.s });
const req = (p, method = 'GET') => new Request(`https://gameguide.online/api/share?p=${encodeURIComponent(p)}`, { method });
const shellOk = async () => SHELL;
{
  const res = await handleShare(req(encoded), { loadShell: shellOk });
  const body = await res.text();
  check('a good link is a 200 page', res.status === 200 && /^text\/html/.test(res.headers.get('content-type')));
  check('with the answer\'s own title', /<title>How do I beat Margit\? \| GameGuide<\/title>/.test(body));
  check('and its shell', /<div id="root">/.test(body));
  check('noindex in the header too (a crawler may skip the HTML)', /noindex/.test(res.headers.get('x-robots-tag')));
  check('no referrer leaves the page', res.headers.get('referrer-policy') === 'no-referrer');
  check('nosniff', res.headers.get('x-content-type-options') === 'nosniff');
  check('cacheable at the edge, briefly', /s-maxage=3600/.test(res.headers.get('cache-control')) && /public/.test(res.headers.get('cache-control')));
  check('the spoiler is nowhere in the response', !/Morgott|disguise/.test(body));
}
{
  const res = await handleShare(req(encoded, 'HEAD'), { loadShell: shellOk });
  check('HEAD has the headers and no body', res.status === 200 && (await res.text()) === '');
}
{
  const res = await handleShare(req(encoded, 'POST'), { loadShell: shellOk });
  check('POST is refused', res.status === 405 && /GET/.test(res.headers.get('allow')));
}
for (const [label, p] of [['empty', ''], ['too short', 'z'], ['not base64url', 'z<script>alert(1)</script>'], ['truncated', encoded.slice(0, 30)], ['absurdly long', 'z' + 'A'.repeat(MAX_PATH_PAYLOAD + 10)]]) {
  const res = await handleShare(req(p), { loadShell: shellOk });
  const body = await res.text();
  check(`a ${label} link is a 404 with generic tags`, res.status === 404 && /<title>Shared answer \| GameGuide<\/title>/.test(body) && /noindex/.test(body), `${res.status}`);
  check(`a ${label} link is not cached for long`, !/s-maxage=3600/.test(res.headers.get('cache-control') || ''));
}
{
  const res = await handleShare(req(encoded), { loadShell: async () => null });
  check('no shell: a good link goes to its fragment form', res.status === 302 && res.headers.get('location') === `${SITE}/#share/${encoded}`);
  const bad = await handleShare(req('zzzz'), { loadShell: async () => null });
  check('no shell and no good link: a plain 404', bad.status === 404);
  const boom = await handleShare(req(encoded), { loadShell: async () => { throw new Error('network'); } });
  check('a shell that throws is the same as none', boom.status === 302);
}
check('the payload limit matches the decoder', MAX_PATH_PAYLOAD === 6000);

console.log(`share-meta: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
