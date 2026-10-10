import { isAllowedOrigin } from './_wikiTarget.js';

// GET /api/price?title=<game>&exact=0|1&limit=1..10   → CheapShark game search
// GET /api/price?id=<cheapshark gameID>                → that game's deals
//
// /price used to call CheapShark straight from the browser, so anyone on a
// network that filters cheapshark.com (college and office web filters do)
// got "Couldn't reach CheapShark" on every lookup. Same-origin, it only has
// to reach us. The upstream host is fixed and every parameter is validated
// on shape, so this is not a general proxy. Responses are cached at the edge
// briefly: prices move slowly, and it keeps all users behind one IP from
// running into CheapShark's rate limit.

const UPSTREAM = 'https://www.cheapshark.com/api/1.0/games';
const TIMEOUT_MS = 8000;

export function priceQuery(query = {}) {
  const id = String(query.id ?? '').trim();
  if (id) return /^\d{1,10}$/.test(id) ? new URLSearchParams({ id }) : null;
  const title = String(query.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!title) return null;
  const limit = Math.min(10, Math.max(1, Number.parseInt(query.limit, 10) || 5));
  const exact = query.exact === '1' ? '1' : '0';
  return new URLSearchParams({ title, limit: String(limit), exact });
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

  const params = priceQuery(req.query || {});
  if (!params) {
    res.status(400).json({ error: 'Expected ?title=<game> or ?id=<number>' });
    return;
  }

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'GameGuide/1.0 (+https://gameguide.online)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    res.status(502).json({ error: 'Price service unreachable' });
    return;
  }
  // CheapShark's own status, without its body: nothing third-party is relayed.
  if (!upstream.ok) {
    res.status(upstream.status === 429 ? 429 : 502).json({ error: `Price service responded ${upstream.status}` });
    return;
  }
  let data;
  try {
    data = await upstream.json();
  } catch {
    res.status(502).json({ error: 'Price service returned an unreadable response' });
    return;
  }
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
  res.status(200).json(data);
}
