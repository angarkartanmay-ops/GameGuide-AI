// ═══════════════════════════════════════════════════════════════════════════
//  HTTP SECURITY — the bot's small public surface (health + two webhooks).
//  ───────────────────────────────────────────────────────────────────────
//  Free of Express and discord.js so it can be unit-tested bare.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');

/**
 * Constant-time string compare. Hashing first makes both sides the same
 * length, so neither the content nor the length of the secret leaks through
 * response timing (a plain `!==` returns at the first differing byte).
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

const isSnowflake = (v) => typeof v === 'string' && /^\d{17,20}$/.test(v);

/** Headers for responses that are only ever JSON or plain text. */
function secureHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/**
 * Fixed-window limiter keyed by client IP. In memory on purpose: it guards a
 * single process against floods of forged webhook calls (each one costs a
 * signature check or a DB read). Real Stripe/Top.gg traffic is a few calls a
 * minute; the default allows 60.
 */
function rateLimiter({ windowMs = 60_000, max = 60, now = () => Date.now() } = {}) {
  const hits = new Map();   // ip → { start, count }
  function limiter(req, res, next) {
    const t = now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    let h = hits.get(ip);
    if (!h || t - h.start >= windowMs) { h = { start: t, count: 0 }; hits.set(ip, h); }
    h.count++;
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
    }
    if (h.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((h.start + windowMs - t) / 1000)));
      return res.status(429).json({ error: 'rate limited' });
    }
    return next();
  }
  limiter.size = () => hits.size;
  return limiter;
}

/**
 * Validate a Top.gg vote webhook body. Returns { userId, weekend } or an
 * { error } naming what was wrong. `test` votes (the "Send test" button)
 * are accepted but never rewarded.
 */
function parseTopggVote(body, { botId = null } = {}) {
  if (!body || typeof body !== 'object') return { error: 'bad body' };
  const user = typeof body.user === 'number' ? String(body.user) : body.user;
  if (!isSnowflake(user)) return { error: 'bad user' };
  if (botId && body.bot != null && String(body.bot) !== String(botId)) return { error: 'wrong bot' };
  const type = body.type || 'upvote';
  if (type !== 'upvote' && type !== 'test') return { error: 'bad type' };
  return { userId: user, weekend: body.isWeekend === true, test: type === 'test' };
}

module.exports = { safeEqual, isSnowflake, secureHeaders, rateLimiter, parseTopggVote };
