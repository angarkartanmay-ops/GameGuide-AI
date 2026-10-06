// Stripe billing — pure-logic assertions.
//
// billing-stripe.js only requires the Stripe SDK when STRIPE_SECRET_KEY is set,
// so it imports cleanly here with billing disabled. That is enough to test the
// parts that decide who keeps paid access, which is the part worth guarding.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const billing = require(join(HERE, '..', 'discord-bot', 'billing-stripe.js'));

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}`);
}

const { subscriptionPeriodEnd } = billing;

// ── subscriptionPeriodEnd ──────────────────────────────────────────────────
// Stripe REMOVED current_period_end from Subscription and moved it onto
// SubscriptionItem (API 2025-03-31.basil onward; the pinned SDK is
// 2026-08-26.dahlia). Reading the old top-level field returns undefined, which
// became null in the DB — and gg_discord_quota_check reads null as "never
// expires":
//
//     AND (e.current_period_end IS NULL OR e.current_period_end > now())
//
// so every subscriber silently received PERMANENT Pro. These assertions exist
// so a future SDK bump cannot quietly restore that.
{
  const AUG_2026 = 1787000000;          // some concrete unix seconds
  const SEP_2026 = AUG_2026 + 30 * 86400;

  check('reads period end from subscription items', (() => {
    const sub = { items: { data: [{ current_period_end: AUG_2026 }] } };
    return subscriptionPeriodEnd(sub) === new Date(AUG_2026 * 1000).toISOString();
  })());

  // Multi-item subscriptions (add-ons, metered components) can have different
  // periods. The earliest is the first moment it is no longer fully paid for.
  check('multi-item takes the EARLIEST end', (() => {
    const sub = { items: { data: [
      { current_period_end: SEP_2026 },
      { current_period_end: AUG_2026 },
    ] } };
    return subscriptionPeriodEnd(sub) === new Date(AUG_2026 * 1000).toISOString();
  })());

  check('ignores items missing a period end', (() => {
    const sub = { items: { data: [
      { current_period_end: null },
      { current_period_end: AUG_2026 },
      {},
    ] } };
    return subscriptionPeriodEnd(sub) === new Date(AUG_2026 * 1000).toISOString();
  })());

  // Back-compat: a pre-basil API version still puts it at the top level.
  check('falls back to the legacy top-level field', (() => {
    const sub = { current_period_end: AUG_2026 };
    return subscriptionPeriodEnd(sub) === new Date(AUG_2026 * 1000).toISOString();
  })());

  check('prefers items over the legacy field when both exist', (() => {
    const sub = {
      current_period_end: SEP_2026,
      items: { data: [{ current_period_end: AUG_2026 }] },
    };
    return subscriptionPeriodEnd(sub) === new Date(AUG_2026 * 1000).toISOString();
  })());

  // THE REGRESSION THAT MATTERED: the old code read sub.current_period_end on a
  // dahlia-shaped object and got undefined. If this ever returns null again for
  // a subscription that plainly has a period, paid access becomes permanent.
  check('a dahlia-shaped subscription never yields null', (() => {
    const sub = { id: 'sub_1', status: 'active', items: { data: [{ current_period_end: AUG_2026 }] } };
    return subscriptionPeriodEnd(sub) !== null;
  })());

  // Genuinely absent → null, which the schema treats as "never expires". That
  // is correct ONLY for a one-off / lifetime purchase with no subscription.
  check('no period information at all is null', subscriptionPeriodEnd({}) === null);
  check('null subscription is null', subscriptionPeriodEnd(null) === null);
  check('empty item list is null', subscriptionPeriodEnd({ items: { data: [] } }) === null);
  check('non-numeric period end is rejected', subscriptionPeriodEnd({ current_period_end: 'soon' }) === null);
}

// ── client_reference_id round-trip ─────────────────────────────────────────
// This is the join between a Stripe payment and a Discord snowflake. If it
// breaks, money arrives and nobody gets upgraded.
{
  const { encodeClientRef, parseClientRef } = billing;
  const USER = '123456789012345678';
  const GUILD = '987654321098765432';

  check('user ref round-trips', (() => {
    const p = parseClientRef(encodeClientRef({ userId: USER }));
    return p && p.kind === 'user' && p.userId === USER && p.guildId === null;
  })());

  check('guild ref round-trips', (() => {
    const p = parseClientRef(encodeClientRef({ userId: USER, guildId: GUILD }));
    return p && p.kind === 'guild' && p.userId === USER && p.guildId === GUILD;
  })());

  check('rejects garbage', parseClientRef('nonsense') === null);
  check('rejects non-string', parseClientRef(null) === null);
  check('rejects a non-snowflake user id', parseClientRef('u_abc') === null);
  check('rejects a truncated guild ref', parseClientRef(`g_${GUILD}`) === null);
}

// ── buildCheckoutUrl ───────────────────────────────────────────────────────
{
  const { buildCheckoutUrl } = billing;
  const USER = '123456789012345678';

  check('appends with ? on a bare link', (() => {
    const u = buildCheckoutUrl('https://buy.stripe.com/x', { userId: USER });
    return u === `https://buy.stripe.com/x?client_reference_id=u_${USER}`;
  })());

  check('appends with & when a query already exists', (() => {
    const u = buildCheckoutUrl('https://buy.stripe.com/x?utm=discord', { userId: USER });
    return u === `https://buy.stripe.com/x?utm=discord&client_reference_id=u_${USER}`;
  })());

  check('no payment link yields empty string', buildCheckoutUrl('', { userId: USER }) === '');
}


// ── Webhook decisions (createBillingHandlers, in-memory repo) ──────────────
// The money-critical rules: what a checkout grants, what renewals and
// cancellations do, and what can never be bought by editing a URL.
const { createBillingHandlers } = billing;
const plans = require(join(HERE, '..', 'discord-bot', 'plans.js'));
{
  const U = '123456789012345678';
  const G = '876543210987654321';
  const DAY = 864e5;
  const silent = { log() {}, warn() {}, error() {} };
  const ENV = { STRIPE_PRICE_PRO: 'price_pro_m,price_pro_y', STRIPE_PRICE_SERVER: 'price_srv', STRIPE_PRICE_LIFETIME: 'price_life' };

  function world({ env = ENV, priceIds = [], subEnd = Math.floor((Date.now() + 30 * DAY) / 1000), users = {} } = {}) {
    const db = { users: { ...users }, guilds: {} };
    const notified = [];
    const repo = {
      async getUser(id) { return db.users[id] || null; },
      async getUserByRef(ref) { return Object.values(db.users).find(u => u.provider_ref === ref) || null; },
      async putUser({ userId, tier, providerRef, status, periodEnd }) {
        db.users[userId] = { user_id: userId, tier, status, provider_ref: providerRef, current_period_end: periodEnd };
      },
      async getGuild(id) { return db.guilds[id] || null; },
      async getGuildByRef(ref) { return Object.values(db.guilds).find(g => g.provider_ref === ref) || null; },
      async putGuild({ guildId, grantedBy, providerRef, expiresAt }) {
        db.guilds[guildId] = { guild_id: guildId, granted_by: grantedBy, provider_ref: providerRef, expires_at: expiresAt };
      },
      async setGuildExpiry(ref, at) { for (const g of Object.values(db.guilds)) if (g.provider_ref === ref) g.expires_at = at; },
    };
    const api = {
      async listLineItemPriceIds() { return priceIds; },
      async retrieveSubscription(id) { return { id, items: { data: [{ current_period_end: subEnd }] } }; },
    };
    const h = createBillingHandlers({ repo, api, env, log: silent, notify: async (u, k) => notified.push([u, k]) });
    return { db, h, notified };
  }
  const session = (o) => ({ id: 'cs_1', payment_status: 'paid', mode: 'subscription', subscription: 'sub_1', amount_total: 499, ...o });

  // Pro, the ordinary path.
  {
    const w = world({ priceIds: ['price_pro_m'] });
    const out = await w.h.checkoutCompleted(session({ client_reference_id: `u_${U}` }));
    check('pro checkout grants pro', out === 'pro' && w.db.users[U]?.tier === 'pro' && w.db.users[U].status === 'active');
    check('pro has a period end (never eternal)', !!w.db.users[U].current_period_end);
    check('period end includes renewal grace',
      Date.parse(w.db.users[U].current_period_end) > Date.now() + 31 * DAY);
    check('buyer is thanked', w.notified.length === 1 && w.notified[0][1] === 'pro');
  }

  // The exploit: a $4.99 Pro link with a hand-edited server reference.
  {
    const w = world({ priceIds: ['price_pro_m'] });
    const out = await w.h.checkoutCompleted(session({ client_reference_id: `g_${G}_${U}` }));
    check('edited reference cannot buy a server plan', out === 'pro' && Object.keys(w.db.guilds).length === 0);
    check('…the buyer still gets what they paid for', w.db.users[U]?.tier === 'pro');
  }

  // A real server purchase.
  {
    const w = world({ priceIds: ['price_srv'] });
    const out = await w.h.checkoutCompleted(session({ client_reference_id: `g_${G}_${U}`, amount_total: 1499 }));
    check('server checkout grants the server', out === 'server' && w.db.guilds[G]?.provider_ref === 'sub_1');
    check('server plan has an expiry', !!w.db.guilds[G].expires_at);

    const renewedEnd = Math.floor((Date.now() + 60 * DAY) / 1000);
    await w.h.subscriptionChanged({ id: 'sub_1', status: 'active', items: { data: [{ current_period_end: renewedEnd }] } });
    check('server renewal extends the expiry', Date.parse(w.db.guilds[G].expires_at) > Date.now() + 59 * DAY);

    await w.h.subscriptionChanged({ id: 'sub_1', status: 'canceled', items: { data: [] } }, { deleted: true });
    check('server cancellation ends it now', Date.parse(w.db.guilds[G].expires_at) <= Date.now());
  }

  // Unknown products on the same Stripe account grant nothing.
  {
    const w = world({ priceIds: ['price_some_tshirt'] });
    const out = await w.h.checkoutCompleted(session({ client_reference_id: `u_${U}`, amount_total: 99999 }));
    check('unknown price grants nothing', out === 'unknown-plan' && !w.db.users[U]);
  }

  // Not paid yet (bank debit) → wait for async_payment_succeeded.
  {
    const w = world({ priceIds: ['price_pro_m'] });
    const out = await w.h.checkoutCompleted(session({ client_reference_id: `u_${U}`, payment_status: 'unpaid' }));
    check('unpaid checkout grants nothing yet', out === 'pending' && !w.db.users[U]);
    const later = await w.h.handleEvent({ type: 'checkout.session.async_payment_succeeded', data: { object: session({ client_reference_id: `u_${U}` }) } });
    check('async success grants', later === 'pro' && w.db.users[U]?.tier === 'pro');
  }

  // Lifetime: one-off, never expires, never overwritten by a subscription.
  {
    const w = world({ priceIds: ['price_life'] });
    const out = await w.h.checkoutCompleted(session({ client_reference_id: `u_${U}`, mode: 'payment', subscription: null, payment_intent: 'pi_1', amount_total: 3999 }));
    check('lifetime grants lifetime with no expiry', out === 'lifetime' && w.db.users[U]?.tier === 'lifetime' && w.db.users[U].current_period_end === null);

    const w2 = world({ priceIds: ['price_pro_m'], users: { [U]: { ...w.db.users[U] } } });
    await w2.h.checkoutCompleted(session({ client_reference_id: `u_${U}`, subscription: 'sub_9' }));
    check('a later Pro subscription never downgrades Lifetime', w2.db.users[U].tier === 'lifetime');

    const partial = await w.h.chargeReversed({ payment_intent: 'pi_1', refunded: false }, 'refund');
    check('partial refund keeps Lifetime', partial === 'partial-refund' && w.db.users[U].tier === 'lifetime');
    const full = await w.h.chargeReversed({ payment_intent: 'pi_1', refunded: true }, 'refund');
    check('full refund revokes Lifetime', full === 'lifetime-revoked' && w.db.users[U].tier === 'free');
  }
  {
    const w = world({ priceIds: ['price_life'] });
    await w.h.checkoutCompleted(session({ client_reference_id: `u_${U}`, mode: 'payment', subscription: null, payment_intent: 'pi_2', amount_total: 3999 }));
    await w.h.chargeReversed({ payment_intent: 'pi_2' }, 'dispute');
    check('a dispute revokes Lifetime', w.db.users[U].tier === 'free');
  }

  // Renewals, dunning, cancellation for Pro.
  {
    const w = world({ priceIds: ['price_pro_m'] });
    await w.h.checkoutCompleted(session({ client_reference_id: `u_${U}` }));
    await w.h.invoicePaymentFailed({ subscription: 'sub_1' });
    check('failed renewal keeps Pro as past_due', w.db.users[U].tier === 'pro' && w.db.users[U].status === 'past_due');
    await w.h.subscriptionChanged({ id: 'sub_1', status: 'active', items: { data: [{ current_period_end: Math.floor((Date.now() + 30 * DAY) / 1000) }] } });
    check('recovered payment returns to active', w.db.users[U].status === 'active');
    await w.h.subscriptionChanged({ id: 'sub_1', status: 'canceled', items: { data: [] } }, { deleted: true });
    check('cancellation returns to free', w.db.users[U].tier === 'free' && w.db.users[U].status === 'canceled');
  }

  // Without configured price ids, the amount decides — and never upward.
  {
    const w = world({ env: {}, priceIds: [] });
    const out = await w.h.checkoutCompleted(session({ client_reference_id: `g_${G}_${U}`, amount_total: 499 }));
    check('no price ids: $4.99 with a server ref is still only Pro', out === 'pro' && !w.db.guilds[G]);
    check('no price ids: a 100% coupon is not guessed', plans.planForCheckout({ amountTotal: 0, mode: 'subscription' }, {}) === null);
    check('no price ids: $39.99 one-off is lifetime', plans.planForCheckout({ amountTotal: 3999, mode: 'payment' }, {}) === 'lifetime');
    check('no price ids: $14.99 subscription is server', plans.planForCheckout({ amountTotal: 1499, mode: 'subscription' }, {}) === 'server');
  }

  check('no reference → nothing granted', await world({ priceIds: ['price_pro_m'] }).h.checkoutCompleted(session({ client_reference_id: 'u_bad' })) === 'unlinked');
  check('price labels', plans.priceLabel('pro') === '$4.99/mo' && plans.priceLabel('server') === '$14.99/mo' && plans.priceLabel('lifetime') === '$39.99 once');
  check('reference longer than any real one is rejected', billing.parseClientRef('u_' + '1'.repeat(80)) === null);
  check('reference with extra parts is rejected', billing.parseClientRef(`u_${U}_x`) === null);
}

console.log(`billing: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
