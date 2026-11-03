// What a shared link says about itself, for the preview card a chat app, a
// social site or a search engine builds from the page's <head>. Pure functions,
// used by api/share.js and tested in tests/share-meta.test.mjs.
//
// Everything in a share was written by whoever made the link, and a link can be
// hand-made, so each field is treated as hostile text: it is cut down to plain
// words, clipped, and HTML-escaped before it goes near markup.
//
// Spoilers: the preview shows the question and the opening of the answer with
// every ||spoiler|| span left out, using the same rules as the chat itself
// (src/utils/spoilerText.js). An unclosed span hides the rest, so a malformed
// answer fails safe.

import { toSpoilerMarkdown, SPOILER_HREF } from '../src/utils/spoilerText.js';

export const SITE = 'https://gameguide.online';
export const SHARE_BASE = `${SITE}/share`;

const TITLE_MAX = 70;
const DESCRIPTION_MAX = 200;
const LEAD_MAX = 170;

export const FALLBACK_DESCRIPTION = 'An answer shared from GameGuide. Spoilers stay hidden until you press them.';

/** Escape for text and for double-quoted attributes. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Cut at a word boundary, add an ellipsis only when something was cut. */
export function clip(text, max) {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

// A spoiler span as toSpoilerMarkdown leaves it: [text](#spoiler), with the
// text's brackets and backslashes escaped.
const SPOILER_SPAN = new RegExp(String.raw`\[(?:\\.|[^\]\\])*\]\(${SPOILER_HREF}\)`, 'g');

/** Markdown with ||spoilers|| → the same markdown with those spans gone. */
export function withoutSpoilers(markdown) {
  return toSpoilerMarkdown(String(markdown ?? '')).replace(SPOILER_SPAN, ' ');
}

/** Markdown → one line of plain words. Lossy on purpose. */
export function plainText(markdown) {
  let t = String(markdown ?? '').replace(/\r/g, '');
  // The follow-up suggestions the server appends are not part of the answer.
  t = t.replace(/(^|\n)[ \t]*(?:\*\*|__)?Next:?(?:\*\*|__)?[ \t]*(?:\n[\s\S]*)?$/i, '');
  t = t
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/~~~[\s\S]*?(~~~|$)/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*\|.*\|[ \t]*$/gm, ' ')            // table rows
    // A heading is a sentence of its own: "Beating Margit." not "Beating Margit Bring help."
    .replace(/^[ \t]*#{1,6}[ \t]+(.*?)[ \t#]*$/gm, (_m, h) => (/[.!?:…]$/.test(h.trim()) ? h : `${h.trim()}.`))
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)/g, '');
  // Control characters and zero-width/bidi tricks have no place in a card.
  // eslint-disable-next-line no-control-regex
  t = t.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * { title, description, game, question } for a normalized share
 * (see decodeShare), or the generic words for a link that did not decode.
 */
export function describeShare(share) {
  if (!share) {
    return { title: 'Shared answer', description: FALLBACK_DESCRIPTION, game: null, question: '' };
  }
  const question = plainText(share.q);
  const game = plainText(share.g);
  // What is left after the spoilers go can end on a dangling "Lore:"; drop that label.
  const lead = clip(
    plainText(withoutSpoilers(share.a)).replace(/(^|[.!?]\s+)[^\s.!?:][^.!?:]{0,24}:\s*$/, '$1').replace(/[\s:,;-]+$/, ''),
    LEAD_MAX,
  );

  const title = clip(question || (game ? `A GameGuide answer about ${game}` : 'A shared GameGuide answer'), TITLE_MAX);
  const intro = game && !question.toLowerCase().includes(game.toLowerCase()) ? `${game}: ` : '';
  const description = lead
    ? clip(`${intro}${lead}`, DESCRIPTION_MAX)
    : clip(`${game ? `${game}. ` : ''}${FALLBACK_DESCRIPTION}`, DESCRIPTION_MAX);
  return { title, description, game: game || null, question };
}

/** The head tags for a share, as one HTML string. `payload` is the base64url from the path. */
export function previewTags({ payload, share }) {
  const { title, description } = describeShare(share);
  const url = `${SHARE_BASE}/${payload}`;
  const full = `${title} | GameGuide`;
  const image = `${SITE}/og.png`;
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  return [
    `<title>${escapeHtml(full)}</title>`,
    `<meta name="description" content="${d}" />`,
    // A shared answer belongs to whoever shared it: never indexed, no canonical.
    '<meta name="robots" content="noindex, nofollow" />',
    '<meta name="referrer" content="no-referrer" />',
    '<meta property="og:type" content="article" />',
    '<meta property="og:site_name" content="GameGuide" />',
    '<meta property="og:locale" content="en_US" />',
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${image}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="GameGuide: ask anything about any game." />',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ].join('\n    ');
}

// The tags previewTags replaces. Anything of these kinds already in the shell
// goes, so a card never shows two titles.
const REPLACED = [
  /<title\b[^>]*>[\s\S]*?<\/title>\s*/gi,
  /<meta\s+name="(?:description|robots|referrer|twitter:[a-z:]+)"[^>]*>\s*/gi,
  /<meta\s+property="(?:og|article):[a-z:_]+"[^>]*>\s*/gi,
  /<link\s+rel="canonical"[^>]*>\s*/gi,
  /<script\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>\s*/gi,
];

/** Put a share's tags into the generic shell, in place of whatever it had. */
export function renderShell(shellHtml, tags) {
  let html = String(shellHtml);
  for (const rx of REPLACED) html = html.replace(rx, '');
  return html.includes('</head>') ? html.replace('</head>', `    ${tags}\n  </head>`) : `${tags}\n${html}`;
}
