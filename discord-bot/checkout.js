// ═══════════════════════════════════════════════════════════════════════════
//  CHECKOUT — which payment buttons exist, and where each one goes.
//  ───────────────────────────────────────────────────────────────────────
//  Three providers can be configured at once:
//    • Stripe / Lemon Squeezy  — a hosted link per plan, with the buyer's
//      Discord id appended (one of the two is the "global" rail)
//    • Razorpay                — rupee checkout created on demand when the
//      buyer presses a button (see billing-razorpay.js)
//  Everything here reads the environment on each call and returns plain data,
//  so index.js stays a thin renderer and tests need no Discord.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { buildCheckoutUrl: stripeUrl } = require('./billing-stripe');
const { lemonConfig, buildCheckoutUrl: lemonUrl } = require('./billing-lemon');
const { razorpayConfig } = require('./billing-razorpay');

const STRIPE_LINK = {
  pro: 'STRIPE_PAYMENT_LINK', server: 'STRIPE_SERVER_PAYMENT_LINK', lifetime: 'STRIPE_LIFETIME_PAYMENT_LINK',
};

/**
 * The hosted-link provider for cards worldwide: 'stripe', 'lemon' or null.
 * PAYMENT_GLOBAL=lemon|stripe picks one when both are configured; otherwise
 * Stripe wins.
 */
function globalProvider(env = process.env) {
  const stripeOn = Object.values(STRIPE_LINK).some(k => (env[k] || '').trim());
  const lc = lemonConfig(env);
  const lemonOn = !!lc && Object.values(lc.checkout).some(Boolean);
  const pref = (env.PAYMENT_GLOBAL || '').trim().toLowerCase();
  if (pref === 'lemon' && lemonOn) return 'lemon';
  if (pref === 'stripe' && stripeOn) return 'stripe';
  return stripeOn ? 'stripe' : lemonOn ? 'lemon' : null;
}

/** The link for one plan on the global rail, or '' when that plan has none. */
function globalCheckoutUrl(plan, { userId, guildId = null }, env = process.env) {
  const prov = globalProvider(env);
  if (prov === 'stripe') {
    const link = (env[STRIPE_LINK[plan]] || '').trim();
    return link ? stripeUrl(link, { userId, guildId: plan === 'server' ? guildId : null }) : '';
  }
  if (prov === 'lemon') {
    const base = lemonConfig(env)?.checkout?.[plan];
    return base ? lemonUrl(base, { userId, guildId: plan === 'server' ? guildId : null }) : '';
  }
  return '';
}

/** Plans Razorpay can sell right now (subscriptions need their plan id). */
function razorpayPlans(env = process.env) {
  const cfg = razorpayConfig(env);
  if (!cfg) return [];
  return ['pro', 'lifetime', 'server'].filter(p => p === 'lifetime' || !!cfg.plans[p]);
}

module.exports = { globalProvider, globalCheckoutUrl, razorpayPlans };
