import { decodeShare } from '../src/utils/share.js';
import { previewTags, renderShell, SITE } from './_shareMeta.js';

// GET /share/<payload>   (vercel.json rewrites it to /api/share?p=<payload>)
//
// A shared answer travels in its link, so there is nothing to look up: this
// reads the payload, writes the question and the safe opening of the answer
// into the page's <head> (title, description, Open Graph, Twitter), and serves
// the app's shell with them. The app then opens the same link and shows the
// answer. A chat app, a social site or a crawler that never runs JavaScript
// still gets a card that says what the answer is about.
//
// What this must never do: index the page (noindex, no canonical), show a
// spoiler (api/_shareMeta.js leaves every ||span|| out), trust the payload
// (decodeShare caps and clips it; the tags are HTML-escaped), or log it.
//
// An edge function: no cold start worth the name, and DecompressionStream is
// native there.
export const config = { runtime: 'edge' };

// The generic shell the build writes (scripts/prerender.mjs). Not /share/...,
// which this very function answers.
const SHELL_PATH = '/share-shell.html';

// base64url, and no longer than a path payload may be (src/utils/share.js).
const PAYLOAD = /^[A-Za-z0-9_-]{2,6000}$/;

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  // The address is the whole content, so it caches well; a new deploy changes the shell.
  'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
  'X-Robots-Tag': 'noindex, nofollow',
  // The link IS the secret: nothing the page loads or links to should hear it.
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

async function defaultLoadShell(request) {
  const res = await fetch(new URL(SHELL_PATH, request.url), { headers: { accept: 'text/html' } });
  return res.ok ? res.text() : null;
}

/** The whole handler, with the shell loader injectable so it can be tested without a network. */
export async function handleShare(request, { loadShell = defaultLoadShell } = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  }
  const payload = new URL(request.url).searchParams.get('p') || '';
  const valid = PAYLOAD.test(payload);
  const share = valid ? await decodeShare(payload) : null;

  let shell = null;
  try { shell = await loadShell(request); } catch { /* handled below */ }

  // No shell to dress (a deploy half-way through, say): send the person to the
  // same answer in its fragment form, which needs no server at all.
  if (!shell) {
    if (!share) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return new Response(null, { status: 302, headers: { Location: `${SITE}/#share/${payload}`, 'Cache-Control': 'no-store' } });
  }

  // A link that does not decode is still answered with the app (which says the
  // link is broken, kindly), but as a 404, and with generic tags.
  const html = renderShell(shell, previewTags({ payload: valid ? payload : '', share }));
  const status = share ? 200 : 404;
  return new Response(request.method === 'HEAD' ? null : html, {
    status,
    headers: share ? HEADERS : { ...HEADERS, 'Cache-Control': 'public, max-age=0, s-maxage=60' },
  });
}

export default function handler(request) {
  return handleShare(request);
}
