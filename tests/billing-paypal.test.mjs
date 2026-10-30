// PayPal, the Base plan, and moving up from one plan to another.
//
// Real adapter code over an in-memory database and a fake PayPal API, plus the
// real HTTP route with PayPal's real signature scheme (RSA over
// id|time|webhook_id|crc32(body)) using a key made here. The PayPal API itself
// is faked: scripts/billing-check.js is what talks to the real sandbox.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { makeDb } from './helpers/fake-supabase.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'discord-bot');
const require = createRequire(join(ROOT, 'index.js'));
const express = require('express');
const pp = require('./billing-paypal.js');
const core = require('./billing-core.js');
const rzp = require('./billing-razorpay.js');
const { createSuperseder } = require('./billing-cancel.js');
const { rateLimiter, secureHeaders } = require('./httpSecurity.js');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => { if (cond) { passed++; return; } failed++; console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`); };
const silent = { log() {}, warn() {}, error() {} };
const throws = (p) => Promise.resolve().then(p).then(() => false, () => true);

const U = '123456789012345678', U2 = '223456789012345678', G = '876543210987654321', DAY = 864e5;
const ENV = {
  PAYPAL_CLIENT_ID: 'client', PAYPAL_CLIENT_SECRET: 'top-secret', PAYPAL_WEBHOOK_ID: 'WH-ID-1',
  PAYPAL_PLAN_BASE: 'P-BASEM', PAYPAL_PLAN_BASE_YEARLY: 'P-BASEY', PAYPAL_PLAN_PRO: 'P-PROM', PAYPAL_PLAN_SERVER: 'P-SRVM',
};
const cfg = pp.paypalConfig(ENV);

// ═══ config ════════════════════════════════════════════════════════════════
{
  check('off without credentials or a webhook id', pp.paypalConfig({}) === null && pp.paypalConfig({ ...ENV, PAYPAL_WEBHOOK_ID: '' }) === null);
  check('sandbox unless told live', cfg.mode === 'sandbox' && cfg.api === 'https://api-m.sandbox.paypal.com'
    && pp.paypalConfig({ ...ENV, PAYPAL_ENV: 'LIVE' }).api === 'https://api-m.paypal.com');
  check('offers what has a plan id, plus Lifetime', JSON.stringify(pp.paypalOffers(cfg)) === JSON.stringify([
    { plan: 'base', interval: 'month' }, { plan: 'base', interval: 'year' }, { plan: 'pro', interval: 'month' },
    { plan: 'server', interval: 'month' }, { plan: 'lifetime', interval: 'once' }]));
  check('custom_id round-trips and stays short', (() => {
    const s = pp.encodeCustomId({ userId: U, plan: 'server', guildId: G });
    const back = pp.parseCustomId(s);
    return s.length < 127 && back.userId === U && back.guildId === G && back.plan === 'server';
  })());
  check('a custom_id without a real user id is refused', pp.parseCustomId('u:abc;p:pro') === null && pp.parseCustomId(null) === null && pp.parseCustomId('x'.repeat(200)) === null);
}

// ═══ signatures ════════════════════════════════════════════════════════════
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const CERT = 'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1';
function sign(body, { webhookId = 'WH-ID-1', id = crypto.randomUUID(), time = new Date().toISOString(), key = privateKey } = {}) {
  const msg = `${id}|${time}|${webhookId}|${pp.crc32(Buffer.from(body))}`;
  return {
    'paypal-transmission-id': id, 'paypal-transmission-time': time, 'paypal-cert-url': CERT,
    'paypal-auth-algo': 'SHA256withRSA', 'paypal-transmission-sig': crypto.sign('sha256', Buffer.from(msg), key).toString('base64'),
  };
}
const keyFor = async (url) => { if (url !== CERT) throw new Error('unexpected cert'); return publicKey; };
{
  check('crc32 is the zlib one', pp.crc32(Buffer.from('hello')) === 907060870
    && (!zlib.crc32 || pp.crc32(Buffer.from('{"a":1}')) === zlib.crc32(Buffer.from('{"a":1}'))));
  const body = Buffer.from('{"id":"WH-1","event_type":"X"}');
  const h = sign(body);
  check('a correctly signed event verifies', await pp.verifyWebhook(body, h, { webhookId: 'WH-ID-1', publicKeyFor: keyFor }));
  check('a body changed after signing fails', !(await pp.verifyWebhook(Buffer.from('{"id":"WH-1","event_type":"Y"}'), h, { webhookId: 'WH-ID-1', publicKeyFor: keyFor })));
  check('an event signed for another webhook fails', !(await pp.verifyWebhook(body, sign(body, { webhookId: 'WH-OTHER' }), { webhookId: 'WH-ID-1', publicKeyFor: keyFor })));
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  check('an event signed with someone else\'s key fails', !(await pp.verifyWebhook(body, sign(body, { key: other }), { webhookId: 'WH-ID-1', publicKeyFor: keyFor })));
  check('missing headers fail', !(await pp.verifyWebhook(body, {}, { webhookId: 'WH-ID-1', publicKeyFor: keyFor })));
  check('an unknown algorithm fails', !(await pp.verifyWebhook(body, { ...h, 'paypal-auth-algo': 'SHA1withRSA' }, { webhookId: 'WH-ID-1', publicKeyFor: keyFor })));
  check('a certificate that cannot be loaded fails closed', !(await pp.verifyWebhook(body, h, { webhookId: 'WH-ID-1', publicKeyFor: async () => { throw new Error('x'); } })));

  check('certificates only from PayPal API hosts', pp.certUrlAllowed(CERT) && pp.certUrlAllowed('https://api.paypal.com/v1/notifications/certs/C')
    && !pp.certUrlAllowed('http://api.paypal.com/c') && !pp.certUrlAllowed('https://evil.example/c')
    && !pp.certUrlAllowed('https://api.paypal.com.evil.example/c') && !pp.certUrlAllowed('https://user@api.paypal.com/c')
    && !pp.certUrlAllowed('https://api.paypal.com:8443/c') && !pp.certUrlAllowed('not a url'));
  let fetched = 0;
  const store = pp.certStore({ fetchImpl: async () => { fetched++; return { ok: true, text: async () => 'x' }; } });
  check('a forged cert URL is refused before any request', await throws(() => store('https://evil.example/cert')) && fetched === 0);
  check('a cert that is not a certificate is refused', await throws(() => store(CERT)) && fetched === 1);
}

// ═══ the REST client ═══════════════════════════════════════════════════════
{
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/oauth2/token')) return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'tok', expires_in: 3200 }) };
    if (url.includes('/capture')) return { ok: false, status: 422, text: async () => JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'I-1', status: 'ACTIVE' }) };
  };
  const c = pp.paypalClient(cfg, { fetchImpl });
  await c.getSubscription('I-1');
  await c.getSubscription('I-2');
  const tokenCalls = calls.filter(x => x.url.endsWith('/oauth2/token'));
  check('one OAuth token, reused', tokenCalls.length === 1 && tokenCalls[0].init.headers.Authorization === `Basic ${Buffer.from('client:top-secret').toString('base64')}`);
  check('API calls carry the bearer token, to the sandbox', calls[1].init.headers.Authorization === 'Bearer tok' && calls[1].url.startsWith('https://api-m.sandbox.paypal.com/v1/billing/subscriptions/I-1'));
  let err = null;
  try { await c.captureOrder('ORDER1'); } catch (e) { err = e; }
  const cap = calls.find(x => x.url.includes('/capture'));
  check('a capture is idempotent (PayPal-Request-Id)', cap.init.headers['PayPal-Request-Id'] === 'capture-ORDER1');
  check('errors say what PayPal said, never the secret', err?.status === 422 && err.issue === 'ORDER_ALREADY_CAPTURED' && !String(err.message).includes('top-secret'));
}

// ═══ creating a checkout ═══════════════════════════════════════════════════
{
  const reqs = [];
  const fake = (links) => ({ request: async (path, opts) => { reqs.push({ path, ...opts }); return { id: 'X-1', links }; } });
  const approve = [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1' }];
  const r = await pp.createPaypalCheckout({ plan: 'base', interval: 'year', userId: U, successUrl: 'https://site/#upgrade/thanks', cancelUrl: 'https://site/#upgrade/t' }, { config: cfg, client: fake(approve) });
  const b = reqs[0].body;
  check('base yearly: the yearly plan, the buyer in custom_id, return links, no shipping',
    reqs[0].path === '/v1/billing/subscriptions' && b.plan_id === 'P-BASEY' && pp.parseCustomId(b.custom_id).userId === U
    && b.application_context.return_url === 'https://site/#upgrade/thanks' && b.application_context.cancel_url === 'https://site/#upgrade/t'
    && b.application_context.shipping_preference === 'NO_SHIPPING' && r.url === approve[0].href && r.kind === 'subscription');
  reqs.length = 0;
  await pp.createPaypalCheckout({ plan: 'server', userId: U, guildId: G }, { config: cfg, client: fake(approve) });
  check('a server plan carries its server', pp.parseCustomId(reqs[0].body.custom_id).guildId === G && reqs[0].body.plan_id === 'P-SRVM');
  reqs.length = 0;
  const life = await pp.createPaypalCheckout({ plan: 'lifetime', userId: U }, { config: cfg, client: fake([{ rel: 'approve', href: 'https://www.paypal.com/checkoutnow?token=O1' }]) });
  const unit = reqs[0].body.purchase_units[0];
  check('lifetime is a $39.99 order, captured later', reqs[0].path === '/v2/checkout/orders' && reqs[0].body.intent === 'CAPTURE'
    && unit.amount.value === '39.99' && unit.amount.currency_code === 'USD' && unit.reference_id === 'lifetime'
    && pp.parseCustomId(unit.custom_id).plan === 'lifetime' && life.kind === 'order');
  check('a link off paypal.com is refused', await throws(() => pp.createPaypalCheckout({ plan: 'base', userId: U }, { config: cfg, client: fake([{ rel: 'approve', href: 'https://paypal.com.evil.example/x' }]) })));
  check('no plan id, no checkout', await throws(() => pp.createPaypalCheckout({ plan: 'pro', interval: 'year', userId: U }, { config: cfg, client: fake(approve) })));
  check('a server plan needs its server', await throws(() => pp.createPaypalCheckout({ plan: 'server', userId: U }, { config: cfg, client: fake(approve) })));
  check('a bad user id is refused', await throws(() => pp.createPaypalCheckout({ plan: 'base', userId: '12' }, { config: cfg, client: fake(approve) })));
}

// ═══ what each event means ═════════════════════════════════════════════════
function paypalWorld({ subs = {}, captures = {}, supersede } = {}) {
  const db = makeDb();
  const repo = core.supabaseRepo(db);
  const dms = [];
  const api = {
    captured: [],
    getSubscription: async (id) => {
      if (id.startsWith('I-GONE')) throw Object.assign(new Error('paypal 404 INVALID_RESOURCE_ID'), { status: 404 });
      if (!subs[id]) throw new Error('paypal unreachable');
      return subs[id];
    },
    captureOrder: async (id) => { api.captured.push(id); return { id, status: 'COMPLETED' }; },
    getCapture: async (id) => captures[id],
  };
  const h = pp.createPaypalHandlers({ repo, notify: async (u, k) => dms.push([u, k]), supersede, config: cfg, client: api, log: silent });
  return { db, repo, dms, api, h, subs, captures };
}
const iso = (ms) => new Date(ms).toISOString();
const sub = (o = {}) => ({
  id: 'I-BASE1', plan_id: 'P-BASEM', status: 'ACTIVE', custom_id: pp.encodeCustomId({ userId: U, plan: 'base' }),
  billing_info: { next_billing_time: iso(Date.now() + 30 * DAY), last_payment: { time: iso(Date.now()) } }, ...o,
});
const ev = (event_type, resource) => ({ id: `WH-${crypto.randomUUID()}`, event_type, resource });
{
  const w = paypalWorld({ subs: { 'I-BASE1': sub() } });
  const r = await w.h.handleEvent(ev('BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-BASE1' }));
  const row = w.db.t.discord_entitlements.get(U);
  check('activation grants Base, from PayPal, until the next bill plus grace', r === 'base' && row?.tier === 'base' && row.source === 'paypal'
    && row.provider_ref === 'pp:I-BASE1' && Date.parse(row.current_period_end) > Date.now() + 31 * DAY);
  check('one thank-you, the Base one', w.dms.length === 1 && w.dms[0][1] === 'base' && typeof core.NOTICE.base === 'string');

  w.subs['I-BASE1'] = sub({ billing_info: { next_billing_time: iso(Date.now() + 60 * DAY) } });
  await w.h.handleEvent(ev('PAYMENT.SALE.COMPLETED', { id: 'SALE1', billing_agreement_id: 'I-BASE1' }));
  check('a renewal payment extends Base without a second thank-you', Date.parse(w.db.t.discord_entitlements.get(U).current_period_end) > Date.now() + 61 * DAY && w.dms.length === 1
    && w.db.t.discord_entitlements.get(U).tier === 'base');

  await w.h.handleEvent(ev('BILLING.SUBSCRIPTION.PAYMENT.FAILED', { id: 'I-BASE1' }));
  check('a failed payment keeps Base, flagged past_due', w.db.t.discord_entitlements.get(U).status === 'past_due' && w.db.t.discord_entitlements.get(U).tier === 'base');

  w.subs['I-BASE1'] = sub({ status: 'CANCELLED', billing_info: { last_payment: { time: iso(Date.now() - 10 * DAY) } } });
  await w.h.handleEvent(ev('BILLING.SUBSCRIPTION.CANCELLED', { id: 'I-BASE1' }));
  const c = w.db.t.discord_entitlements.get(U);
  check('cancelled: Base stays on until the paid month runs out', c.tier === 'base' && c.status === 'ending'
    && Math.abs(Date.parse(c.current_period_end) - (Date.now() + 21 * DAY)) < DAY);

  w.subs['I-BASE1'] = sub({ status: 'EXPIRED', billing_info: { last_payment: { time: iso(Date.now() - 40 * DAY) } } });
  await w.h.handleEvent(ev('BILLING.SUBSCRIPTION.EXPIRED', { id: 'I-BASE1' }));
  check('expired with nothing left: back to free', w.db.t.discord_entitlements.get(U).tier === 'free');
}
{
  const w = paypalWorld({ subs: { 'I-ODD1': sub({ id: 'I-ODD1', plan_id: 'P-SOMETHING-ELSE' }), 'I-NOBODY': sub({ id: 'I-NOBODY', custom_id: '' }), 'I-PEND': sub({ id: 'I-PEND', status: 'APPROVAL_PENDING' }) } });
  check('a plan id that is not ours grants nothing', await w.h.handleEvent(ev('BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-ODD1' })) === 'unknown-plan' && w.db.t.discord_entitlements.size === 0);
  check('no buyer on an unknown subscription grants nothing', await w.h.handleEvent(ev('BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-NOBODY' })) === 'unknown' && w.db.t.discord_entitlements.size === 0);
  check('a subscription not yet paid grants nothing', await w.h.handleEvent(ev('BILLING.SUBSCRIPTION.UPDATED', { id: 'I-PEND' })) === 'ignored' && w.db.t.discord_entitlements.size === 0);
  check('a junk id is ignored without asking PayPal', await w.h.handleEvent(ev('BILLING.SUBSCRIPTION.ACTIVATED', { id: '../../v1/oauth2' })) === 'ignored');
  check('PayPal being down is an error (so the webhook answers 500 and PayPal retries)', await throws(() => w.h.handleEvent(ev('BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-MISSING1' }))));
  check('a subscription PayPal says does not exist (simulator events) is acknowledged, not retried', await w.h.handleEvent(ev('BILLING.SUBSCRIPTION.CANCELLED', { id: 'I-GONE123' })) === 'unknown-subscription');
  check('unhandled events are ignored', await w.h.handleEvent(ev('CATALOG.PRODUCT.CREATED', {})) === 'ignored');
}
{
  const w = paypalWorld({ subs: { 'I-SRV1': sub({ id: 'I-SRV1', plan_id: 'P-SRVM', custom_id: pp.encodeCustomId({ userId: U, plan: 'server', guildId: G }) }) } });
  await w.h.handleEvent(ev('BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-SRV1' }));
  check('a server plan attaches to its server', w.db.t.discord_premium_servers.get(G)?.provider_ref === 'pp:I-SRV1');
}
// Lifetime: approve → capture → completed; refunds and disputes
{
  const w = paypalWorld({ captures: { CAP1: { id: 'CAP1', status: 'PARTIALLY_REFUNDED' } } });
  check('an approved Lifetime order is captured by the bot', await w.h.handleEvent(ev('CHECKOUT.ORDER.APPROVED', { id: 'ORDER1', purchase_units: [{ reference_id: 'lifetime' }] })) === 'captured' && w.api.captured[0] === 'ORDER1');
  check('someone else\'s order is not touched', await w.h.handleEvent(ev('CHECKOUT.ORDER.APPROVED', { id: 'ORDER2', purchase_units: [{ reference_id: 'other' }] })) === 'ignored' && w.api.captured.length === 1);
  const capture = (o = {}) => ({ id: 'CAP1', status: 'COMPLETED', amount: { value: '39.99', currency_code: 'USD' }, custom_id: pp.encodeCustomId({ userId: U, plan: 'lifetime' }), ...o });
  check('a short capture grants nothing', await w.h.handleEvent(ev('PAYMENT.CAPTURE.COMPLETED', capture({ id: 'CAP0', amount: { value: '1.00', currency_code: 'USD' } }))) === 'unknown-plan' && w.db.t.discord_entitlements.size === 0);
  check('a pending capture waits', await w.h.handleEvent(ev('PAYMENT.CAPTURE.COMPLETED', capture({ status: 'PENDING' }))) === 'pending');
  check('a full capture grants Lifetime', await w.h.handleEvent(ev('PAYMENT.CAPTURE.COMPLETED', capture())) === 'lifetime' && w.db.t.discord_entitlements.get(U)?.tier === 'lifetime'
    && w.db.t.discord_entitlements.get(U).provider_ref === 'pp:cap:CAP1' && w.db.t.discord_entitlements.get(U).current_period_end === null);
  const refund = { id: 'REF1', links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/CAP1' }] };
  check('a partial refund keeps Lifetime', await w.h.handleEvent(ev('PAYMENT.CAPTURE.REFUNDED', refund)) === 'partial-refund' && w.db.t.discord_entitlements.get(U).tier === 'lifetime');
  w.captures.CAP1.status = 'REFUNDED';
  check('a full refund takes Lifetime back', await w.h.handleEvent(ev('PAYMENT.CAPTURE.REFUNDED', refund)) === 'lifetime-revoked' && w.db.t.discord_entitlements.get(U).tier === 'free');

  const w2 = paypalWorld();
  await w2.h.handleEvent(ev('PAYMENT.CAPTURE.COMPLETED', capture({ id: 'CAP9' })));
  check('a dispute takes Lifetime back', await w2.h.handleEvent(ev('CUSTOMER.DISPUTE.CREATED', { disputed_transactions: [{ seller_transaction_id: 'CAP9' }] })) === 'lifetime-revoked');
}

// ═══ moving up: Base → Pro, across providers ═══════════════════════════════
{
  const stopped = [];
  const supersede = async (ref) => { stopped.push(ref); };
  const w = paypalWorld({ subs: { 'I-BASE1': sub() }, supersede });
  await w.h.handleEvent(ev('BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-BASE1' }));
  // Pro bought with UPI, through the Razorpay handlers, on the same database.
  const rcfg = rzp.razorpayConfig({ RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w', RAZORPAY_PLAN_PRO: 'plan_pro' });
  const rh = rzp.createRazorpayHandlers({ repo: w.repo, notify: async (u, k) => w.dms.push([u, k]), supersede, config: rcfg, log: silent });
  const r = await rh.handleEvent({ event: 'subscription.activated', payload: { subscription: { entity: {
    id: 'sub_PRO1', plan_id: 'plan_pro', status: 'active', current_end: Math.floor((Date.now() + 30 * DAY) / 1000), notes: { discord_user_id: U, plan: 'pro' } } } } });
  const row = w.db.t.discord_entitlements.get(U);
  check('Pro replaces an active Base', r === 'pro' && row.tier === 'pro' && row.provider_ref === 'rzp:sub_PRO1');
  check('…and the Base subscription is told to stop renewing', JSON.stringify(stopped) === '["pp:I-BASE1"]');
  check('…with a Pro thank-you, not a "you already have a plan"', w.dms.at(-1)[1] === 'pro' && !w.dms.some(d => d[1] === 'covered'));
  w.subs['I-BASE1'] = sub({ status: 'CANCELLED' });
  check('the old Base\'s cancellation then changes nothing', await w.h.handleEvent(ev('BILLING.SUBSCRIPTION.CANCELLED', { id: 'I-BASE1' })) === 'unknown' && w.db.t.discord_entitlements.get(U).tier === 'pro');

  // Pro → Base is not an upgrade.
  w.subs['I-BASE2'] = sub({ id: 'I-BASE2' });
  check('Base never replaces an active Pro', await w.h.handleEvent(ev('BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-BASE2' })) === 'already-covered' && w.db.t.discord_entitlements.get(U).tier === 'pro' && stopped.length === 1);
}
{
  const c = core.createBillingCore({ repo: core.supabaseRepo(makeDb()), supersede: async () => { throw new Error('provider down'); }, log: silent });
  const end = iso(Date.now() + 30 * DAY);
  await c.grant({ source: 'paypal', plan: 'pro', userId: U2, providerRef: 'pp:I-PRO9', periodEnd: end });
  check('a stop that fails never undoes the new plan', await c.grant({ source: 'paypal', plan: 'lifetime', userId: U2, providerRef: 'pp:cap:L9' }) === 'lifetime');

  const asked = [];
  const pdb = makeDb();
  const pc = core.createBillingCore({ repo: core.supabaseRepo(pdb), supersede: async (r) => { asked.push(r); }, log: silent });
  await pc.grant({ source: 'razorpay', plan: 'pro', userId: U2, providerRef: 'rzp:sub_OLD', periodEnd: end });
  await pc.setPeriod({ providerRef: 'rzp:sub_OLD', state: 'past_due', until: end });
  await pc.grant({ source: 'paypal', plan: 'base', userId: U2, providerRef: 'pp:I-NEW1', periodEnd: end });
  check('a new plan over a failing (past_due) one stops the failing one retrying', JSON.stringify(asked) === '["rzp:sub_OLD"]' && pdb.t.discord_entitlements.get(U2).tier === 'base');
  await pc.grant({ source: 'paypal', plan: 'base', userId: U2, providerRef: 'pp:I-NEW1', periodEnd: iso(Date.now() + 60 * DAY) });
  check('a renewal of the same subscription stops nothing', asked.length === 1);

  const db = makeDb();
  const c2 = core.createBillingCore({ repo: core.supabaseRepo(db), log: silent });
  await c2.grant({ source: 'razorpay', plan: 'base', userId: U2, providerRef: 'rzp:sub_B', periodEnd: end });
  await c2.setPeriod({ providerRef: 'rzp:sub_B', state: 'active', until: iso(Date.now() + 60 * DAY) });
  check('a Base renewal stays Base (it used to come back as Pro)', db.t.discord_entitlements.get(U2).tier === 'base');
  await c2.setPeriod({ providerRef: 'rzp:sub_B', state: 'past_due', until: null });
  check('a Base payment problem stays Base', db.t.discord_entitlements.get(U2).tier === 'base' && db.t.discord_entitlements.get(U2).status === 'past_due');
}

// ═══ stopping a subscription at the right provider ═════════════════════════
{
  const hits = [];
  const fakeC = (name) => async (id) => { hits.push(`${name}:${id}`); return 'cancelled'; };
  const s = createSuperseder({ cancellers: { razorpay: fakeC('rzp'), paypal: fakeC('pp'), lemon: fakeC('ls'), stripe: fakeC('stripe') }, log: silent });
  for (const ref of ['rzp:sub_ABC', 'pp:I-XYZ123', 'ls:sub:42', 'sub_1Abc']) await s(ref);
  check('each reference goes to its own provider', hits.join() === 'rzp:sub_ABC,pp:I-XYZ123,ls:42,stripe:sub_1Abc');
  check('one-off payments and manual grants have nothing to stop', await s('rzp:pay_1') === 'nothing-to-stop' && await s('pp:cap:C1') === 'nothing-to-stop'
    && await s(null) === 'nothing-to-stop' && await s('ls:order:3') === 'nothing-to-stop' && hits.length === 4);

  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: true, status: 200, json: async () => ({}) }; };
  const rcfg = rzp.razorpayConfig({ RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' });
  await rzp.cancelRazorpaySubscription('sub_ABC', { config: rcfg, fetchImpl });
  check('razorpay: cancel at the end of the paid cycle', calls[0].url === 'https://api.razorpay.com/v1/subscriptions/sub_ABC/cancel' && calls[0].body.cancel_at_cycle_end === 1);
  const gone = async () => ({ ok: false, status: 400, json: async () => ({ error: { description: 'Subscription is not cancellable in cancelled status.' } }) });
  check('razorpay: already cancelled is fine', await rzp.cancelRazorpaySubscription('sub_ABC', { config: rcfg, fetchImpl: gone }) === 'already-stopped');

  const already = { cancelSubscription: async () => { const e = new Error('paypal 422'); e.status = 422; e.issue = 'SUBSCRIPTION_STATUS_INVALID'; throw e; } };
  check('paypal: already cancelled is fine', await pp.cancelPaypalSubscription('I-1', { config: cfg, client: already }) === 'already-stopped');
  const down = { cancelSubscription: async () => { const e = new Error('paypal 503'); e.status = 503; throw e; } };
  check('paypal: an outage is reported', await throws(() => pp.cancelPaypalSubscription('I-1', { config: cfg, client: down })));
}

// ═══ the real route, over HTTP ═════════════════════════════════════════════
{
  const db = makeDb();
  const subs = { 'I-BASE1': sub() };
  const api = { getSubscription: async (id) => subs[id], captureOrder: async () => ({}), getCapture: async () => ({}) };
  const app = express();
  app.disable('x-powered-by');
  app.use(secureHeaders);
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  const client = { users: { fetch: async () => ({ send: async () => {} }) } };
  check('mounts when configured', pp.mountPaypalWebhook(app, { supabase: db, client, guard: rateLimiter({ windowMs: 60_000, max: 60 }), config: cfg, api, publicKeyFor: keyFor }) === true);
  check('stays off without configuration', pp.mountPaypalWebhook(express(), { supabase: db, client, config: null }) === false);
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (obj, headers) => {
    const body = JSON.stringify(obj);
    const res = await fetch(`${base}/paypal-webhook`, { method: 'POST', headers: { 'content-type': 'application/json', ...(headers || sign(Buffer.from(body))) }, body });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const e1 = ev('BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-BASE1' });
  const unsigned = await post(e1, {});
  check('an unsigned event is refused without detail', unsigned.status === 400 && JSON.stringify(unsigned.json) === '{"error":"invalid signature"}' && db.state.writes === 0);
  const ok = await post(e1);
  check('a signed activation is accepted and grants Base', ok.status === 200 && db.t.discord_entitlements.get(U)?.tier === 'base');
  const writes = db.state.writes;
  const dup = await post(e1);
  check('a replay of the same event is applied once', dup.status === 200 && dup.json?.duplicate === true && db.state.writes === writes);

  db.state.down = true;
  const e2 = ev('PAYMENT.SALE.COMPLETED', { billing_agreement_id: 'I-BASE1' });
  check('a database outage answers 500 so PayPal retries', (await post(e2)).status === 500);
  db.state.down = false;
  check('…and the retry lands', (await post(e2)).status === 200);
  server.closeAllConnections?.();
  await new Promise(r => server.close(r));
}

// ═══ index.js wires it ═════════════════════════════════════════════════════
{
  const idx = readFileSync(join(ROOT, 'index.js'), 'utf8');
  check('index mounts paypal behind the limiter', /mountPaypalWebhook\(app, \{[^}]*guard: webhookGuard/.test(idx));
  check('every rail gets the same superseder', ['Stripe', 'Razorpay', 'Lemon', 'Paypal'].every(n => new RegExp(`mount${n}Webhook\\(app, \\{[^}]*supersede`).test(idx)));
}

console.log(`paypal: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
