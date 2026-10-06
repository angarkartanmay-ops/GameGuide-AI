// ═══════════════════════════════════════════════════════════════════════════
//  PLANS — what we sell and what it costs. The one place prices live.
//  ───────────────────────────────────────────────────────────────────────
//  Limits (messages/day, screenshots, burst…) live in discord_quota_tiers so
//  they can be retuned with an UPDATE. Prices live here because the webhooks
//  CHECK them: what was bought is decided from what the payment provider says
//  was paid, never from anything the buyer could edit.
//
//  Each plan has one or more OFFERS — monthly, yearly, or once. Yearly is
//  priced at ten months (two free), the way most subscriptions do it.
//  The website's copy lives in src/site/pricing.js; tests/pricing.test.mjs
//  fails if the two ever disagree.
//
//  Free of discord.js and Stripe, so tests can import it bare.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const PLANS = Object.freeze({
  pro: Object.freeze({
    id: 'pro', label: 'Pro', cents: 499, inr: 399, interval: 'month',
    yearly: Object.freeze({ cents: 4999, inr: 3999 }),
    priceEnv: 'STRIPE_PRICE_PRO', linkEnv: 'STRIPE_PAYMENT_LINK',
  }),
  server: Object.freeze({
    id: 'server', label: 'Server', cents: 1499, inr: 1199, interval: 'month',
    yearly: Object.freeze({ cents: 14999, inr: 11999 }),
    priceEnv: 'STRIPE_PRICE_SERVER', linkEnv: 'STRIPE_SERVER_PAYMENT_LINK',
  }),
  lifetime: Object.freeze({
    id: 'lifetime', label: 'Pro Lifetime', cents: 3999, inr: 3299, interval: null,
    priceEnv: 'STRIPE_PRICE_LIFETIME', linkEnv: 'STRIPE_LIFETIME_PAYMENT_LINK',
  }),
});

const INTERVALS = Object.freeze(['month', 'year', 'once']);

/**
 * The price of one plan on one interval, or null if that combination is not
 * sold (there is no yearly Lifetime, and no one-off Pro).
 * @returns { plan, interval, cents, inr }
 */
function offer(planId, interval) {
  const p = PLANS[planId];
  if (!p) return null;
  if (planId === 'lifetime') return interval === 'once' ? { plan: planId, interval, cents: p.cents, inr: p.inr } : null;
  if (interval === 'month') return { plan: planId, interval, cents: p.cents, inr: p.inr };
  if (interval === 'year' && p.yearly) return { plan: planId, interval, cents: p.yearly.cents, inr: p.yearly.inr };
  return null;
}

/** Every plan with its offers — the public price list (no secrets). */
function catalog() {
  return Object.values(PLANS).map(p => ({
    id: p.id,
    label: p.label,
    offers: INTERVALS.map(i => offer(p.id, i)).filter(Boolean)
      .map(o => ({ interval: o.interval, usdCents: o.cents, inr: o.inr })),
  }));
}

const SUFFIX = { month: '/mo', year: '/yr', once: ' once' };

/** "$4.99/mo" · "$49.99/yr" · "$39.99 once". Monthly unless an interval is given. */
function priceLabel(planId, { interval = null, withInterval = true } = {}) {
  const o = offer(planId, interval || (planId === 'lifetime' ? 'once' : 'month'));
  if (!o) return '';
  const amount = `$${(o.cents / 100).toFixed(2)}`;
  return withInterval ? `${amount}${SUFFIX[o.interval]}` : amount;
}

/**
 * Rupee prices for Razorpay (India). Set by hand, not converted live: Indian
 * buyers see round numbers, and these are checked against what Razorpay
 * actually collected, so changing one means changing the Razorpay plan too.
 */
function inrLabel(planId, { interval = null, withInterval = true } = {}) {
  const o = offer(planId, interval || (planId === 'lifetime' ? 'once' : 'month'));
  if (!o || !o.inr) return '';
  const amount = `₹${o.inr.toLocaleString('en-IN')}`;
  return withInterval ? `${amount}${SUFFIX[o.interval]}` : amount;
}

/**
 * Stripe price ids configured for each plan. STRIPE_PRICE_PRO holds the
 * monthly price, STRIPE_PRICE_PRO_YEARLY the yearly one; both map to 'pro'
 * (the period itself comes from the subscription). Comma lists are allowed.
 */
function configuredPriceIds(env = process.env) {
  const list = (k) => String(env[k] || '').split(',').map(s => s.trim()).filter(Boolean);
  const out = {};
  for (const p of Object.values(PLANS)) out[p.id] = [...list(p.priceEnv), ...list(`${p.priceEnv}_YEARLY`)];
  return out;
}

/** The single Stripe price id to sell `plan` on `interval` with, or ''. */
function stripePriceFor(planId, interval, env = process.env) {
  const p = PLANS[planId];
  if (!p || !offer(planId, interval)) return '';
  const key = interval === 'year' ? `${p.priceEnv}_YEARLY` : p.priceEnv;
  return String(env[key] || '').split(',').map(s => s.trim()).filter(Boolean)[0] || '';
}

/**
 * Which plan a completed checkout paid for.
 *
 * 1. By Stripe price id, when STRIPE_PRICE_* are configured — exact.
 * 2. Otherwise by what was charged: the most expensive offer the amount covers
 *    (taxes can push a charge above list price, never a plan below it), with
 *    the mode deciding subscription vs one-off. A 100%-off coupon (amount 0)
 *    cannot be verified this way, so it is refused and logged; configure the
 *    price ids to support it.
 *
 * Returns a plan id or null (unknown purchase — grant nothing).
 */
function planForCheckout({ priceIds = [], amountTotal = null, mode = null }, env = process.env) {
  const configured = configuredPriceIds(env);
  for (const [planId, ids] of Object.entries(configured)) {
    if (ids.length && priceIds.some(id => ids.includes(id))) return planId;
  }
  // Price ids are configured but none matched: this is some other product on
  // the same Stripe account. Grant nothing.
  if (Object.values(configured).some(ids => ids.length)) return null;

  if (!Number.isFinite(amountTotal) || amountTotal <= 0) return null;
  if (mode === 'payment') return amountTotal >= PLANS.lifetime.cents ? 'lifetime' : null;
  if (mode === 'subscription') {
    // Every subscription offer, dearest first: $149.99 server/yr, $49.99 pro/yr,
    // $14.99 server/mo, $4.99 pro/mo. A $49.99 yearly Pro must not read as a
    // monthly server plan just because it is more than $14.99.
    const offers = ['pro', 'server'].flatMap(id => ['month', 'year'].map(i => offer(id, i))).filter(Boolean)
      .sort((a, b) => b.cents - a.cents);
    const hit = offers.find(o => amountTotal >= o.cents && amountTotal < o.cents * 1.5);
    return hit ? hit.plan : null;
  }
  return null;
}

module.exports = {
  PLANS, INTERVALS, offer, catalog, priceLabel, inrLabel, configuredPriceIds, stripePriceFor, planForCheckout,
};
