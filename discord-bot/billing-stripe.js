// ═══════════════════════════════════════════════════════════════════════════
//  BILLING — Stripe.
//  ───────────────────────────────────────────────────────────────────────
//  Linking: Stripe knows an email, Discord knows a snowflake. /premium builds
//  a per-user checkout URL carrying `client_reference_id`, so the two are
//  already joined when the webhook fires and the buyer never types an id.
//
//  What the reference is trusted for, and what it is not
//  ─────────────────────────────────────────────────────
//  A Payment Link's client_reference_id is a query parameter the buyer can
//  edit. It is trusted ONLY to say who to credit (and, for a server plan,
//  which server). The plan itself comes from what Stripe says was paid — see
//  plans.js — so a Pro link edited to look like a server purchase buys Pro.
//
//  Delivery guarantees
//  ───────────────────
//  - Signature-verified over the exact raw bytes.
//  - Each event id is claimed in discord_billing_events before it is applied,
//    so Stripe's retries and replays are applied once.
//  - The work runs BEFORE the 200: if Supabase is down the webhook answers
//    500 and Stripe retries for up to three days, instead of a paid grant
//    being acknowledged and lost. Every write is idempotent, so a retry after
//    a partial failure is safe.
//  - Error responses never echo internals.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { PLANS, planForCheckout } = require('./plans');
const { createBillingCore, applyOnce, dmNotifier, supabaseRepo, withGrace, RENEWAL_GRACE_MS } = require('./billing-core');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

let stripe = null;
if (STRIPE_SECRET_KEY) {
  try {
    stripe = require('stripe')(STRIPE_SECRET_KEY);
  } catch (e) {
    console.warn('[stripe] SDK not installed — run `npm install stripe`. Billing disabled.', e.message);
  }
}

const stripeConfigured = !!(stripe && STRIPE_WEBHOOK_SECRET);

// ─── Client reference encoding ─────────────────────────────────────────────
// Stripe restricts client_reference_id to alphanumerics, '-' and '_'.
//   u_<userId>              → buyer is <userId>
//   g_<guildId>_<userId>    → buyer is <userId>, for server <guildId>

const SNOWFLAKE = /^\d{17,20}$/;

function encodeClientRef({ userId, guildId = null }) {
  return guildId ? `g_${guildId}_${userId}` : `u_${userId}`;
}

function parseClientRef(ref) {
  if (typeof ref !== 'string' || ref.length > 64) return null;
  const parts = ref.split('_');
  if (parts.length === 2 && parts[0] === 'u' && SNOWFLAKE.test(parts[1])) {
    return { kind: 'user', userId: parts[1], guildId: null };
  }
  if (parts.length === 3 && parts[0] === 'g' && SNOWFLAKE.test(parts[1]) && SNOWFLAKE.test(parts[2])) {
    return { kind: 'guild', userId: parts[2], guildId: parts[1] };
  }
  return null;
}

/** Append the reference to a Stripe Payment Link, preserving any existing query. */
function buildCheckoutUrl(paymentLink, { userId, guildId = null }) {
  if (!paymentLink) return '';
  const ref = encodeClientRef({ userId, guildId });
  const sep = paymentLink.includes('?') ? '&' : '?';
  return `${paymentLink}${sep}client_reference_id=${encodeURIComponent(ref)}`;
}

// ─── Period end ────────────────────────────────────────────────────────────

const ISO = (unixSeconds) =>
  Number.isFinite(unixSeconds) ? new Date(unixSeconds * 1000).toISOString() : null;

/**
 * Read a subscription's current period end.
 *
 * `current_period_end` moved from Subscription onto SubscriptionItem (Stripe
 * API 2025-03-31.basil onward). Reading the old field yields null, and null
 * means "never expires" to gg_discord_quota_check — which once granted every
 * subscriber permanent Pro. With several items, the EARLIEST end is the first
 * moment the subscription is no longer fully paid for.
 */
function subscriptionPeriodEnd(sub) {
  const items = sub?.items?.data;
  if (Array.isArray(items) && items.length) {
    const ends = items.map(i => i?.current_period_end).filter(Number.isFinite);
    if (ends.length) return ISO(Math.min(...ends));
  }
  if (Number.isFinite(sub?.current_period_end)) return ISO(sub.current_period_end);
  return null;
}

const PAID_SUB_STATUSES = new Set(['active', 'trialing', 'past_due']);

// ─── Stripe's dialect → billing-core ───────────────────────────────────────

/**
 * Event handlers, with every side effect injected.
 *   repo   — supabaseRepo(...) or a fake
 *   api    — { retrieveSubscription(id), listLineItemPriceIds(sessionId) }
 *   notify — (userId, kind) => Promise, best effort
 */
function createBillingHandlers({ repo, api, notify = async () => {}, env = process.env, log = console }) {
  const core = createBillingCore({ repo, notify, log });

  async function checkoutCompleted(session) {
    // Card payments complete as 'paid'. Delayed methods (bank debits) arrive
    // 'unpaid' and are granted on checkout.session.async_payment_succeeded.
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      log.log(`[stripe] checkout ${session.id} not paid yet (${session.payment_status}) — waiting`);
      return 'pending';
    }
    const ref = parseClientRef(session.client_reference_id);
    if (!ref) {
      log.error(`[stripe] checkout ${session.id} paid with no usable client_reference_id — grant manually`);
      return 'unlinked';
    }

    let priceIds = [];
    try { priceIds = await api.listLineItemPriceIds(session.id); } catch (e) {
      log.warn(`[stripe] could not list line items for ${session.id}: ${e.message}`);
    }
    const plan = planForCheckout({ priceIds, amountTotal: session.amount_total, mode: session.mode }, env);
    if (!plan) {
      log.error(`[stripe] checkout ${session.id} (${session.mode}, ${session.amount_total}) matches no plan — nothing granted`);
      return 'unknown-plan';
    }

    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    let periodEnd = null;
    if (plan !== 'lifetime') {
      if (!subscriptionId) {
        log.error(`[stripe] ${plan} checkout ${session.id} has no subscription — nothing granted`);
        return 'unknown-plan';
      }
      try {
        periodEnd = withGrace(subscriptionPeriodEnd(await api.retrieveSubscription(subscriptionId)));
      } catch (e) {
        log.warn(`[stripe] could not read subscription ${subscriptionId} (${e.message}) — provisional grant`);
      }
    }

    // The reference says WHO and which server; the price said WHAT was bought.
    const providerRef = plan === 'lifetime'
      ? (typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id) || session.id
      : subscriptionId;
    const granted = await core.grant({
      source: 'stripe', plan, userId: ref.userId, guildId: ref.guildId, providerRef, periodEnd,
    });
    return granted === 'invalid' ? 'unlinked' : granted;
  }

  async function subscriptionChanged(sub, { deleted = false } = {}) {
    const periodEnd = withGrace(subscriptionPeriodEnd(sub));
    const state = deleted || !PAID_SUB_STATUSES.has(sub.status) ? 'ended'
      : sub.status === 'past_due' ? 'past_due' : 'active';
    // Stripe ends access at once when a subscription ends.
    return core.setPeriod({ providerRef: sub.id, state, until: state === 'ended' ? null : periodEnd });
  }

  async function chargeReversed(charge, why) {
    const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!pi) return 'unknown';
    if (why === 'refund' && !charge.refunded) return 'partial-refund';   // partial refunds keep access
    return core.revokeLifetime(pi, why);
  }

  async function invoicePaymentFailed(invoice) {
    const subId = typeof invoice.subscription === 'string' ? invoice.subscription
      : invoice.parent?.subscription_details?.subscription || null;
    if (!subId) return 'unknown';
    // Keep Pro while Stripe retries the card: dunning runs for days, and
    // cutting access on the first failed charge turns a card blip into churn.
    return core.setPeriod({ providerRef: subId, state: 'past_due', until: null });
  }

  async function handleEvent(event) {
    const o = event.data?.object || {};
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        return checkoutCompleted(o);
      case 'customer.subscription.updated':
        return subscriptionChanged(o);
      case 'customer.subscription.deleted':
        return subscriptionChanged(o, { deleted: true });
      case 'invoice.payment_failed':
        return invoicePaymentFailed(o);
      case 'charge.refunded':
        return chargeReversed(o, 'refund');
      case 'charge.dispute.created':
        return chargeReversed(o, 'dispute');
      default:
        return 'ignored';
    }
  }

  return { handleEvent, checkoutCompleted, subscriptionChanged, chargeReversed, invoicePaymentFailed };
}

/**
 * Mount POST /stripe-webhook. Requires `req.rawBody` (captured by the `verify`
 * hook on express.json() in index.js): Stripe signs the exact bytes it sent.
 */
function mountStripeWebhook(app, { supabase, client, guard = (_req, _res, next) => next(), stripeApi = null }) {
  if (!stripeConfigured) {
    console.log('[stripe] billing disabled (need STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET)');
    return false;
  }

  const repo = supabaseRepo(supabase);
  // `stripeApi` lets a test stand in for the two Stripe calls the handlers
  // make, so the real route, signature check and handlers run without a network.
  const api = stripeApi || {
    retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
    async listLineItemPriceIds(sessionId) {
      const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 10 });
      return (items?.data || []).map(i => i?.price?.id).filter(Boolean);
    },
  };
  const handlers = createBillingHandlers({ repo, api, notify: dmNotifier(client) });

  app.post('/stripe-webhook', guard, async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      console.warn('[stripe] signature verification failed:', e.message);
      return res.status(400).json({ error: 'invalid signature' });
    }
    const out = await applyOnce({ repo, eventId: event.id, type: event.type, handle: () => handlers.handleEvent(event) });
    return res.status(out.status).json(out.body);
  });

  console.log('[stripe] billing enabled → POST /stripe-webhook');
  return true;
}

module.exports = {
  mountStripeWebhook,
  buildCheckoutUrl,
  encodeClientRef,
  parseClientRef,
  stripeConfigured,
  PLANS,
  // exported for tests
  subscriptionPeriodEnd,
  createBillingHandlers,
  supabaseRepo,
  RENEWAL_GRACE_MS,
};
