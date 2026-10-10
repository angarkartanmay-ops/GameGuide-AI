// ═══════════════════════════════════════════════════════════════════════════
//  UPGRADE LINK — a short-lived, signed pass from Discord to the plans page.
//  ───────────────────────────────────────────────────────────────────────
//  /upgrade (and /quota, and the "out of messages" wall) hand the user a link
//  to the website's plans page. The link carries WHO is buying, signed by the
//  bot, so the page never asks anyone to paste a Discord id and nobody can buy
//  "as" someone else by editing a URL:
//
//      https://<site>/#upgrade/v1.<payload>.<signature>
//
//  payload   base64url JSON { u: user id, g: server id | null, n: display
//            name (for "Buying for @name"), exp: unix seconds }
//  signature HMAC-SHA256 over "v1.<payload>" with UPGRADE_LINK_SECRET
//
//  The website only READS the payload (to greet the buyer); the bot's billing
//  API verifies the signature and expiry before creating any checkout. The link
//  lives in the URL fragment, which browsers never send to a server.
//
//  Free of discord.js: testable with a bare import.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const crypto = require('node:crypto');
const { safeEqual, isSnowflake } = require('./httpSecurity');

const VERSION = 'v1';
const TTL_SECONDS = 60 * 60;          // an hour to pick a plan and pay
const DEFAULT_SITE = 'https://gameguide.online';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function siteUrl(env = process.env) {
  const raw = (env.SITE_URL || DEFAULT_SITE).trim().replace(/\/+$/, '');
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.hostname === 'localhost' ? raw : DEFAULT_SITE;
  } catch {
    return DEFAULT_SITE;
  }
}

/** Keep a display name printable and short; it is only ever shown back to its owner. */
function cleanName(name) {
  return String(name || '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}

function sign(body, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(body).digest());
}

/** A signed token for this buyer, or '' when UPGRADE_LINK_SECRET is not set. */
function createUpgradeToken({ userId, guildId = null, name = '' }, { secret, now = Date.now(), ttl = TTL_SECONDS } = {}) {
  if (!secret || !isSnowflake(String(userId))) return '';
  const payload = {
    u: String(userId),
    g: guildId && isSnowflake(String(guildId)) ? String(guildId) : null,
    n: cleanName(name),
    exp: Math.floor(now / 1000) + ttl,
  };
  const body = `${VERSION}.${b64url(JSON.stringify(payload))}`;
  return `${body}.${sign(body, secret)}`;
}

/**
 * The payload of a genuine, unexpired token — or null. Constant-time
 * signature check; every field re-validated after decoding.
 */
function verifyUpgradeToken(token, { secret, now = Date.now() } = {}) {
  if (!secret || typeof token !== 'string' || token.length > 600) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const body = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], sign(body, secret))) return null;
  let p;
  try { p = JSON.parse(fromB64url(parts[1]).toString('utf8')); } catch { return null; }
  if (!p || !isSnowflake(String(p.u))) return null;
  if (p.g != null && !isSnowflake(String(p.g))) return null;
  if (!Number.isFinite(p.exp) || p.exp * 1000 <= now) return null;
  return { userId: String(p.u), guildId: p.g ? String(p.g) : null, name: cleanName(p.n), exp: p.exp };
}

/** The plans-page link for this Discord user, or '' when signing is not configured. */
function upgradeUrl({ userId, guildId = null, name = '' }, env = process.env, now = Date.now()) {
  const token = createUpgradeToken({ userId, guildId, name }, { secret: (env.UPGRADE_LINK_SECRET || '').trim(), now });
  return token ? `${siteUrl(env)}/#upgrade/${token}` : '';
}

module.exports = { createUpgradeToken, verifyUpgradeToken, upgradeUrl, siteUrl, DEFAULT_SITE, TTL_SECONDS };
