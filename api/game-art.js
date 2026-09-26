import { isAllowedOrigin } from './_wikiTarget.js';
import { resolveSteamArt } from './_steamArt.js';

// GET /api/game-art?q=<game name> → { match: {appid, name, hero[], header[], cover[]} | null }
// Powers the chat's game-reactive backdrop. The app calls it same-origin;
// CORS is only granted to our own origins, like /api/wiki/*.
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
  const { status, body, cacheControl } = await resolveSteamArt(String(req.query?.q || ''));
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);
  res.status(status).json(body);
}
