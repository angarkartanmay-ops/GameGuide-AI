// How an address becomes a page, and what each page says about itself:
// the URL reader (src/site/route.js), the per-view title / description /
// canonical (src/site/meta.js) against index.html and its inline redirect script, the stale-deploy reload
// guard (src/utils/chunkReload.js) and the install offer (src/utils/install.js). The 404 itself is a view, so
// "unknown address" is tested here as the reader's answer.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  ROUTES, ALL_VIEWS, readViewFromLocation, readShare, sharePayloadFromPath, sharePath, legacyRedirect,
  pathForView, viewForPath, isAliasPath,
} from '../src/site/route.js';
import { VIEW_META, ORIGIN, LOCALE, metaFor, applyMeta, canonicalUrl } from '../src/site/meta.js';
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
const view = (pathname = '/', hash = '') => readViewFromLocation({ hash, pathname });

check('the bare site has no opinion (the app picks landing or chat)', view('/') === null);
check('index.html is the bare site', view('/index.html') === null);
check('an unknown path is a 404', view('/asdf') === 'notfound' && view('/a/b/c') === 'notfound' && view('/favicon.ico') === 'notfound');
check('a trailing slash is not a different page', view('/about/') === 'about' && view('//') === null);
for (const r of ROUTES.filter(r => r.view !== 'landing')) {
  check(`${r.path} is the ${r.view} view`, view(r.path) === r.view);
  check(`${r.path} survives case and a trailing slash`, view(r.path.toUpperCase() + '/') === r.view);
  for (const a of r.aliases) check(`${a} is an alias of ${r.view}`, view(a) === r.view && isAliasPath(a) && !isAliasPath(r.path));
}
check('Razorpay-era paths still work', view('/refund-policy') === 'refunds' && view('/contact-us') === 'contacts' && view('/delivery-policy') === 'delivery' && view('/terms-and-conditions') === 'terms');
check('no path is claimed by two views', new Set(ROUTES.flatMap(r => [r.path, ...r.aliases])).size === ROUTES.flatMap(r => [r.path, ...r.aliases]).length);
check('every canonical path is lowercase and flat', ROUTES.every(r => /^\/[a-z]*$/.test(r.path)));
check('pathForView is the inverse of viewForPath', ROUTES.every(r => viewForPath(pathForView(r.view)) === r.view));
check('share and notfound have no path of their own', pathForView('share') === null && pathForView('notfound') === null);

// Old hash links still open the right page (the app reads them even if the inline script has not moved them).
for (const v of ALL_VIEWS) check(`/#${v} is the ${v} view`, view('/', `#${v}`) === v);
check('a leading slash after # is fine', view('/', '#/about') === 'about');
check('case is ignored for hash view names', view('/', '#About') === 'about' && view('/', '#TERMS') === 'terms');
check('upgrade links carry a token', view('/', '#upgrade/eyJhbGciOi.signed') === 'upgrade' && view('/', '#upgrade/thanks') === 'upgrade' && view('/pricing', '#upgrade/thanks') === 'upgrade');
check('a path beats a stray hash', view('/terms', '#about') === 'terms' && view('/asdf', '#about') === 'notfound');
check('an unknown hash at the root is a 404, not the landing page', view('/', '#nonsense') === 'notfound' && view('/', '#nonsense/deeper') === 'notfound');
check('a hash that names the 404 is a 404', view('/', '#notfound') === 'notfound');
check('#main (the skip link) on a page does not turn it into a 404', view('/about', '#main') === 'about' && view('/pricing', '#main') === 'upgrade');

// Shares: a path made today, a fragment made before.
check('/share/<payload> is a share', view('/share/zAbC_-9') === 'share' && readShare({ pathname: '/share/zAbC_-9', hash: '' })?.encoded === 'zAbC_-9');
check('the payload keeps its case', readShare({ pathname: '/share/zAbCdEf', hash: '' })?.encoded === 'zAbCdEf' && readShare({ pathname: '/SHARE/zAbCdEf', hash: '' })?.encoded === 'zAbCdEf');
check('a path share says it is in the path', readShare({ pathname: '/share/zAbC', hash: '' })?.where === 'path');
check('an old fragment share still opens, and says where it is', view('/', '#share/AbCdEf_-') === 'share' && readShare({ pathname: '/', hash: '#share/AbCdEf_-' })?.where === 'fragment' && readShare({ pathname: '/', hash: '#share/AbCdEf_-' })?.encoded === 'AbCdEf_-');
check('a cut-short share link is a share the page can explain', view('/share') === 'share' && readShare({ pathname: '/share', hash: '' })?.encoded === '' && view('/', '#share') === 'share');
check('a share is not confused with a page that starts with the same letters', view('/shared') === 'notfound' && readShare({ pathname: '/shared', hash: '' }) === null);
check('only a single segment is a payload', sharePayloadFromPath('/share/a/b') === null && sharePayloadFromPath('/share/') === null && sharePayloadFromPath('/about') === null);
check('sharePath builds what sharePayloadFromPath reads', sharePayloadFromPath(sharePath('zAbC_-9')) === 'zAbC_-9');

// Google sign-in returns to the site root with the session in the fragment.
// Those must never flash a 404; they belong to whatever put them there.
check('a sign-in redirect is left alone', view('/', '#access_token=eyJ.abc.def&expires_at=1&refresh_token=x&token_type=bearer') === null);
check('a failed sign-in is left alone', view('/', '#error=access_denied&error_code=bad_oauth&error_description=nope') === null);
check('anything query-shaped is left alone', view('/', '#a=1') === null && view('/', '#a b') === null);

// ── Old links move to the new addresses ────────────────────────────────────
const redirect = (pathname, hash) => legacyRedirect({ pathname, hash });
check('/#about moves to /about', JSON.stringify(redirect('/', '#about')) === JSON.stringify({ path: '/about', hash: '' }));
check('/#refunds moves to /refunds, /#upgrade to /pricing', redirect('/', '#refunds')?.path === '/refunds' && redirect('/', '#upgrade')?.path === '/pricing');
check('/#chat moves to /chat and /#landing to /', redirect('/', '#chat')?.path === '/chat' && redirect('/', '#landing')?.path === '/');
check('a signed upgrade link keeps its token, case and all', JSON.stringify(redirect('/', '#upgrade/v1.AbC.dEf')) === JSON.stringify({ path: '/pricing', hash: '#upgrade/v1.AbC.dEf' }));
check('the payment return URL keeps its marker', JSON.stringify(redirect('/', '#upgrade/thanks')) === JSON.stringify({ path: '/pricing', hash: '#upgrade/thanks' }));
check('hash names are case-insensitive but their token is not', redirect('/', '#Upgrade/AbC')?.hash === '#upgrade/AbC');
check('a share in a fragment is never moved to the path', redirect('/', '#share/AbC') === null && redirect('/', '#share') === null);
check('a sign-in fragment is never moved', redirect('/', '#access_token=a.b.c&x=1') === null);
check('an unknown hash is left for the app to call a 404', redirect('/', '#nonsense') === null && redirect('/', '#constructor') === null && redirect('/', '#__proto__') === null);
check('only the root carries old links', redirect('/about', '#terms') === null && redirect('/asdf', '#about') === null);
check('no hash, nothing to move', redirect('/', '') === null && redirect('/', '#') === null);

// ── Per-view metadata ──────────────────────────────────────────────────────
const views = Object.keys(VIEW_META);
check('every view has meta', [...ALL_VIEWS].every(v => VIEW_META[v]) && !!VIEW_META.share && !!VIEW_META.notfound);
check('titles are short enough to read in a tab', views.every(v => VIEW_META[v].title.length <= 60), views.filter(v => VIEW_META[v].title.length > 60).join());
check('descriptions are a sentence or two', views.every(v => VIEW_META[v].description.length >= 30 && VIEW_META[v].description.length <= 200));
check('no em-dash or en-dash in any title or description', views.every(v => !/[—–]/.test(VIEW_META[v].title + VIEW_META[v].description + (VIEW_META[v].share || ''))));
check('titles are unique, so tabs and bookmarks tell pages apart', new Set(views.map(v => VIEW_META[v].title)).size === views.length);
check('canonical paths are absolute paths, or none at all', views.every(v => VIEW_META[v].path === null || /^\/[a-z-]*$/.test(VIEW_META[v].path)));
check('each page canonical is its route path', ROUTES.every(r => VIEW_META[r.view].path === r.path));
check('the 404 has no canonical and is noindex', canonicalUrl(VIEW_META.notfound) === null && VIEW_META.notfound.robots === 'noindex');
check('a shared answer is never indexed and has no canonical', VIEW_META.share.robots === 'noindex' && canonicalUrl(VIEW_META.share) === null);
check('the chat is an app, not a page: noindex but followable', /^noindex/.test(VIEW_META.chat.robots) && /follow/.test(VIEW_META.chat.robots));
check('public pages carry no robots tag', ['landing', 'about', 'terms', 'privacy', 'refunds', 'delivery', 'contacts', 'upgrade'].every(v => !VIEW_META[v].robots));
check('an unknown view gets the landing meta', metaFor('nope').title === VIEW_META.landing.title);
check('overrides replace fields', metaFor('share', { title: 'Shared answer: Elden Ring | GameGuide' }).title === 'Shared answer: Elden Ring | GameGuide');
check('a long override is cut', metaFor('share', { title: 'x'.repeat(300) }).title.length <= 70);
check('canonical URLs are on the production origin', canonicalUrl(VIEW_META.terms) === `${ORIGIN}/terms`);
check('the locale is en_US', LOCALE === 'en_US');

// ── index.html says what the landing entry says ────────────────────────────
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const grab = (rx) => (rx.exec(html) || [])[1];
const L = VIEW_META.landing;
check('static <title> is the landing title', grab(/<title>([^<]*)<\/title>/) === L.title, grab(/<title>([^<]*)<\/title>/));
check('static description is the landing description', grab(/<meta name="description" content="([^"]*)"/) === L.description);
check('static canonical is the landing canonical', grab(/<link rel="canonical" href="([^"]*)"/) === canonicalUrl(L));
check('og:title and twitter:title are the title', grab(/property="og:title" content="([^"]*)"/) === L.title && grab(/name="twitter:title" content="([^"]*)"/) === L.title);
check('og:url is the canonical', grab(/property="og:url" content="([^"]*)"/) === canonicalUrl(L));
check('og:locale is the locale', grab(/property="og:locale" content="([^"]*)"/) === LOCALE);
check('share-card descriptions are the landing share line', grab(/property="og:description" content="([^"]*)"/) === L.share && grab(/name="twitter:description" content="([^"]*)"/) === L.share);
check('index.html head has no em-dash', !/[—–]/.test(html.slice(0, html.indexOf('</head>'))));

// The inline script at the top of index.html moves old hash links to their
// paths before the app starts. Run that exact script against a fake location
// and hold it to legacyRedirect(), so the two cannot drift.
{
  const script = /<script>\s*\/\* Pages have real paths[\s\S]*?\(function \(\) \{([\s\S]*?)\}\)\(\);\s*<\/script>/.exec(html)?.[1];
  check('the redirect script is the first inline script', !!script);
  const run = (pathname, hash, search = '') => {
    const log = [];
    const location = { pathname, hash, search, replace: (u) => log.push(['replace', u]) };
    const history = { replaceState: (_s, _t, u) => log.push(['replaceState', u]) };
    // Only the page's own repo-owned script runs here, in a context that has nothing but these two stand-ins.
    vm.runInNewContext('(function () {' + script + '})()', { location, history });
    return log;
  };
  const cases = [
    ['/', '#about'], ['/', '#terms'], ['/', '#privacy'], ['/', '#refunds'], ['/', '#delivery'], ['/', '#contacts'],
    ['/', '#chat'], ['/', '#landing'], ['/', '#upgrade'], ['/', '#upgrade/thanks'], ['/', '#upgrade/v1.AbC.dEf'], ['/', '#Upgrade/AbC'],
    ['/', '#/about'], ['/', '#About'], ['/index.html', '#about'],
    ['/', '#share/AbC'], ['/', '#share'], ['/', '#access_token=a.b.c&x=1'], ['/', '#nonsense'], ['/', '#constructor'], ['/', '#__proto__'],
    ['/', ''], ['/', '#'], ['/about', '#terms'], ['/asdf', '#about'], ['/pricing', '#upgrade/thanks'],
  ];
  for (const [p, h] of cases) {
    const want = legacyRedirect({ pathname: p, hash: h });
    const got = run(p, h);
    const target = want && `${want.path}${want.hash}`;
    const ok = want
      ? (want.path === '/' ? got.length === 1 && got[0][0] === 'replaceState' && got[0][1] === '/' : got.length === 1 && got[0][0] === 'replace' && got[0][1] === target)
      : got.length === 0;
    check(`index.html and legacyRedirect agree on ${p}${h}`, ok, JSON.stringify({ want, got }));
  }
  check('a query string rides along', JSON.stringify(run('/', '#about', '?ref=ph')) === JSON.stringify([['replace', '/about?ref=ph']]));
  check('the script has no alias table for paths any more (real pages need none)', !/var alias/.test(html));
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
