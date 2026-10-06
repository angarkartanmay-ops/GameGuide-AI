// Stripe webhook — the real HTTP route, end to end.
//
// billing.test.mjs checks the decisions; this checks the door they sit behind:
// a real Express server, the real Stripe SDK verifying real signatures over the
// raw body, the real event-claim and retry behaviour, and the real flood
// limiter. Only two things are fake: the database (in memory) and the two
// outbound Stripe lookups. No Stripe account, key or network is involved.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'discord-bot');
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'y'.repeat(24);
process.env.STRIPE_PRICE_PRO = 'price_pro';
process.env.STRIPE_PRICE_SERVER = 'price_server';
process.env.STRIPE_PRICE_LIFETIME = 'price_life';

// The bot's own dependencies live in discord-bot/node_modules.
const require = createRequire(join(ROOT, 'index.js'));
const express = require('express');
const Stripe = require('stripe');
const billing = require('./billing-stripe.js');
const { rateLimiter, secureHeaders } = require('./httpSecurity.js');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => { if (cond) { passed++; return; } failed++; console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`); };

import { makeDb } from './helpers/fake-supabase.mjs';

// ── harness ─────────────────────────────────────────────────────────────────
const db = makeDb();
const dms = [];
const lookups = { priceIds: ['price_pro'], subEnd: Math.floor((Date.now() + 30 * 864e5) / 1000) };
const stripeApi = {
  async listLineItemPriceIds() { return lookups.priceIds; },
  async retrieveSubscription(id) { return { id, items: { data: [{ current_period_end: lookups.subEnd }] } }; },
};
const app = express();
app.disable('x-powered-by');   // as index.js does
app.use(secureHeaders);
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
const ok = billing.mountStripeWebhook(app, {
  supabase: db,
  client: { users: { fetch: async (id) => ({ send: async (m) => { dms.push([id, m]); } }) } },
  guard: rateLimiter({ windowMs: 60_000, max: 40 }),
  stripeApi,
});
check('webhook mounts when keys are present', ok === true && billing.stripeConfigured === true);

const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const signer = Stripe('sk_test_' + 'x'.repeat(24));

let evtN = 0;
const U = '123456789012345678', G = '876543210987654321';
function event(type, object, id = `evt_${++evtN}`) { return { id, object: 'event', type, data: { object } }; }
async function post(ev, { secret = process.env.STRIPE_WEBHOOK_SECRET, header, body } = {}) {
  const payload = body ?? JSON.stringify(ev);
  const sig = header ?? signer.webhooks.generateTestHeaderString({ payload, secret });
  const res = await fetch(`${base}/stripe-webhook`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'stripe-signature': sig } : {}) }, body: payload });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}
const session = (o) => ({ id: 'cs_1', payment_status: 'paid', mode: 'subscription', subscription: 'sub_1', amount_total: 499, client_reference_id: `u_${U}`, ...o });

// ── the door ────────────────────────────────────────────────────────────────
{
  const ev = event('checkout.session.completed', session());
  check('no signature header is refused', (await post(ev, { header: '' })).status === 400);
  const bad = await post(ev, { secret: 'whsec_' + 'z'.repeat(24) });
  check('a signature from the wrong secret is refused', bad.status === 400);
  check('the refusal does not echo internals', JSON.stringify(bad.json) === '{"error":"invalid signature"}');
  const tampered = JSON.stringify(ev);
  const sig = signer.webhooks.generateTestHeaderString({ payload: tampered, secret: process.env.STRIPE_WEBHOOK_SECRET });
  check('a body changed after signing is refused', (await post(null, { body: tampered.replace('"amount_total":499', '"amount_total":1'), header: sig })).status === 400);
  check('refused requests changed nothing', db.state.writes === 0 && db.t.discord_billing_events.size === 0 && db.t.discord_entitlements.size === 0);
  check('responses carry security headers', bad.headers.get('x-content-type-options') === 'nosniff' && !bad.headers.get('x-powered-by'));
}

// ── a genuine Pro purchase ─────────────────────────────────────────────────
{
  const ev = event('checkout.session.completed', session(), 'evt_pro_1');
  const r = await post(ev);
  check('a signed purchase is accepted', r.status === 200 && r.json?.received === true);
  const row = db.t.discord_entitlements.get(U);
  check('buyer now holds Pro', row?.tier === 'pro' && row.status === 'active' && row.source === 'stripe');
  check('Pro has a real end date', !!row?.current_period_end && Date.parse(row.current_period_end) > Date.now() + 29 * 864e5);
  check('the event was recorded', db.t.discord_billing_events.has('evt_pro_1'));
  check('the buyer got a thank-you DM', dms.length === 1 && dms[0][0] === U && /Pro/.test(dms[0][1]));

  const writes = db.state.writes;
  const again = await post(ev);
  check('a replay is acknowledged as a duplicate', again.status === 200 && again.json?.duplicate === true);
  check('a replay changes nothing and sends no second DM', db.state.writes === writes && dms.length === 1);
}

// ── the exploit: Pro price, edited server reference ────────────────────────
{
  db.t.discord_entitlements.clear();
  const r = await post(event('checkout.session.completed', session({ id: 'cs_2', client_reference_id: `g_${G}_${U}` })));
  check('edited reference accepted as a payment', r.status === 200);
  check('…but buys only Pro, never the server plan', db.t.discord_premium_servers.size === 0 && db.t.discord_entitlements.get(U)?.tier === 'pro');
}

// ── a genuine server purchase, renewal and cancellation ────────────────────
{
  lookups.priceIds = ['price_server'];
  await post(event('checkout.session.completed', session({ id: 'cs_3', subscription: 'sub_srv', amount_total: 1499, client_reference_id: `g_${G}_${U}` })));
  const g = db.t.discord_premium_servers.get(G);
  check('server purchase grants the server', g?.provider_ref === 'sub_srv' && g.granted_by === U && !!g.expires_at);

  const longer = Math.floor((Date.now() + 90 * 864e5) / 1000);
  await post(event('customer.subscription.updated', { id: 'sub_srv', status: 'active', items: { data: [{ current_period_end: longer }] } }));
  check('renewal extends the server plan', Date.parse(db.t.discord_premium_servers.get(G).expires_at) > Date.now() + 89 * 864e5);

  await post(event('customer.subscription.deleted', { id: 'sub_srv', status: 'canceled', items: { data: [] } }));
  check('cancellation ends the server plan now', Date.parse(db.t.discord_premium_servers.get(G).expires_at) <= Date.now());
}

// ── lifetime, then a refund ────────────────────────────────────────────────
{
  db.t.discord_entitlements.clear();
  lookups.priceIds = ['price_life'];
  await post(event('checkout.session.completed', session({ id: 'cs_4', mode: 'payment', subscription: null, payment_intent: 'pi_9', amount_total: 3999 })));
  const row = db.t.discord_entitlements.get(U);
  check('lifetime is granted with no end date', row?.tier === 'lifetime' && row.current_period_end === null);
  await post(event('charge.refunded', { id: 'ch_1', payment_intent: 'pi_9', refunded: true }));
  check('a full refund takes lifetime back', db.t.discord_entitlements.get(U)?.tier === 'free');
}

// ── a purchase that is not ours, and one not yet paid ──────────────────────
{
  db.t.discord_entitlements.clear();
  lookups.priceIds = ['price_someone_elses_product'];
  await post(event('checkout.session.completed', session({ id: 'cs_5', amount_total: 99999 })));
  check('an unrelated Stripe product grants nothing', db.t.discord_entitlements.size === 0);

  lookups.priceIds = ['price_pro'];
  await post(event('checkout.session.completed', session({ id: 'cs_6', payment_status: 'unpaid' })));
  check('an unpaid checkout grants nothing yet', db.t.discord_entitlements.size === 0);
  await post(event('checkout.session.async_payment_succeeded', session({ id: 'cs_6' })));
  check('…and grants once the payment clears', db.t.discord_entitlements.get(U)?.tier === 'pro');
}

// ── the database is down: never lose a paid grant ──────────────────────────
{
  db.t.discord_entitlements.clear();
  const ev = event('checkout.session.completed', session({ id: 'cs_7' }), 'evt_outage');
  db.state.down = true;
  const r = await post(ev);
  check('an outage answers 500 so Stripe retries', r.status === 500 && JSON.stringify(r.json) === '{"error":"temporary failure"}');
  db.state.down = false;
  check('nothing was marked as handled', !db.t.discord_billing_events.has('evt_outage') && db.t.discord_entitlements.size === 0);
  const retry = await post(ev);
  check('Stripe\'s retry is applied, not skipped as a duplicate', retry.status === 200 && db.t.discord_entitlements.get(U)?.tier === 'pro');
}

// ── a flood of forged calls is cut off ─────────────────────────────────────
{
  let limited = false;
  for (let i = 0; i < 60 && !limited; i++) limited = (await post(null, { body: '{}', header: 't=1,v1=00' })).status === 429;
  check('a flood from one address is rate limited', limited);
}

server.close();
console.log(`stripe-webhook-http: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
