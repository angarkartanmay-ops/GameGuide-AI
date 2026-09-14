// Stripe billing — pure-logic assertions.
//
// billing-stripe.js only requires the Stripe SDK when STRIPE_SECRET_KEY is set,
// so it imports cleanly here with billing disabled. That is enough to test the
// parts that decide who keeps paid access, which is the part worth guarding.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const billing = require(join(HERE, '..', 'discord-bot', 'billing-stripe.js'));

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}`);
}

const { subscriptionPeriodEnd } = billing;

// ── subscriptionPeriodEnd ──────────────────────────────────────────────────
// Stripe REMOVED current_period_end from Subscription and moved it onto
// SubscriptionItem (API 2025-03-31.basil onward; the pinned SDK is
// 2026-08-26.dahlia). Reading the old top-level field returns undefined, which
// became null in the DB — and gg_discord_quota_check reads null as "never
// expires":
//
//     AND (e.current_period_end IS NULL OR e.current_period_end > now())
//
// so every subscriber silently received PERMANENT Pro. These assertions exist
// so a future SDK bump cannot quietly restore that.
{
  const AUG_2026 = 1787000000;          // some concrete unix seconds
  const SEP_2026 = AUG_2026 + 30 * 86400;

  check('reads period end from subscription items', (() => {
    const sub = { items: { data: [{ current_period_end: AUG_2026 }] } };
    return subscriptionPeriodEnd(sub) === new Date(AUG_2026 * 1000).toISOString();
  })());

  // Multi-item subscriptions (add-ons, metered components) can have different
  // periods. The earliest is the first moment it is no longer fully paid for.
  check('multi-item takes the EARLIEST end', (() => {
    const sub = { items: { data: [
      { current_period_end: SEP_2026 },
      { current_period_end: AUG_2026 },
    ] } };
    return subscriptionPeriodEnd(sub) === new Date(AUG_2026 * 1000).toISOString();
  })());

  check('ignores items missing a period end', (() => {
    const sub = { items: { data: [
      { current_period_end: null },
      { current_period_end: AUG_2026 },
      {},
    ] } };
    return subscriptionPeriodEnd(sub) === new Date(AUG_2026 * 1000).toISOString();
  })());

  // Back-compat: a pre-basil API version still puts it at the top level.
  check('falls back to the legacy top-level field', (() => {
    const sub = { current_period_end: AUG_2026 };
    return subscriptionPeriodEnd(sub) === new Date(AUG_2026 * 1000).toISOString();
  })());

  check('prefers items over the legacy field when both exist', (() => {
    const sub = {
      current_period_end: SEP_2026,
      items: { data: [{ current_period_end: AUG_2026 }] },
    };
    return subscriptionPeriodEnd(sub) === new Date(AUG_2026 * 1000).toISOString();
  })());

  // THE REGRESSION THAT MATTERED: the old code read sub.current_period_end on a
  // dahlia-shaped object and got undefined. If this ever returns null again for
  // a subscription that plainly has a period, paid access becomes permanent.
  check('a dahlia-shaped subscription never yields null', (() => {
    const sub = { id: 'sub_1', status: 'active', items: { data: [{ current_period_end: AUG_2026 }] } };
    return subscriptionPeriodEnd(sub) !== null;
  })());

  // Genuinely absent → null, which the schema treats as "never expires". That
  // is correct ONLY for a one-off / lifetime purchase with no subscription.
  check('no period information at all is null', subscriptionPeriodEnd({}) === null);
  check('null subscription is null', subscriptionPeriodEnd(null) === null);
  check('empty item list is null', subscriptionPeriodEnd({ items: { data: [] } }) === null);
  check('non-numeric period end is rejected', subscriptionPeriodEnd({ current_period_end: 'soon' }) === null);
}

// ── client_reference_id round-trip ─────────────────────────────────────────
// This is the join between a Stripe payment and a Discord snowflake. If it
// breaks, money arrives and nobody gets upgraded.
{
  const { encodeClientRef, parseClientRef } = billing;
  const USER = '123456789012345678';
  const GUILD = '987654321098765432';

  check('user ref round-trips', (() => {
    const p = parseClientRef(encodeClientRef({ userId: USER }));
    return p && p.kind === 'user' && p.userId === USER && p.guildId === null;
  })());

  check('guild ref round-trips', (() => {
    const p = parseClientRef(encodeClientRef({ userId: USER, guildId: GUILD }));
    return p && p.kind === 'guild' && p.userId === USER && p.guildId === GUILD;
  })());

  check('rejects garbage', parseClientRef('nonsense') === null);
  check('rejects non-string', parseClientRef(null) === null);
  check('rejects a non-snowflake user id', parseClientRef('u_abc') === null);
  check('rejects a truncated guild ref', parseClientRef(`g_${GUILD}`) === null);
}

// ── buildCheckoutUrl ───────────────────────────────────────────────────────
{
  const { buildCheckoutUrl } = billing;
  const USER = '123456789012345678';

  check('appends with ? on a bare link', (() => {
    const u = buildCheckoutUrl('https://buy.stripe.com/x', { userId: USER });
    return u === `https://buy.stripe.com/x?client_reference_id=u_${USER}`;
  })());

  check('appends with & when a query already exists', (() => {
    const u = buildCheckoutUrl('https://buy.stripe.com/x?utm=discord', { userId: USER });
    return u === `https://buy.stripe.com/x?utm=discord&client_reference_id=u_${USER}`;
  })());

  check('no payment link yields empty string', buildCheckoutUrl('', { userId: USER }) === '');
}

console.log(`billing: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
