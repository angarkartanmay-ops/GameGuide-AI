// The static pages (scripts/prerender.mjs, src/prerender/*). Runs the real
// build step against the real index.html shell into a temp folder, then reads
// what a crawler, a link preview or a reader without JavaScript would get.

import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prerender } from '../scripts/prerender.mjs';
import { applyHead, applyBody, buildPage, PRERENDER_STYLE } from '../src/prerender/shell.js';
import { inlineScriptHashes } from '../src/prerender/csp.js';
import { ROUTES } from '../src/site/route.js';
import { VIEW_META, ORIGIN, LOCALE } from '../src/site/meta.js';
import { jsonLdFor, sitemapXml } from '../src/site/seo.js';
import { FAQ } from '../src/site/faq.js';
import { PLANS } from '../src/site/pricing.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

const SHELL = readFileSync(join(ROOT, 'index.html'), 'utf8');
const out = mkdtempSync(join(tmpdir(), 'gg-prerender-'));
const written = await prerender({ template: join(ROOT, 'index.html'), outDir: out });
const page = (file) => readFileSync(join(out, file), 'utf8');
const decode = (s) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const grab = (html, rx) => (rx.exec(html) || [])[1];
const metaContent = (html, attr, key) => grab(html, new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`));
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

// ── Which files ────────────────────────────────────────────────────────────
const files = written.map((w) => w.file);
for (const r of ROUTES) {
  const f = r.path === '/' ? 'index.html' : `${r.path.slice(1)}/index.html`;
  check(`${r.path} is written as ${f}`, files.includes(f) && existsSync(join(out, f)));
}
check('404.html, share-shell.html and sitemap.xml are written', ['404.html', 'share-shell.html', 'sitemap.xml'].every((f) => files.includes(f)));
check('nothing else is written', files.length === ROUTES.length + 3, files.join());
check('the sitemap is the one src/site/seo.js describes', page('sitemap.xml') === sitemapXml());

// ── Each page says what the app says about it ──────────────────────────────
for (const r of ROUTES) {
  const f = r.path === '/' ? 'index.html' : `${r.path.slice(1)}/index.html`;
  const html = page(f);
  const m = VIEW_META[r.view];
  const social = m.share || m.description;
  const tag = `${r.path} (${r.view})`;
  check(`${tag}: one title, the view's`, (html.match(/<title>/g) || []).length === 1 && grab(html, /<title>([^<]*)<\/title>/) === m.title.replace(/&/g, '&amp;'));
  check(`${tag}: description`, decode(metaContent(html, 'name', 'description')) === m.description);
  check(`${tag}: canonical is the page's own address`, grab(html, /<link rel="canonical" href="([^"]*)"/) === `${ORIGIN}${r.path}`);
  check(`${tag}: og:url, og:title and og:locale`, metaContent(html, 'property', 'og:url') === `${ORIGIN}${r.path}` && decode(metaContent(html, 'property', 'og:title')) === m.title && metaContent(html, 'property', 'og:locale') === LOCALE);
  check(`${tag}: share-card description`, decode(metaContent(html, 'property', 'og:description')) === social && decode(metaContent(html, 'name', 'twitter:description')) === social);
  check(`${tag}: robots is ${m.robots || 'absent'}`, (metaContent(html, 'name', 'robots') || undefined) === m.robots);
  check(`${tag}: exactly one description, one canonical, one og:title`, (html.match(/name="description"/g) || []).length === 1 && (html.match(/rel="canonical"/g) || []).length === 1 && (html.match(/property="og:title"/g) || []).length === 1);
  const blocks = jsonLd(html);
  check(`${tag}: structured data is exactly what seo.js says`, JSON.stringify(blocks) === JSON.stringify(jsonLdFor(r.view)), blocks.map((b) => b['@type']).join());
  check(`${tag}: one h1 in the static text`, (page(f).match(/<h1[ >]/g) || []).length === 1);
  check(`${tag}: the text sits in #root, hidden for people with JavaScript`, /<div id="root"><div data-prerender>/.test(html) && html.includes(`<style>${PRERENDER_STYLE}</style>`));
  check(`${tag}: and shown without it`, /<noscript><style>#root>\[data-prerender\]\{display:block/.test(html));
  check(`${tag}: the hand-written noscript block is gone`, !/<noscript>\s*<div style=/.test(html));
  check(`${tag}: nothing half-rendered`, !/undefined|\[object|NaN</.test(html.replace(/<script[\s\S]*?<\/script>/g, '')));
  check(`${tag}: the app's script is still there`, /<script type="module"/.test(html) || /src="\/src\/main\.jsx"/.test(html));
  // The legal copy predates the no-dash rule and is quoted as written; what the build adds around it (the header, the footer) and the pages written for the build must follow it.
  const written = ['landing', 'chat', 'upgrade'].includes(r.view) ? html.slice(html.indexOf('<div id="root">')) : html.slice(html.indexOf('<header>'), html.indexOf('<main>')) + html.slice(html.indexOf('<footer>'));
  check(`${tag}: the em-dash rule holds for what we wrote`, !/[—–]/.test(written));
  // Every link in the static text goes somewhere real.
  const hrefs = [...html.slice(html.indexOf('<div id="root">')).matchAll(/href="([^"]+)"/g)].map((x) => decode(x[1]));
  const internal = hrefs.filter((h) => h.startsWith('/'));
  const known = new Set(ROUTES.flatMap((x) => [x.path, ...x.aliases]));
  check(`${tag}: internal links are paths of real pages, never /#...`, internal.every((h) => known.has(h.split('#')[0])), internal.filter((h) => !known.has(h.split('#')[0])).join());
  check(`${tag}: the other links are https or mailto`, hrefs.filter((h) => !h.startsWith('/') && !h.startsWith('#')).every((h) => /^(https:\/\/|mailto:)/.test(h)));
}

// ── What is on the pages ───────────────────────────────────────────────────
{
  const home = page('index.html');
  check('home: the static headline is the fallback, not today\'s game', /<h1>Ask anything about any game\.<\/h1>/.test(home));
  check('home: how it works and what it does are in the text', /How it works/.test(home) && /Live research/.test(home) && /Spoiler Shield/.test(home) && /Missables/.test(home));
  check('home: links to the pages it summarises', ['/about', '/pricing', '/terms', '/privacy', '/refunds', '/delivery', '/contacts'].every((p) => home.includes(`href="${p}"`)));
  check('home: Organization, WebSite and WebApplication', jsonLd(home).map((b) => b['@type']).join() === 'Organization,WebSite,WebApplication');
}
{
  const about = decode(page('about/index.html'));
  check('about: every FAQ question and answer is in the static text', FAQ.every((e) => about.includes(e.q) && about.includes(e.a)));
  check('about: FAQPage markup has the same questions', jsonLd(about).find((b) => b['@type'] === 'FAQPage').mainEntity.map((q) => q.name).join('|') === FAQ.map((e) => e.q).join('|'));
}
{
  const pricing = decode(page('pricing/index.html'));
  check('pricing: every plan, its tagline and its features', PLANS.every((p) => pricing.includes(p.name) && pricing.includes(p.tagline) && p.features.every((f) => pricing.includes(f))));
  check('pricing: the prices, in both currencies', ['$2.99', '₹199', '$29.99', '₹1,999', '$4.99', '₹399', '$39.99', '₹3,299', '$14.99', '₹1,199'].every((p) => pricing.includes(p)));
  check('pricing: says how to buy', /\/upgrade/.test(pricing) && /Discord/.test(pricing));
}
check('terms: the document itself, not just a heading', /Acceptance of terms/.test(page('terms/index.html')) && page('terms/index.html').length > 12_000);
check('privacy: names what the site stores', /Share links/.test(page('privacy/index.html')) && /\/share\/redacted/.test(page('privacy/index.html')));
check('refunds, delivery and contact have their own words', /7 days|seven days/i.test(page('refunds/index.html')) && /Nothing is shipped/.test(page('delivery/index.html')) && /gameguideai\.support@gmail\.com/.test(page('contacts/index.html')));
check('the policy pages a payment reviewer reads are real, readable HTML at their own addresses', ['refunds', 'delivery', 'contacts', 'terms', 'privacy'].every((p) => page(`${p}/index.html`).includes(`<h1>`) && page(`${p}/index.html`).includes(`rel="canonical" href="${ORIGIN}/${p}"`)));

// ── The pages that are not pages ───────────────────────────────────────────
{
  const nf = page('404.html');
  check('404.html: noindex, no canonical, no structured data', metaContent(nf, 'name', 'robots') === 'noindex' && !/rel="canonical"/.test(nf) && jsonLd(nf).length === 0 && !/property="og:url"/.test(nf));
  check('404.html: says so', /<title>Page not found \| GameGuide<\/title>/.test(nf) && /No page here\./.test(nf));
  const sh = page('share-shell.html');
  check('share-shell.html: noindex, no canonical, generic words', metaContent(sh, 'name', 'robots') === 'noindex' && !/rel="canonical"/.test(sh) && /<title>Shared answer \| GameGuide<\/title>/.test(sh));
  const chat = page('chat/index.html');
  check('chat: noindex but followable', metaContent(chat, 'name', 'robots') === 'noindex, follow' && /rel="canonical" href="https:\/\/gameguide\.online\/chat"/.test(chat));
}

// ── The inline scripts are unchanged on every page (the CSP names them by hash) ──
{
  const want = JSON.stringify(inlineScriptHashes(SHELL).sort());
  const bad = files.filter((f) => f.endsWith('.html') && JSON.stringify(inlineScriptHashes(page(f)).sort()) !== want);
  check('every page carries exactly the shell\'s inline scripts, byte for byte', bad.length === 0, bad.join());
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const csp = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy-Report-Only').value;
  check('and the policy allows each of them', inlineScriptHashes(page('about/index.html')).every((h) => csp.includes(h)));
}

// ── The shell functions refuse a template that has drifted ─────────────────
{
  const head = { title: 'T', description: 'D', path: '/x' };
  check('the source shell is accepted', typeof applyHead(SHELL, head) === 'string');
  check('a missing og:locale throws', (() => { try { applyHead(SHELL.replace(/<meta property="og:locale"[^>]*>/, ''), head); return false; } catch (e) { return /og:locale/.test(e.message); } })());
  check('a missing canonical throws', (() => { try { applyHead(SHELL.replace(/<link rel="canonical"[^>]*>/, ''), head); return false; } catch (e) { return /canonical/.test(e.message); } })());
  check('a missing #root throws', (() => { try { applyBody(SHELL.replace('<div id="root"></div>', ''), 'x'); return false; } catch (e) { return /#root/.test(e.message); } })());
  check('a "$&" in a title cannot corrupt the page', applyHead(SHELL, { ...head, title: 'Costs $& more $1' }).includes('<title>Costs $&amp; more $1</title>'));
  check('markup in a description is escaped', !/<script>alert/.test(applyHead(SHELL, { ...head, description: '"><script>alert(1)</script>' })));
  check('a path of null removes canonical and og:url', !/rel="canonical"|og:url/.test(applyHead(SHELL, { ...head, path: null })));
  check('the template itself is not changed', SHELL === readFileSync(join(ROOT, 'index.html'), 'utf8') && /<div id="root"><\/div>/.test(SHELL));
  check('buildPage = head then body', /data-prerender/.test(buildPage(SHELL, head, '<p>hi</p>')) && /<p>hi<\/p>/.test(buildPage(SHELL, head, '<p>hi</p>')));
}

rmSync(out, { recursive: true, force: true });
console.log(`prerender: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
