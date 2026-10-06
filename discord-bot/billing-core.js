// ═══════════════════════════════════════════════════════════════════════════
//  BILLING CORE — what a payment MEANS, whichever company took it.
//  ───────────────────────────────────────────────────────────────────────
//  Stripe, Razorpay and Lemon Squeezy each speak their own webhook dialect.
//  Each adapter (billing-stripe / -razorpay / -lemon) verifies its own
//  signatures and works out WHO paid for WHICH plan; everything after that
//  is one set of rules, here, so the three can never disagree:
//
//    • Pro and Lifetime are personal; a server plan attaches to one server.
//    • A subscription always has an end date — null would mean "never
//      expires" to gg_discord_quota_check, so a missing date becomes a short
//      provisional window, never eternity.
//    • Lifetime is never downgraded by a later subscription, and only a full
//      refund or a dispute takes it back.
//    • Cancelling keeps access until the period already paid for runs out.
//    • An active plan is never replaced by a DIFFERENT subscription's grant.
//      Hosted-link checkouts carry the buyer's Discord id in a URL anyone can
//      edit, so without this a stranger could buy a cheap plan "for" someone
//      else's id (or server) and displace what that account already pays for.
//      The stranger's payment is logged and the buyer told; nothing changes.
//    • Every provider event is applied once (claimEvent), and a failure
//      answers 5xx and un-claims the event so the provider's retry lands. A
//      claim that never completed (the process died mid-handler) goes stale
//      after STALE_CLAIM_MS and is taken over by the provider's next retry.
//
//  Provider references are prefixed (`rzp:`, `ls:`) so ids that look alike
//  across providers (`sub_…` exists at both Stripe and Razorpay) can never
//  collide in discord_entitlements.provider_ref.
//
//  Free of discord.js, Express and any provider SDK: testable with a bare import.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const SNOWFLAKE = /^\d{17,20}$/;
const isSnowflake = (v) => typeof v === 'string' && SNOWFLAKE.test(v);

// Slack after a period ends, covering a renewal webhook that arrives late.
const RENEWAL_GRACE_MS = 2 * 864e5;
// When a subscription's period cannot be read, grant for this long and let the
// next event write the real date. Never null (= forever).
const PROVISIONAL_MS = 3 * 864e5;
// A claimed event that never reported completion is retried after this long.
const STALE_CLAIM_MS = 5 * 60_000;

const withGrace = (iso) => (iso ? new Date(Date.parse(iso) + RENEWAL_GRACE_MS).toISOString() : null);
const provisionalEnd = (now = Date.now()) => new Date(now + PROVISIONAL_MS).toISOString();
const isFuture = (iso, now = Date.now()) => !!iso && Date.parse(iso) > now;

// ─── Supabase repository ───────────────────────────────────────────────────
// Every write the webhooks make, behind plain async methods, so the rules
// below are testable against an in-memory fake.

function supabaseRepo(supabase) {
  const now = () => new Date().toISOString();
  const must = (error, what) => { if (error) throw new Error(`${what}: ${error.message}`); };
  return {
    /**
     * True the first time an event id is seen, or when an earlier claim never
     * completed and has gone stale; false for a retry or replay of one that did.
     */
    async claimEvent(id, type) {
      const eventId = String(id).slice(0, 255);
      const { error } = await supabase.from('discord_billing_events').insert({ event_id: eventId, type: String(type).slice(0, 100) });
      if (!error) return true;
      if (error.code !== '23505') throw new Error(`claim event: ${error.message}`);   // not "already exists"
      const { data, error: readErr } = await supabase.from('discord_billing_events')
        .select('received_at, completed_at').eq('event_id', eventId).maybeSingle();
      must(readErr, 'read event claim');
      if (data && !data.completed_at && Date.now() - Date.parse(data.received_at) > STALE_CLAIM_MS) {
        await supabase.from('discord_billing_events').update({ received_at: now() }).eq('event_id', eventId);
        return true;
      }
      return false;
    },
    async completeEvent(id) {
      await supabase.from('discord_billing_events').update({ completed_at: now() }).eq('event_id', String(id).slice(0, 255));
    },
    async releaseEvent(id) {
      await supabase.from('discord_billing_events').delete().eq('event_id', String(id).slice(0, 255));
    },
    async getUser(userId) {
      const { data, error } = await supabase.from('discord_entitlements')
        .select('user_id, tier, status, source, provider_ref, current_period_end')
        .eq('user_id', String(userId)).maybeSingle();
      must(error, 'read entitlement');
      return data || null;
    },
    async getUserByRef(ref) {
      const { data, error } = await supabase.from('discord_entitlements')
        .select('user_id, tier, status, source, provider_ref, current_period_end').eq('provider_ref', ref).maybeSingle();
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
    async getGuild(guildId) {
      const { data, error } = await supabase.from('discord_premium_servers')
        .select('guild_id, granted_by, provider_ref, expires_at').eq('guild_id', String(guildId)).maybeSingle();
      must(error, 'read server plan');
      return data || null;
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

// ─── The rules ─────────────────────────────────────────────────────────────

/**
 * @param repo    supabaseRepo(...) or a fake
 * @param notify  (userId, 'pro' | 'server' | 'lifetime') => Promise, best effort
 */
function createBillingCore({ repo, notify = async () => {}, log = console }) {

  /**
   * A confirmed purchase (or renewal — it is idempotent).
   * @param plan       'pro' | 'server' | 'lifetime'
   * @param periodEnd  ISO end of the paid period (already including any grace);
   *                   required for pro/server, ignored for lifetime
   * @returns the plan actually granted, or 'invalid'
   */
  async function grant({ source, plan, userId, guildId = null, providerRef, periodEnd = null }) {
    if (!isSnowflake(String(userId))) {
      log.error(`[billing] ${source} ${plan} purchase ${providerRef} has no usable Discord user id (${String(userId).slice(0, 30)}) — grant manually`);
      return 'invalid';
    }
    userId = String(userId);
    const end = plan === 'lifetime' ? null : (periodEnd || provisionalEnd());

    if (plan === 'server') {
      if (isSnowflake(String(guildId))) {
        const held = await repo.getGuild(String(guildId));
        const covered = held && held.provider_ref !== providerRef && (!held.expires_at || isFuture(held.expires_at));
        if (covered) {
          log.error(`[billing] server ${guildId} already has an active plan (${held.provider_ref || 'manual'}); ${source} purchase ${providerRef} by user=${userId} changed nothing — refund or re-assign it`);
          await notify(userId, 'covered-server');
          return 'already-covered';
        }
        const known = held && held.provider_ref === providerRef;
        await repo.putGuild({ guildId: String(guildId), grantedBy: userId, providerRef, expiresAt: end });
        log.log(`[billing] server plan active → guild=${guildId} by user=${userId} (${source})`);
        // Renewals arrive as the same grant; only a new plan earns a thank-you.
        if (!known) await notify(userId, 'server');
        return 'server';
      }
      // A server price with no server to attach it to. Do not leave the buyer
      // with nothing: credit Pro, and say loudly that the server is missing.
      log.error(`[billing] server plan ${providerRef} bought without a server — granted Pro to user=${userId}; attach the server manually`);
      plan = 'pro';
    }

    const existing = await repo.getUser(userId);
    // A different, still-valid plan on this account stays put — see the header.
    // (Lifetime may replace a subscription: it is strictly more, and the
    // subscription is simply left to lapse.)
    // (A past_due plan is failing to renew; a fresh purchase is meant to replace it.)
    const holds = existing && existing.status === 'active'
      && (!existing.current_period_end || isFuture(existing.current_period_end));
    if (holds && existing.provider_ref !== providerRef && !(plan === 'lifetime' && existing.tier !== 'lifetime')) {
      log.error(`[billing] user=${userId} already has an active ${existing.tier} (${existing.provider_ref || 'manual'}); ${source} ${plan} ${providerRef} changed nothing — refund or re-assign it`);
      await notify(userId, 'covered');
      return 'already-covered';
    }
    const known = existing && existing.provider_ref === providerRef ? existing : null;
    await repo.putUser({ userId, tier: plan, source, providerRef, status: 'active', periodEnd: end });
    log.log(`[billing] ${plan} active → user=${userId} ref=${providerRef} (${source})`);
    // Renewals arrive as the same grant; only a new (or resumed) plan earns a thank-you.
    if (!known || known.status !== 'active' || known.tier !== plan) await notify(userId, plan);
    return plan;
  }

  /**
   * A subscription changed state.
   * @param state  'active'   paid up to `until`
   *               'past_due' a charge failed; keep access while the provider retries
   *               'ended'    cancelled or lapsed; access runs to `until` if that is
   *                          still ahead (already paid for), otherwise stops now
   * @param until  ISO end of the paid period (with grace for active/past_due)
   */
  async function setPeriod({ providerRef, state, until = null }) {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const guild = await repo.getGuildByRef(providerRef);
    if (guild) {
      const expires = state === 'ended'
        ? (isFuture(until, now) ? until : nowIso)
        : (until || provisionalEnd(now));
      await repo.setGuildExpiry(providerRef, expires);
      log.log(`[billing] server plan ${providerRef} → ${state} (guild=${guild.guild_id})`);
      return state === 'ended' && !isFuture(until, now) ? 'server-ended' : 'server-renewed';
    }

    const row = await repo.getUserByRef(providerRef);
    if (!row) return 'unknown';
    if (row.tier === 'lifetime') return 'lifetime-kept';

    if (state === 'ended' && !isFuture(until, now)) {
      await repo.putUser({ userId: row.user_id, tier: 'free', source: row.source || 'stripe', providerRef, status: 'canceled', periodEnd: nowIso });
      log.log(`[billing] ${providerRef} ended (user=${row.user_id})`);
      return 'pro-ended';
    }
    const end = until || row.current_period_end || provisionalEnd(now);
    await repo.putUser({
      userId: row.user_id, tier: 'pro', source: row.source || 'stripe', providerRef,
      status: state === 'past_due' ? 'past_due' : 'active', periodEnd: end,
    });
    log.log(`[billing] ${providerRef} → ${state} until ${end} (user=${row.user_id})`);
    return state === 'ended' ? 'pro-ending' : state === 'past_due' ? 'past-due' : 'pro-renewed';
  }

  /** A full refund or a dispute on a one-off purchase takes Lifetime back. */
  async function revokeLifetime(providerRef, why) {
    const row = await repo.getUserByRef(providerRef);
    if (!row || row.tier !== 'lifetime') return 'unknown';
    await repo.putUser({ userId: row.user_id, tier: 'free', source: row.source || 'stripe', providerRef, status: 'canceled', periodEnd: new Date().toISOString() });
    log.log(`[billing] lifetime revoked after ${why} (user=${row.user_id})`);
    return 'lifetime-revoked';
  }

  return { grant, setPeriod, revokeLifetime };
}

// ─── Webhook plumbing shared by every provider ─────────────────────────────

/**
 * Apply one verified provider event exactly once.
 *   200 {received}               applied (or ignored)
 *   200 {received, duplicate}    a retry or replay of something already applied
 *   500 {error}                  something failed BEFORE it was applied; the
 *                                event is un-claimed so the provider's retry lands
 */
async function applyOnce({ repo, eventId, type, handle, log = console }) {
  let claimed = false;
  try {
    claimed = await repo.claimEvent(eventId, type);
    if (!claimed) return { status: 200, body: { received: true, duplicate: true } };
    const outcome = await handle();
    await repo.completeEvent(eventId);
    if (outcome && outcome !== 'ignored') log.log(`[billing] ${type} ${eventId} → ${outcome}`);
    return { status: 200, body: { received: true } };
  } catch (e) {
    log.error(`[billing] handling ${type} ${eventId} failed: ${e.message}`);
    if (claimed) await repo.releaseEvent(eventId).catch(() => {});
    return { status: 500, body: { error: 'temporary failure' } };
  }
}

/** Thank-you DM, best effort. */
const NOTICE = {
  server: '🌟 **Server plan is live.** Every member of your server now gets 60 messages/day, 10 screenshots and priority routing. Thank you — this is what keeps the bot running.',
  pro: '⭐ **You\'re on Pro.** 200 messages/day, 40 screenshots, 20/min and priority routing, effective immediately. Check anytime with `/quota`. Thank you for supporting a solo dev.',
  covered: `💳 **Payment received — but you already have an active plan,** so nothing changed. If this was a mistake, email ${process.env.SUPPORT_EMAIL || 'gameguideai.support@gmail.com'} and it will be refunded.`,
  'covered-server': `💳 **Payment received — but that server already has an active plan,** so nothing changed. If this was a mistake, email ${process.env.SUPPORT_EMAIL || 'gameguideai.support@gmail.com'} and it will be refunded.`,
  lifetime: '💎 **Pro Lifetime is yours.** Everything in Pro, for good — no renewals. Check anytime with `/quota`. Thank you!',
};

function dmNotifier(client) {
  return async (userId, kind) => {
    try {
      const user = await client.users.fetch(String(userId));
      await user.send(NOTICE[kind] || NOTICE.pro);
    } catch {
      // DMs closed. The entitlement is what matters; the thank-you is a bonus.
    }
  };
}

module.exports = {
  isSnowflake, withGrace, provisionalEnd, RENEWAL_GRACE_MS, PROVISIONAL_MS, STALE_CLAIM_MS,
  supabaseRepo, createBillingCore, applyOnce, dmNotifier, NOTICE,
};
