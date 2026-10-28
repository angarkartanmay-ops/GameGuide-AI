#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  Billing check — is every payment rail really set up?
//  ───────────────────────────────────────────────────────────────────────
//  Run after razorpay-setup.js / paypal-setup.js, with the same values the
//  bot host has (it reads discord-bot/.env, then .env.render, then the shell):
//
//     node scripts/billing-check.js [--bot https://<bot-host>]
//
//  For each configured rail it asks the provider itself:
//    • do the configured plan ids exist, active, at the prices in plans.js?
//    • can a checkout be created for every plan (a real hosted page link)?
//    • (PayPal) does the webhook exist, point at the bot, and send every event?
//  With --bot it also checks the bot answers on each webhook route and
//  refuses an unsigned event there.
//
//  It creates checkouts for a TEST Discord id and never completes them;
//  Razorpay ones are cancelled again at the end. It never prints a secret.
//  Exit code 0 only when every check passes.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PLANS } = require('../plans');
const { razorpayConfig, razorpayOffers, createCheckout: createRazorpayCheckout, razorpayPlanId } = require('../billing-razorpay');
const { paypalConfig, paypalClient, paypalOffers, paypalPlanId, createPaypalCheckout } = require('../billing-paypal');

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
const botArg = process.argv.indexOf('--bot');
const botUrl = botArg > 0 ? String(process.argv[botArg + 1] || '').replace(/\/+$/, '') : '';

const TEST_USER = (env.REVIEW_DISCORD_USER_ID || '100000000000000001').trim();
const TEST_GUILD = (env.REVIEW_DISCORD_GUILD_ID || '100000000000000002').trim();
const SITE = (env.SITE_URL || 'https://gameguide.online').replace(/\/+$/, '');

let ok = 0, bad = 0;
const pass = (m) => { ok++; console.log(`  ✓ ${m}`); };
const fail = (m) => { bad++; console.log(`  ✗ ${m}`); };
const usd = (cents) => (cents / 100).toFixed(2);
const offerOf = (plan, interval) => (interval === 'year' ? PLANS[plan].yearly : PLANS[plan]);

async function checkRazorpay() {
  const cfg = razorpayConfig(env);
  console.log('\nRazorpay');
  if (!cfg) return console.log('  – not configured (RAZORPAY_KEY_ID / _KEY_SECRET / _WEBHOOK_SECRET)');
  console.log(`  ${cfg.keyId.startsWith('rzp_live_') ? 'LIVE' : 'TEST'} keys`);
  const auth = `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`;
  const api = async (method, url, body) => {
    const res = await fetch(`https://api.razorpay.com/v1${url}`, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status} ${data?.error?.description || ''}`.trim());
    return data;
  };

  for (const plan of ['base', 'pro', 'server']) {
    for (const interval of ['month', 'year']) {
      const id = razorpayPlanId(cfg, plan, interval);
      if (!id) { fail(`${plan}/${interval}: no RAZORPAY_PLAN_ id set`); continue; }
      try {
        const p = await api('GET', `/plans/${id}`);
        const want = offerOf(plan, interval).inr * 100;
        const period = interval === 'year' ? 'yearly' : 'monthly';
        if (p.item?.amount === want && p.item?.currency === 'INR' && p.period === period && p.interval === 1) pass(`${plan}/${interval} plan ${id} is ₹${want / 100} ${period}`);
        else fail(`${plan}/${interval} plan ${id} is ${p.item?.amount / 100} ${p.item?.currency} ${p.period} — plans.js says ₹${want / 100} ${period}`);
      } catch (e) { fail(`${plan}/${interval} plan ${id}: ${e.message}`); }
    }
  }

  const made = [];
  for (const o of razorpayOffers(cfg)) {
    try {
      const r = await createRazorpayCheckout({ ...o, userId: TEST_USER, guildId: o.plan === 'server' ? TEST_GUILD : null, callbackUrl: `${SITE}/#upgrade/thanks` }, { config: cfg });
      made.push(r);
      pass(`checkout ${o.plan}/${o.interval} → ${r.url}`);
    } catch (e) { fail(`checkout ${o.plan}/${o.interval}: ${e.message}`); }
  }
  for (const r of made) {
    try {
      await api('POST', r.kind === 'subscription' ? `/subscriptions/${r.ref}/cancel` : `/payment_links/${r.ref}/cancel`, r.kind === 'subscription' ? { cancel_at_cycle_end: 0 } : undefined);
    } catch { /* an unpaid one may already be gone; it expires anyway */ }
  }
}

async function checkPaypal() {
  const cfg = paypalConfig(env);
  console.log('\nPayPal');
  if (!cfg) return console.log('  – not configured (PAYPAL_CLIENT_ID / _CLIENT_SECRET / _WEBHOOK_ID)');
  console.log(`  ${cfg.mode.toUpperCase()} (${cfg.api})`);
  const api = paypalClient(cfg);
  try { await api.request('/v1/catalogs/products?page_size=1'); pass('credentials work'); } catch (e) { fail(`credentials: ${e.message}`); return; }

  for (const plan of ['base', 'pro', 'server']) {
    for (const interval of ['month', 'year']) {
      const id = paypalPlanId(cfg, plan, interval);
      if (!id) { fail(`${plan}/${interval}: no PAYPAL_PLAN_ id set`); continue; }
      try {
        const p = await api.request(`/v1/billing/plans/${encodeURIComponent(id)}`);
        const cyc = (p.billing_cycles || []).find(c => c.tenure_type === 'REGULAR');
        const price = cyc?.pricing_scheme?.fixed_price;
        const unit = interval === 'year' ? 'YEAR' : 'MONTH';
        const want = usd(offerOf(plan, interval).cents);
        if (p.status === 'ACTIVE' && price?.currency_code === 'USD' && Number(price.value).toFixed(2) === want && cyc.frequency?.interval_unit === unit && cyc.frequency?.interval_count === 1) {
          pass(`${plan}/${interval} plan ${id} is $${want} per ${unit.toLowerCase()}`);
        } else fail(`${plan}/${interval} plan ${id} is ${p.status} ${price?.value} ${price?.currency_code} per ${cyc?.frequency?.interval_unit} — plans.js says $${want} per ${unit.toLowerCase()}`);
      } catch (e) { fail(`${plan}/${interval} plan ${id}: ${e.message}`); }
    }
  }

  try {
    const hook = await api.request(`/v1/notifications/webhooks/${encodeURIComponent(cfg.webhookId)}`);
    const have = new Set((hook.event_types || []).map(e => e.name));
    const need = ['BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.CANCELLED', 'PAYMENT.SALE.COMPLETED', 'CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED'];
    const missing = need.filter(e => !have.has(e) && !have.has('*'));
    if (!/\/paypal-webhook$/.test(hook.url || '')) fail(`webhook ${cfg.webhookId} points at ${hook.url}, not …/paypal-webhook`);
    else if (missing.length) fail(`webhook is missing events: ${missing.join(', ')} — re-run paypal-setup.js --webhook ${hook.url}`);
    else pass(`webhook ${cfg.webhookId} → ${hook.url}`);
  } catch (e) { fail(`webhook ${cfg.webhookId}: ${e.message}`); }

  for (const o of paypalOffers(cfg)) {
    try {
      const r = await createPaypalCheckout({ ...o, userId: TEST_USER, guildId: o.plan === 'server' ? TEST_GUILD : null, successUrl: `${SITE}/#upgrade/thanks`, cancelUrl: `${SITE}/#upgrade` }, { config: cfg, client: api });
      pass(`checkout ${o.plan}/${o.interval} → ${r.url}`);
    } catch (e) { fail(`checkout ${o.plan}/${o.interval}: ${e.message}`); }
  }
}

async function checkBot() {
  if (!botUrl) return;
  console.log(`\nBot at ${botUrl}`);
  for (const [route, on] of [['/razorpay-webhook', !!razorpayConfig(env)], ['/paypal-webhook', !!paypalConfig(env)]]) {
    if (!on) continue;
    try {
      const res = await fetch(`${botUrl}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"probe":true}' });
      if (res.status === 400) pass(`${route} is live and refuses an unsigned event`);
      else fail(`${route} answered ${res.status} (expected 400: is the bot running this version with these env vars?)`);
    } catch (e) { fail(`${route}: ${e.message}`); }
  }
  try {
    const res = await fetch(`${botUrl}/api/plans`);
    const j = await res.json().catch(() => null);
    const rails = Object.entries(j?.rails || {}).filter(([, r]) => r).map(([k, r]) => `${k}=${r.provider}`);
    if (res.ok && rails.length) pass(`plans API offers ${rails.join(', ')}`);
    else fail(`plans API: ${res.status}${rails.length ? '' : ', no rails open'}`);
  } catch (e) { fail(`plans API: ${e.message}`); }
}

(async () => {
  await checkRazorpay();
  await checkPaypal();
  await checkBot();
  console.log(`\n${ok} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
