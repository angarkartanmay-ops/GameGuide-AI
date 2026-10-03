// /api/price — the same-origin CheapShark proxy behind /price on the web.
//
// It exists because calling CheapShark from the browser failed on filtered
// networks. It must stay a narrow proxy: fixed upstream host, parameters
// validated on shape, no third-party body relayed on errors.

import handler, { priceQuery } from '../api/price.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}`);
}

// ── parameter shape ──────────────────────────────────────────────────────
check('title search', priceQuery({ title: 'Elden Ring' })?.toString() === 'title=Elden+Ring&limit=5&exact=0');
check('exact + limit honoured', priceQuery({ title: 'bg3', exact: '1', limit: '8' })?.toString() === 'title=bg3&limit=8&exact=1');
check('limit clamped high', priceQuery({ title: 'x', limit: '500' })?.get('limit') === '10');
check('limit clamped low', priceQuery({ title: 'x', limit: '-3' })?.get('limit') === '1');
check('junk limit falls back', priceQuery({ title: 'x', limit: 'abc' })?.get('limit') === '5');
check('id lookup', priceQuery({ id: '612' })?.toString() === 'id=612');
check('id must be digits', priceQuery({ id: '612&title=x' }) === null);
check('id cannot carry a host', priceQuery({ id: 'evil.com' }) === null);
check('nothing → rejected', priceQuery({}) === null);
check('blank title → rejected', priceQuery({ title: '   ' }) === null);
check('title is clipped', priceQuery({ title: 'a'.repeat(400) })?.get('title').length === 100);
check('newlines collapse', priceQuery({ title: 'elden\r\nring' })?.get('title') === 'elden ring');

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
  if (String(url).includes('title=down')) return { ok: false, status: 500, json: async () => ({ secret: 'vendor text' }) };
  return { ok: true, status: 200, json: async () => [{ gameID: '612', title: 'Elden Ring' }] };
};

{
  const res = fakeRes();
  await handler({ method: 'GET', headers: {}, query: { title: 'Elden Ring', exact: '1' } }, res);
  check('200 with CheapShark data', res.statusCode === 200 && res.body?.[0]?.gameID === '612');
  check('upstream host is fixed', calls.at(-1).startsWith('https://www.cheapshark.com/api/1.0/games?'));
  check('edge-cached', /s-maxage/.test(res.headers['cache-control'] || ''));
}
{
  const res = fakeRes();
  await handler({ method: 'GET', headers: {}, query: { title: 'down' } }, res);
  check('upstream error → 502', res.statusCode === 502);
  check('upstream body is not relayed', !JSON.stringify(res.body).includes('vendor text'));
}
{
  const res = fakeRes();
  const before = calls.length;
  await handler({ method: 'GET', headers: {}, query: { id: '../../x' } }, res);
  check('bad input → 400, no upstream call', res.statusCode === 400 && calls.length === before);
}
{
  const res = fakeRes();
  await handler({ method: 'POST', headers: {}, query: { title: 'x' } }, res);
  check('GET only', res.statusCode === 405);
}
{
  const res = fakeRes();
  await handler({ method: 'GET', headers: { origin: 'https://evil.example' }, query: { title: 'x' } }, res);
  check('no CORS grant for foreign origins', !res.headers['access-control-allow-origin']);
}

console.log(`price-proxy: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
