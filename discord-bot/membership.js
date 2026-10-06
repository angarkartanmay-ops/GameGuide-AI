// ═══════════════════════════════════════════════════════════════════════════
//  MEMBERSHIP — what plan someone is on, said plainly.
//  ───────────────────────────────────────────────────────────────────────
//  /quota shows a badge (FREE · PRO · PRO LIFETIME · PREMIUM SERVER), the
//  plan's state (renews on…, ends on…, payment problem) and the day's usage.
//  The quota decision says which tier is in force; the entitlement row says
//  why and until when. This module reads the row and turns both into copy.
//
//  Free of discord.js: returns plain strings and data.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const BADGES = Object.freeze({
  free: { emoji: '⚪', text: 'FREE', color: 0x8a93a6 },
  pro: { emoji: '⭐', text: 'PRO', color: 0xffd166 },
  lifetime: { emoji: '💎', text: 'PRO LIFETIME', color: 0x7ee0ff },
  server: { emoji: '🌟', text: 'PREMIUM SERVER', color: 0xc9a7ff },
});

const SOURCES = { stripe: 'card (Stripe)', razorpay: 'Razorpay', lemonsqueezy: 'Lemon Squeezy', manual: 'granted by the team' };

/** Discord's long-date timestamp, e.g. "12 November 2026". */
const dateStamp = (iso) => {
  const ms = Date.parse(iso || '');
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:D>` : null;
};

/**
 * The rows behind someone's plan. Read-only, service role. Never throws: a
 * failed read just means /quota shows less detail.
 */
async function loadMembership(supabase, { userId, guildId = null }) {
  const out = { entitlement: null, server: null };
  try {
    const { data } = await supabase.from('discord_entitlements')
      .select('tier, status, source, current_period_end')
      .eq('user_id', String(userId)).maybeSingle();
    out.entitlement = data || null;
  } catch { /* detail only */ }
  if (guildId) {
    try {
      const { data } = await supabase.from('discord_premium_servers')
        .select('expires_at').eq('guild_id', String(guildId)).maybeSingle();
      out.server = data || null;
    } catch { /* detail only */ }
  }
  return out;
}

/**
 * Badge + one or two lines describing the plan.
 * @param tier          the tier in force (from the quota decision)
 * @param entitlement   discord_entitlements row or null
 * @param server        discord_premium_servers row for this server or null
 */
function describeMembership({ tier = 'free', entitlement = null, server = null, now = Date.now() } = {}) {
  const badge = BADGES[tier] || BADGES.free;
  const lines = [];
  const end = entitlement?.current_period_end;
  const via = SOURCES[entitlement?.source] ? ` · paid with ${SOURCES[entitlement.source]}` : '';

  if (tier === 'lifetime') {
    lines.push(`Yours for good — no renewals${entitlement?.source === 'manual' ? '' : via}.`);
  } else if (tier === 'pro') {
    if (entitlement?.status === 'past_due') {
      lines.push(`⚠️ Your last payment didn't go through — Pro stays on while it's retried${dateStamp(end) ? `, until ${dateStamp(end)}` : ''}. Update your card from the link in your receipt email.`);
    } else if (entitlement?.source === 'manual' && !end) {
      lines.push('Granted by the team — no renewals.');
    } else if (entitlement?.status === 'ending') {
      lines.push(`Cancelled — Pro stays on until ${dateStamp(end) || 'the end of the paid period'}. \`/upgrade\` to pick it up again.`);
    } else if (end) {
      // The stored date includes a short grace period after the renewal charge.
      lines.push(`Renews around ${dateStamp(end)}${via}.`);
    }
  } else if (tier === 'server') {
    const s = server?.expires_at ? dateStamp(server.expires_at) : null;
    lines.push(`This server is on the Premium Server plan${s ? ` until ${s}` : ''} — every member shares it.`);
  } else {
    lines.push('Upgrade with `/upgrade` for 200 messages a day and the most accurate answers.');
  }
  // A lapsed paid plan reads as Free, but say what happened.
  if (tier === 'free' && entitlement && entitlement.tier !== 'free' && Date.parse(end || '') <= now) {
    lines.unshift(`Your ${entitlement.tier === 'server' ? 'server' : 'Pro'} plan ended ${dateStamp(end) || 'recently'}.`);
  }
  return { badge, title: `${badge.emoji} ${badge.text}`, lines };
}

module.exports = { BADGES, loadMembership, describeMembership };
