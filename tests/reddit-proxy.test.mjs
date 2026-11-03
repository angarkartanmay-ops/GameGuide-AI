// /api/reddit — the same-origin Reddit proxy behind the web client's Reddit
// context. It replaced a bare rewrite that forwarded any path, so it must stay
// narrow: the four shapes the client asks for, parameters validated on shape,
// no third-party body relayed on errors.

import handler, { redditTarget } from '../api/reddit.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}`);
}

const ok = (q) => redditTarget(q) !== null;
const qs = (q) => redditTarget(q)?.[1].toString();

// ── the shapes the client makes ──────────────────────────────────────────
check('top of a sub (useChat)', qs({ path: 'r/GamingDetails/top.json', t: 'month', limit: '40' }) === 't=month&limit=40');
check('search in up to three subs (redditScraper)', ok({ path: 'r/Eldenring+eldenringdiscussion/search.json', q: 'margit', sort: 'top', t: 'year', limit: '8', restrict_sr: 'on' }));
check('site-wide search fallback', ok({ path: 'search.json', q: 'elden ring 2026', sort: 'new', t: 'month', limit: '5', type: 'link' }));
check('a post\'s comments from its permalink', ok({ path: 'r/Eldenring/comments/1abc2d/how_to_beat_margit/.json', sort: 'top', limit: '5' }));
check('a leading slash is fine', ok({ path: '/r/gaming/top.json' }));

// ── everything else is refused ───────────────────────────────────────────
check('user pages', !ok({ path: 'user/someone/about.json' }));
check('api endpoints', !ok({ path: 'api/v1/me.json' }));
check('non-JSON pages', !ok({ path: 'r/gaming/top' }));
check('path traversal', !ok({ path: 'r/gaming/../../api/v1/me.json' }));
check('a host in the path', !ok({ path: '//evil.example/x.json' }));
check('four subs is too many', !ok({ path: 'r/aa+bb+cc+dd/search.json', q: 'x' }));
check('unknown sort', !ok({ path: 'search.json', q: 'x', sort: 'controversial&x=1' }));
check('unknown window', !ok({ path: 'search.json', q: 'x', t: 'forever' }));
check('blank query', !ok({ path: 'search.json', q: '   ' }));
check('nothing at all', !ok({}));

// ── parameters are rebuilt, not passed through ───────────────────────────
check('unknown parameters are dropped', qs({ path: 'r/gaming/top.json', t: 'week', after: 't3_x', raw_json: '1' }) === 't=week');
check('limit clamped high', redditTarget({ path: 'search.json', q: 'x', limit: '1000' })[1].get('limit') === '40');
check('limit clamped low', redditTarget({ path: 'search.json', q: 'x', limit: '-5' })[1].get('limit') === '1');
check('query is clipped', redditTarget({ path: 'search.json', q: 'a'.repeat(900) })[1].get('q').length === 200);

// ── handler ─────────────────────────────────────────────────────────────
function fakeRes() {
  const r = { statusCode: 0, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  if (String(url).includes('q=down')) return { ok: false, status: 503, json: async () => ({ secret: 'vendor text' }) };
  if (String(url).includes('q=slow')) return { ok: false, status: 429, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ kind: 'Listing', data: { children: [] } }) };
};

{
  const res = fakeRes();
  await handler({ method: 'GET', headers: {}, query: { path: 'r/gaming/top.json', t: 'week', limit: '30' } }, res);
  check('200 with Reddit data', res.statusCode === 200 && res.body?.kind === 'Listing');
  check('upstream host is fixed', calls.at(-1) === 'https://www.reddit.com/r/gaming/top.json?t=week&limit=30');
  check('edge-cached', /s-maxage/.test(res.headers['cache-control'] || ''));
}
{
  const res = fakeRes();
  await handler({ method: 'GET', headers: {}, query: { path: 'search.json', q: 'down' } }, res);
  check('upstream error → 502', res.statusCode === 502);
  check('upstream body is not relayed', !JSON.stringify(res.body).includes('vendor text'));
}
{
  const res = fakeRes();
  await handler({ method: 'GET', headers: {}, query: { path: 'search.json', q: 'slow' } }, res);
  check('upstream 429 stays 429', res.statusCode === 429);
}
{
  const res = fakeRes();
  const before = calls.length;
  await handler({ method: 'GET', headers: {}, query: { path: 'user/x/about.json' } }, res);
  check('refused path → 400, no upstream call', res.statusCode === 400 && calls.length === before);
}
{
  const res = fakeRes();
  await handler({ method: 'POST', headers: {}, query: { path: 'r/gaming/top.json' } }, res);
  check('GET only', res.statusCode === 405);
}
{
  const res = fakeRes();
  await handler({ method: 'GET', headers: { origin: 'https://evil.example' }, query: { path: 'r/gaming/top.json' } }, res);
  check('no CORS grant for foreign origins', !res.headers['access-control-allow-origin']);
}

console.log(`reddit-proxy: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
