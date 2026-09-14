// ═══════════════════════════════════════════════════════════════════════════
//  ENTITLEMENTS — who has paid, and for what.
//  ───────────────────────────────────────────────────────────────────────
//  Provider-agnostic on purpose. Stripe writes `discord_entitlements` today;
//  Discord's own App Subscriptions will write the same table later, as would
//  Patreon or Ko-fi. Nothing downstream of this file knows which rail was used.
//
//  NOTE — there is no tier cache here, and that is deliberate.
//  gg_discord_quota_check() already resolves the caller's tier as part of the
//  admission check it has to make anyway, so the hot path gets tier + limits
//  for free in a round trip it was already paying for. The old 5-minute
//  premiumCache meant someone could pay and still be throttled for another
//  five minutes; now an upgrade lands on their very next message.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

/**
 * Mirror PREMIUM_USER_IDS / PREMIUM_GUILD_IDS into the database at boot.
 *
 * The operator keeps their zero-DB hot config, but the DATABASE stays the one
 * place tier is resolved — otherwise the bot would show "Pro" for an env-listed
 * user while the quota function, which cannot see env, enforced free.
 *
 * Additive only: an existing row always wins, so this can never clobber a
 * Stripe subscription with a weaker manual grant. To revoke, delete the row.
 */
async function syncEnvOverrides(supabase, { userIds = [], guildIds = [] } = {}) {
  const result = { users: 0, guilds: 0 };

  if (userIds.length) {
    try {
      const { error } = await supabase
        .from('discord_entitlements')
        .upsert(
          userIds.map(id => ({ user_id: id, tier: 'pro', source: 'manual', status: 'active' })),
          { onConflict: 'user_id', ignoreDuplicates: true },
        );
      if (error) throw error;
      result.users = userIds.length;
    } catch (e) {
      console.warn('[entitlements] env user sync failed:', e.message);
    }
  }

  if (guildIds.length) {
    try {
      const { error } = await supabase
        .from('discord_premium_servers')
        .upsert(
          guildIds.map(id => ({ guild_id: id })),
          { onConflict: 'guild_id', ignoreDuplicates: true },
        );
      if (error) throw error;
      result.guilds = guildIds.length;
    } catch (e) {
      console.warn('[entitlements] env guild sync failed:', e.message);
    }
  }

  return result;
}

/**
 * Grant or refresh a paid entitlement. Called by the Stripe webhook.
 * `currentPeriodEnd` null means it never lapses (lifetime / manual).
 */
async function upsertEntitlement(supabase, {
  userId,
  tier = 'pro',
  source = 'stripe',
  providerRef = null,
  status = 'active',
  currentPeriodEnd = null,
}) {
  const { error } = await supabase.from('discord_entitlements').upsert({
    user_id: String(userId),
    tier,
    source,
    provider_ref: providerRef,
    status,
    current_period_end: currentPeriodEnd,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (error) throw new Error(`entitlement upsert failed: ${error.message}`);
  return true;
}

/**
 * Downgrade. We flip `status` rather than deleting so the row keeps its
 * provider_ref — a resubscribe then reuses the same record, and support
 * questions ("I definitely paid in March") stay answerable.
 */
async function cancelEntitlement(supabase, { userId = null, providerRef = null, status = 'canceled' }) {
  if (!userId && !providerRef) throw new Error('cancelEntitlement needs userId or providerRef');

  let q = supabase
    .from('discord_entitlements')
    .update({ tier: 'free', status, updated_at: new Date().toISOString() });

  q = userId ? q.eq('user_id', String(userId)) : q.eq('provider_ref', providerRef);

  const { error } = await q;
  if (error) throw new Error(`entitlement cancel failed: ${error.message}`);
  return true;
}

/** Resolve the Discord user behind a Stripe subscription id. */
async function findByProviderRef(supabase, providerRef) {
  const { data } = await supabase
    .from('discord_entitlements')
    .select('user_id, tier, status')
    .eq('provider_ref', providerRef)
    .maybeSingle();
  return data || null;
}

/**
 * Top.gg vote reward.
 *
 * Credits, NOT a tier. The old code upserted `tier:'pro'` with a 12-hour
 * expiry, which had two consequences: Top.gg allows a vote every 12 hours, so
 * voting twice a day bought permanent free Pro; and because the upsert was
 * keyed on user_id, a LIFETIME customer who voted had their row replaced and
 * silently downgraded to a 12-hour expiry.
 *
 * The cap is enforced inside gg_discord_grant_bonus so it holds even if this
 * is called twice concurrently.
 */
async function grantBonusCredits(supabase, userId, { credits = 10, hours = 24, cap = 20, source = 'topgg-vote' } = {}) {
  const { data, error } = await supabase.rpc('gg_discord_grant_bonus', {
    p_user_id: String(userId),
    p_credits: credits,
    p_hours: hours,
    p_cap: cap,
    p_source: source,
  });
  if (error) throw new Error(`bonus grant failed: ${error.message}`);
  return data || { granted: 0, balance: 0 };
}

module.exports = {
  syncEnvOverrides,
  upsertEntitlement,
  cancelEntitlement,
  findByProviderRef,
  grantBonusCredits,
};
