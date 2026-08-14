import { buildFandomUrl } from '../_wikiTarget.js';

export default async function handler(req, res) {
  // Scoped to the app's own origins. This route proxies outbound fetches, so a
  // wildcard would let any site on the internet drive it.
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { game, title } = req.query;

    if (!game || !title) {
      return res.status(400).json({ error: 'Missing game or title parameter' });
    }

    // `game` lands in the URL hostname — validate before assembling (SSRF).
    const fandomUrl = buildFandomUrl(game, {
      action: 'query',
      titles: title,
      prop: 'extracts',
      exintro: false,
      explaintext: true,
      exsectionformat: 'plain',
      format: 'json',
    });
    if (!fandomUrl) {
      return res.status(400).json({ error: 'Invalid game parameter' });
    }

    const response = await fetch(fandomUrl, {
      headers: { 'User-Agent': 'GameGuide-AI/1.0 (educational project)' },
      redirect: 'error',   // a 3xx off Fandom would re-open the SSRF
      signal: AbortSignal.timeout(8000),
    });

    const data = await response.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(data);
  } catch (err) {
    // Don't echo internal error detail back to the caller.
    console.error('[wiki/article]', err);
    res.status(502).json({ error: 'Upstream wiki lookup failed' });
  }
}

function isAllowedOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== 'https:' && hostname !== 'localhost' && hostname !== '127.0.0.1') return false;
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === 'gameguide-ai.vercel.app'
      || hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}
