// ═══════════════════════════════════════════════════════════════════════════
//  BILLING — Lemon Squeezy (worldwide cards and wallets, merchant of record).
//  ───────────────────────────────────────────────────────────────────────
//  Lemon Squeezy is the SELLER on record: it collects the money, handles sales
//  tax / VAT in every country, and pays you out. Same job as billing-stripe.js
//  in its own dialect; the rules live in billing-core.js.
//
//  Linking: each product has a hosted "buy" link; the bot appends
//  `checkout[custom][discord_user_id]=…` (and the server id for a server plan),
//  which Lemon Squeezy returns as meta.custom_data in every webhook.
//
//  Trust: like a Stripe Payment Link, that data is in a URL the buyer can edit,
//  so it only says WHO to credit. WHAT was bought is the variant id Lemon
//  Squeezy reports (variant ids are configured here, never read from the link).
//
//  Test mode: Lemon Squeezy test purchases are free and can be made by anyone,
//  and they arrive signed with the same secret as live ones. Events flagged
//  `test_mode` are therefore ignored unless LEMON_ALLOW_TEST=1.
//
//  References are prefixed `ls:` (`ls:sub:<id>`, `ls:order:<id>`).
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const crypto = require('node:crypto');
const {
  createBillingCore, applyOnce, dmNotifier, supabaseRepo, withGrace, isSnowflake, RENEWAL_GRACE_MS,
} = require('./billing-core');
const { safeEqual } = require('./httpSecurity');

/**
 * Settings from the environment, or null when Lemon Squeezy is not set up.
 *   LEMONSQUEEZY_WEBHOOK_SECRET        the signing secret you type when adding the webhook
 *   LEMON_VARIANT_PRO / _SERVER / _LIFETIME   variant ids (and _PRO_YEARLY / _SERVER_YEARLY)
 *   LEMONSQUEEZY_API_KEY + LEMONSQUEEZY_STORE_ID  to create checkouts server-side (preferred)
 *   LEMON_CHECKOUT_PRO / _SERVER / _LIFETIME  hosted buy links (fallback without an API key)
 */
function lemonConfig(env = process.env) {
  const webhookSecret = (env.LEMONSQUEEZY_WEBHOOK_SECRET || '').trim();
  const variants = {
    pro: (env.LEMON_VARIANT_PRO || '').trim(),
    pro_yearly: (env.LEMON_VARIANT_PRO_YEARLY || '').trim(),
    server: (env.LEMON_VARIANT_SERVER || '').trim(),
    server_yearly: (env.LEMON_VARIANT_SERVER_YEARLY || '').trim(),
    lifetime: (env.LEMON_VARIANT_LIFETIME || '').trim(),
  };
  if (!webhookSecret || !Object.values(variants).some(Boolean)) return null;
  return {
    webhookSecret, variants,
    checkout: {
      pro: (env.LEMON_CHECKOUT_PRO || '').trim(),
      pro_yearly: (env.LEMON_CHECKOUT_PRO_YEARLY || '').trim(),
      server: (env.LEMON_CHECKOUT_SERVER || '').trim(),
      server_yearly: (env.LEMON_CHECKOUT_SERVER_YEARLY || '').trim(),
      lifetime: (env.LEMON_CHECKOUT_LIFETIME || '').trim(),
    },
    // With an API key the bot creates each checkout itself (the buyer's id is
    // then written server-side, not appended to a URL). Buy links are the fallback.
    apiKey: (env.LEMONSQUEEZY_API_KEY || '').trim(),
    storeId: (env.LEMONSQUEEZY_STORE_ID || '').trim(),
    allowTest: env.LEMON_ALLOW_TEST === '1',
  };
}

/** Constant-time check of X-Signature: hex HMAC-SHA256 of the exact raw body. */
function verifySignature(rawBody, header, secret) {
  if (!secret || (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(String(header || ''), expected);
}

/**
 * The hosted buy link with the Discord ids attached. Returns '' unless the base
 * is an https Lemon Squeezy address (so a typo'd or hostile env value can never
 * send a buyer somewhere else).
 */
function buildCheckoutUrl(base, { userId, guildId = null }) {
  if (!base || !isSnowflake(String(userId))) return '';
  let url;
  try { url = new URL(base); } catch { return ''; }
  if (url.protocol !== 'https:' || !/(^|\.)lemonsqueezy\.com$/i.test(url.hostname)) return '';
  // Brackets are left raw on purpose: that is the form Lemon Squeezy documents.
  let out = `${base}${base.includes('?') ? '&' : '?'}checkout[custom][discord_user_id]=${userId}`;
  if (guildId && isSnowflake(String(guildId))) out += `&checkout[custom][discord_guild_id]=${guildId}`;
  return out;
}

// ─── Selling ───────────────────────────────────────────────────────────────

const keyFor = (plan, interval) => (plan === 'lifetime' ? 'lifetime' : interval === 'year' ? `${plan}_yearly` : plan);

/** Which plan/interval combinations this config can sell. */
function lemonOffers(config) {
  if (!config) return [];
  const can = (k) => !!config.variants[k] && (!!(config.apiKey && config.storeId) || !!config.checkout[k]);
  const out = [];
  for (const plan of ['pro', 'server']) {
    for (const interval of ['month', 'year']) if (can(keyFor(plan, interval))) out.push({ plan, interval });
  }
  if (can('lifetime')) out.push({ plan: 'lifetime', interval: 'once' });
  return out;
}

/**
 * A checkout for one buyer. Through the API when a key is set (custom data
 * written by the server, a return link to the site); otherwise the hosted
 * buy link with the ids appended.
 * @returns { url }
 */
async function createLemonCheckout({ plan, interval = null, userId, guildId = null, redirectUrl = '' }, {
  config, fetchImpl = globalThis.fetch, timeoutMs = 8000,
} = {}) {
  if (!config) throw new Error('lemon squeezy not configured');
  interval = plan === 'lifetime' ? 'once' : (interval || 'month');
  const key = keyFor(plan, interval);
  const variant = config.variants[key];
  if (!variant) throw new Error(`no Lemon Squeezy variant for ${plan}/${interval}`);
  if (!isSnowflake(String(userId))) throw new Error('bad user id');
  if (plan === 'server' && !isSnowflake(String(guildId))) throw new Error('server plan needs a server id');

  if (!(config.apiKey && config.storeId)) {
    const url = buildCheckoutUrl(config.checkout[key], { userId, guildId: plan === 'server' ? guildId : null });
    if (!url) throw new Error(`no Lemon Squeezy buy link for ${plan}/${interval}`);
    return { url };
  }

  const custom = { discord_user_id: String(userId) };
  if (plan === 'server') custom.discord_guild_id = String(guildId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: { custom },
            product_options: { enabled_variants: [Number(variant)], ...(redirectUrl ? { redirect_url: redirectUrl } : {}) },
          },
          relationships: {
            store: { data: { type: 'stores', id: String(config.storeId) } },
            variant: { data: { type: 'variants', id: String(variant) } },
          },
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`lemon squeezy ${res.status}: ${String(data?.errors?.[0]?.detail || '').slice(0, 160)}`);
    const url = data?.data?.attributes?.url;
    let ok = false;
    try { const u = new URL(url); ok = u.protocol === 'https:' && /(^|\.)lemonsqueezy\.com$/i.test(u.hostname); } catch { ok = false; }
    if (!ok) throw new Error('lemon squeezy returned no usable link');
    return { url };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Lemon Squeezy's dialect → billing-core ────────────────────────────────

function createLemonHandlers({ repo, notify = async () => {}, config, log = console }) {
  const core = createBillingCore({ repo, notify, log });
  // pro and pro_yearly are both Pro; the period itself comes from the subscription.
  const planFor = (variantId) => {
    const key = Object.entries(config.variants).find(([, v]) => v && String(v) === String(variantId))?.[0];
    return key ? key.replace(/_yearly$/, '') : null;
  };

  async function orderCreated(data, attrs, custom) {
    const plan = planFor(attrs.first_order_item?.variant_id);
    if (plan !== 'lifetime') return 'ignored';       // subscriptions grant from their own events
    if (attrs.status !== 'paid') return 'pending';
    const granted = await core.grant({
      source: 'lemonsqueezy', plan: 'lifetime', userId: custom.discord_user_id, providerRef: `ls:order:${data.id}`,
    });
    return granted === 'invalid' ? 'unlinked' : granted;
  }

  async function orderRefunded(data, attrs) {
    if (attrs.status !== 'refunded') return 'partial-refund';       // partial refunds keep access
    return core.revokeLifetime(`ls:order:${data.id}`, 'refund');
  }

  async function subscriptionEvent(data, attrs, custom) {
    const plan = planFor(attrs.variant_id);
    if (plan !== 'pro' && plan !== 'server') return 'ignored';
    const ref = `ls:sub:${data.id}`;
    const now = Date.now();

    switch (attrs.status) {
      case 'active':
      case 'on_trial': {
        const until = withGrace(attrs.renews_at || attrs.ends_at || null);
        if (isSnowflake(String(custom.discord_user_id))) {
          const granted = await core.grant({
            source: 'lemonsqueezy', plan, userId: custom.discord_user_id,
            guildId: custom.discord_guild_id || null, providerRef: ref, periodEnd: until,
          });
          return granted === 'invalid' ? 'unlinked' : granted;
        }
        // No buyer data on this event: it can only be a renewal of a known subscription.
        const r = await core.setPeriod({ providerRef: ref, state: 'active', until });
        if (r === 'unknown') log.error(`[lemon] subscription ${data.id} has no discord_user_id and is not known — grant manually`);
        return r;
      }
      case 'past_due': {
        // Lemon Squeezy is retrying the card; keep access a little longer.
        const keep = Math.max(Date.parse(withGrace(attrs.renews_at) || 0) || 0, now + RENEWAL_GRACE_MS);
        return core.setPeriod({ providerRef: ref, state: 'past_due', until: new Date(keep).toISOString() });
      }
      case 'cancelled':
        // Cancelled subscriptions stay usable until the period already paid for ends.
        return core.setPeriod({ providerRef: ref, state: 'ended', until: attrs.ends_at || attrs.renews_at || null });
      case 'expired':
      case 'unpaid':
      case 'paused':
        return core.setPeriod({ providerRef: ref, state: 'ended', until: null });
      default:
        return 'ignored';
    }
  }

  async function paymentFailed(attrs) {
    if (!attrs.subscription_id) return 'ignored';
    return core.setPeriod({
      providerRef: `ls:sub:${attrs.subscription_id}`, state: 'past_due',
      until: new Date(Date.now() + RENEWAL_GRACE_MS).toISOString(),
    });
  }

  async function handleEvent(body) {
    const name = body?.meta?.event_name;
    const data = body?.data;
    const attrs = data?.attributes || {};
    const custom = body?.meta?.custom_data && typeof body.meta.custom_data === 'object' ? body.meta.custom_data : {};
    if (typeof name !== 'string' || !data?.id) return 'ignored';

    if (attrs.test_mode === true && !config.allowTest) {
      log.warn(`[lemon] ignoring test-mode ${name} (set LEMON_ALLOW_TEST=1 to accept test purchases)`);
      return 'ignored-test';
    }

    switch (name) {
      case 'order_created': return orderCreated(data, attrs, custom);
      case 'order_refunded': return orderRefunded(data, attrs);
      case 'subscription_created':
      case 'subscription_updated':
      case 'subscription_resumed':
      case 'subscription_unpaused':
      case 'subscription_cancelled':
      case 'subscription_expired':
      case 'subscription_paused':
        return subscriptionEvent(data, attrs, custom);
      case 'subscription_payment_failed': return paymentFailed(attrs);
      default: return 'ignored';        // incl. subscription_payment_success: _updated carries the new period
    }
  }

  return { handleEvent };
}

// ─── Mounting ──────────────────────────────────────────────────────────────

/** Mount POST /lemonsqueezy-webhook. Needs `req.rawBody` from express.json's verify hook. */
function mountLemonWebhook(app, { supabase, client, guard = (_req, _res, next) => next(), config = lemonConfig() }) {
  if (!config) {
    console.log('[lemon] billing disabled (need LEMONSQUEEZY_WEBHOOK_SECRET and at least one LEMON_VARIANT_*)');
    return false;
  }
  const repo = supabaseRepo(supabase);
  const handlers = createLemonHandlers({ repo, notify: dmNotifier(client), config });

  app.post('/lemonsqueezy-webhook', guard, async (req, res) => {
    if (!verifySignature(req.rawBody, req.headers['x-signature'], config.webhookSecret)) {
      console.warn('[lemon] signature verification failed');
      return res.status(400).json({ error: 'invalid signature' });
    }
    const body = req.body || {};
    const data = body.data || {};
    const attrs = data.attributes || {};
    // No event-id header exists, so identify an event by what it is and when it
    // last changed: a retry of the same delivery repeats this exactly.
    const eventId = `ls:${body.meta?.event_name}:${data.type}:${data.id}:${attrs.updated_at || attrs.created_at || ''}`;
    const out = await applyOnce({
      repo, eventId, type: `lemon:${String(body.meta?.event_name || 'unknown').slice(0, 80)}`,
      handle: () => handlers.handleEvent(body),
    });
    return res.status(out.status).json(out.body);
  });

  console.log('[lemon] billing enabled → POST /lemonsqueezy-webhook');
  return true;
}

module.exports = {
  lemonConfig, verifySignature, buildCheckoutUrl, createLemonHandlers, mountLemonWebhook,
  lemonOffers, createLemonCheckout,
};
