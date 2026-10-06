// ═══════════════════════════════════════════════════════════════════════════
//  BILLING API — what the website's plans page talks to.
//  ───────────────────────────────────────────────────────────────────────
//  /upgrade in Discord hands the user a signed link (upgradeLink.js) to the
//  plans page. The page asks this API two things:
//
//    GET  /api/plans?t=<token>   prices, which ways to pay are open, and — for
//                                a valid link — who is buying and what plan
//                                they already have
//    POST /api/checkout          { t, plan, interval, rail } → { url } of a
//                                checkout created for exactly that buyer
//
//  Checkouts are created HERE, with the provider keys the bot already holds,
//  so no payment secret ever reaches the website. The buyer comes from the
//  verified token, never from the request body; the plan and price come from
//  plans.js and the provider's own product ids.
//
//  Rails: "card" is the worldwide option (Stripe, or Lemon Squeezy — the
//  latter is merchant of record and handles sales tax); "upi" is Razorpay,
//  in rupees, for buyers in India.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { catalog, offer } = require('./plans');
const { verifyUpgradeToken, siteUrl } = require('./upgradeLink');
const { stripeOffers, createStripeCheckout } = require('./billing-stripe');
const { lemonConfig, lemonOffers, createLemonCheckout } = require('./billing-lemon');
const { razorpayConfig, razorpayOffers, createCheckout: createRazorpayCheckout } = require('./billing-razorpay');
const { loadMembership } = require('./membership');

const COOLDOWN_MS = 8_000;

/** Which ways to pay are open, and what each can sell. */
function availableRails(env = process.env) {
  const stripe = stripeOffers(env);
  const lemon = lemonOffers(lemonConfig(env));
  const pref = (env.PAYMENT_GLOBAL || '').trim().toLowerCase();
  let card = null;
  if (pref === 'lemon' && lemon.length) card = { provider: 'lemon', offers: lemon };
  else if (pref === 'stripe' && stripe.length) card = { provider: 'stripe', offers: stripe };
  else if (stripe.length) card = { provider: 'stripe', offers: stripe };
  else if (lemon.length) card = { provider: 'lemon', offers: lemon };
  const rzp = razorpayOffers(razorpayConfig(env));
  return { card, upi: rzp.length ? { provider: 'razorpay', offers: rzp } : null };
}

const sells = (rail, plan, interval) => !!rail && rail.offers.some(o => o.plan === plan && o.interval === interval);

/**
 * The handlers, with every outside dependency injectable for tests.
 *   checkQuota(supabase, {userId, guildId, kind, dryRun}) → quota decision
 *   creators.{stripe,lemon,razorpay}(args) → { url }
 */
function createBillingApi({
  supabase, env = process.env, checkQuota, creators = {}, now = () => Date.now(), log = console,
} = {}) {
  const secret = () => (env.UPGRADE_LINK_SECRET || '').trim();
  const site = () => siteUrl(env);
  const recent = new Map();   // userId → last checkout created, against button-mashing

  const create = {
    stripe: creators.stripe || ((a) => createStripeCheckout(a, { env })),
    lemon: creators.lemon || ((a) => createLemonCheckout(a, { config: lemonConfig(env) })),
    razorpay: creators.razorpay || ((a) => createRazorpayCheckout(a, { config: razorpayConfig(env) })),
  };

  async function account(buyer) {
    const [d, m] = await Promise.all([
      checkQuota(supabase, { userId: buyer.userId, guildId: buyer.guildId, kind: 'chat', dryRun: true }),
      loadMembership(supabase, { userId: buyer.userId, guildId: buyer.guildId }),
    ]);
    if (d?.degraded) return null;
    const e = m.entitlement;
    return {
      tier: d?.tier || 'free',
      status: e?.status || null,
      until: d?.tier === 'server' ? (m.server?.expires_at || null) : (e?.current_period_end || null),
    };
  }

  async function plans(req, res) {
    const rails = availableRails(env);
    const token = typeof req.query?.t === 'string' ? req.query.t : '';
    const buyer = token ? verifyUpgradeToken(token, { secret: secret(), now: now() }) : null;
    let you = null;
    if (buyer) {
      try { you = await account(buyer); } catch { you = null; }
    }
    return res.json({
      plans: catalog(),
      rails: {
        card: rails.card && { provider: rails.card.provider, offers: rails.card.offers },
        upi: rails.upi && { provider: rails.upi.provider, offers: rails.upi.offers },
      },
      buyer: buyer ? { name: buyer.name, inServer: !!buyer.guildId, expiresAt: buyer.exp } : null,
      linkExpired: !!token && !buyer,
      account: you,
    });
  }

  async function checkout(req, res) {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const buyer = verifyUpgradeToken(typeof b.t === 'string' ? b.t : '', { secret: secret(), now: now() });
    if (!buyer) return res.status(401).json({ error: 'link-expired' });

    const plan = String(b.plan || '');
    const interval = plan === 'lifetime' ? 'once' : String(b.interval || 'month');
    const railName = b.rail === 'upi' ? 'upi' : 'card';
    if (!offer(plan, interval)) return res.status(400).json({ error: 'unknown-plan' });
    const rail = availableRails(env)[railName];
    if (!sells(rail, plan, interval)) return res.status(400).json({ error: 'unavailable' });
    if (plan === 'server' && !buyer.guildId) return res.status(400).json({ error: 'needs-server' });

    // Do not sell a plan someone already holds (a second tab, a stale page).
    try {
      const you = await account(buyer);
      if (you?.tier === 'lifetime' && plan !== 'server') return res.status(409).json({ error: 'already-lifetime' });
      if (you?.tier === 'pro' && plan === 'pro' && you.status !== 'ending') return res.status(409).json({ error: 'already-pro' });
      if (you?.tier === 'server' && plan === 'server') return res.status(409).json({ error: 'server-already-premium' });
    } catch { /* if the lookup fails, the billing core still refuses to displace a plan */ }

    const last = recent.get(buyer.userId) || 0;
    if (now() - last < COOLDOWN_MS) return res.status(429).json({ error: 'slow-down' });
    recent.set(buyer.userId, now());
    if (recent.size > 5000) for (const [k, t] of recent) if (now() - t > COOLDOWN_MS) recent.delete(k);

    const token = b.t;
    const args = {
      plan, interval, userId: buyer.userId, guildId: plan === 'server' ? buyer.guildId : null,
      successUrl: `${site()}/#upgrade/thanks`,
      cancelUrl: `${site()}/#upgrade/${token}`,
      redirectUrl: `${site()}/#upgrade/thanks`,
      callbackUrl: `${site()}/#upgrade/thanks`,
    };
    try {
      const { url } = await create[rail.provider](args);
      log.log(`[upgrade] ${rail.provider} checkout for user=${buyer.userId} ${plan}/${interval}`);
      return res.json({ url });
    } catch (e) {
      recent.delete(buyer.userId);
      log.error(`[upgrade] ${rail.provider} checkout failed for user=${buyer.userId} ${plan}/${interval}: ${e.message}`);
      return res.status(502).json({ error: 'provider-unavailable' });
    }
  }

  /** CORS for the site (and any extra origins in BILLING_API_ORIGINS). */
  function cors(req, res, next) {
    const allowed = new Set([new URL(site()).origin,
      ...String(env.BILLING_API_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  }

  return { plans, checkout, cors, availableRails: () => availableRails(env) };
}

/** Mount the routes. Off unless UPGRADE_LINK_SECRET is set (nothing to verify links with). */
function mountBillingApi(app, { supabase, checkQuota, guard = (_req, _res, next) => next(), env = process.env, creators } = {}) {
  if (!(env.UPGRADE_LINK_SECRET || '').trim()) {
    console.log('[upgrade] plans API off (set UPGRADE_LINK_SECRET to enable /upgrade links)');
    return false;
  }
  const api = createBillingApi({ supabase, env, checkQuota, creators });
  app.options('/api/plans', api.cors);
  app.options('/api/checkout', api.cors);
  app.get('/api/plans', guard, api.cors, (req, res) => api.plans(req, res));
  app.post('/api/checkout', guard, api.cors, (req, res) => api.checkout(req, res));
  console.log('[upgrade] plans API on → GET /api/plans, POST /api/checkout');
  return true;
}

module.exports = { availableRails, createBillingApi, mountBillingApi };
