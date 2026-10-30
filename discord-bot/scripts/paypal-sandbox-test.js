#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  PayPal sandbox test — one real purchase, end to end, for the TEST identity.
//  ───────────────────────────────────────────────────────────────────────
//     node scripts/paypal-sandbox-test.js [base|pro|server] [month|year]
//
//  1. Creates a real sandbox checkout (Base monthly by default) for the bot's
//     test identity (REVIEW_DISCORD_USER_ID, default 100000000000000001) —
//     never a real Discord account.
//  2. Prints the link, with PayPal's US checkout forced (?country.x=US):
//     from an Indian connection PayPal otherwise serves its India checkout,
//     which refuses Indian accounts and sandbox subscriptions alike.
//  3. Waits (up to 20 min) for the buyer to approve, watching PayPal's own
//     record of the subscription, then for the bot's webhook to grant the
//     plan in the database. Prints PASS or what is stuck.
//  4. Cancels the sandbox subscription so it does not "renew".
//
//  The buyer must be a sandbox PERSONAL account registered in the UNITED
//  STATES (developer.paypal.com → Testing Tools → Sandbox Accounts → Create
//  account → Personal, United States). PayPal's default sandbox buyer for an
//  Indian developer account is Indian, and PayPal does not allow payments
//  between two Indian accounts: "This seller doesn't accept payments in your
//  currency". Sandbox only; refuses to run against live keys.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { paypalConfig, paypalClient, createPaypalCheckout } = require('../billing-paypal');

const BOT = path.join(__dirname, '..');
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return out;
}
const env = { ...readEnvFile(path.join(BOT, '.env')), ...readEnvFile(path.join(BOT, '.env.render')), ...process.env };
const cfg = paypalConfig(env);
if (!cfg) { console.error('PayPal is not configured in discord-bot/.env / .env.render.'); process.exit(1); }
if (cfg.mode !== 'sandbox') { console.error('Refusing: PAYPAL_ENV is live. This test makes sandbox purchases only.'); process.exit(1); }

const plan = ['base', 'pro', 'server'].includes(process.argv[2]) ? process.argv[2] : 'base';
const interval = process.argv[3] === 'year' ? 'year' : 'month';
const userId = (env.REVIEW_DISCORD_USER_ID || '100000000000000001').trim();
const guildId = (env.REVIEW_DISCORD_GUILD_ID || '100000000000000002').trim();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function entitlement() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const table = plan === 'server' ? 'discord_premium_servers' : 'discord_entitlements';
  const q = plan === 'server' ? `guild_id=eq.${guildId}&select=provider_ref,expires_at` : `user_id=eq.${userId}&select=tier,source,status,provider_ref,current_period_end`;
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${table}?${q}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  return res.ok ? (await res.json())[0] || null : null;
}

(async () => {
  const api = paypalClient(cfg);
  const site = (env.SITE_URL || 'https://gameguide.online').replace(/\/+$/, '');
  const { url, ref } = await createPaypalCheckout(
    { plan, interval, userId, guildId: plan === 'server' ? guildId : null, successUrl: `${site}/#upgrade/thanks`, cancelUrl: `${site}/#upgrade` },
    { config: cfg, client: api },
  );
  const link = `${url}${url.includes('?') ? '&' : '?'}country.x=US&locale.x=en_US`;
  console.log(`Sandbox ${plan}/${interval} checkout for the TEST identity ${userId} (subscription ${ref}).`);
  console.log('\nOpen this, log in with a UNITED STATES sandbox personal account, press Subscribe:\n');
  console.log(`  ${link}\n`);
  console.log('Waiting for approval (20 min max)…');

  const until = Date.now() + 20 * 60_000;
  let status = '';
  while (Date.now() < until) {
    const sub = await api.getSubscription(ref).catch(() => null);
    if (sub && sub.status !== status) { status = sub.status; console.log(`  PayPal: ${status}`); }
    if (status === 'ACTIVE') break;
    if (['CANCELLED', 'EXPIRED', 'SUSPENDED'].includes(status)) { console.log('FAIL: the subscription ended before it was paid.'); process.exit(1); }
    await sleep(5_000);
  }
  if (status !== 'ACTIVE') { console.log('FAIL: nobody approved the checkout in time.'); process.exit(1); }

  console.log('Paid. Waiting for the bot\'s webhook to grant the plan…');
  let row = null;
  for (let i = 0; i < 36; i++) {
    row = await entitlement();
    if (row && row.provider_ref === `pp:${ref}`) break;
    await sleep(5_000);
  }
  if (row && row.provider_ref === `pp:${ref}`) {
    console.log(`PASS: the database has ${plan === 'server' ? `server plan until ${row.expires_at}` : `${row.tier} (${row.source}, ${row.status}) until ${row.current_period_end}`} for the test identity.`);
  } else {
    console.log('FAIL: PayPal took the payment but the bot has not granted it. Run: node scripts/billing-go-live.js --diagnose');
  }

  if (!process.argv.includes('--keep')) {
    await api.cancelSubscription(ref, 'Sandbox test finished').then(
      () => console.log('Cleaned up: the sandbox subscription is cancelled (the test identity keeps the plan to the end of the paid month).'),
      (e) => console.log(`Could not cancel the sandbox subscription: ${e.message}`),
    );
  }
  process.exit(row && row.provider_ref === `pp:${ref}` ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
