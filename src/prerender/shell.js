// Turn the app's one HTML shell into a page of its own. Pure string functions,
// no DOM and no JSX, so tests can run them on the real index.html.
//
// A page written this way has, before any script runs:
//   · its own <title>, description, canonical, robots, Open Graph and Twitter tags
//   · its own structured data
//   · its text, inside #root, for crawlers, link previews and readers without
//     JavaScript. People with JavaScript never see it: it is hidden by one
//     rule in the head, and React replaces it the moment the app mounts, so
//     the first paint (and its timing) is exactly what it was without it.
//
// Every substitution below looks for a tag the shell must have and throws if
// it is missing: a template that drifts from this file fails the build, it
// does not quietly ship a page with the wrong tags.

import { ORIGIN, LOCALE } from '../site/meta.js';
import { jsonLdText } from '../site/seo.js';

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `<meta name|property="key" content="…">` → the same tag with a new content. */
function setMeta(html, attr, key, value) {
  const rx = new RegExp(`(<meta\\s+${attr}="${escRx(key)}"\\s+content=")[^"]*(")`);
  if (!rx.test(html)) throw new Error(`the template has no <meta ${attr}="${key}">`);
  return html.replace(rx, (_m, open, close) => `${open}${esc(value)}${close}`);
}

function removeTag(html, rx, what) {
  if (!rx.test(html)) throw new Error(`the template has no ${what}`);
  return html.replace(rx, '');
}

/**
 * @typedef {object} PageHead
 * @property {string} title
 * @property {string} description
 * @property {string} [share]       the line for share cards, when it differs from the description
 * @property {string|null} path     canonical path, or null for a page with no canonical
 * @property {string} [robots]      e.g. "noindex, follow"
 * @property {object[]} [jsonLd]    structured-data blocks
 */

/** The shell's <head> tags, for one page. */
export function applyHead(template, page) {
  let html = String(template);
  const url = typeof page.path === 'string' ? `${ORIGIN}${page.path}` : null;
  const social = page.share || page.description;

  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(page.title)}</title>`);
  if (!html.includes(`<title>${esc(page.title)}</title>`)) throw new Error('the template has no <title>');

  html = setMeta(html, 'name', 'description', page.description);
  html = setMeta(html, 'property', 'og:title', page.title);
  html = setMeta(html, 'property', 'og:description', social);
  html = setMeta(html, 'property', 'og:locale', LOCALE);
  html = setMeta(html, 'name', 'twitter:title', page.title);
  html = setMeta(html, 'name', 'twitter:description', social);

  const canonical = /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/;
  const ogUrl = /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>\s*/;
  if (url) {
    if (!canonical.test(html)) throw new Error('the template has no canonical link');
    html = html.replace(canonical, () => `<link rel="canonical" href="${esc(url)}" />`);
    html = setMeta(html, 'property', 'og:url', url);
  } else {
    // No address of its own (a 404, a shared answer): nothing to point at.
    html = removeTag(html, new RegExp(canonical.source + '\\s*'), 'canonical link');
    html = removeTag(html, ogUrl, 'og:url');
  }

  const extra = [];
  if (page.robots) extra.push(`<meta name="robots" content="${esc(page.robots)}" />`);
  for (const block of page.jsonLd || []) extra.push(`<script type="application/ld+json">${jsonLdText(block)}</script>`);
  if (extra.length) {
    if (!html.includes('</head>')) throw new Error('the template has no </head>');
    html = html.replace('</head>', () => `    ${extra.join('\n    ')}\n  </head>`);
  }
  return html;
}

/**
 * The rules that keep the static text out of sight for anyone running
 * JavaScript, and put it in front of anyone who is not. Added to the head.
 */
export const PRERENDER_STYLE = '#root>[data-prerender]{display:none}';
const NOSCRIPT_STYLE = [
  '#root>[data-prerender]{display:block;max-width:44rem;margin:0 auto;padding:2rem 1.25rem 4rem;color:#ece6da;font:16px/1.65 system-ui,sans-serif}',
  'body{margin:0;background:#07090d}',
  '#root>[data-prerender] a{color:#ece6da}',
  '#root>[data-prerender] h1{font-size:2rem;line-height:1.2;font-weight:600}',
  '#root>[data-prerender] h2{font-size:1.25rem;margin-top:2rem}',
  '#root>[data-prerender] nav ul{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;padding:0;list-style:none}',
].join('');

/** Put a page's text into #root and the rules for showing it into the head. */
export function applyBody(template, bodyHtml) {
  let html = String(template);
  const root = '<div id="root"></div>';
  if (!html.includes(root)) throw new Error('the template has no empty #root');

  // The hand-written <noscript> pitch is what this replaces: the same job, per page.
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>\s*/, '');
  html = html.replace(root, () => `<div id="root"><div data-prerender>${bodyHtml}</div></div>`);

  if (!html.includes('</head>')) throw new Error('the template has no </head>');
  return html.replace('</head>', () => `    <style>${PRERENDER_STYLE}</style>\n    <noscript><style>${NOSCRIPT_STYLE}</style></noscript>\n  </head>`);
}

/** A whole page: head, body and all. */
export function buildPage(template, page, bodyHtml) {
  return applyBody(applyHead(template, page), bodyHtml);
}
