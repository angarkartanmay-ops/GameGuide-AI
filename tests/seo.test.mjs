// Structured data and the sitemap (src/site/seo.js, src/site/faq.js).
// Search engines publish the rules for each markup type, and they reject (or
// stop trusting) markup that breaks them: a required field missing, a question
// that is not on the page, a date in the future. Those rules are the tests.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  organization, webSite, webApplication, breadcrumbList, faqPage, jsonLdFor, jsonLdText,
  sitemapXml, sitemapViews, LASTMOD, CRUMB_NAMES, ORG_ID, SITE_ID,
} from '../src/site/seo.js';
import { FAQ } from '../src/site/faq.js';
import { ROUTES, pathForView } from '../src/site/route.js';
import { ORIGIN, VIEW_META } from '../src/site/meta.js';
import { LINKS } from '../src/site/links.js';
import { PLANS } from '../src/site/pricing.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const everyBlock = ROUTES.flatMap((r) => jsonLdFor(r.view));

// ── Organization ───────────────────────────────────────────────────────────
{
  const o = organization();
  check('Organization has the type, a stable id, a name and the home page url', o['@type'] === 'Organization' && o['@id'] === ORG_ID && o.name === 'GameGuide' && o.url === `${ORIGIN}/`);
  check('the logo is an image of at least 112x112 (the minimum Google asks for)', o.logo['@type'] === 'ImageObject' && o.logo.width >= 112 && o.logo.height >= 112 && o.logo.url === `${ORIGIN}/icon-512.png`);
  check('...and that file is shipped', (() => { try { read('public', 'icon-512.png'); return true; } catch { return false; } })());
  check('support contact: the address the site publishes', o.contactPoint[0].email === LINKS.email && o.contactPoint[0].contactType === 'customer support');
  check('sameAs are https profiles with no tracking parameters', o.sameAs.length >= 3 && o.sameAs.every((u) => isHttps(u) && !new URL(u).search), o.sameAs.join(' '));
  check('the founder is named as the About page names them', o.founder.name === 'Tanmay Angarkar' && /Tanmay Angarkar/.test(read('src', 'components', 'InfoContent.jsx')));
  check('the site is published by the organisation (an @id reference, not a copy)', webSite().publisher['@id'] === ORG_ID && webSite()['@id'] === SITE_ID && webApplication().publisher['@id'] === ORG_ID);
}

// ── WebApplication ─────────────────────────────────────────────────────────
{
  const w = webApplication();
  check('WebApplication: name, url, category, offer', w.name === 'GameGuide' && w.url === `${ORIGIN}/` && w.applicationCategory === 'GameApplication' && w.offers.price === '0');
  check('its free offer matches the free plan', PLANS.find((p) => p.id === 'free') && !PLANS.find((p) => p.id === 'free').offers);
}

// ── BreadcrumbList ─────────────────────────────────────────────────────────
for (const view of Object.keys(CRUMB_NAMES)) {
  const b = breadcrumbList(view);
  const items = b.itemListElement;
  check(`${view}: two items, positions 1 and 2`, items.length === 2 && items.map((i) => i.position).join() === '1,2');
  check(`${view}: Home first, then this page, by its own canonical address`, items[0].name === 'Home' && items[0].item === `${ORIGIN}/` && items[1].item === `${ORIGIN}${pathForView(view)}` && items[1].name === CRUMB_NAMES[view]);
}
check('the home page has no trail', breadcrumbList('landing') === null && breadcrumbList('chat') === null && breadcrumbList('share') === null && breadcrumbList('notfound') === null);
check('every crumb name is used on a page that exists', Object.keys(CRUMB_NAMES).every((v) => ROUTES.some((r) => r.view === v)));

// ── FAQPage ────────────────────────────────────────────────────────────────
{
  const f = faqPage();
  check('FAQPage: one Question per FAQ entry, each with one accepted Answer', f.mainEntity.length === FAQ.length && f.mainEntity.every((q) => q['@type'] === 'Question' && q.name && q.acceptedAnswer['@type'] === 'Answer' && q.acceptedAnswer.text));
  check('the questions are real questions, unique', FAQ.every((e) => e.q.endsWith('?')) && new Set(FAQ.map((e) => e.q)).size === FAQ.length);
  check('answers are plain text (the same string is shown and marked up)', FAQ.every((e) => !/[<>]/.test(e.a)));
  check('answers are a sentence or three', FAQ.every((e) => e.a.length >= 40 && e.a.length <= 420));
  check('the free-plan answer quotes the plans table', new RegExp(PLANS[0].features[0].replace(/\s/g, '\\s')).test(FAQ[0].a));
  check('no em-dash in any question or answer', FAQ.every((e) => !/[—–]/.test(e.q + e.a)));
  const about = read('src', 'components', 'InfoContent.jsx');
  check('the About page renders that same list (the markup describes visible text)', /FAQ\.map/.test(about) && /from '\.\.\/site\/faq'/.test(about));
}

// ── What goes on which page ────────────────────────────────────────────────
const types = (view) => jsonLdFor(view).map((b) => b['@type']);
check('home: Organization, WebSite, WebApplication', types('landing').join() === 'Organization,WebSite,WebApplication');
check('about: Organization, BreadcrumbList, FAQPage', types('about').join() === 'Organization,BreadcrumbList,FAQPage');
check('the other pages: a trail and nothing else', ['terms', 'privacy', 'refunds', 'delivery', 'contacts', 'upgrade'].every((v) => types(v).join() === 'BreadcrumbList'));
check('the chat, a share and a 404 carry no structured data', ['chat', 'share', 'notfound'].every((v) => jsonLdFor(v).length === 0));
check('FAQPage appears on one page only', ROUTES.filter((r) => types(r.view).includes('FAQPage')).length === 1);
check('every block declares the schema.org context', everyBlock.every((b) => b['@context'] === 'https://schema.org'));
check('every block survives a round trip through JSON', everyBlock.every((b) => JSON.stringify(JSON.parse(jsonLdText(b))) === JSON.stringify(JSON.parse(JSON.stringify(b)))));
check('a "<" in markup is escaped so it cannot close the script tag', !jsonLdText({ a: '</script><script>alert(1)' }).includes('<') && JSON.parse(jsonLdText({ a: '</script>' })).a === '</script>');
check('every address in the markup is on the production origin or an https profile', JSON.stringify(everyBlock).match(/https?:\/\/[^"\\]+/g).every((u) => u.startsWith('https://')));

// ── Sitemap ────────────────────────────────────────────────────────────────
{
  const xml = sitemapXml();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const mods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
  check('the sitemap is the pages worth listing: home, about, terms, privacy, refunds, delivery, contacts, pricing',
    locs.join() === ['/', '/about', '/terms', '/privacy', '/refunds', '/delivery', '/contacts', '/pricing'].map((p) => `${ORIGIN}${p}`).join());
  check('each address is its page\'s canonical', sitemapViews().every((v) => locs.includes(`${ORIGIN}${VIEW_META[v].path}`)));
  check('no alias, no chat, no share, no 404', !locs.some((l) => /refund-policy|contact-us|\/chat|\/share|404/.test(l)));
  check('every lastmod is a real date, not in the future', mods.length === locs.length && mods.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && Date.parse(d) <= Date.now() + 864e5));
  check('lastmod is set per page, not one date for all', new Set(Object.values(LASTMOD)).size > 1);
  check('the file in public/ is exactly what the build writes', read('public', 'sitemap.xml').replace(/\r\n/g, '\n') === xml);
  check('it is well-formed enough: one urlset, as many url as loc', (xml.match(/<url>/g) || []).length === locs.length && /^<\?xml/.test(xml) && /<\/urlset>\n$/.test(xml));
  check('no page that is noindex is listed', sitemapViews().every((v) => !VIEW_META[v].robots));
  const robots = read('public', 'robots.txt');
  check('robots.txt points at the sitemap', robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`));
  check('robots.txt does not block the share previews (X, Slack and Discord must be able to fetch /share/...)', !/^\s*Disallow:\s*\/share/im.test(robots));
  check('llms.txt links are real paths now', !/\/#/.test(read('public', 'llms.txt')) && /gameguide\.online\/about/.test(read('public', 'llms.txt')));
}

console.log(`seo: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
