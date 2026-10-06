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

// Grace after a period ends, covering webhook delivery lag on renewal. Without
// it a subscriber whose renewal webhook is a few minutes late loses Pro.
const RENEWAL_GRACE_MS = 2 * 864e5;
const withGrace = (iso) => (iso ? new Date(Date.parse(iso) + RENEWAL_GRACE_MS).toISOString() : null);

// When the subscription cannot be fetched at checkout, grant provisionally and
// let customer.subscription.updated write the real date. Never null (eternity).
const PROVISIONAL_MS = 3 * 864e5;

const PAID_SUB_STATUSES = new Set(['active', 'trialing', 'past_due']);

// ─── Supabase repository ───────────────────────────────────────────────────
// Every write the webhook makes, in one place, behind plain async methods —
// so the decision logic below is testable with an in-memory fake.

function supabaseRepo(supabase) {
  const now = () => new Date().toISOString();
  const must = (error, what) => { if (error) throw new Error(`${what}: ${error.message}`); };
  return {
    /** True the first time an event id is seen; false for a retry/replay. */
    async claimEvent(id, type) {
      const { error } = await supabase.from('discord_billing_events').insert({ event_id: id, type });
      if (!error) return true;
      if (error.code === '23505') return false;   // unique_violation: already applied
      throw new Error(`claim event: ${error.message}`);
    },
    async releaseEvent(id) {
      await supabase.from('discord_billing_events').delete().eq('event_id', id);
    },
    async getUser(userId) {
      const { data, error } = await supabase.from('discord_entitlements')
        .select('user_id, tier, status, provider_ref, current_period_end')
        .eq('user_id', String(userId)).maybeSingle();
      must(error, 'read entitlement');
      return data || null;
    },
    async getUserByRef(ref) {
      const { data, error } = await supabase.from('discord_entitlements')
        .select('user_id, tier, status, provider_ref, current_period_end').eq('provider_ref', ref).maybeSingle();
      must(error, 'read entitlement by ref');
      return data || null;
    },
    async putUser({ userId, tier, source = 'stripe', providerRef, status, periodEnd }) {
      const { error } = await supabase.from('discord_entitlements').upsert({
        user_id: String(userId), tier, source, provider_ref: providerRef, status,
        current_period_end: periodEnd, updated_at: now(),
      }, { onConflict: 'user_id' });
      must(error, 'write entitlement');
    },
    async getGuildByRef(ref) {
      const { data, error } = await supabase.from('discord_premium_servers')
        .select('guild_id, granted_by, provider_ref, expires_at').eq('provider_ref', ref).maybeSingle();
      must(error, 'read server plan by ref');
      return data || null;
    },
    async putGuild({ guildId, grantedBy, providerRef, expiresAt }) {
      const { error } = await supabase.from('discord_premium_servers').upsert({
        guild_id: String(guildId), granted_by: grantedBy ? String(grantedBy) : null,
        provider_ref: providerRef, expires_at: expiresAt,
      }, { onConflict: 'guild_id' });
      must(error, 'write server plan');
    },
    async setGuildExpiry(ref, expiresAt) {
      const { error } = await supabase.from('discord_premium_servers')
        .update({ expires_at: expiresAt }).eq('provider_ref', ref);
      must(error, 'update server plan');
    },
  };
}

// ─── Decision logic ────────────────────────────────────────────────────────

/**
 * Event handlers, with every side effect injected.
 *   repo   — supabaseRepo(...) or a fake
 *   api    — { retrieveSubscription(id), listLineItemPriceIds(sessionId) }
 *   notify — (userId, kind) => Promise, best effort
 */
function createBillingHandlers({ repo, api, notify = async () => {}, env = process.env, log = console }) {

  /** Grant to a user without ever downgrading a lifetime purchase. */
  async function grantUser({ userId, tier, providerRef, periodEnd }) {
    const existing = await repo.getUser(userId);
    if (existing?.tier === 'lifetime' && existing.status === 'active' && tier !== 'lifetime') {
      log.log(`[stripe] user=${userId} already has Lifetime — subscription ${providerRef} not applied over it`);
      return false;
    }
    await repo.putUser({ userId, tier, providerRef, status: 'active', periodEnd });
    return true;
  }

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
        log.warn(`[stripe] could not read subscription ${subscriptionId} (${e.message}) — provisional ${PROVISIONAL_MS / 864e5}-day grant`);
      }
      if (!periodEnd) periodEnd = new Date(Date.now() + PROVISIONAL_MS).toISOString();
    }

    if (plan === 'server') {
      if (ref.kind !== 'guild') {
        // Server price paid from a personal link: there is no server to attach
        // it to. Credit the buyer with Pro so they are not left with nothing.
        log.error(`[stripe] server plan ${session.id} bought without a server — granted Pro to user=${ref.userId}; attach the server manually`);
        await grantUser({ userId: ref.userId, tier: 'pro', providerRef: subscriptionId, periodEnd });
        await notify(ref.userId, 'pro');
        return 'pro';
      }
      await repo.putGuild({ guildId: ref.guildId, grantedBy: ref.userId, providerRef: subscriptionId, expiresAt: periodEnd });
      log.log(`[stripe] server plan active → guild=${ref.guildId} by user=${ref.userId}`);
      await notify(ref.userId, 'server');
      return 'server';
    }

    // Pro and Lifetime are personal, whatever the reference says about a server.
    const providerRef = plan === 'lifetime'
      ? (typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id) || session.id
      : subscriptionId;
    const applied = await grantUser({ userId: ref.userId, tier: plan, providerRef, periodEnd });
    if (applied) {
      log.log(`[stripe] ${plan} active → user=${ref.userId} ref=${providerRef}`);
      await notify(ref.userId, plan);
    }
    return plan;
  }

  async function subscriptionChanged(sub, { deleted = false } = {}) {
    const paid = !deleted && PAID_SUB_STATUSES.has(sub.status);
    const periodEnd = withGrace(subscriptionPeriodEnd(sub));

    const guild = await repo.getGuildByRef(sub.id);
    if (guild) {
      // Ended: expire now. Renewed: move the expiry to the new period end.
      await repo.setGuildExpiry(sub.id, paid ? periodEnd : new Date().toISOString());
      log.log(`[stripe] server plan ${sub.id} → ${deleted ? 'deleted' : sub.status} (guild=${guild.guild_id})`);
      return paid ? 'server-renewed' : 'server-ended';
    }

    const row = await repo.getUserByRef(sub.id);
    if (!row) return 'unknown';
    if (row.tier === 'lifetime') return 'lifetime-kept';

    const tier = paid ? 'pro' : 'free';
    await repo.putUser({
      userId: row.user_id, tier, providerRef: sub.id,
      status: deleted ? 'canceled' : sub.status === 'past_due' ? 'past_due' : paid ? 'active' : 'canceled',
      periodEnd: paid ? periodEnd : new Date().toISOString(),
    });
    log.log(`[stripe] subscription ${sub.id} → ${deleted ? 'deleted' : sub.status} (user=${row.user_id})`);
    return paid ? 'pro-renewed' : 'pro-ended';
  }

  /** Full refund or a dispute on a one-off purchase takes Lifetime back. */
  async function chargeReversed(charge, why) {
    const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!pi) return 'unknown';
    if (why === 'refund' && !charge.refunded) return 'partial-refund';   // partial refunds keep access
    const row = await repo.getUserByRef(pi);
    if (!row || row.tier !== 'lifetime') return 'unknown';
    await repo.putUser({ userId: row.user_id, tier: 'free', providerRef: pi, status: 'canceled', periodEnd: new Date().toISOString() });
    log.log(`[stripe] lifetime revoked after ${why} (user=${row.user_id})`);
    return 'lifetime-revoked';
  }

  async function invoicePaymentFailed(invoice) {
    const subId = typeof invoice.subscription === 'string' ? invoice.subscription
      : invoice.parent?.subscription_details?.subscription || null;
    if (!subId) return 'unknown';
    const row = await repo.getUserByRef(subId);
    if (!row || row.tier === 'lifetime') return 'unknown';
    // Keep Pro while Stripe retries the card: dunning runs for days, and
    // cutting access on the first failed charge turns a card blip into churn.
    // The quota function treats past_due as paid until the period end.
    await repo.putUser({ userId: row.user_id, tier: row.tier, providerRef: subId, status: 'past_due', periodEnd: row.current_period_end ?? null });
    return 'past-due';
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

const NOTICE = {
  server: '🌟 **Server plan is live.** Every member of your server now gets 60 messages/day, 10 screenshots and priority routing. Thank you — this is what keeps the bot running.',
  pro: '⭐ **You\'re on Pro.** 200 messages/day, 40 screenshots, 20/min and priority routing, effective immediately. Check anytime with `/quota`. Thank you for supporting a solo dev.',
  lifetime: '💎 **Pro Lifetime is yours.** Everything in Pro, for good — no renewals. Check anytime with `/quota`. Thank you!',
};

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
  const notify = async (userId, kind) => {
    try {
      const user = await client.users.fetch(String(userId));
      await user.send(NOTICE[kind] || NOTICE.pro);
    } catch {
      // DMs closed. The entitlement is what matters; the thank-you is a bonus.
    }
  };
  const handlers = createBillingHandlers({ repo, api, notify });

  app.post('/stripe-webhook', guard, async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      console.warn('[stripe] signature verification failed:', e.message);
      return res.status(400).json({ error: 'invalid signature' });
    }

    let claimed = false;
    try {
      claimed = await repo.claimEvent(event.id, event.type);
      if (!claimed) return res.json({ received: true, duplicate: true });
      const outcome = await handlers.handleEvent(event);
      if (outcome !== 'ignored') console.log(`[stripe] ${event.type} ${event.id} → ${outcome}`);
      return res.json({ received: true });
    } catch (e) {
      console.error(`[stripe] handling ${event.type} ${event.id} failed:`, e.message);
      // Un-claim so Stripe's retry is applied rather than skipped as a duplicate.
      if (claimed) await repo.releaseEvent(event.id).catch(() => {});
      return res.status(500).json({ error: 'temporary failure' });
    }
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
