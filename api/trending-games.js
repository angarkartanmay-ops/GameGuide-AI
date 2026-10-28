import { resolveTrending } from './_trending.js';

// GET /api/trending-games → { date, hero[6], wall[≤24] }
// Today's most-played and fastest-climbing games on Steam, for the landing's
// hero and cover wall. Same-origin only; cached at the edge until Steam's
// daily rollover, so one visitor a day per region pays for the two calls.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { status, body, cacheControl } = await resolveTrending();
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);
  res.status(status).json(body);
}
