// ═══════════════════════════════════════════════════════════════════════════
//  BILLING — PayPal (worldwide: PayPal balance, and cards through PayPal).
//  ───────────────────────────────────────────────────────────────────────
//  Same job as billing-razorpay.js, different dialect. Rules live in
//  billing-core.js; this file only (1) creates checkouts, (2) turns PayPal's
//  signed webhooks into core calls and (3) cancels a subscription that a
//  higher plan replaced.
//
//  Linking — written by the server, like Razorpay
//  ──────────────────────────────────────────────
//  The bot creates each checkout through the PayPal API when the buyer presses
//  the button: a subscription (Base, Pro, Server) or an order (Lifetime), with
//  the Discord ids in `custom_id`. The buyer never sees or edits that field,
//  and PayPal returns it on the subscription and on the captured payment.
//  WHAT was bought is still read from PayPal — the subscription's plan id, or
//  the amount captured — never from custom_id.
//
//  Webhooks are only a doorbell
//  ────────────────────────────
//  A subscription event names a subscription; the handler then reads that
//  subscription back from the PayPal API and acts on what PayPal says NOW
//  (status, plan, next billing time). Events can arrive late or out of order
//  and a sale event carries no period end, so re-reading is both simpler and
//  harder to fool than trusting each payload.
//
//  Lifetime is an order: the buyer approves it on PayPal, PayPal sends
//  CHECKOUT.ORDER.APPROVED, this file captures it, and the capture's
//  PAYMENT.CAPTURE.COMPLETED grants the plan. Nothing on the website has to
//  finish the payment, so closing the tab after approving is fine.
//
//  Signatures: PayPal signs `transmission_id|time|webhook_id|crc32(raw body)`
//  with RSA-SHA256 and says where its certificate is. The certificate is only
//  fetched from PayPal's own API hosts, over https, and cached.
//
//  References are prefixed `pp:` (`pp:I-…` subscriptions, `pp:cap:…` captures).
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const crypto = require('node:crypto');
const { PLANS } = require('./plans');
const {
  createBillingCore, applyOnce, dmNotifier, supabaseRepo, withGrace, isSnowflake, RENEWAL_GRACE_MS,
} = require('./billing-core');

const API = { live: 'https://api-m.paypal.com', sandbox: 'https://api-m.sandbox.paypal.com' };
const SUB_REF = (id) => `pp:${id}`;
const CAP_REF = (id) => `pp:cap:${id}`;
const PLAN_KEYS = ['base', 'base_yearly', 'pro', 'pro_yearly', 'server', 'server_yearly'];

/**
 * Settings from the environment, or null when PayPal is not set up.
 *   PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET   REST app credentials (developer.paypal.com → Apps)
 *   PAYPAL_WEBHOOK_ID                         the id PayPal gives the webhook you add (scripts/paypal-setup.js does it)
 *   PAYPAL_ENV                                sandbox (default) or live
 *   PAYPAL_PLAN_BASE / _PRO / _SERVER         billing plan ids (P-…), monthly, in USD at the prices in plans.js
 *   PAYPAL_PLAN_BASE_YEARLY / _PRO_YEARLY / _SERVER_YEARLY   the yearly ones
 */
function paypalConfig(env = process.env) {
  const clientId = (env.PAYPAL_CLIENT_ID || '').trim();
  const clientSecret = (env.PAYPAL_CLIENT_SECRET || '').trim();
  const webhookId = (env.PAYPAL_WEBHOOK_ID || '').trim();
  if (!clientId || !clientSecret || !webhookId) return null;
  const mode = (env.PAYPAL_ENV || '').trim().toLowerCase() === 'live' ? 'live' : 'sandbox';
  const plans = {};
  for (const k of PLAN_KEYS) plans[k] = (env[`PAYPAL_PLAN_${k.toUpperCase()}`] || '').trim();
  return { clientId, clientSecret, webhookId, mode, api: API[mode], plans, brand: 'GameGuide' };
}

// ─── Signatures ────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Unsigned CRC-32 (the zlib one) of a buffer — node:zlib only has it from Node 20.15. */
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Certificates may only come from PayPal's API hosts. A cert URL anywhere
// else is refused before any request is made, so a forged header cannot point
// the check at a key the forger holds.
const CERT_HOSTS = new Set(['api.paypal.com', 'api-m.paypal.com', 'api.sandbox.paypal.com', 'api-m.sandbox.paypal.com']);
function certUrlAllowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && CERT_HOSTS.has(u.hostname.toLowerCase()) && !u.username && !u.password && (!u.port || u.port === '443');
  } catch {
    return false;
  }
}

/** Fetch-and-cache PayPal signing certificates; returns the public key. */
function certStore({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map();   // url → { key, until }
  return async function publicKeyFor(url) {
    const hit = cache.get(url);
    if (hit && hit.until > now()) return hit.key;
    if (!certUrlAllowed(url)) throw new Error('certificate url is not a PayPal host');
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`certificate fetch ${res.status}`);
    const cert = new crypto.X509Certificate(await res.text());
    const until = Date.parse(cert.validTo);
    if (!(Date.parse(cert.validFrom) <= now() && until > now())) throw new Error('certificate is not valid now');
    if (cache.size > 20) cache.clear();
    cache.set(url, { key: cert.publicKey, until: Math.min(until, now() + 24 * 3600_000) });
    return cert.publicKey;
  };
}

/**
 * True when the headers prove PayPal sent exactly these bytes to this webhook.
 * @param publicKeyFor  (certUrl) => Promise<KeyObject> — certStore() in production
 */
async function verifyWebhook(rawBody, headers, { webhookId, publicKeyFor }) {
  const h = (k) => String(headers?.[k] || '');
  const id = h('paypal-transmission-id');
  const time = h('paypal-transmission-time');
  const sig = h('paypal-transmission-sig');
  const certUrl = h('paypal-cert-url');
  const algo = h('paypal-auth-algo');
  if (!webhookId || !id || !time || !sig || !certUrl || !Buffer.isBuffer(rawBody)) return false;
  if (algo && algo.toUpperCase() !== 'SHA256WITHRSA') return false;
  try {
    const key = await publicKeyFor(certUrl);
    const message = `${id}|${time}|${webhookId}|${crc32(rawBody)}`;
    return crypto.verify('sha256', Buffer.from(message), key, Buffer.from(sig, 'base64'));
  } catch {
    return false;
  }
}

// ─── The REST API ──────────────────────────────────────────────────────────

/**
 * A small PayPal client: an OAuth token, cached until shortly before it
 * expires, and JSON requests with a timeout. Every error message is safe to
 * log (it never includes the credentials).
 */
function paypalClient(config, { fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 10_000 } = {}) {
  let token = null;   // { value, until }

  async function call(path, { method = 'GET', body, headers = {}, form = false } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${config.api}${path}`, {
        method, signal: ctrl.signal, headers,
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      });
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
      if (!res.ok) {
        const why = data?.details?.[0]?.issue || data?.name || data?.error || '';
        const err = new Error(`paypal ${res.status}${why ? ` ${String(why).slice(0, 80)}` : ''}`);
        err.status = res.status;
        err.issue = why;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function accessToken() {
    if (token && token.until > now()) return token.value;
    const data = await call('/v1/oauth2/token', {
      method: 'POST', form: true, body: 'grant_type=client_credentials',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    if (typeof data.access_token !== 'string') throw new Error('paypal gave no access token');
    token = { value: data.access_token, until: now() + Math.max(60, Number(data.expires_in) || 300) * 1000 - 60_000 };
    return token.value;
  }

  async function request(path, { method = 'GET', body, requestId } = {}) {
    const headers = { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    // PayPal-Request-Id makes a POST idempotent: a retried capture or create
    // returns the first result instead of doing it twice.
    if (requestId) headers['PayPal-Request-Id'] = String(requestId).slice(0, 108);
    return call(path, { method, body, headers });
  }

  return {
    request,
    getSubscription: (id) => request(`/v1/billing/subscriptions/${encodeURIComponent(id)}`),
    cancelSubscription: (id, reason) => request(`/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason } }),
    captureOrder: (id) => request(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, { method: 'POST', body: {}, requestId: `capture-${id}` }),
    getCapture: (id) => request(`/v2/payments/captures/${encodeURIComponent(id)}`),
  };
}

// ─── Who bought it: custom_id ──────────────────────────────────────────────

/** "u:<user>;p:<plan>[;g:<guild>]" — well under PayPal's 127-character limit. */
function encodeCustomId({ userId, plan, guildId = null }) {
  return `u:${userId};p:${plan}${guildId ? `;g:${guildId}` : ''}`;
}

function parseCustomId(s) {
  if (typeof s !== 'string' || s.length > 127) return null;
  const out = {};
  for (const part of s.split(';')) {
    const [k, v] = part.split(':');
    if (k === 'u' || k === 'g' || k === 'p') out[k] = v;
  }
  if (!isSnowflake(out.u || '')) return null;
  return { userId: out.u, plan: out.p || null, guildId: isSnowflake(out.g || '') ? out.g : null };
}

// ─── Selling ───────────────────────────────────────────────────────────────

const keyFor = (plan, interval) => (interval === 'year' ? `${plan}_yearly` : plan);

/** The PayPal plan id that sells `plan` on `interval`, or ''. */
function paypalPlanId(config, plan, interval) {
  if (!config || plan === 'lifetime') return '';
  return config.plans[keyFor(plan, interval)] || '';
}

/** Which plan/interval combinations PayPal can sell with this config. */
function paypalOffers(config) {
  if (!config) return [];
  const out = [];
  for (const plan of ['base', 'pro', 'server']) {
    for (const interval of ['month', 'year']) if (paypalPlanId(config, plan, interval)) out.push({ plan, interval });
  }
  out.push({ plan: 'lifetime', interval: 'once' });
  return out;
}

const usd = (cents) => (cents / 100).toFixed(2);

// Only ever send a buyer to PayPal itself.
function approveLink(data) {
  const href = (data?.links || []).find(l => l?.rel === 'approve' || l?.rel === 'payer-action')?.href;
  try {
    const u = new URL(href);
    if (u.protocol === 'https:' && /(^|\.)paypal\.com$/i.test(u.hostname)) return href;
  } catch { /* fall through */ }
  return '';
}

/**
 * Create the PayPal checkout for one buyer and plan.
 * @returns { url, ref, kind }
 * Throws on bad input or any PayPal failure; callers show a generic message.
 */
async function createPaypalCheckout({ plan, interval = null, userId, guildId = null, successUrl = '', cancelUrl = '' }, {
  config, client = config && paypalClient(config),
} = {}) {
  if (!config || !client) throw new Error('paypal not configured');
  if (!PLANS[plan]) throw new Error(`unknown plan ${plan}`);
  if (!isSnowflake(String(userId))) throw new Error('bad user id');
  if (plan === 'server' && !isSnowflake(String(guildId))) throw new Error('server plan needs a server id');
  interval = plan === 'lifetime' ? 'once' : (interval || 'month');
  const custom = encodeCustomId({ userId: String(userId), plan, guildId: plan === 'server' ? String(guildId) : null });
  const context = {
    brand_name: config.brand,
    shipping_preference: 'NO_SHIPPING',
    ...(successUrl ? { return_url: successUrl } : {}),
    ...(cancelUrl ? { cancel_url: cancelUrl } : {}),
  };

  let data;
  if (plan === 'lifetime') {
    data = await client.request('/v2/checkout/orders', {
      method: 'POST',
      requestId: `order-${userId}-${Date.now().toString(36)}`,
      body: {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: 'lifetime',
          custom_id: custom,
          description: 'GameGuide Pro Lifetime',
          amount: { currency_code: 'USD', value: usd(PLANS.lifetime.cents) },
        }],
        application_context: { ...context, user_action: 'PAY_NOW' },
      },
    });
  } else {
    const planId = paypalPlanId(config, plan, interval);
    if (!planId) throw new Error(`no PayPal plan id set for ${plan}/${interval}`);
    data = await client.request('/v1/billing/subscriptions', {
      method: 'POST',
      body: {
        plan_id: planId,
        custom_id: custom,
        application_context: { ...context, user_action: 'SUBSCRIBE_NOW' },
      },
    });
  }
  const url = approveLink(data);
  if (!url) throw new Error('paypal returned no usable link');
  return { url, ref: data.id, kind: plan === 'lifetime' ? 'order' : 'subscription' };
}

// ─── PayPal's dialect → billing-core ───────────────────────────────────────

const MONTH_MS = 31 * 864e5;
const YEAR_MS = 366 * 864e5;

function createPaypalHandlers({ repo, notify = async () => {}, supersede, config, client, log = console }) {
  const core = createBillingCore({ repo, notify, supersede, log });
  // pro and pro_yearly are both Pro; the period itself comes from the subscription.
  const planFor = (planId) => {
    const key = Object.entries(config.plans).find(([, id]) => id && id === planId)?.[0];
    return key ? { plan: key.replace(/_yearly$/, ''), yearly: key.endsWith('_yearly') } : null;
  };

  /** End of what has been paid for: the next bill, else the last payment plus one period. */
  function paidUntil(sub, yearly) {
    const next = Date.parse(sub?.billing_info?.next_billing_time || '');
    if (Number.isFinite(next)) return new Date(next).toISOString();
    const last = Date.parse(sub?.billing_info?.last_payment?.time || '');
    return Number.isFinite(last) ? new Date(last + (yearly ? YEAR_MS : MONTH_MS)).toISOString() : null;
  }

  async function subscriptionChanged(id, { failed = false } = {}) {
    if (typeof id !== 'string' || !/^I-[A-Z0-9]{1,60}$/i.test(id)) return 'ignored';
    // A failure to read throws → 5xx → PayPal retries. A subscription PayPal
    // says does not exist (the dashboard's webhook simulator sends made-up
    // ids) is answered 200: retrying it for days would change nothing.
    const sub = await client.getSubscription(id).catch((e) => {
      if (e.status === 404) return null;
      throw e;
    });
    if (!sub) {
      log.warn(`[paypal] subscription ${id} does not exist at PayPal — ignored`);
      return 'unknown-subscription';
    }
    const ref = SUB_REF(sub.id || id);
    const which = planFor(sub.plan_id);
    if (!which) {
      log.error(`[paypal] subscription ${id} has plan_id ${sub.plan_id}, which is not a PAYPAL_PLAN_* — nothing granted`);
      return 'unknown-plan';
    }
    const until = paidUntil(sub, which.yearly);

    if (failed && sub.status === 'ACTIVE') {
      // PayPal is retrying the payment: keep access a little past the failure.
      const keep = Math.max(Date.parse(withGrace(until) || 0) || 0, Date.now() + RENEWAL_GRACE_MS);
      return core.setPeriod({ providerRef: ref, state: 'past_due', until: new Date(keep).toISOString() });
    }
    switch (sub.status) {
      case 'ACTIVE': {
        const who = parseCustomId(sub.custom_id);
        if (!who) {
          // No buyer on it: it can only be a renewal of one already known.
          const r = await core.setPeriod({ providerRef: ref, state: 'active', until: withGrace(until) });
          if (r === 'unknown') log.error(`[paypal] subscription ${id} has no usable custom_id and is not known — grant manually`);
          return r;
        }
        const granted = await core.grant({
          source: 'paypal', plan: which.plan, userId: who.userId, guildId: who.guildId,
          providerRef: ref, periodEnd: withGrace(until),
        });
        return granted === 'invalid' ? 'unlinked' : granted;
      }
      case 'SUSPENDED':
      case 'CANCELLED':
      case 'EXPIRED':
        // Access runs to the end of what was already paid for.
        return core.setPeriod({ providerRef: ref, state: 'ended', until });
      default:
        return 'ignored';   // APPROVAL_PENDING, APPROVED: nothing paid yet
    }
  }

  async function orderApproved(order) {
    if (!order?.id) return 'ignored';
    if (order.purchase_units?.[0]?.reference_id !== 'lifetime') return 'ignored';
    try {
      await client.captureOrder(order.id);
    } catch (e) {
      // Already captured (a retry, or the buyer's own redirect beat us): fine.
      if (e.issue === 'ORDER_ALREADY_CAPTURED') return 'already-captured';
      throw e;
    }
    // The grant comes with PAYMENT.CAPTURE.COMPLETED.
    return 'captured';
  }

  async function captureCompleted(cap) {
    if (!cap?.id || cap.status !== 'COMPLETED') return 'pending';
    const who = parseCustomId(cap.custom_id);
    if (!who || who.plan !== 'lifetime') return 'ignored';           // only Lifetime sells by order
    const paid = Math.round(Number(cap.amount?.value) * 100);
    if (cap.amount?.currency_code !== 'USD' || !(paid >= PLANS.lifetime.cents)) {
      log.error(`[paypal] capture ${cap.id} is not a full Lifetime payment (${cap.amount?.value} ${cap.amount?.currency_code}) — nothing granted`);
      return 'unknown-plan';
    }
    const granted = await core.grant({ source: 'paypal', plan: 'lifetime', userId: who.userId, providerRef: CAP_REF(cap.id) });
    return granted === 'invalid' ? 'unlinked' : granted;
  }

  async function captureReversed(captureId, why) {
    if (typeof captureId !== 'string' || !captureId) return 'ignored';
    if (why === 'refund') {
      // Only a FULL refund takes Lifetime back; ask PayPal which this was.
      const cap = await client.getCapture(captureId).catch((e) => {
        if (e.status === 404) return null;
        throw e;
      });
      if (!cap) return 'unknown-capture';
      if (cap.status !== 'REFUNDED') return 'partial-refund';
    }
    return core.revokeLifetime(CAP_REF(captureId), why);
  }

  async function handleEvent(event) {
    const type = event?.event_type;
    const r = event?.resource || {};
    if (typeof type !== 'string') return 'ignored';
    switch (type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
      case 'BILLING.SUBSCRIPTION.RE-ACTIVATED':
      case 'BILLING.SUBSCRIPTION.UPDATED':
      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
      case 'BILLING.SUBSCRIPTION.EXPIRED':
        return subscriptionChanged(r.id);
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
        return subscriptionChanged(r.id, { failed: true });
      case 'PAYMENT.SALE.COMPLETED':
        // A subscription renewal: re-read the subscription for its new period.
        return r.billing_agreement_id ? subscriptionChanged(r.billing_agreement_id) : 'ignored';
      case 'CHECKOUT.ORDER.APPROVED':
        return orderApproved(r);
      case 'PAYMENT.CAPTURE.COMPLETED':
        return captureCompleted(r);
      case 'PAYMENT.CAPTURE.REFUNDED':
      case 'PAYMENT.CAPTURE.REVERSED': {
        // The resource is the refund; its "up" link is the capture it refunds.
        const up = (r.links || []).find(l => l?.rel === 'up')?.href || '';
        const capId = /\/captures\/([A-Z0-9]+)/i.exec(up)?.[1] || (type === 'PAYMENT.CAPTURE.REVERSED' ? r.id : '');
        return captureReversed(capId, type === 'PAYMENT.CAPTURE.REVERSED' ? 'dispute' : 'refund');
      }
      case 'CUSTOMER.DISPUTE.CREATED': {
        const capId = r.disputed_transactions?.[0]?.seller_transaction_id;
        return captureReversed(capId, 'dispute');
      }
      default:
        return 'ignored';
    }
  }

  return { handleEvent };
}

/** Stop a PayPal subscription renewing (a higher plan replaced it). */
async function cancelPaypalSubscription(id, { config, client = config && paypalClient(config) } = {}) {
  if (!client) throw new Error('paypal not configured');
  try {
    await client.cancelSubscription(id, 'Replaced by a higher GameGuide plan');
  } catch (e) {
    // Already cancelled or expired: the goal is met.
    if (e.status === 422 && /SUBSCRIPTION_STATUS_INVALID/.test(String(e.issue))) return 'already-stopped';
    throw e;
  }
  return 'cancelled';
}

// ─── Mounting ──────────────────────────────────────────────────────────────

/** Mount POST /paypal-webhook. Needs `req.rawBody` from express.json's verify hook. */
function mountPaypalWebhook(app, {
  supabase, client: discordClient, guard = (_req, _res, next) => next(), config = paypalConfig(),
  api = config && paypalClient(config), publicKeyFor = certStore(), supersede,
}) {
  if (!config) {
    console.log('[paypal] billing disabled (need PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID)');
    return false;
  }
  const repo = supabaseRepo(supabase);
  const handlers = createPaypalHandlers({ repo, notify: dmNotifier(discordClient), supersede, config, client: api });

  app.post('/paypal-webhook', guard, async (req, res) => {
    if (!(await verifyWebhook(req.rawBody, req.headers, { webhookId: config.webhookId, publicKeyFor }))) {
      console.warn('[paypal] signature verification failed');
      return res.status(400).json({ error: 'invalid signature' });
    }
    const event = req.body || {};
    // PayPal repeats the event id (WH-…) on every retry of the same event.
    const eventId = typeof event.id === 'string' && event.id
      ? event.id : crypto.createHash('sha256').update(req.rawBody).digest('hex');
    const out = await applyOnce({
      repo, eventId: `pp:${eventId}`, type: `paypal:${String(event.event_type || 'unknown').slice(0, 80)}`,
      handle: () => handlers.handleEvent(event),
    });
    return res.status(out.status).json(out.body);
  });

  console.log(`[paypal] billing enabled (${config.mode}) → POST /paypal-webhook`);
  return true;
}

module.exports = {
  paypalConfig, paypalClient, paypalOffers, paypalPlanId, createPaypalCheckout, createPaypalHandlers,
  cancelPaypalSubscription, mountPaypalWebhook, verifyWebhook, certStore, certUrlAllowed, crc32,
  encodeCustomId, parseCustomId,
};
