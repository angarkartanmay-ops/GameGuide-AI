// ═══════════════════════════════════════════════════════════════════════════
//  QUOTA — product-tier enforcement, backed by Postgres.
//  ───────────────────────────────────────────────────────────────────────
//  The bot used to hold quota in an in-memory Map. That reset on every
//  restart (free hosts restart constantly), could not be shared between
//  instances, and capped only a 60-second window — so a free user could
//  sustain 5/min forever, ~7,200 turns/day, against a platform that can
//  serve roughly 3,000/day in total.
//
//  Quota now lives in gg_discord_quota_check(): one RPC that resolves the
//  caller's tier, spends bonus credits, evaluates every window and records
//  the admission atomically. This module is the thin client for it, plus the
//  user-facing copy.
//
//  DELIBERATELY FREE OF discord.js. Everything here returns plain strings and
//  data so it can be unit-tested with a bare `import` — no gateway, no client,
//  no fixtures. index.js turns the output into embeds and buttons.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

// Nudge when this fraction of the daily allowance is gone. 0.8 puts the first
// warning at 12/15 on free — late enough not to nag, early enough to act on.
const NUDGE_AT = 0.8;
// One nudge per user per hour. Repeating it on every reply is the fastest way
// to make a free user resent the bot and leave.
const NUDGE_COOLDOWN_MS = 60 * 60_000;
// Collapses double-clicks and Discord's own retries. Not a rate limit — the
// real limits are in Postgres — just a guard against paying for the same
// question twice.
const SPAM_GATE_MS = 1_000;

const nudgeSeen = new Map();   // userId → last nudge timestamp
const spamGate = new Map();    // userId → last accepted request timestamp
const memFallback = new Map(); // userId → [timestamps]  (DB-outage burst guard)

// Mirrors discord_quota_tiers.burst_min for the free tier. Used ONLY while the
// database is unreachable, where we cannot know the caller's real tier.
const FALLBACK_BURST_PER_MIN = 5;

/** Classify a turn so vision and image generation bill against their own caps. */
function kindFor({ attachments, wantsImage } = {}) {
  if (wantsImage) return 'image_gen';
  if (attachments && attachments.length > 0) return 'vision';
  return 'chat';
}

/**
 * Reject a request that arrived within SPAM_GATE_MS of the previous one.
 * Exported for tests; `now` is injectable so tests need no timers.
 */
function localSpamGate(userId, now = Date.now()) {
  // `has` rather than a 0 default: "never seen" must not read as "seen at the
  // epoch", which would suppress a user's very first request under any clock
  // smaller than the window.
  if (spamGate.has(userId) && now - spamGate.get(userId) < SPAM_GATE_MS) return false;
  spamGate.set(userId, now);
  return true;
}

/** True at most once per hour per user. */
function shouldNudge(userId, now = Date.now()) {
  if (nudgeSeen.has(userId) && now - nudgeSeen.get(userId) < NUDGE_COOLDOWN_MS) return false;
  nudgeSeen.set(userId, now);
  return true;
}

/**
 * Burst-only limiter used when the RPC fails.
 *
 * Tradeoff, stated plainly: during a database outage the DAILY caps go
 * unenforced. Blocking everyone instead would turn a Supabase blip into a dead
 * bot, and the damage is bounded — the edge function still applies its own
 * infrastructure ceiling and the providers still have their own quotas. So we
 * hold the line on burst and let the day slide.
 */
function fallbackDecision(userId, kind, now = Date.now()) {
  const hits = (memFallback.get(userId) || []).filter(t => now - t < 60_000);
  const allowed = hits.length < FALLBACK_BURST_PER_MIN;
  if (allowed) {
    hits.push(now);
    memFallback.set(userId, hits);
  }
  if (memFallback.size > 5000) sweep(memFallback, now, 60_000);

  return {
    allowed,
    degraded: true,
    tier: 'free',
    tier_label: 'Free',
    scope: allowed ? null : 'minute',
    retry_after: 60,
    reset_at: null,
    used_bonus: false,
    messages: { used: 0, limit: 0, remaining: 0 },
    vision: { used: 0, limit: 0, remaining: 0 },
    image_gen: { used: 0, limit: 0, remaining: 0 },
    burst: { used: hits.length, limit: FALLBACK_BURST_PER_MIN },
    bonus_credits: 0,
    guild: null,
    limits: { history_len: 10, context_turns: 6, priority: false, soft_capped: false },
  };
}

/** Drop entries with no activity inside `windowMs`. Keeps the Maps bounded. */
function sweep(map, now = Date.now(), windowMs = NUDGE_COOLDOWN_MS) {
  for (const [k, v] of map) {
    const last = Array.isArray(v) ? (v[v.length - 1] || 0) : v;
    if (now - last > windowMs) map.delete(k);
  }
}

/** Periodic housekeeping — called from the bot's existing watchdog interval. */
function sweepAll(now = Date.now()) {
  sweep(nudgeSeen, now, NUDGE_COOLDOWN_MS);
  sweep(spamGate, now, 60_000);
  sweep(memFallback, now, 60_000);
  return { nudgeSeen: nudgeSeen.size, spamGate: spamGate.size, memFallback: memFallback.size };
}

/**
 * Check (and, unless dryRun, consume) quota.
 * @returns the JSONB decision from gg_discord_quota_check, plus `degraded`.
 */
async function checkQuota(supabase, { userId, guildId = null, kind = 'chat', dryRun = false }) {
  try {
    const { data, error } = await supabase.rpc('gg_discord_quota_check', {
      p_user_id: String(userId),
      p_guild_id: guildId ? String(guildId) : null,
      p_kind: kind,
      p_dry_run: dryRun,
    });
    if (error || !data || typeof data.allowed !== 'boolean') {
      console.warn('[quota] RPC unusable:', error?.message || 'malformed response');
      return fallbackDecision(userId, kind);
    }
    return { ...data, degraded: false };
  } catch (e) {
    console.warn('[quota] RPC failed:', e.message);
    return fallbackDecision(userId, kind);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  COPY
//  Freemium lives or dies on how the wall feels, not on where it sits.
// ═══════════════════════════════════════════════════════════════════════════

/** Discord relative timestamp, e.g. "in 4 hours". Falls back to plain text. */
function resetStamp(resetAtIso) {
  if (!resetAtIso) return 'at 00:00 UTC';
  const ms = Date.parse(resetAtIso);
  if (!Number.isFinite(ms)) return 'at 00:00 UTC';
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

/**
 * One dim line appended under an answer once the user is deep into their day.
 * Returns '' when there is nothing worth saying — the common case.
 */
function quotaFooter(decision, { userId, now = Date.now() } = {}) {
  if (!decision || decision.degraded) return '';
  if (decision.limits && decision.limits.priority) return ''; // never upsell a paying user

  const msgs = decision.messages || {};
  if (!msgs.limit) return '';
  const used = msgs.used || 0;
  if (used / msgs.limit < NUDGE_AT) return '';
  if (userId && !shouldNudge(userId, now)) return '';

  const left = msgs.remaining || 0;
  if (left <= 0) return '';
  return `-# ${left} message${left === 1 ? '' : 's'} left today · \`/premium\` for 200/day`;
}

/**
 * What the user sees when they are out. Never a bare error: always says which
 * limit, when it lifts, and what to do about it.
 */
function blockedMessage(decision) {
  const label = decision.tier_label || 'Free';
  const reset = resetStamp(decision.reset_at);
  const isFree = decision.tier === 'free';
  const upsell = isFree ? '\n\nUse `/premium` for **200 messages/day**, 40 screenshots and 20/min.' : '';

  switch (decision.scope) {
    case 'minute':
      return `⏳ **Slow down a moment.** You're sending them faster than I can think — try again in about a minute.`;

    case 'vision': {
      const v = decision.vision || {};
      return `📷 **Screenshot analyses used up** (${v.used}/${v.limit} today, ${label}).\n\nResets ${reset}. Ask me in text and I'll still answer.${upsell}`;
    }

    case 'image_gen': {
      const g = decision.image_gen || {};
      return `🎨 **Image generations used up** (${g.used}/${g.limit} today, ${label}).\n\nResets ${reset}.${upsell}`;
    }

    case 'day': {
      const m = decision.messages || {};
      return `🎮 **That's your ${m.limit} messages for today** (${label}).\n\nResets ${reset}.${upsell}`;
    }

    case 'guild': {
      const g = decision.guild || {};
      return `🌟 **This server has used its daily pool** (${g.used}/${g.limit}).\n\nResets ${reset}. Individual \`/premium\` still works on top of the server plan.`;
    }

    case 'capacity':
      // Honest about the real cause, and the strongest upgrade argument the
      // bot will ever make — because it is true.
      return `⚡ **I'm at capacity for today.** Free traffic has used up the shared daily pool.\n\nResets ${reset}. Pro users are never queued — \`/premium\`.`;

    default:
      return `⏳ **Rate limit reached** (${label}). Try again shortly.${upsell}`;
  }
}

/** Field rows for the /quota embed. index.js supplies the EmbedBuilder. */
function quotaFields(decision) {
  const m = decision.messages || {};
  const v = decision.vision || {};
  const g = decision.image_gen || {};

  const bar = (used, limit) => {
    if (!limit) return '—';
    const filled = Math.min(Math.round((used / limit) * 10), 10);
    return `\`${'█'.repeat(filled)}${'░'.repeat(10 - filled)}\` ${used}/${limit}`;
  };

  const fields = [
    { name: '💬 Messages', value: bar(m.used || 0, m.limit || 0), inline: false },
    { name: '📷 Screenshots', value: bar(v.used || 0, v.limit || 0), inline: true },
    { name: '🎨 Images', value: bar(g.used || 0, g.limit || 0), inline: true },
  ];

  if (decision.bonus_credits > 0) {
    fields.push({
      name: '🗳️ Bonus credits',
      value: `**${decision.bonus_credits}** left — spent before your daily allowance.`,
      inline: false,
    });
  }

  if (decision.guild) {
    fields.push({
      name: '🌟 Server pool',
      value: bar(decision.guild.used || 0, decision.guild.limit || 0),
      inline: false,
    });
  }

  fields.push({
    name: '🔄 Resets',
    value: resetStamp(decision.reset_at),
    inline: false,
  });

  return fields;
}

module.exports = {
  checkQuota,
  kindFor,
  localSpamGate,
  shouldNudge,
  quotaFooter,
  blockedMessage,
  quotaFields,
  resetStamp,
  sweepAll,
  // exported for tests
  _internals: { NUDGE_AT, NUDGE_COOLDOWN_MS, SPAM_GATE_MS, FALLBACK_BURST_PER_MIN, fallbackDecision, nudgeSeen, spamGate },
};
