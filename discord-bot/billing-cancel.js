// ═══════════════════════════════════════════════════════════════════════════
//  BILLING — stopping a subscription that a higher plan replaced.
//  ───────────────────────────────────────────────────────────────────────
//  When someone on Base buys Pro (or anyone buys Lifetime), billing-core
//  grants the new plan and calls `supersede(oldRef)`. The old subscription
//  may live at a different provider than the new purchase, so the reference
//  prefix decides who to ask:
//
//    rzp:sub_…   Razorpay     cancel at the end of the cycle
//    pp:I-…      PayPal       cancel (no further payments)
//    ls:sub:…    Lemon Squeezy  cancel (runs to the end of the period)
//    sub_…       Stripe       cancel at period end
//
//  Anything else (a one-off payment, a manual grant) has nothing to stop.
//  Every path keeps what was already paid for and refunds nothing.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { razorpayConfig, cancelRazorpaySubscription } = require('./billing-razorpay');
const { paypalConfig, cancelPaypalSubscription } = require('./billing-paypal');
const { lemonConfig, cancelLemonSubscription } = require('./billing-lemon');

/**
 * @param cancellers  per-provider overrides, for tests
 * @returns (providerRef) => Promise<'cancelled' | 'already-stopped' | 'nothing-to-stop'>
 */
function createSuperseder({ env = process.env, cancellers = {}, log = console } = {}) {
  const run = {
    razorpay: cancellers.razorpay || ((id) => cancelRazorpaySubscription(id, { config: razorpayConfig(env) })),
    paypal: cancellers.paypal || ((id) => cancelPaypalSubscription(id, { config: paypalConfig(env) })),
    lemon: cancellers.lemon || ((id) => cancelLemonSubscription(id, { config: lemonConfig(env) })),
    // Required lazily: billing-stripe loads the Stripe SDK at require time.
    stripe: cancellers.stripe || ((id) => require('./billing-stripe').cancelStripeSubscription(id)),
  };

  return async function supersede(ref) {
    const r = String(ref || '');
    let provider = null, id = null, m;
    if ((m = /^rzp:(sub_[A-Za-z0-9]+)$/.exec(r))) [provider, id] = ['razorpay', m[1]];
    else if ((m = /^pp:(I-[A-Za-z0-9]+)$/.exec(r))) [provider, id] = ['paypal', m[1]];
    else if ((m = /^ls:sub:(\d+)$/.exec(r))) [provider, id] = ['lemon', m[1]];
    else if ((m = /^(sub_[A-Za-z0-9]+)$/.exec(r))) [provider, id] = ['stripe', m[1]];
    if (!provider) return 'nothing-to-stop';
    const out = await run[provider](id);
    log.log(`[billing] ${r} told to stop renewing (${provider}: ${out})`);
    return out;
  };
}

module.exports = { createSuperseder };
