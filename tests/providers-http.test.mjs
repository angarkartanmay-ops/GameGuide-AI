// Razorpay and Lemon Squeezy — the real HTTP routes, end to end.
//
// A real Express server and the real signature checks over the raw body; only
// the database is in memory. Mirrors stripe-webhook-http.test.mjs so all three
// providers are held to the same bar: bad signatures refused without leaking,
// replays applied once, an outage answered 500 so the provider retries, floods
// cut off — plus a check that index.js wires them all up behind the limiter.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { makeDb } from './helpers/fake-supabase.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'discord-bot');
const require = createRequire(join(ROOT, 'index.js'));
const express = require('express');
const rzp = require('./billing-razorpay.js');
const lemon = require('./billing-lemon.js');
const { rateLimiter, secureHeaders } = require('./httpSecurity.js');
const { PLANS } = require('./plans.js');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => { if (cond) { passed++; return; } failed++; console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`); };

const U = '123456789012345678', G = '876543210987654321', DAY = 864e5;
const rcfg = rzp.razorpayConfig({ RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'rzp-whsec', RAZORPAY_PLAN_PRO: 'plan_pro', RAZORPAY_PLAN_SERVER: 'plan_srv' });
const lcfg = lemon.lemonConfig({ LEMONSQUEEZY_WEBHOOK_SECRET: 'ls-secret', LEMON_VARIANT_PRO: '111', LEMON_VARIANT_SERVER: '222', LEMON_VARIANT_LIFETIME: '333' });

const db = makeDb();
const dms = [];
const app = express();
app.disable('x-powered-by');
app.use(secureHeaders);
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
const client = { users: { fetch: async (id) => ({ send: async (m) => { dms.push([id, m]); } }) } };
const guard = rateLimiter({ windowMs: 60_000, max: 60 });
check('razorpay mounts when configured', rzp.mountRazorpayWebhook(app, { supabase: db, client, guard, config: rcfg }) === true);
check('lemon mounts when configured', lemon.mountLemonWebhook(app, { supabase: db, client, guard, config: lcfg }) === true);
check('neither mounts without configuration', rzp.mountRazorpayWebhook(express(), { supabase: db, client, config: null }) === false && lemon.mountLemonWebhook(express(), { supabase: db, client, config: null }) === false);

const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const hmac = (secret, body) => crypto.createHmac('sha256', secret).update(body).digest('hex');

async function send(path, headers, body) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}
let n = 0;
const rzpPost = (obj, { secret = 'rzp-whsec', id = `evt_${++n}`, sig } = {}) => {
  const body = JSON.stringify(obj);
  return send('/razorpay-webhook', { 'x-razorpay-signature': sig ?? hmac(secret, body), 'x-razorpay-event-id': id }, body);
};
const lsPost = (obj, { secret = 'ls-secret', sig } = {}) => {
  const body = JSON.stringify(obj);
  return send('/lemonsqueezy-webhook', { 'x-signature': sig ?? hmac(secret, body) }, body);
};

const rzpSub = (event, o = {}) => ({ event, payload: { subscription: { entity: {
  id: 'sub_1', plan_id: 'plan_pro', status: 'active', current_end: Math.floor((Date.now() + 30 * DAY) / 1000), notes: { discord_user_id: U, plan: 'pro' }, ...o } } } });

// ── Razorpay ────────────────────────────────────────────────────────────────
{
  const ev = rzpSub('subscription.activated');
  check('razorpay: no signature refused', (await send('/razorpay-webhook', {}, JSON.stringify(ev))).status === 400);
  const bad = await rzpPost(ev, { secret: 'wrong' });
  check('razorpay: wrong secret refused without leaking', bad.status === 400 && JSON.stringify(bad.json) === '{"error":"invalid signature"}');
  const body = JSON.stringify(ev);
  check('razorpay: a body changed after signing is refused', (await send('/razorpay-webhook', { 'x-razorpay-signature': hmac('rzp-whsec', body) }, body.replace('plan_pro', 'plan_srv'))).status === 400);
  check('razorpay: refusals changed nothing', db.state.writes === 0);
  check('razorpay: security headers set', bad.headers.get('x-content-type-options') === 'nosniff' && !bad.headers.get('x-powered-by'));

  const ok = await rzpPost(ev, { id: 'evt_a' });
  check('razorpay: a signed activation is accepted', ok.status === 200 && ok.json?.received === true);
  const row = db.t.discord_entitlements.get(U);
  check('razorpay: buyer holds Pro, from razorpay, with an end date', row?.tier === 'pro' && row.source === 'razorpay' && row.provider_ref === 'rzp:sub_1' && Date.parse(row.current_period_end) > Date.now() + 30 * DAY);
  check('razorpay: one thank-you DM', dms.length === 1 && dms[0][0] === U);
  const writes = db.state.writes;
  const dup = await rzpPost(ev, { id: 'evt_a' });
  check('razorpay: a retried delivery is a no-op', dup.status === 200 && dup.json?.duplicate === true && db.state.writes === writes && dms.length === 1);

  // outage
  db.t.discord_entitlements.clear();
  const outage = rzpSub('subscription.activated', { id: 'sub_out' });
  db.state.down = true;
  const r500 = await rzpPost(outage, { id: 'evt_out' });
  db.state.down = false;
  check('razorpay: an outage answers 500 so Razorpay retries', r500.status === 500 && JSON.stringify(r500.json) === '{"error":"temporary failure"}');
  check('razorpay: …and nothing was marked handled', !db.t.discord_billing_events.has('rzp:evt_out'));
  const retry = await rzpPost(outage, { id: 'evt_out' });
  check('razorpay: the retry is applied', retry.status === 200 && db.t.discord_entitlements.get(U)?.tier === 'pro');

  // an event id is not shared with another provider's namespace
  check('razorpay: event ids are namespaced', [...db.t.discord_billing_events.keys()].every(k => !k.startsWith('evt_')));
}

// ── Lemon Squeezy ───────────────────────────────────────────────────────────
{
  db.t.discord_entitlements.clear(); dms.length = 0;
  const sub = (name, attrs = {}) => ({
    meta: { event_name: name, custom_data: { discord_user_id: U } },
    data: { type: 'subscriptions', id: '42', attributes: { status: 'active', variant_id: 111, renews_at: new Date(Date.now() + 30 * DAY).toISOString(), updated_at: '2026-10-06T10:00:00Z', test_mode: false, ...attrs } },
  });
  const ev = sub('subscription_created');
  check('lemon: no signature refused', (await send('/lemonsqueezy-webhook', {}, JSON.stringify(ev))).status === 400);
  const bad = await lsPost(ev, { secret: 'wrong' });
  check('lemon: wrong secret refused without leaking', bad.status === 400 && JSON.stringify(bad.json) === '{"error":"invalid signature"}');
  const body = JSON.stringify(ev);
  check('lemon: a body changed after signing is refused', (await send('/lemonsqueezy-webhook', { 'x-signature': hmac('ls-secret', body) }, body.replace('111', '222'))).status === 400);

  const ok = await lsPost(ev);
  check('lemon: a signed subscription_created is accepted', ok.status === 200);
  const row = db.t.discord_entitlements.get(U);
  check('lemon: buyer holds Pro from lemonsqueezy', row?.tier === 'pro' && row.source === 'lemonsqueezy' && row.provider_ref === 'ls:sub:42');
  check('lemon: one thank-you DM', dms.length === 1);
  const writes = db.state.writes;
  const dup = await lsPost(ev);
  check('lemon: a retried delivery is a no-op', dup.status === 200 && dup.json?.duplicate === true && db.state.writes === writes && dms.length === 1);
  await lsPost(sub('subscription_updated', { updated_at: '2026-11-06T10:00:00Z', renews_at: new Date(Date.now() + 60 * DAY).toISOString() }));
  check('lemon: a later update (new updated_at) is applied', Date.parse(db.t.discord_entitlements.get(U).current_period_end) > Date.now() + 61 * DAY);

  db.t.discord_entitlements.clear();
  const out = sub('subscription_created', { updated_at: '2026-10-07T10:00:00Z' });
  db.state.down = true;
  const r500 = await lsPost(out);
  db.state.down = false;
  check('lemon: an outage answers 500 so Lemon Squeezy retries', r500.status === 500);
  const retry = await lsPost(out);
  check('lemon: the retry is applied', retry.status === 200 && db.t.discord_entitlements.get(U)?.tier === 'pro');

  db.t.discord_entitlements.clear();
  const testBuy = sub('subscription_created', { test_mode: true, updated_at: '2026-10-08T10:00:00Z' });
  const t = await lsPost(testBuy);
  check('lemon: a signed TEST purchase is acknowledged but grants nothing', t.status === 200 && db.t.discord_entitlements.size === 0);
}

// ── flood ───────────────────────────────────────────────────────────────────
{
  let limited = false;
  for (let i = 0; i < 80 && !limited; i++) limited = (await send('/razorpay-webhook', { 'x-razorpay-signature': '00' }, '{}')).status === 429;
  check('a flood is rate limited across both webhooks', limited);
}
server.close();

// ── index.js wires it all ───────────────────────────────────────────────────
{
  const idx = readFileSync(join(ROOT, 'index.js'), 'utf8');
  check('index mounts stripe, razorpay and lemon behind the limiter',
    /mountStripeWebhook\(app, \{[^}]*guard: webhookGuard/.test(idx)
    && /mountRazorpayWebhook\(app, \{[^}]*guard: webhookGuard/.test(idx)
    && /mountLemonWebhook\(app, \{[^}]*guard: webhookGuard/.test(idx));
  check('index serves the plans API behind a rate limiter', /mountBillingApi\(app, \{[^}]*guard: rateLimiter/.test(idx));
  check('/upgrade and /premium share one handler', /case 'upgrade':\s*case 'premium': \{/.test(idx));
  check('a paying user is never sent to a fresh checkout', /paid \? upgradeUrl\(/.test(idx));
  check('no payment link is read straight from env in index.js any more', !/process\.env\.STRIPE_(PAYMENT|SERVER_PAYMENT|LIFETIME_PAYMENT)_LINK/.test(idx));
  check('prices on the upgrade card come from plans.js', /priceLabel\('pro'\)/.test(idx) && /priceLabel\('pro', \{ interval: 'year' \}\)/.test(idx));
  check('lifetime rupee price matches what the webhook demands', PLANS.lifetime.inr === 3299);
}

console.log(`providers-http: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
