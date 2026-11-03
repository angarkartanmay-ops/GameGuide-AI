import { isAllowedOrigin } from './_wikiTarget.js';

// GET /api/reddit/<path>?<query>   (vercel.json rewrites it to ?path=<path>)
//
// This used to be a bare rewrite to https://www.reddit.com/:path*, which made
// /api/reddit an open proxy: any Reddit path, any parameters, on our bandwidth
// and our IP. It now only forwards the four shapes the web client asks for
// (src/services/redditScraper.js, src/hooks/useChat.js), with parameters
// validated on shape, and caches the answer at the edge so all players behind
// one IP don't hit Reddit's rate limit. Client URLs did not change.

const UPSTREAM = 'https://www.reddit.com/';
const TIMEOUT_MS = 8000;

const SUB = '[A-Za-z0-9_]{2,21}';
const SUBS = `${SUB}(?:\\+${SUB}){0,2}`;
const PATHS = [
  new RegExp(`^r/${SUBS}/top\\.json$`),
  new RegExp(`^r/${SUBS}/search\\.json$`),
  /^search\.json$/,
  // A post's comments, from its permalink: /r/<sub>/comments/<id>/<slug>/.json
  new RegExp(`^r/${SUB}/comments/[a-z0-9]{1,12}(?:/[A-Za-z0-9_]{0,120})?/?\\.json$`),
];

const ENUMS = {
  sort: ['top', 'new', 'hot', 'relevance', 'comments'],
  t: ['hour', 'day', 'week', 'month', 'year', 'all'],
  restrict_sr: ['on'],
  type: ['link'],
};

/** Validated `[path, URLSearchParams]`, or null when the request isn't one the client makes. */
export function redditTarget(query = {}) {
  const path = String(query.path ?? '').replace(/^\/+/, '');
  if (!PATHS.some((re) => re.test(path))) return null;
  const out = new URLSearchParams();
  if (query.q !== undefined) {
    const q = String(query.q).replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!q) return null;
    out.set('q', q);
  }
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (query[key] === undefined) continue;
    if (!allowed.includes(String(query[key]))) return null;
    out.set(key, String(query[key]));
  }
  if (query.limit !== undefined) {
    out.set('limit', String(Math.min(40, Math.max(1, Number.parseInt(query.limit, 10) || 8))));
  }
  return [path, out];
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const target = redditTarget(req.query || {});
  if (!target) {
    res.status(400).json({ error: 'Not a Reddit request this site makes' });
    return;
  }
  const [path, params] = target;
  const qs = params.toString();

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}${path}${qs ? `?${qs}` : ''}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'web:gameguide:1.0 (+https://gameguide.online)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    res.status(502).json({ error: 'Reddit unreachable' });
    return;
  }
  // Reddit's status, without its body: nothing third-party is relayed on errors.
  if (!upstream.ok) {
    res.status(upstream.status === 429 ? 429 : 502).json({ error: `Reddit responded ${upstream.status}` });
    return;
  }
  let data;
  try {
    data = await upstream.json();
  } catch {
    res.status(502).json({ error: 'Reddit returned an unreadable response' });
    return;
  }
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
  res.status(200).json(data);
}
