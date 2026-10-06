// ═══════════════════════════════════════════════════════════════════════════
//  PLANS — what we sell and what it costs. The one place prices live.
//  ───────────────────────────────────────────────────────────────────────
//  Limits (messages/day, screenshots, burst…) live in discord_quota_tiers so
//  they can be retuned with an UPDATE. Prices live here because the webhook
//  must CHECK them: a Stripe Payment Link lets the buyer edit the
//  client_reference_id in the URL, so the reference only says WHO is buying.
//  WHAT was bought is decided from the Stripe price that was paid — otherwise
//  a $4.99 Pro link with a hand-edited "g_<guild>_<user>" reference would buy
//  the $14.99 server plan.
//
//  Free of discord.js and Stripe, so tests can import it bare.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const PLANS = Object.freeze({
  pro: Object.freeze({
    id: 'pro', label: 'Pro', cents: 499, inr: 399, interval: 'month',
    priceEnv: 'STRIPE_PRICE_PRO', linkEnv: 'STRIPE_PAYMENT_LINK',
  }),
  server: Object.freeze({
    id: 'server', label: 'Server', cents: 1499, inr: 1199, interval: 'month',
    priceEnv: 'STRIPE_PRICE_SERVER', linkEnv: 'STRIPE_SERVER_PAYMENT_LINK',
  }),
  lifetime: Object.freeze({
    id: 'lifetime', label: 'Pro Lifetime', cents: 3999, inr: 3299, interval: null,
    priceEnv: 'STRIPE_PRICE_LIFETIME', linkEnv: 'STRIPE_LIFETIME_PAYMENT_LINK',
  }),
});

/** "$4.99" / "$4.99/mo" / "$39.99 once". */
function priceLabel(planId, { withInterval = true } = {}) {
  const p = PLANS[planId];
  if (!p) return '';
  const amount = `$${(p.cents / 100).toFixed(2)}`;
  if (!withInterval) return amount;
  return p.interval === 'month' ? `${amount}/mo` : `${amount} once`;
}

/**
 * Rupee prices for Razorpay (India). Set by hand, not converted live: Indian
 * buyers see round numbers, and these are checked against what Razorpay
 * actually collected, so changing one means changing the Razorpay plan too.
 */
function inrLabel(planId, { withInterval = true } = {}) {
  const p = PLANS[planId];
  if (!p || !p.inr) return '';
  const amount = `₹${p.inr.toLocaleString('en-IN')}`;
  if (!withInterval) return amount;
  return p.interval === 'month' ? `${amount}/mo` : `${amount} once`;
}

/** Stripe price ids configured for each plan (comma-separated env allowed: monthly + yearly). */
function configuredPriceIds(env = process.env) {
  const out = {};
  for (const p of Object.values(PLANS)) {
    out[p.id] = String(env[p.priceEnv] || '').split(',').map(s => s.trim()).filter(Boolean);
  }
  return out;
}

/**
 * Which plan a completed checkout paid for.
 *
 * 1. By Stripe price id, when STRIPE_PRICE_* are configured — exact.
 * 2. Otherwise by what was charged, matched to the most expensive plan the
 *    amount covers, with the mode deciding subscription vs one-off. A
 *    100%-off coupon (amount 0) cannot be verified this way, so it is refused
 *    and logged rather than guessed; configure the price ids to support it.
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
    if (amountTotal >= PLANS.server.cents) return 'server';
    if (amountTotal >= PLANS.pro.cents) return 'pro';
  }
  return null;
}

module.exports = { PLANS, priceLabel, inrLabel, configuredPriceIds, planForCheckout };
