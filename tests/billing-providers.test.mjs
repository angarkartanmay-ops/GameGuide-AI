// Razorpay and Lemon Squeezy — what each webhook means, and how checkouts are made.
//
// Real repository code over an in-memory database, so the rules (never eternal,
// lifetime never downgraded, cancel keeps what was paid for, one thank-you) are
// checked through the same writes production makes. The HTTP door is covered in
// providers-http.test.mjs; the shared rules in billing-core below.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { makeDb } from './helpers/fake-supabase.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'discord-bot');
const require = createRequire(join(ROOT, 'index.js'));
const core = require('./billing-core.js');
const rzp = require('./billing-razorpay.js');
const lemon = require('./billing-lemon.js');
const checkout = require('./checkout.js');
const plans = require('./plans.js');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => { if (cond) { passed++; return; } failed++; console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`); };
const silent = { log() {}, warn() {}, error() {} };

const U = '123456789012345678', G = '876543210987654321';
const DAY = 864e5;
const unix = (ms) => Math.floor(ms / 1000);

function world(make) {
  const db = makeDb();
  const repo = core.supabaseRepo(db);
  const dms = [];
  const notify = async (u, k) => dms.push([u, k]);
  return { db, repo, dms, ...make({ repo, notify }) };
}
const ent = (w) => w.db.t.discord_entitlements.get(U);

// ═══ billing-core ═════════════════════════════════════════════════════════
{
  const w = world(({ repo, notify }) => ({ c: core.createBillingCore({ repo, notify, log: silent }) }));
  const end = new Date(Date.now() + 30 * DAY).toISOString();

  check('a bad user id grants nothing', await w.c.grant({ source: 'x', plan: 'pro', userId: 'abc', providerRef: 'r1', periodEnd: end }) === 'invalid' && w.db.t.discord_entitlements.size === 0);
  await w.c.grant({ source: 'razorpay', plan: 'pro', userId: U, providerRef: 'rzp:sub_1', periodEnd: end });
  check('pro is granted with its end date and source', ent(w).tier === 'pro' && ent(w).source === 'razorpay' && ent(w).current_period_end === end);
  check('a missing end date is provisional, never null (= forever)', (await (async () => {
    const w2 = world(({ repo, notify }) => ({ c: core.createBillingCore({ repo, notify, log: silent }) }));
    await w2.c.grant({ source: 'x', plan: 'pro', userId: U, providerRef: 'r2', periodEnd: null });
    const e = Date.parse(w2.db.t.discord_entitlements.get(U).current_period_end);
    return e > Date.now() && e < Date.now() + 4 * DAY;
  })()));
  check('first grant earns one thank-you', w.dms.length === 1 && w.dms[0][1] === 'pro');
  await w.c.grant({ source: 'razorpay', plan: 'pro', userId: U, providerRef: 'rzp:sub_1', periodEnd: new Date(Date.now() + 60 * DAY).toISOString() });
  check('a renewal extends the plan without a second thank-you', Date.parse(ent(w).current_period_end) > Date.now() + 59 * DAY && w.dms.length === 1);

  await w.c.grant({ source: 'lemonsqueezy', plan: 'lifetime', userId: U, providerRef: 'ls:order:9' });
  check('lifetime has no end date', ent(w).tier === 'lifetime' && ent(w).current_period_end === null);
  await w.c.grant({ source: 'razorpay', plan: 'pro', userId: U, providerRef: 'rzp:sub_2', periodEnd: end });
  check('a subscription never downgrades lifetime', ent(w).tier === 'lifetime');
  check('setPeriod leaves lifetime alone', await w.c.setPeriod({ providerRef: 'ls:order:9', state: 'ended', until: null }) === 'lifetime-kept' && ent(w).tier === 'lifetime');
  check('revokeLifetime only touches lifetime rows', await w.c.revokeLifetime('rzp:sub_1', 'refund') === 'unknown');
  check('revokeLifetime takes lifetime back', await w.c.revokeLifetime('ls:order:9', 'refund') === 'lifetime-revoked' && ent(w).tier === 'free');
}
{
  const w = world(({ repo, notify }) => ({ c: core.createBillingCore({ repo, notify, log: silent }) }));
  await w.c.grant({ source: 'razorpay', plan: 'pro', userId: U, providerRef: 'rzp:sub_1', periodEnd: new Date(Date.now() + 10 * DAY).toISOString() });
  const future = new Date(Date.now() + 5 * DAY).toISOString();
  await w.c.setPeriod({ providerRef: 'rzp:sub_1', state: 'ended', until: future });
  check('cancelled with days left keeps access until then (status ending)', ent(w).tier === 'pro' && ent(w).status === 'ending' && ent(w).current_period_end === future);
  await w.c.setPeriod({ providerRef: 'rzp:sub_1', state: 'ended', until: new Date(Date.now() - 1000).toISOString() });
  check('cancelled with nothing left ends now', ent(w).tier === 'free' && ent(w).status === 'canceled');
  check('an unknown reference is reported, not invented', await w.c.setPeriod({ providerRef: 'rzp:sub_nope', state: 'active', until: null }) === 'unknown');

  // server plans
  await w.c.grant({ source: 'lemonsqueezy', plan: 'server', userId: U, guildId: G, providerRef: 'ls:sub:5', periodEnd: new Date(Date.now() + 30 * DAY).toISOString() });
  check('a server plan attaches to its server', w.db.t.discord_premium_servers.get(G)?.provider_ref === 'ls:sub:5');
  await w.c.setPeriod({ providerRef: 'ls:sub:5', state: 'active', until: null });
  check('a server renewal with no date is provisional, never null', Date.parse(w.db.t.discord_premium_servers.get(G).expires_at) < Date.now() + 4 * DAY);
  await w.c.setPeriod({ providerRef: 'ls:sub:5', state: 'ended', until: null });
  check('a server plan ends now', Date.parse(w.db.t.discord_premium_servers.get(G).expires_at) <= Date.now());
  const w3 = world(({ repo, notify }) => ({ c: core.createBillingCore({ repo, notify, log: silent }) }));
  await w3.c.grant({ source: 'razorpay', plan: 'server', userId: U, guildId: null, providerRef: 'rzp:sub_8', periodEnd: new Date(Date.now() + DAY).toISOString() });
  check('a server purchase with no server falls back to Pro for the buyer', w3.db.t.discord_premium_servers.size === 0 && w3.db.t.discord_entitlements.get(U)?.tier === 'pro');
}

// ═══ billing-core: nobody can displace a plan someone else already pays for ═
{
  const mk = () => world(({ repo, notify }) => ({ c: core.createBillingCore({ repo, notify, log: silent }) }));
  const later = new Date(Date.now() + 25 * DAY).toISOString();

  // A stranger buys a cheap plan "for" an account that already has one.
  const w = mk();
  await w.c.grant({ source: 'stripe', plan: 'pro', userId: U, providerRef: 'sub_victim', periodEnd: later });
  const r = await w.c.grant({ source: 'lemonsqueezy', plan: 'pro', userId: U, providerRef: 'ls:sub:attacker', periodEnd: new Date(Date.now() + 60 * DAY).toISOString() });
  check('a different subscription cannot replace an active plan', r === 'already-covered' && ent(w).provider_ref === 'sub_victim' && ent(w).current_period_end === later);
  check('…and the buyer is told, instead of silently getting nothing', w.dms.at(-1)?.[1] === 'covered');
  check('the same subscription renewing is still applied', await w.c.grant({ source: 'stripe', plan: 'pro', userId: U, providerRef: 'sub_victim', periodEnd: new Date(Date.now() + 55 * DAY).toISOString() }) === 'pro' && Date.parse(ent(w).current_period_end) > Date.now() + 54 * DAY);

  // Lifetime may replace a subscription; nothing replaces lifetime.
  check('lifetime replaces a subscription', await w.c.grant({ source: 'razorpay', plan: 'lifetime', userId: U, providerRef: 'rzp:pay_1' }) === 'lifetime' && ent(w).tier === 'lifetime');
  check('a second lifetime does not replace the first', await w.c.grant({ source: 'stripe', plan: 'lifetime', userId: U, providerRef: 'pi_2' }) === 'already-covered' && ent(w).provider_ref === 'rzp:pay_1');
  check('a subscription cannot replace lifetime, and the buyer is told', await w.c.grant({ source: 'stripe', plan: 'pro', userId: U, providerRef: 'sub_x', periodEnd: later }) === 'already-covered' && w.dms.at(-1)[1] === 'covered');

  // A lapsed or failing plan may be replaced.
  const w2 = mk();
  await w2.db.t.discord_entitlements.set(U, { user_id: U, tier: 'pro', status: 'canceled', provider_ref: 'sub_old', current_period_end: new Date(Date.now() - DAY).toISOString() });
  check('a lapsed plan can be replaced by a new purchase', await w2.c.grant({ source: 'razorpay', plan: 'pro', userId: U, providerRef: 'rzp:sub_new', periodEnd: later }) === 'pro' && ent(w2).provider_ref === 'rzp:sub_new');
  const w3 = mk();
  await w3.db.t.discord_entitlements.set(U, { user_id: U, tier: 'pro', status: 'past_due', provider_ref: 'sub_failing', current_period_end: later });
  check('a past_due plan can be replaced by a new purchase', await w3.c.grant({ source: 'razorpay', plan: 'pro', userId: U, providerRef: 'rzp:sub_fresh', periodEnd: later }) === 'pro');
  const w4 = mk();
  await w4.db.t.discord_entitlements.set(U, { user_id: U, tier: 'pro', status: 'active', source: 'manual', provider_ref: null, current_period_end: null });
  check('a permanent manual grant is not displaced by a purchase', await w4.c.grant({ source: 'stripe', plan: 'pro', userId: U, providerRef: 'sub_z', periodEnd: later }) === 'already-covered' && ent(w4).source === 'manual');

  // The same for servers.
  const w5 = mk();
  await w5.c.grant({ source: 'stripe', plan: 'server', userId: U, guildId: G, providerRef: 'sub_srv', periodEnd: later });
  const stranger = '999999999999999999';
  check('a stranger cannot take over a server\'s active plan',
    await w5.c.grant({ source: 'lemonsqueezy', plan: 'server', userId: stranger, guildId: G, providerRef: 'ls:sub:evil', periodEnd: new Date(Date.now() + 90 * DAY).toISOString() }) === 'already-covered'
    && w5.db.t.discord_premium_servers.get(G).provider_ref === 'sub_srv' && w5.dms.at(-1)[1] === 'covered-server');
  check('the server\'s own renewal still applies', await w5.c.grant({ source: 'stripe', plan: 'server', userId: U, guildId: G, providerRef: 'sub_srv', periodEnd: new Date(Date.now() + 55 * DAY).toISOString() }) === 'server');
  w5.db.t.discord_premium_servers.get(G).expires_at = new Date(Date.now() - DAY).toISOString();
  check('an expired server plan can be bought again by anyone', await w5.c.grant({ source: 'razorpay', plan: 'server', userId: stranger, guildId: G, providerRef: 'rzp:sub_new', periodEnd: later }) === 'server');
}

// ═══ billing-core: an event is applied once, and a crashed claim recovers ═══
{
  const db = makeDb();
  const repo = core.supabaseRepo(db);
  const ev = db.t.discord_billing_events;
  check('a new event is claimed', await repo.claimEvent('e1', 't') === true);
  check('a second delivery while it is in flight is a duplicate', await repo.claimEvent('e1', 't') === false);
  await repo.completeEvent('e1');
  ev.get('e1').received_at = new Date(Date.now() - 3600_000).toISOString();
  check('a completed event stays a duplicate however old', await repo.claimEvent('e1', 't') === false);

  await repo.claimEvent('e2', 't');                                        // claimed, then the process "died"
  ev.get('e2').received_at = new Date(Date.now() - 60_000).toISOString();
  check('a fresh unfinished claim is still respected', await repo.claimEvent('e2', 't') === false);
  ev.get('e2').received_at = new Date(Date.now() - core.STALE_CLAIM_MS - 1000).toISOString();
  check('a stale unfinished claim is taken over by the retry', await repo.claimEvent('e2', 't') === true);

  const logs = [];
  const quiet = { log: (m) => logs.push(m), error: () => {}, warn: () => {} };
  let handled = 0;
  const first = await core.applyOnce({ repo, eventId: 'e3', type: 't', handle: async () => { handled++; return 'pro'; }, log: quiet });
  const again = await core.applyOnce({ repo, eventId: 'e3', type: 't', handle: async () => { handled++; return 'pro'; }, log: quiet });
  check('applyOnce applies once and acknowledges the repeat', handled === 1 && first.status === 200 && again.body.duplicate === true);
  check('applyOnce marks the event completed', !!ev.get('e3').completed_at);
  const failed = await core.applyOnce({ repo, eventId: 'e4', type: 't', handle: async () => { throw new Error('db down: secret detail'); }, log: quiet });
  check('a failing handler answers 500 with no detail and un-claims', failed.status === 500 && !JSON.stringify(failed.body).includes('secret') && !ev.has('e4'));
}

// ═══ Razorpay ═════════════════════════════════════════════════════════════
const rcfg = rzp.razorpayConfig({ RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'sekret', RAZORPAY_WEBHOOK_SECRET: 'whsec', RAZORPAY_PLAN_PRO: 'plan_pro', RAZORPAY_PLAN_SERVER: 'plan_srv' });
check('razorpay config needs all three secrets', !!rcfg && !rzp.razorpayConfig({ RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'b' }) && !rzp.razorpayConfig({}));
{
  const body = '{"event":"x"}';
  const good = crypto.createHmac('sha256', 'whsec').update(body).digest('hex');
  check('a correct signature verifies', rzp.verifySignature(body, good, 'whsec') && rzp.verifySignature(Buffer.from(body), good, 'whsec'));
  check('a wrong secret, a changed body, a missing header all fail',
    !rzp.verifySignature(body, good, 'other') && !rzp.verifySignature(body + ' ', good, 'whsec') && !rzp.verifySignature(body, undefined, 'whsec') && !rzp.verifySignature(null, good, 'whsec'));
}

// checkout creation
{
  const calls = [];
  const fake = (resp, ok = true) => async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok, status: ok ? 200 : 400, json: async () => resp }; };
  const now = () => 1_790_000_000_000;

  const sub = await rzp.createCheckout({ plan: 'pro', userId: U }, { config: rcfg, now, fetchImpl: fake({ id: 'sub_9', short_url: 'https://rzp.io/i/abc' }) });
  const c1 = calls[0];
  check('pro creates a subscription on the pro plan', c1.url.endsWith('/v1/subscriptions') && c1.body.plan_id === 'plan_pro' && sub.kind === 'subscription' && sub.url === 'https://rzp.io/i/abc');
  check('the buyer is carried in notes the server wrote', c1.body.notes.discord_user_id === U && c1.body.notes.plan === 'pro' && !('discord_guild_id' in c1.body.notes));
  check('auth is basic, from the key pair', c1.init.headers.Authorization === `Basic ${Buffer.from('rzp_test_abc:sekret').toString('base64')}`);
  check('the cycle count is bounded', c1.body.total_count > 0 && c1.body.total_count <= 120);

  calls.length = 0;
  await rzp.createCheckout({ plan: 'server', userId: U, guildId: G }, { config: rcfg, now, fetchImpl: fake({ id: 'sub_10', short_url: 'https://rzp.io/i/def' }) });
  check('server carries the server id and uses the server plan', calls[0].body.plan_id === 'plan_srv' && calls[0].body.notes.discord_guild_id === G);

  calls.length = 0;
  await rzp.createCheckout({ plan: 'lifetime', userId: U }, { config: rcfg, now, fetchImpl: fake({ id: 'plink_1', short_url: 'https://rzp.io/i/ghi' }) });
  const lt = calls[0];
  check('lifetime is a one-off payment link for the exact rupee amount in paise',
    lt.url.endsWith('/v1/payment_links') && lt.body.amount === plans.PLANS.lifetime.inr * 100 && lt.body.currency === 'INR' && lt.body.accept_partial === false);
  check('the payment link reference fits Razorpay\'s 40 characters and expires', lt.body.reference_id.length <= 40 && lt.body.expire_by > 1_790_000_000);

  const bad = async (args, opts) => { try { await rzp.createCheckout(args, { config: rcfg, now, fetchImpl: fake({}), ...opts }); return null; } catch (e) { return e.message; } };
  check('an unknown plan is refused', !!(await bad({ plan: 'platinum', userId: U })));
  check('a bad user id is refused', !!(await bad({ plan: 'pro', userId: 'x' })));
  check('a server plan without a server is refused', !!(await bad({ plan: 'server', userId: U })));
  check('pro with no Razorpay plan id configured is refused', !!(await rzp.createCheckout({ plan: 'pro', userId: U }, { config: { ...rcfg, plans: { pro: '', server: '' } }, fetchImpl: fake({}) }).then(() => null, e => e.message)));
  check('a Razorpay error is surfaced for the log', /razorpay 400/.test(await rzp.createCheckout({ plan: 'pro', userId: U }, { config: rcfg, fetchImpl: fake({ error: { description: 'Plan is invalid' } }, false) }).then(() => '', e => e.message)));
  check('a link off Razorpay\'s own domain is refused',
    !!(await rzp.createCheckout({ plan: 'pro', userId: U }, { config: rcfg, fetchImpl: fake({ id: 's', short_url: 'https://evil.example/pay' }) }).then(() => null, e => e.message)));
  check('a non-https link is refused',
    !!(await rzp.createCheckout({ plan: 'pro', userId: U }, { config: rcfg, fetchImpl: fake({ id: 's', short_url: 'http://rzp.io/i/x' }) }).then(() => null, e => e.message)));
  check('a hung Razorpay call times out', !!(await rzp.createCheckout({ plan: 'pro', userId: U }, {
    config: rcfg, timeoutMs: 30,
    fetchImpl: (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))),
  }).then(() => null, e => e.message)));
}

// webhook meaning
{
  const w = world(({ repo, notify }) => ({ h: rzp.createRazorpayHandlers({ repo, notify, config: rcfg, log: silent }) }));
  const end = unix(Date.now() + 30 * DAY);
  const sub = (o = {}) => ({ id: 'sub_1', plan_id: 'plan_pro', status: 'active', current_end: end, notes: { discord_user_id: U, plan: 'pro' }, ...o });
  const ev = (event, subscription) => ({ event, payload: { subscription: { entity: subscription } } });

  check('authenticated (mandate only, nothing paid) grants nothing', await w.h.handleEvent(ev('subscription.authenticated', sub({ status: 'authenticated' }))) === 'ignored' && !ent(w));
  check('activated grants pro', await w.h.handleEvent(ev('subscription.activated', sub())) === 'pro' && ent(w)?.tier === 'pro' && ent(w).provider_ref === 'rzp:sub_1');
  check('the period includes renewal grace', Date.parse(ent(w).current_period_end) > Date.now() + 31 * DAY);
  await w.h.handleEvent(ev('subscription.charged', sub({ current_end: unix(Date.now() + 60 * DAY) })));
  check('charged (a renewal) extends it with no second DM', Date.parse(ent(w).current_period_end) > Date.now() + 61 * DAY && w.dms.length === 1);
  check('an `updated` event that is not active changes nothing', await w.h.handleEvent(ev('subscription.updated', sub({ status: 'created' }))) === 'ignored');

  await w.h.handleEvent(ev('subscription.pending', sub({ current_end: unix(Date.now() - DAY) })));
  check('a failed charge keeps access a little longer, as past_due', ent(w).status === 'past_due' && Date.parse(ent(w).current_period_end) > Date.now());
  await w.h.handleEvent(ev('subscription.charged', sub()));
  check('a successful retry returns it to active', ent(w).status === 'active');

  await w.h.handleEvent(ev('subscription.cancelled', sub({ status: 'cancelled', current_end: unix(Date.now() + 6 * DAY) })));
  check('cancelled keeps access to the end of what was paid', ent(w).tier === 'pro' && Date.parse(ent(w).current_period_end) > Date.now() + 5 * DAY && Date.parse(ent(w).current_period_end) < Date.now() + 7 * DAY);
  await w.h.handleEvent(ev('subscription.halted', sub({ status: 'halted', current_end: unix(Date.now() - DAY) })));
  check('halted with nothing left ends it', ent(w).tier === 'free');

  check('a plan id that is not ours grants nothing', await w.h.handleEvent(ev('subscription.activated', sub({ id: 'sub_x', plan_id: 'plan_someone_else' }))) === 'unknown-plan');
  const noBuyer = await w.h.handleEvent(ev('subscription.activated', sub({ id: 'sub_y', notes: {} })));
  check('an activation with no Discord id grants nothing', noBuyer === 'unlinked' && !w.db.t.discord_entitlements.has('undefined'));
  const w2 = world(({ repo, notify }) => ({ h: rzp.createRazorpayHandlers({ repo, notify, config: rcfg, log: silent }) }));
  await w2.h.handleEvent(ev('subscription.activated', sub({ id: 'sub_s', plan_id: 'plan_srv', notes: { discord_user_id: U, discord_guild_id: G, plan: 'server' } })));
  check('the server plan grants the server', w2.db.t.discord_premium_servers.get(G)?.provider_ref === 'rzp:sub_s');
  await w2.h.handleEvent(ev('subscription.cancelled', sub({ id: 'sub_s', plan_id: 'plan_srv', status: 'cancelled', current_end: unix(Date.now() - 1000) })));
  check('cancelling the server plan ends it', Date.parse(w2.db.t.discord_premium_servers.get(G).expires_at) <= Date.now());

  // lifetime by payment link
  const w3 = world(({ repo, notify }) => ({ h: rzp.createRazorpayHandlers({ repo, notify, config: rcfg, log: silent }) }));
  const paid = (o = {}, p = {}) => ({ event: 'payment_link.paid', payload: {
    payment_link: { entity: { id: 'plink_1', status: 'paid', currency: 'INR', amount_paid: plans.PLANS.lifetime.inr * 100, notes: { discord_user_id: U, plan: 'lifetime' }, ...o } },
    payment: { entity: { id: 'pay_1', amount: plans.PLANS.lifetime.inr * 100, amount_refunded: 0, ...p } },
  } });
  check('a full lifetime payment grants lifetime', await w3.h.handleEvent(paid()) === 'lifetime' && w3.db.t.discord_entitlements.get(U)?.tier === 'lifetime' && w3.db.t.discord_entitlements.get(U).provider_ref === 'rzp:pay_1');
  const w4 = world(({ repo, notify }) => ({ h: rzp.createRazorpayHandlers({ repo, notify, config: rcfg, log: silent }) }));
  check('a short payment grants nothing', await w4.h.handleEvent(paid({ amount_paid: 100 })) === 'unknown-plan' && w4.db.t.discord_entitlements.size === 0);
  check('a payment in another currency grants nothing', await w4.h.handleEvent(paid({ currency: 'USD' })) === 'unknown-plan');
  check('an unpaid link grants nothing', await w4.h.handleEvent(paid({ status: 'created' })) === 'unknown-plan');
  check('a link for something else is ignored', await w4.h.handleEvent(paid({ notes: { plan: 'pro', discord_user_id: U } })) === 'ignored');

  const refund = (amount_refunded) => ({ event: 'refund.processed', payload: { refund: { entity: { payment_id: 'pay_1', amount: amount_refunded } }, payment: { entity: { id: 'pay_1', amount: plans.PLANS.lifetime.inr * 100, amount_refunded } } } });
  check('a partial refund keeps lifetime', await w3.h.handleEvent(refund(50_000)) === 'partial-refund' && w3.db.t.discord_entitlements.get(U).tier === 'lifetime');
  check('a full refund takes lifetime back', await w3.h.handleEvent(refund(plans.PLANS.lifetime.inr * 100)) === 'lifetime-revoked' && w3.db.t.discord_entitlements.get(U).tier === 'free');
  await w3.h.handleEvent(paid());
  check('a dispute takes lifetime back', await w3.h.handleEvent({ event: 'payment.dispute.created', payload: { dispute: { entity: { payment_id: 'pay_1' } } } }) === 'lifetime-revoked');
  check('unknown events are ignored', await w3.h.handleEvent({ event: 'order.paid', payload: {} }) === 'ignored' && await w3.h.handleEvent({}) === 'ignored');
}

// ═══ Lemon Squeezy ════════════════════════════════════════════════════════
const lenv = {
  LEMONSQUEEZY_WEBHOOK_SECRET: 'lsecret', LEMON_VARIANT_PRO: '111', LEMON_VARIANT_SERVER: '222', LEMON_VARIANT_LIFETIME: '333',
  LEMON_CHECKOUT_PRO: 'https://gameguide.lemonsqueezy.com/checkout/buy/aaa', LEMON_CHECKOUT_SERVER: 'https://gameguide.lemonsqueezy.com/checkout/buy/bbb',
  LEMON_CHECKOUT_LIFETIME: 'https://gameguide.lemonsqueezy.com/checkout/buy/ccc',
};
const lcfg = lemon.lemonConfig(lenv);
check('lemon config needs the secret and a variant', !!lcfg && !lemon.lemonConfig({ LEMONSQUEEZY_WEBHOOK_SECRET: 's' }) && !lemon.lemonConfig({ LEMON_VARIANT_PRO: '1' }));
{
  const body = '{"meta":{}}';
  const good = crypto.createHmac('sha256', 'lsecret').update(body).digest('hex');
  check('lemon signature verifies, and fails for a wrong secret or body', lemon.verifySignature(body, good, 'lsecret') && !lemon.verifySignature(body, good, 'x') && !lemon.verifySignature(body + '.', good, 'lsecret'));

  const url = lemon.buildCheckoutUrl(lenv.LEMON_CHECKOUT_PRO, { userId: U });
  check('the buy link carries the Discord id as custom data', url === `${lenv.LEMON_CHECKOUT_PRO}?checkout[custom][discord_user_id]=${U}`);
  check('a server link also carries the server', lemon.buildCheckoutUrl(lenv.LEMON_CHECKOUT_SERVER, { userId: U, guildId: G }).endsWith(`&checkout[custom][discord_guild_id]=${G}`));
  check('an existing query string is extended with &', lemon.buildCheckoutUrl(lenv.LEMON_CHECKOUT_PRO + '?embed=1', { userId: U }).includes('?embed=1&checkout['));
  check('a link off lemonsqueezy.com is refused', lemon.buildCheckoutUrl('https://evil.example/checkout/buy/x', { userId: U }) === '' && lemon.buildCheckoutUrl('https://lemonsqueezy.com.evil.example/x', { userId: U }) === '');
  check('a non-https link is refused', lemon.buildCheckoutUrl('http://gameguide.lemonsqueezy.com/x', { userId: U }) === '');
  check('a bad user id is refused', lemon.buildCheckoutUrl(lenv.LEMON_CHECKOUT_PRO, { userId: '1; drop' }) === '');
}
{
  const w = world(({ repo, notify }) => ({ h: lemon.createLemonHandlers({ repo, notify, config: lcfg, log: silent }) }));
  const iso = (ms) => new Date(ms).toISOString();
  const subEv = (name, attrs = {}, custom = { discord_user_id: U }, id = '77') => ({
    meta: { event_name: name, custom_data: custom },
    data: { type: 'subscriptions', id, attributes: { status: 'active', variant_id: 111, renews_at: iso(Date.now() + 30 * DAY), ends_at: null, test_mode: false, ...attrs } },
  });

  check('subscription_created grants pro', await w.h.handleEvent(subEv('subscription_created')) === 'pro' && ent(w)?.tier === 'pro' && ent(w).source === 'lemonsqueezy' && ent(w).provider_ref === 'ls:sub:77');
  check('a trial counts as paid', await w.h.handleEvent(subEv('subscription_updated', { status: 'on_trial' })) === 'pro');
  await w.h.handleEvent(subEv('subscription_updated', { renews_at: iso(Date.now() + 60 * DAY) }, {}));
  check('a renewal with no buyer data extends the known subscription', Date.parse(ent(w).current_period_end) > Date.now() + 61 * DAY && w.dms.length === 1);
  check('an event with no buyer data for an unknown subscription grants nothing', await w.h.handleEvent(subEv('subscription_updated', {}, {}, '999')) === 'unknown');

  await w.h.handleEvent(subEv('subscription_updated', { status: 'past_due', renews_at: iso(Date.now() - DAY) }));
  check('past_due keeps access briefly', ent(w).status === 'past_due' && Date.parse(ent(w).current_period_end) > Date.now());
  await w.h.handleEvent({ meta: { event_name: 'subscription_payment_failed' }, data: { type: 'subscription-invoices', id: '5', attributes: { subscription_id: 77 } } });
  check('a failed payment keeps it past_due', ent(w).status === 'past_due');
  await w.h.handleEvent(subEv('subscription_updated'));
  check('paying again returns it to active', ent(w).status === 'active');

  await w.h.handleEvent(subEv('subscription_cancelled', { status: 'cancelled', ends_at: iso(Date.now() + 9 * DAY) }));
  check('cancelled keeps access until ends_at', ent(w).tier === 'pro' && Date.parse(ent(w).current_period_end) > Date.now() + 8 * DAY);
  await w.h.handleEvent(subEv('subscription_expired', { status: 'expired' }));
  check('expired ends it', ent(w).tier === 'free');

  check('another product\'s variant is ignored', await w.h.handleEvent(subEv('subscription_created', { variant_id: 999 }, { discord_user_id: U }, '1')) === 'ignored');
  const wf = world(({ repo, notify }) => ({ h: lemon.createLemonHandlers({ repo, notify, config: lcfg, log: silent }) }));
  check('test-mode purchases are ignored by default (they are free for anyone to make)',
    await wf.h.handleEvent(subEv('subscription_created', { test_mode: true }, { discord_user_id: U }, '2')) === 'ignored-test' && wf.db.t.discord_entitlements.size === 0 && wf.db.state.writes === 0);
  const wt = world(({ repo, notify }) => ({ h: lemon.createLemonHandlers({ repo, notify, config: { ...lcfg, allowTest: true }, log: silent }) }));
  check('…unless LEMON_ALLOW_TEST=1', await wt.h.handleEvent(subEv('subscription_created', { test_mode: true }, { discord_user_id: U }, '3')) === 'pro');

  const w2 = world(({ repo, notify }) => ({ h: lemon.createLemonHandlers({ repo, notify, config: lcfg, log: silent }) }));
  await w2.h.handleEvent(subEv('subscription_created', { variant_id: 222 }, { discord_user_id: U, discord_guild_id: G }, '88'));
  check('the server variant grants the server', w2.db.t.discord_premium_servers.get(G)?.provider_ref === 'ls:sub:88');
  await w2.h.handleEvent(subEv('subscription_expired', { status: 'expired', variant_id: 222 }, { discord_user_id: U, discord_guild_id: G }, '88'));
  check('expiry ends the server plan', Date.parse(w2.db.t.discord_premium_servers.get(G).expires_at) <= Date.now());

  const w3 = world(({ repo, notify }) => ({ h: lemon.createLemonHandlers({ repo, notify, config: lcfg, log: silent }) }));
  const order = (attrs = {}, custom = { discord_user_id: U }) => ({ meta: { event_name: 'order_created', custom_data: custom }, data: { type: 'orders', id: '500', attributes: { status: 'paid', first_order_item: { variant_id: 333 }, test_mode: false, ...attrs } } });
  check('a paid lifetime order grants lifetime', await w3.h.handleEvent(order()) === 'lifetime' && w3.db.t.discord_entitlements.get(U)?.provider_ref === 'ls:order:500');
  check('an order for a subscription variant is left to its subscription events', await w3.h.handleEvent(order({ first_order_item: { variant_id: 111 } })) === 'ignored');
  const w4 = world(({ repo, notify }) => ({ h: lemon.createLemonHandlers({ repo, notify, config: lcfg, log: silent }) }));
  check('an unpaid order grants nothing', await w4.h.handleEvent(order({ status: 'pending' })) === 'pending' && w4.db.t.discord_entitlements.size === 0);
  check('a lifetime order with no buyer grants nothing', await w4.h.handleEvent(order({}, {})) === 'unlinked');
  const refunded = (status) => ({ meta: { event_name: 'order_refunded' }, data: { type: 'orders', id: '500', attributes: { status, test_mode: false } } });
  check('a partial refund keeps lifetime', await w3.h.handleEvent(refunded('partial_refund')) === 'partial-refund' && w3.db.t.discord_entitlements.get(U).tier === 'lifetime');
  check('a full refund takes lifetime back', await w3.h.handleEvent(refunded('refunded')) === 'lifetime-revoked' && w3.db.t.discord_entitlements.get(U).tier === 'free');
  check('unknown events are ignored', await w3.h.handleEvent({ meta: { event_name: 'license_key_created' }, data: { id: '1', attributes: {} } }) === 'ignored' && await w3.h.handleEvent({}) === 'ignored');
}

// ═══ checkout.js — which buttons exist ════════════════════════════════════
{
  const stripeEnv = { STRIPE_PAYMENT_LINK: 'https://buy.stripe.com/aaa', STRIPE_SERVER_PAYMENT_LINK: 'https://buy.stripe.com/bbb' };
  check('nothing configured → no global rail', checkout.globalProvider({}) === null && checkout.globalCheckoutUrl('pro', { userId: U }, {}) === '');
  check('stripe links → stripe', checkout.globalProvider(stripeEnv) === 'stripe');
  check('lemon links → lemon', checkout.globalProvider(lenv) === 'lemon');
  check('both configured → stripe unless told otherwise', checkout.globalProvider({ ...stripeEnv, ...lenv }) === 'stripe' && checkout.globalProvider({ ...stripeEnv, ...lenv, PAYMENT_GLOBAL: 'lemon' }) === 'lemon');
  check('PAYMENT_GLOBAL cannot select a provider that is not configured', checkout.globalProvider({ ...stripeEnv, PAYMENT_GLOBAL: 'lemon' }) === 'stripe');
  const su = checkout.globalCheckoutUrl('pro', { userId: U }, stripeEnv);
  check('the stripe link carries the buyer', su.startsWith('https://buy.stripe.com/aaa?client_reference_id=') && su.includes(`u_${U}`));
  check('a plan with no link on that rail has no button', checkout.globalCheckoutUrl('lifetime', { userId: U }, stripeEnv) === '');
  check('the server link carries the server', checkout.globalCheckoutUrl('server', { userId: U, guildId: G }, stripeEnv).includes(`g_${G}_${U}`));
  check('the lemon link carries the buyer', checkout.globalCheckoutUrl('pro', { userId: U }, lenv).includes(`discord_user_id]=${U}`));

  check('razorpay offers nothing when unconfigured', checkout.razorpayPlans({}).length === 0);
  const renv = { RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'b', RAZORPAY_WEBHOOK_SECRET: 'c' };
  check('razorpay offers lifetime with no plan ids', JSON.stringify(checkout.razorpayPlans(renv)) === '["lifetime"]');
  check('razorpay offers a subscription only once its plan id is set', JSON.stringify(checkout.razorpayPlans({ ...renv, RAZORPAY_PLAN_PRO: 'p' })) === '["pro","lifetime"]');
}

// ═══ plans ════════════════════════════════════════════════════════════════
check('rupee labels', plans.inrLabel('pro') === '₹399/mo' && plans.inrLabel('server') === '₹1,199/mo' && plans.inrLabel('lifetime') === '₹3,299 once');
check('every plan has a rupee price', Object.values(plans.PLANS).every(p => Number.isInteger(p.inr) && p.inr > 0));

console.log(`billing-providers: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
