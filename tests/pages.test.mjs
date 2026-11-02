// How an address becomes a page, and what each page says about itself:
// the URL reader (src/site/route.js), the per-view title / description /
// canonical (src/site/meta.js) against index.html, the stale-deploy reload
// guard (src/utils/chunkReload.js) and the install offer (src/utils/install.js). The 404 itself is a view, so
// "unknown address" is tested here as the reader's answer.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readViewFromLocation } from '../src/site/route.js';
import { VIEW_META, ORIGIN, metaFor, applyMeta, canonicalUrl } from '../src/site/meta.js';
import { shouldReload, RELOAD_KEY, RELOAD_WINDOW_MS } from '../src/utils/chunkReload.js';
import { isIos, isStandalone, installMode } from '../src/utils/install.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

// ── The URL reader ─────────────────────────────────────────────────────────
const ALL = new Set(['landing', 'chat', 'upgrade', 'about', 'terms', 'privacy', 'refunds', 'delivery', 'contacts']);
const view = (hash = '', pathname = '/') => readViewFromLocation({ hash, pathname }, ALL);

check('the bare site has no opinion (the app picks landing or chat)', view() === null);
check('index.html is the bare site', view('', '/index.html') === null);
check('an unknown path is a 404', view('', '/asdf') === 'notfound' && view('', '/a/b/c') === 'notfound');
check('a trailing slash is not a different page', view('', '/') === null && view('', '//') === null);
for (const v of ALL) check(`#${v} is the ${v} view`, view(`#${v}`) === v || (v === 'upgrade' && view('#upgrade') === 'upgrade'));
check('a leading slash after # is fine', view('#/about') === 'about');
check('case is ignored for view names', view('#About') === 'about' && view('#TERMS') === 'terms');
check('a trailing slash after a view is fine', view('#about/') === 'about');
check('the hash beats the path', view('#about', '/asdf') === 'about');
check('upgrade links carry a token', view('#upgrade/eyJhbGciOi.signed') === 'upgrade' && view('#upgrade/thanks') === 'upgrade');
check('share links are share, bare or full', view('#share/AbCdEf_-') === 'share' && view('#share') === 'share');
check('an unknown hash is a 404, not the landing page', view('#nonsense') === 'notfound' && view('#nonsense/deeper') === 'notfound');
check('a hash that names the 404 is a 404', view('#notfound') === 'notfound');

// Google sign-in returns to the site root with the session in the fragment.
// Those must never flash a 404; they belong to whatever put them there.
check('a sign-in redirect is left alone', view('#access_token=eyJ.abc.def&expires_at=1&refresh_token=x&token_type=bearer') === null);
check('a failed sign-in is left alone', view('#error=access_denied&error_code=bad_oauth&error_description=nope') === null);
check('anything query-shaped is left alone', view('#a=1') === null && view('#a b') === null);

// ── Per-view metadata ──────────────────────────────────────────────────────
const views = Object.keys(VIEW_META);
check('every hash view has meta', [...ALL].every(v => VIEW_META[v]) && !!VIEW_META.share && !!VIEW_META.notfound);
check('titles are short enough to read in a tab', views.every(v => VIEW_META[v].title.length <= 60), views.filter(v => VIEW_META[v].title.length > 60).join());
check('descriptions are a sentence or two', views.every(v => VIEW_META[v].description.length >= 30 && VIEW_META[v].description.length <= 200));
check('no em-dash or en-dash in any title or description', views.every(v => !/[—–]/.test(VIEW_META[v].title + VIEW_META[v].description + (VIEW_META[v].share || ''))));
check('titles are unique, so tabs and bookmarks tell pages apart', new Set(views.map(v => VIEW_META[v].title)).size === views.length);
check('canonical paths are absolute paths, or none at all', views.every(v => VIEW_META[v].path === null || /^\/[a-z-]*$/.test(VIEW_META[v].path)));
check('the 404 has no canonical and is noindex', canonicalUrl(VIEW_META.notfound) === null && VIEW_META.notfound.robots === 'noindex');
check('a shared answer is never indexed', VIEW_META.share.robots === 'noindex');
check('public pages carry no robots tag', ['landing', 'chat', 'about', 'terms', 'privacy', 'refunds', 'delivery', 'contacts', 'upgrade'].every(v => !VIEW_META[v].robots));
check('an unknown view gets the landing meta', metaFor('nope').title === VIEW_META.landing.title);
check('overrides replace fields', metaFor('share', { title: 'Shared answer: Elden Ring | GameGuide' }).title === 'Shared answer: Elden Ring | GameGuide');
check('a long override is cut', metaFor('share', { title: 'x'.repeat(300) }).title.length <= 70);
check('canonical URLs are on the production origin', canonicalUrl(VIEW_META.terms) === `${ORIGIN}/terms`);

// ── index.html says what the landing entry says ────────────────────────────
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const grab = (rx) => (rx.exec(html) || [])[1];
const L = VIEW_META.landing;
check('static <title> is the landing title', grab(/<title>([^<]*)<\/title>/) === L.title, grab(/<title>([^<]*)<\/title>/));
check('static description is the landing description', grab(/<meta name="description" content="([^"]*)"/) === L.description);
check('static canonical is the landing canonical', grab(/<link rel="canonical" href="([^"]*)"/) === canonicalUrl(L));
check('og:title and twitter:title are the title', grab(/property="og:title" content="([^"]*)"/) === L.title && grab(/name="twitter:title" content="([^"]*)"/) === L.title);
check('og:url is the canonical', grab(/property="og:url" content="([^"]*)"/) === canonicalUrl(L));
check('share-card descriptions are the landing share line', grab(/property="og:description" content="([^"]*)"/) === L.share && grab(/name="twitter:description" content="([^"]*)"/) === L.share);
check('index.html head has no em-dash', !/[—–]/.test(html.slice(0, html.indexOf('</head>'))));

// Each canonical path must forward, through the inline script in index.html,
// to its own view. This reads the script's own alias table, so they cannot drift.
{
  const aliasSrc = /var alias = (\{[\s\S]*?\});/.exec(html)?.[1] || '{}';
  const alias = Function(`return ${aliasSrc}`)();
  const known = new Set(((/\/\^\(([^)]+)\)\$\/\.test\(view\)/.exec(html) || [])[1] || '').split('|'));
  for (const v of ['about', 'terms', 'privacy', 'refunds', 'delivery', 'contacts', 'upgrade']) {
    const p = VIEW_META[v].path.slice(1);
    const target = alias[p] || p;
    check(`${VIEW_META[v].path} forwards to the ${v} view`, target === v && known.has(target), `${p} -> ${target}`);
  }
  check('/chat forwards too', known.has('chat'));
}

// ── applyMeta, against a minimal stand-in for the document ─────────────────
function fakeDoc(seed = []) {
  const make = (tag) => {
    const el = { tag, attrs: {}, setAttribute(k, v) { el.attrs[k] = String(v); }, getAttribute(k) { return el.attrs[k] ?? null; }, remove() { const i = head.els.indexOf(el); if (i >= 0) head.els.splice(i, 1); } };
    return el;
  };
  const head = {
    els: [],
    appendChild(e) { this.els.push(e); },
    querySelector(sel) {
      const m = /^(\w+)\[([\w:-]+)="([^"]+)"\]$/.exec(sel);
      return this.els.find(e => e.tag === m[1] && e.attrs[m[2]] === m[3]) || null;
    },
  };
  for (const [tag, attrs] of seed) { const e = make(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); head.els.push(e); }
  return { title: '', head, createElement: make };
}
{
  const doc = fakeDoc([
    ['meta', { name: 'description', content: 'old' }],
    ['link', { rel: 'canonical', href: `${ORIGIN}/` }],
    ['meta', { property: 'og:title', content: 'old' }],
    ['meta', { property: 'og:url', content: `${ORIGIN}/` }],
    ['meta', { name: 'twitter:description', content: 'old' }],
  ]);
  applyMeta(metaFor('terms'), doc);
  check('applyMeta sets the title', doc.title === VIEW_META.terms.title);
  check('applyMeta sets the description', doc.head.querySelector('meta[name="description"]').getAttribute('content') === VIEW_META.terms.description);
  check('applyMeta sets the canonical', doc.head.querySelector('link[rel="canonical"]').getAttribute('href') === `${ORIGIN}/terms`);
  check('applyMeta keeps share cards in step', doc.head.querySelector('meta[property="og:url"]').getAttribute('content') === `${ORIGIN}/terms`
    && doc.head.querySelector('meta[property="og:title"]').getAttribute('content') === VIEW_META.terms.title
    && doc.head.querySelector('meta[name="twitter:description"]').getAttribute('content') === VIEW_META.terms.description);
  check('applyMeta adds no robots tag to a public page', doc.head.querySelector('meta[name="robots"]') === null);

  applyMeta(metaFor('notfound'), doc);
  check('a 404 gets noindex', doc.head.querySelector('meta[name="robots"]')?.getAttribute('content') === 'noindex');
  check('a 404 drops the canonical', doc.head.querySelector('link[rel="canonical"]') === null);

  applyMeta(metaFor('landing'), doc);
  check('leaving a 404 removes noindex', doc.head.querySelector('meta[name="robots"]') === null);
  check('leaving a 404 restores the canonical', doc.head.querySelector('link[rel="canonical"]')?.getAttribute('href') === `${ORIGIN}/`);
  check('the landing share line comes back', doc.head.querySelector('meta[name="twitter:description"]').getAttribute('content') === VIEW_META.landing.share);

  applyMeta(metaFor('about'), fakeDoc());
  check('applyMeta works on a head with none of the tags', true);
}

// ── The stale-deploy reload guard ──────────────────────────────────────────
const store = (init = {}) => { const m = { ...init }; return { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, m }; };
{
  const s = store();
  const t0 = 1_000_000;
  check('the first failure reloads', shouldReload(s, t0) === true);
  check('it remembers when', s.m[RELOAD_KEY] === String(t0));
  check('a second failure right after does not (no loop)', shouldReload(s, t0 + 5_000) === false);
  check('still not just inside the window', shouldReload(s, t0 + RELOAD_WINDOW_MS - 1) === false);
  check('after the window it may try again', shouldReload(s, t0 + RELOAD_WINDOW_MS) === true);
  check('blocked storage never reloads (it could not stop a loop)', shouldReload({ getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } }) === false);
  check('garbage in storage counts as never', shouldReload(store({ [RELOAD_KEY]: 'banana' }), t0) === true);
}

// ── "Install app" ──────────────────────────────────────────────────────────
const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 };
const IPAD_AS_MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
const MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 };
const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', platform: 'Linux armv8l', maxTouchPoints: 5 };
check('an iPhone is iOS', isIos(IPHONE));
check('an iPad that says it is a Mac is iOS', isIos(IPAD_AS_MAC));
check('a real Mac is not', !isIos(MAC));
check('Android is not', !isIos(ANDROID));
check('no navigator is not', !isIos(null) && !isIos({}));

const win = (standalone, mq) => ({ navigator: { standalone }, matchMedia: () => ({ matches: mq }) });
check('an iOS home-screen app is standalone', isStandalone(win(true, false)));
check('a Chromium app window is standalone', isStandalone(win(undefined, true)));
check('a normal tab is not', !isStandalone(win(false, false)) && !isStandalone(win(undefined, false)));
check('a browser without matchMedia is not', !isStandalone({ navigator: {} }) && !isStandalone(null));
check('a throwing matchMedia is not', !isStandalone({ navigator: {}, matchMedia() { throw new Error('no'); } }));

check('a Chromium prompt in hand: offer the prompt', installMode({ hasPrompt: true, installed: false, ios: false }) === 'prompt');
check('iOS has no prompt: offer the steps', installMode({ hasPrompt: false, installed: false, ios: true }) === 'ios');
check('anywhere else with no prompt: offer nothing', installMode({ hasPrompt: false, installed: false, ios: false }) === null);
check('once installed: offer nothing, even with a prompt or on iOS', installMode({ hasPrompt: true, installed: true, ios: false }) === null && installMode({ hasPrompt: false, installed: true, ios: true }) === null);

{
  const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'manifest.webmanifest'), 'utf8'));
  const sizes = (manifest.icons || []).filter(i => i.type === 'image/png').map(i => i.sizes);
  check('the manifest has what installability needs', !!manifest.name && !!manifest.short_name && !!manifest.start_url && manifest.display === 'standalone');
  check('with 192px and 512px PNG icons', sizes.includes('192x192') && sizes.includes('512x512'));
  check('and a maskable icon', (manifest.icons || []).some(i => /maskable/.test(i.purpose || '')));
  check('the manifest copy has no em-dash', !/[—–]/.test(`${manifest.name} ${manifest.description}`));
  check('the early listener is in index.html', /addEventListener\('beforeinstallprompt'/.test(html) && /__ggInstall/.test(html));
}

console.log(`pages: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
