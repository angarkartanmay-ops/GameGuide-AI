// ═══════════════════════════════════════════════════════════════════════════
//  Server-side PostHog capture for the one moment the website cannot see:
//  a paid plan actually switching on (the payment webhook, via billing-core).
//
//  Off unless POSTHOG_KEY is set on the bot's host (Render). Same project key
//  as the website's VITE_POSTHOG_KEY. POSTHOG_HOST defaults to the US cloud;
//  set https://eu.i.posthog.com for an EU project.
//
//  Privacy, matching src/utils/analytics.js:
//   · No Discord id, guild id, name or provider reference leaves the bot.
//     Each event gets a random distinct_id and creates no person profile.
//   · The event uuid is a hash of the provider reference + plan, so a webhook
//     the provider re-sends cannot be counted twice.
//   · Fire-and-forget with a short timeout: analytics never delays or fails a
//     grant.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const crypto = require('node:crypto');

const TIMEOUT_MS = 3000;

/** A UUID-shaped, one-way digest of `text` (PostHog dedupes on `uuid`). */
function digestUuid(text) {
  const h = crypto.createHash('sha256').update(String(text)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * @returns (event, properties, { dedupeKey }) => void — a no-op when unset.
 * `fetchImpl` and `env` are injectable for tests.
 */
function serverAnalytics({ env = process.env, fetchImpl = globalThis.fetch, log = console } = {}) {
  const key = env.POSTHOG_KEY || '';
  if (!key || typeof fetchImpl !== 'function') return () => {};
  const host = (env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/+$/, '');

  return (event, properties = {}, { dedupeKey } = {}) => {
    const body = {
      api_key: key,
      event,
      distinct_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      properties: { ...properties, $process_person_profile: false, $lib: 'gameguide-bot' },
    };
    if (dedupeKey) body.uuid = digestUuid(dedupeKey);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      Promise.resolve(fetchImpl(`${host}/i/v0/e/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }))
        .catch((e) => log.warn?.(`[analytics] ${event} not sent: ${e?.message || e}`))
        .finally(() => clearTimeout(timer));
    } catch (e) {
      log.warn?.(`[analytics] ${event} not sent: ${e?.message || e}`);
    }
  };
}

module.exports = { serverAnalytics, digestUuid };
