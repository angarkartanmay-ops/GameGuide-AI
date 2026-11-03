// Structured data (JSON-LD) and the sitemap, from one place. Pure functions:
// the build (scripts/prerender.mjs) writes them into each page's static HTML,
// and tests/seo.test.mjs checks them against the rules the search engines
// publish, and against what the pages actually say.
//
//   Organization    who is behind the site: name, logo, contact, profiles
//   WebSite         the site as a whole, published by that organisation
//   WebApplication  the product itself (home page)
//   BreadcrumbList  Home > Page, for every page that is not the home page
//   FAQPage         the questions on the About page (src/site/faq.js)
//
// Markup describes only what a visitor can see on the page, so nothing here is
// invented: names, addresses and counts come from the same constants the
// pages use (links.js, faq.js, meta.js, route.js).

import { LINKS } from './links.js';
import { FAQ } from './faq.js';
import { ORIGIN, VIEW_META } from './meta.js';
import { ROUTES, pathForView } from './route.js';

export const ORG_ID = `${ORIGIN}/#organization`;
export const SITE_ID = `${ORIGIN}/#website`;
const CONTEXT = 'https://schema.org';

/** The product's own listing pages, as profiles of the organisation. */
const PROFILES = [
  LINKS.github,
  LINKS.topgg.split('?')[0],
  'https://www.producthunt.com/products/gameguide-ai',
  LINKS.launchbuff,
];

export function organization() {
  return {
    '@context': CONTEXT,
    '@type': 'Organization',
    '@id': ORG_ID,
    name: 'GameGuide',
    alternateName: 'GameGuide-AI',
    url: `${ORIGIN}/`,
    logo: { '@type': 'ImageObject', url: `${ORIGIN}/icon-512.png`, width: 512, height: 512 },
    description: 'A spoiler-safe game guide you can talk to, on the web and in Discord.',
    founder: { '@type': 'Person', name: 'Tanmay Angarkar', sameAs: [LINKS.linkedin, LINKS.github] },
    contactPoint: [{
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: LINKS.email,
      availableLanguage: ['English'],
    }],
    sameAs: PROFILES,
  };
}

export function webSite() {
  return {
    '@context': CONTEXT,
    '@type': 'WebSite',
    '@id': SITE_ID,
    url: `${ORIGIN}/`,
    name: 'GameGuide',
    inLanguage: 'en',
    publisher: { '@id': ORG_ID },
  };
}

export function webApplication() {
  return {
    '@context': CONTEXT,
    '@type': 'WebApplication',
    name: 'GameGuide',
    url: `${ORIGIN}/`,
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any (web browser), Discord',
    description: "A spoiler-safe game guide you can talk to. Live answers from wikis, patch notes and the web, set like a strategy guide. It never spoils what you haven't reached.",
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@id': ORG_ID },
    featureList: [
      'Spoiler Shield: answers stop where you are in the story',
      'Missables checklist from your current progress',
      'Live research from wikis, official patch notes and the web',
      'Spoiler-safe share links',
      'PC deal and all-time-low price checks',
      'Discord bot with patch-note alerts',
    ],
  };
}

/** What each page is called in a trail. Short, and the page's own words. */
export const CRUMB_NAMES = {
  about: 'About',
  terms: 'Terms and copyright',
  privacy: 'Privacy',
  refunds: 'Refunds and cancellation',
  delivery: 'Delivery',
  contacts: 'Contact',
  upgrade: 'Plans and pricing',
};

/** Home > Page. null for the home page, which has no trail. */
export function breadcrumbList(view) {
  const name = CRUMB_NAMES[view];
  const path = pathForView(view);
  if (!name || !path) return null;
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name, item: `${ORIGIN}${path}` },
    ],
  };
}

export function faqPage() {
  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    mainEntity: FAQ.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

/** Every block a view's page carries, in the order it is written. */
export function jsonLdFor(view) {
  const blocks = [];
  if (view === 'landing') blocks.push(organization(), webSite(), webApplication());
  if (view === 'about') blocks.push(organization());
  const crumbs = breadcrumbList(view);
  if (crumbs) blocks.push(crumbs);
  if (view === 'about') blocks.push(faqPage());
  return blocks;
}

/** A block as it goes inside <script type="application/ld+json">. `<` is escaped so nothing can close the tag. */
export const jsonLdText = (block) => JSON.stringify(block).replace(/</g, '\\u003c');

// ── Sitemap ────────────────────────────────────────────────────────────────

/**
 * The day each page's content last changed. A crawler weighs a lastmod by
 * whether it has been right before, so these are set by hand when a page's
 * words change, never by the build date. Pages whose footer says only a month
 * use the first of it.
 */
export const LASTMOD = {
  landing: '2026-11-03',
  about: '2026-11-03',
  terms: '2026-11-03',
  privacy: '2026-11-03',
  refunds: '2026-10-01',
  delivery: '2026-10-01',
  contacts: '2026-10-01',
  upgrade: '2026-11-02',
};

/** The pages a search engine should list: every route that is a page and is not noindex. */
export const sitemapViews = () => ROUTES.map((r) => r.view).filter((v) => LASTMOD[v] && !VIEW_META[v]?.robots);

export function sitemapXml() {
  const urls = sitemapViews().map((view) => {
    const loc = `${ORIGIN}${pathForView(view)}`;
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${LASTMOD[view]}</lastmod>\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
