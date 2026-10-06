// ═══════════════════════════════════════════════════════════════════════════
//  BILLING — Razorpay (India: UPI, cards, netbanking).
//  ───────────────────────────────────────────────────────────────────────
//  Same job as billing-stripe.js, different dialect. Rules live in
//  billing-core.js; this file only (1) creates checkout links and (2) turns
//  Razorpay's signed webhooks into core calls.
//
//  Linking — and why this one is safer than a Stripe Payment Link
//  ──────────────────────────────────────────────────────────────
//  Razorpay has no "append ?client_reference_id=" to a static link. Instead
//  the bot calls the Razorpay API at the moment someone presses the button,
//  and creates a subscription (Pro, Server) or a payment link (Lifetime) that
//  carries the Discord user id, server id and plan in `notes`. Those notes are
//  written by the server, not by the buyer, and come back inside the signed
//  webhook — so unlike a hand-editable URL they cannot be tampered with. The
//  plan is still checked against what Razorpay says was paid (its plan_id, or
//  the amount collected), never against the notes alone.
//
//  References are prefixed `rzp:` so Razorpay's `sub_…` ids cannot collide
//  with Stripe's in discord_entitlements.provider_ref.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const crypto = require('node:crypto');
const { PLANS } = require('./plans');
const {
  createBillingCore, applyOnce, dmNotifier, supabaseRepo, withGrace, isSnowflake, RENEWAL_GRACE_MS,
} = require('./billing-core');
const { safeEqual } = require('./httpSecurity');

const API = 'https://api.razorpay.com/v1';
const REF = (id) => `rzp:${id}`;
const iso = (unix) => (Number.isFinite(unix) ? new Date(unix * 1000).toISOString() : null);

/**
 * Settings from the environment, or null when Razorpay is not set up.
 *   RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET   API keys (Dashboard → API Keys)
 *   RAZORPAY_WEBHOOK_SECRET                 the secret you type when adding the webhook
 *   RAZORPAY_PLAN_PRO / RAZORPAY_PLAN_SERVER  plan ids (plan_…) you create once, monthly,
 *                                           for the amounts in plans.js
 */
function razorpayConfig(env = process.env) {
  const keyId = (env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = (env.RAZORPAY_KEY_SECRET || '').trim();
  const webhookSecret = (env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  if (!keyId || !keySecret || !webhookSecret) return null;
  return {
    keyId, keySecret, webhookSecret,
    plans: { pro: (env.RAZORPAY_PLAN_PRO || '').trim(), server: (env.RAZORPAY_PLAN_SERVER || '').trim() },
  };
}

/** Constant-time check of X-Razorpay-Signature: hex HMAC-SHA256 of the exact raw body. */
function verifySignature(rawBody, header, secret) {
  if (!secret || (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(String(header || ''), expected);
}

// ─── Creating a checkout ───────────────────────────────────────────────────

/**
 * Create the hosted checkout for one buyer and plan.
 * @returns { url, ref, kind }   url is Razorpay's short link
 * Throws on bad input or any Razorpay failure; callers show a generic message
 * (the detail in the error is for the server log only).
 */
async function createCheckout({ plan, userId, guildId = null }, {
  config, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000,
} = {}) {
  if (!config) throw new Error('razorpay not configured');
  if (!PLANS[plan] || !PLANS[plan].inr) throw new Error(`unknown plan ${plan}`);
  if (!isSnowflake(String(userId))) throw new Error('bad user id');
  if (plan === 'server' && !isSnowflake(String(guildId))) throw new Error('server plan needs a server id');
  if (plan !== 'lifetime' && !config.plans[plan]) throw new Error(`no Razorpay plan id set for ${plan}`);

  const notes = { discord_user_id: String(userId), plan };
  if (plan === 'server') notes.discord_guild_id = String(guildId);

  let path, body;
  if (plan === 'lifetime') {
    path = '/payment_links';
    body = {
      amount: PLANS.lifetime.inr * 100,           // paise
      currency: 'INR',
      accept_partial: false,
      description: 'GameGuide-AI Pro Lifetime',
      reference_id: `lt_${userId}_${now().toString(36)}`.slice(0, 40),
      reminder_enable: false,
      expire_by: Math.floor(now() / 1000) + 3 * 86400,
      notes,
    };
  } else {
    path = '/subscriptions';
    body = {
      plan_id: config.plans[plan],
      total_count: 120,                            // billing cycles allowed; cancel any time
      quantity: 1,
      customer_notify: 1,
      notes,
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${API}${path}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`razorpay ${res.status}: ${String(data?.error?.description || '').slice(0, 160)}`);
    const url = data.short_url;
    // Only ever hand the buyer an https link on Razorpay's own short domain.
    if (typeof url !== 'string' || !/^https:\/\/(rzp\.io|[a-z0-9-]+\.razorpay\.com)\//i.test(url)) {
      throw new Error('razorpay returned no usable link');
    }
    return { url, ref: data.id, kind: plan === 'lifetime' ? 'payment_link' : 'subscription' };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Razorpay's dialect → billing-core ─────────────────────────────────────

function createRazorpayHandlers({ repo, notify = async () => {}, config, log = console }) {
  const core = createBillingCore({ repo, notify, log });
  const planFor = (planId) => Object.entries(config.plans).find(([, id]) => id && id === planId)?.[0] || null;

  async function subscriptionEvent(name, sub) {
    if (!sub?.id) return 'ignored';
    const ref = REF(sub.id);
    const end = iso(sub.current_end);

    switch (name) {
      case 'subscription.activated':
      case 'subscription.charged':
      case 'subscription.resumed':
      case 'subscription.updated': {
        // `updated` also fires for states that are not paid yet.
        if (sub.status !== 'active') return 'ignored';
        const plan = planFor(sub.plan_id);
        if (!plan) {
          log.error(`[razorpay] subscription ${sub.id} has plan_id ${sub.plan_id}, which is not RAZORPAY_PLAN_PRO/SERVER — nothing granted`);
          return 'unknown-plan';
        }
        const granted = await core.grant({
          source: 'razorpay', plan,
          userId: sub.notes?.discord_user_id, guildId: sub.notes?.discord_guild_id || null,
          providerRef: ref, periodEnd: withGrace(end),
        });
        return granted === 'invalid' ? 'unlinked' : granted;
      }
      case 'subscription.pending': {
        // A charge failed and Razorpay is retrying: keep access a little past
        // the failure instead of cutting a subscriber over one declined card.
        const keep = Math.max(Date.parse(withGrace(end) || 0) || 0, Date.now() + RENEWAL_GRACE_MS);
        return core.setPeriod({ providerRef: ref, state: 'past_due', until: new Date(keep).toISOString() });
      }
      case 'subscription.halted':
      case 'subscription.cancelled':
      case 'subscription.completed':
        // Access runs to the end of what was already paid for.
        return core.setPeriod({ providerRef: ref, state: 'ended', until: end });
      case 'subscription.paused':
        return core.setPeriod({ providerRef: ref, state: 'ended', until: null });
      default:
        return 'ignored';
    }
  }

  async function paymentLinkPaid(payload) {
    const link = payload?.payment_link?.entity;
    const payment = payload?.payment?.entity;
    if (!link || !payment?.id) return 'ignored';
    if (link.notes?.plan !== 'lifetime') return 'ignored';          // only Lifetime sells by link
    const owed = PLANS.lifetime.inr * 100;
    if (link.status !== 'paid' || link.currency !== 'INR' || !(link.amount_paid >= owed)) {
      log.error(`[razorpay] payment link ${link.id} is not a full Lifetime payment (${link.status} ${link.amount_paid} ${link.currency}) — nothing granted`);
      return 'unknown-plan';
    }
    const granted = await core.grant({
      source: 'razorpay', plan: 'lifetime', userId: link.notes?.discord_user_id, providerRef: REF(payment.id),
    });
    return granted === 'invalid' ? 'unlinked' : granted;
  }

  async function refundProcessed(payload) {
    const paymentId = payload?.refund?.entity?.payment_id || payload?.payment?.entity?.id;
    const payment = payload?.payment?.entity;
    if (!paymentId) return 'ignored';
    // Without the payment we cannot tell a full refund from a partial one, and a
    // partial refund keeps access.
    if (!payment || !(payment.amount_refunded >= payment.amount)) return 'partial-refund';
    return core.revokeLifetime(REF(paymentId), 'refund');
  }

  async function disputeCreated(payload) {
    const paymentId = payload?.dispute?.entity?.payment_id;
    return paymentId ? core.revokeLifetime(REF(paymentId), 'dispute') : 'ignored';
  }

  async function handleEvent(event) {
    const name = event?.event;
    const p = event?.payload || {};
    if (typeof name !== 'string') return 'ignored';
    if (name.startsWith('subscription.')) return subscriptionEvent(name, p.subscription?.entity);
    if (name === 'payment_link.paid') return paymentLinkPaid(p);
    if (name === 'refund.processed') return refundProcessed(p);
    if (name === 'payment.dispute.created') return disputeCreated(p);
    return 'ignored';
  }

  return { handleEvent };
}

// ─── Mounting ──────────────────────────────────────────────────────────────

/** Mount POST /razorpay-webhook. Needs `req.rawBody` from express.json's verify hook. */
function mountRazorpayWebhook(app, { supabase, client, guard = (_req, _res, next) => next(), config = razorpayConfig() }) {
  if (!config) {
    console.log('[razorpay] billing disabled (need RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET)');
    return false;
  }
  const repo = supabaseRepo(supabase);
  const handlers = createRazorpayHandlers({ repo, notify: dmNotifier(client), config });

  app.post('/razorpay-webhook', guard, async (req, res) => {
    if (!verifySignature(req.rawBody, req.headers['x-razorpay-signature'], config.webhookSecret)) {
      console.warn('[razorpay] signature verification failed');
      return res.status(400).json({ error: 'invalid signature' });
    }
    const event = req.body || {};
    // Razorpay repeats the same event id on every retry; a hash of the body is
    // the stand-in if the header is ever absent.
    const eventId = req.headers['x-razorpay-event-id']
      || crypto.createHash('sha256').update(req.rawBody).digest('hex');
    const out = await applyOnce({
      repo, eventId: REF(eventId), type: `razorpay:${String(event.event || 'unknown').slice(0, 80)}`,
      handle: () => handlers.handleEvent(event),
    });
    return res.status(out.status).json(out.body);
  });

  console.log('[razorpay] billing enabled → POST /razorpay-webhook');
  return true;
}

module.exports = {
  razorpayConfig, verifySignature, createCheckout, createRazorpayHandlers, mountRazorpayWebhook,
};
