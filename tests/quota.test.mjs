// Discord freemium quota — pure-logic assertions.
//
// quota.js is deliberately free of discord.js imports, so unlike the Deno edge
// modules (which tests/helpers/extract.mjs has to string-slice out of a file
// that calls Deno.serve at load time) this one imports directly.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const quota = require(join(HERE, '..', 'discord-bot', 'quota.js'));

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}`);
}

// ── kindFor: the billing classifier ────────────────────────────────────────
// Getting this wrong is how vision (3x the cost of a text turn) drained the
// free pool while being counted as one plain message.
check('no attachments is chat', quota.kindFor({ attachments: [] }) === 'chat');
check('undefined args is chat', quota.kindFor() === 'chat');
check('attachments make it vision', quota.kindFor({ attachments: [{}] }) === 'vision');
check('image request outranks vision', quota.kindFor({ attachments: [{}], wantsImage: true }) === 'image_gen');

// ── localSpamGate: double-click / gateway-retry filter ─────────────────────
{
  const t0 = 1_000_000;
  check('first request passes', quota.localSpamGate('u1', t0) === true);
  check('immediate repeat rejected', quota.localSpamGate('u1', t0 + 200) === false);
  check('still rejected just under 1s', quota.localSpamGate('u1', t0 + 999) === false);
  check('passes after the gate', quota.localSpamGate('u1', t0 + 1001) === true);
  check('a different user is unaffected', quota.localSpamGate('u2', t0 + 200) === true);
}

// ── shouldNudge: at most one upsell per hour ───────────────────────────────
{
  const t0 = 2_000_000;
  check('first nudge allowed', quota.shouldNudge('n1', t0) === true);
  check('second nudge suppressed', quota.shouldNudge('n1', t0 + 60_000) === false);
  check('still suppressed at 59 min', quota.shouldNudge('n1', t0 + 59 * 60_000) === false);
  check('allowed again after an hour', quota.shouldNudge('n1', t0 + 61 * 60_000) === true);
}

// ── quotaFooter: the 80% threshold ─────────────────────────────────────────
const decision = (over, extra = {}) => ({
  allowed: true,
  degraded: false,
  tier: 'free',
  tier_label: 'Free',
  messages: { used: over, limit: 15, remaining: 15 - over },
  limits: { priority: false },
  ...extra,
});

{
  // 11/15 = 73% — below threshold, stay quiet.
  check('quiet below 80%', quota.quotaFooter(decision(11), { userId: 'f1' }) === '');
  // 12/15 = 80% — first warning.
  check('nudges at exactly 80%', quota.quotaFooter(decision(12), { userId: 'f2' }).includes('3 messages left'));
  check('singular at one left', quota.quotaFooter(decision(14), { userId: 'f3' }).includes('1 message left'));
  check('silent when nothing remains', quota.quotaFooter(decision(15), { userId: 'f4' }) === '');

  // A paying user must never be upsold.
  const pro = decision(190, { tier: 'pro', messages: { used: 190, limit: 200, remaining: 10 }, limits: { priority: true } });
  check('never nudges a paying user', quota.quotaFooter(pro, { userId: 'f5' }) === '');

  // Degraded means the numbers are not real; do not quote them.
  check('silent while degraded', quota.quotaFooter(decision(14, { degraded: true }), { userId: 'f6' }) === '');

  // Hourly suppression applies to the footer too.
  const t = 5_000_000;
  check('footer shown once', quota.quotaFooter(decision(12), { userId: 'f7', now: t }) !== '');
  check('footer suppressed on next reply', quota.quotaFooter(decision(13), { userId: 'f7', now: t + 5_000 }) === '');
}

// ── blockedMessage: never a bare error ─────────────────────────────────────
{
  const base = {
    tier: 'free', tier_label: 'Free',
    reset_at: '2026-09-06T00:00:00Z',
    messages: { used: 15, limit: 15, remaining: 0 },
    vision: { used: 3, limit: 3, remaining: 0 },
    image_gen: { used: 1, limit: 1, remaining: 0 },
  };

  const day = quota.blockedMessage({ ...base, scope: 'day' });
  check('day block names the limit', day.includes('15 messages'));
  check('day block says when it lifts', day.includes('<t:'));
  check('day block upsells a free user', day.includes('/premium'));

  const vision = quota.blockedMessage({ ...base, scope: 'vision' });
  check('vision block is specific', vision.includes('3/3'));
  check('vision block offers text instead', vision.toLowerCase().includes('text'));

  const minute = quota.blockedMessage({ ...base, scope: 'minute' });
  check('burst block does not upsell', !minute.includes('/premium'));

  const capacity = quota.blockedMessage({ ...base, scope: 'capacity' });
  check('capacity block is honest', capacity.toLowerCase().includes('capacity'));

  // A paying user hitting a limit must not be sold the thing they already have.
  const proBlocked = quota.blockedMessage({ ...base, tier: 'pro', tier_label: 'Pro', scope: 'day', messages: { used: 200, limit: 200, remaining: 0 } });
  check('paid user is not upsold', !proBlocked.includes('/premium'));
}

// ── fallbackDecision: DB outage must not fail open ─────────────────────────
{
  const { fallbackDecision, FALLBACK_BURST_PER_MIN } = quota._internals;
  const t = 9_000_000;
  let last;
  for (let i = 0; i < FALLBACK_BURST_PER_MIN; i++) {
    last = fallbackDecision('degraded-user', 'chat', t + i);
    check(`fallback admits request ${i + 1}`, last.allowed === true);
  }
  const over = fallbackDecision('degraded-user', 'chat', t + FALLBACK_BURST_PER_MIN);
  check('fallback refuses past the burst', over.allowed === false);
  check('fallback is flagged degraded', over.degraded === true);
  check('fallback reports the burst scope', over.scope === 'minute');
}

// ── resetStamp ─────────────────────────────────────────────────────────────
check('renders a Discord relative stamp', quota.resetStamp('2026-09-06T00:00:00Z').startsWith('<t:'));
check('survives a null reset', quota.resetStamp(null).includes('UTC'));
check('survives a malformed reset', quota.resetStamp('not-a-date').includes('UTC'));

// ── quotaFields ────────────────────────────────────────────────────────────
{
  const fields = quota.quotaFields({
    messages: { used: 8, limit: 15 }, vision: { used: 1, limit: 3 },
    image_gen: { used: 0, limit: 1 }, bonus_credits: 4, guild: null,
    reset_at: '2026-09-06T00:00:00Z',
  });
  const names = fields.map(f => f.name).join(' ');
  check('renders the three counters', /Messages/.test(names) && /Screenshots/.test(names) && /Images/.test(names));
  check('surfaces bonus credits when held', /Bonus/.test(names));
  check('always shows the reset time', /Resets/.test(names));

  const noBonus = quota.quotaFields({
    messages: { used: 1, limit: 15 }, vision: { used: 0, limit: 3 },
    image_gen: { used: 0, limit: 1 }, bonus_credits: 0, guild: null, reset_at: null,
  });
  check('hides bonus row at zero', !noBonus.map(f => f.name).join(' ').includes('Bonus'));
}

console.log(`quota: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
