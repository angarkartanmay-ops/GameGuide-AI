// ═══════════════════════════════════════════════════════════════════════════
//  BILLING — Stripe.
//  ───────────────────────────────────────────────────────────────────────
//  Before this file existed, /premium rendered a link button and nothing else.
//  There was no webhook, no checkout handling and no subscription sync, so
//  every person who actually paid received exactly nothing. This closes that.
//
//  The linking problem, and how it is solved
//  ─────────────────────────────────────────
//  Stripe knows an email; Discord knows a snowflake. Most bots bridge the two
//  by asking the buyer to paste their Discord ID into a form after paying,
//  which is where a large share of conversions quietly die. Instead the bot
//  builds a per-user checkout URL carrying `client_reference_id`, so the two
//  identities are already joined by the time the webhook fires and the buyer
//  never has to know their own snowflake.
//
//  Entitlements are written through entitlements.js, so when Discord's own App
//  Subscriptions are enabled later they land in the same table and nothing
//  downstream changes.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { upsertEntitlement, cancelEntitlement, findByProviderRef } = require('./entitlements');

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
// Stripe restricts client_reference_id to alphanumerics, '-' and '_', so the
// separator is an underscore rather than the more obvious colon.
//   u_<userId>              → individual Pro
//   g_<guildId>_<userId>    → whole-server upgrade, bought by <userId>

function encodeClientRef({ userId, guildId = null }) {
  return guildId ? `g_${guildId}_${userId}` : `u_${userId}`;
}

function parseClientRef(ref) {
  if (typeof ref !== 'string') return null;
  const parts = ref.split('_');
  if (parts[0] === 'u' && /^\d{17,20}$/.test(parts[1] || '')) {
    return { kind: 'user', userId: parts[1], guildId: null };
  }
  if (parts[0] === 'g' && /^\d{17,20}$/.test(parts[1] || '') && /^\d{17,20}$/.test(parts[2] || '')) {
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

// ─── Webhook ───────────────────────────────────────────────────────────────

const ISO = (unixSeconds) =>
  Number.isFinite(unixSeconds) ? new Date(unixSeconds * 1000).toISOString() : null;

async function handleCheckoutCompleted(supabase, session, notify) {
  const ref = parseClientRef(session.client_reference_id);
  if (!ref) {
    // Nothing to attach the payment to. Loud, because it means money came in
    // and somebody is about to be very reasonably annoyed.
    console.error('[stripe] checkout completed with no usable client_reference_id:', session.id, session.client_reference_id);
    return;
  }

  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  let periodEnd = null;

  if (subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      periodEnd = ISO(sub.current_period_end);
    } catch (e) {
      // A missing period end is survivable — the subscription.updated event
      // that follows will fill it in. Refusing the grant would not be.
      console.warn('[stripe] could not retrieve subscription for period end:', e.message);
    }
  }

  if (ref.kind === 'guild') {
    const { error } = await supabase.from('discord_premium_servers').upsert({
      guild_id: ref.guildId,
      granted_by: ref.userId,
      expires_at: periodEnd,
    }, { onConflict: 'guild_id' });
    if (error) throw new Error(`guild grant failed: ${error.message}`);
    console.log(`[stripe] server plan active → guild=${ref.guildId} by user=${ref.userId}`);
    await notify(ref.userId, 'server');
    return;
  }

  await upsertEntitlement(supabase, {
    userId: ref.userId,
    tier: 'pro',
    source: 'stripe',
    providerRef: subscriptionId || session.id,
    status: 'active',
    currentPeriodEnd: periodEnd,
  });
  console.log(`[stripe] Pro active → user=${ref.userId} sub=${subscriptionId || session.id}`);
  await notify(ref.userId, 'pro');
}

async function handleSubscriptionUpdated(supabase, sub) {
  const row = await findByProviderRef(supabase, sub.id);
  if (!row) return; // guild plans and unknown subs are tracked elsewhere

  // Stripe keeps a canceled-at-period-end subscription 'active' until it
  // actually lapses, so honour current_period_end rather than the flag.
  const active = ['active', 'trialing', 'past_due'].includes(sub.status);
  await upsertEntitlement(supabase, {
    userId: row.user_id,
    tier: active ? 'pro' : 'free',
    source: 'stripe',
    providerRef: sub.id,
    status: sub.status === 'past_due' ? 'past_due' : (active ? 'active' : 'canceled'),
    currentPeriodEnd: ISO(sub.current_period_end),
  });
  console.log(`[stripe] subscription ${sub.id} → ${sub.status} (user=${row.user_id})`);
}

async function handleSubscriptionDeleted(supabase, sub) {
  const row = await findByProviderRef(supabase, sub.id);
  if (!row) return;
  await cancelEntitlement(supabase, { providerRef: sub.id, status: 'canceled' });
  console.log(`[stripe] subscription ${sub.id} canceled (user=${row.user_id})`);
}

/**
 * Mount POST /stripe-webhook.
 *
 * Requires `req.rawBody` — index.js captures it via the `verify` hook on
 * express.json(). Signature verification is done over the exact bytes Stripe
 * signed, so a re-serialised JSON object will never validate.
 */
function mountStripeWebhook(app, { supabase, client }) {
  if (!stripeConfigured) {
    console.log('[stripe] billing disabled (need STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET)');
    return false;
  }

  const notify = async (userId, kind) => {
    try {
      const user = await client.users.fetch(String(userId));
      const body = kind === 'server'
        ? '🌟 **Server plan is live.** Every member of your server now gets 60 messages/day, 10 screenshots and priority routing. Thank you — this is what keeps the bot running.'
        : '⭐ **You\'re on Pro.** 200 messages/day, 40 screenshots, 20/min and priority routing, effective immediately. Check anytime with `/quota`. Thank you for supporting a solo dev.';
      await user.send(body);
    } catch {
      // DMs closed. The entitlement is what matters; the thank-you is a bonus.
    }
  };

  app.post('/stripe-webhook', async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers['stripe-signature'],
        STRIPE_WEBHOOK_SECRET,
      );
    } catch (e) {
      console.warn('[stripe] signature verification failed:', e.message);
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    // Acknowledge before doing the work. Stripe retries on a slow response,
    // and a duplicate grant is harmless (every write here is an upsert) but a
    // retry storm during a Supabase hiccup is not.
    res.json({ received: true });

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(supabase, event.data.object, notify);
          break;
        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(supabase, event.data.object);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(supabase, event.data.object);
          break;
        case 'invoice.payment_failed': {
          const subId = event.data.object.subscription;
          if (subId) {
            const row = await findByProviderRef(supabase, subId);
            // Keep them on Pro while Stripe retries the card — dunning runs for
            // days, and yanking access on the first failed charge is how you
            // turn a expired-card blip into a cancellation.
            if (row) {
              await supabase.from('discord_entitlements')
                .update({ status: 'past_due', updated_at: new Date().toISOString() })
                .eq('provider_ref', subId);
              console.log(`[stripe] payment failed → user=${row.user_id} marked past_due`);
            }
          }
          break;
        }
        default:
          break;
      }
    } catch (e) {
      console.error(`[stripe] handling ${event.type} failed:`, e.message);
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
};
