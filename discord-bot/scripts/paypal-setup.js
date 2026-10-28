#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  PayPal one-time setup.
//  ───────────────────────────────────────────────────────────────────────
//  1. developer.paypal.com → Apps & Credentials → (Sandbox first) Create App.
//     Put its credentials in discord-bot/.env:
//        PAYPAL_CLIENT_ID=...
//        PAYPAL_CLIENT_SECRET=...
//        PAYPAL_ENV=sandbox            (live when you switch over)
//  2. Run:  node scripts/paypal-setup.js --webhook https://<bot-host>/paypal-webhook
//
//  It creates the product and the six subscription plans the bot sells (Base,
//  Pro and Server, monthly and yearly, at the dollar prices in plans.js) — or
//  finds them if a previous run already did — adds the webhook with exactly
//  the events billing-paypal.js handles, and writes the ids to
//  discord-bot/.env.render (git-ignored), ready to paste into the bot host's
//  environment. It never prints a secret. Without --webhook it skips that step.
//
//  Safe to run again: plans are matched by name (which includes the price),
//  the webhook by its URL.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PLANS } = require('../plans');
const { paypalClient } = require('../billing-paypal');

const BOT = path.join(__dirname, '..');
const ENV_FILE = path.join(BOT, '.env');
const OUT_FILE = path.join(BOT, '.env.render');

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return out;
}

const env = { ...readEnvFile(ENV_FILE), ...process.env };
const previous = readEnvFile(OUT_FILE);
const clientId = (env.PAYPAL_CLIENT_ID || '').trim();
const clientSecret = (env.PAYPAL_CLIENT_SECRET || '').trim();
const mode = (env.PAYPAL_ENV || '').trim().toLowerCase() === 'live' ? 'live' : 'sandbox';
const webhookArg = process.argv.indexOf('--webhook');
const webhookUrl = webhookArg > 0 ? String(process.argv[webhookArg + 1] || '') : '';

if (!clientId || !clientSecret) {
  console.error('Put PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in discord-bot/.env first (developer.paypal.com → Apps & Credentials).');
  process.exit(1);
}
if (webhookUrl && !/^https:\/\/[^/]+\/paypal-webhook$/.test(webhookUrl)) {
  console.error('--webhook must be the bot\'s public https address ending in /paypal-webhook.');
  process.exit(1);
}

const api = paypalClient({ clientId, clientSecret, api: mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com' });

const usd = (cents) => (cents / 100).toFixed(2);
const WANT = [];
for (const plan of ['base', 'pro', 'server']) {
  const p = PLANS[plan];
  WANT.push({ env: `PAYPAL_PLAN_${plan.toUpperCase()}`, unit: 'MONTH', price: usd(p.cents), name: `GameGuide ${p.label} monthly $${usd(p.cents)}` });
  WANT.push({ env: `PAYPAL_PLAN_${plan.toUpperCase()}_YEARLY`, unit: 'YEAR', price: usd(p.yearly.cents), name: `GameGuide ${p.label} yearly $${usd(p.yearly.cents)}` });
}

// Exactly what billing-paypal.js handles.
const EVENTS = [
  'BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.RE-ACTIVATED', 'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'PAYMENT.SALE.COMPLETED',
  'CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED',
  'CUSTOMER.DISPUTE.CREATED',
];
const PRODUCT_NAME = 'GameGuide-AI Discord plans';

(async () => {
  console.log(`PayPal ${mode.toUpperCase()} mode`);

  // Product
  let product;
  try {
    const list = await api.request('/v1/catalogs/products?page_size=20');
    product = (list.products || []).find(p => p.name === PRODUCT_NAME);
  } catch (e) {
    console.error(`Could not reach PayPal with these credentials: ${e.message}`);
    process.exit(1);
  }
  if (!product) {
    product = await api.request('/v1/catalogs/products', {
      method: 'POST', requestId: `gg-product-${mode}`,
      body: { name: PRODUCT_NAME, description: 'GameGuide-AI Discord bot plans', type: 'SERVICE', category: 'SOFTWARE' },
    });
    console.log(`  created product ${product.id}`);
  } else {
    console.log(`  found   product ${product.id}`);
  }

  // Plans
  const existing = (await api.request(`/v1/billing/plans?product_id=${encodeURIComponent(product.id)}&page_size=20`)).plans || [];
  const ids = {};
  for (const w of WANT) {
    const hit = existing.find(p => p.name === w.name && p.status === 'ACTIVE');
    if (hit) {
      ids[w.env] = hit.id;
      console.log(`  found   ${w.name.padEnd(36)} ${hit.id}`);
      continue;
    }
    const plan = await api.request('/v1/billing/plans', {
      method: 'POST', requestId: `gg-plan-${mode}-${w.env}-${w.price}`,
      body: {
        product_id: product.id,
        name: w.name,
        status: 'ACTIVE',
        billing_cycles: [{
          frequency: { interval_unit: w.unit, interval_count: 1 },
          tenure_type: 'REGULAR', sequence: 1, total_cycles: 0,
          pricing_scheme: { fixed_price: { value: w.price, currency_code: 'USD' } },
        }],
        payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: 'CONTINUE', payment_failure_threshold: 3 },
      },
    });
    ids[w.env] = plan.id;
    console.log(`  created ${w.name.padEnd(36)} ${plan.id}`);
  }

  // Webhook
  let webhookId = previous.PAYPAL_WEBHOOK_ID || env.PAYPAL_WEBHOOK_ID || '';
  if (webhookUrl) {
    const hooks = (await api.request('/v1/notifications/webhooks')).webhooks || [];
    const hit = hooks.find(h => h.url === webhookUrl);
    if (hit) {
      webhookId = hit.id;
      const have = new Set((hit.event_types || []).map(e => e.name));
      const missing = EVENTS.filter(e => !have.has(e));
      if (missing.length) {
        await api.request(`/v1/notifications/webhooks/${hit.id}`, {
          method: 'PATCH', body: [{ op: 'replace', path: '/event_types', value: EVENTS.map(name => ({ name })) }],
        });
        console.log(`  updated webhook ${hit.id} (+${missing.length} events)`);
      } else {
        console.log(`  found   webhook ${hit.id}`);
      }
    } else {
      const hook = await api.request('/v1/notifications/webhooks', {
        method: 'POST', body: { url: webhookUrl, event_types: EVENTS.map(name => ({ name })) },
      });
      webhookId = hook.id;
      console.log(`  created webhook ${hook.id} → ${webhookUrl}`);
    }
  } else {
    console.log('  (no --webhook given: add one later, or the bot will not switch PayPal on)');
  }

  const lines = [
    `# PayPal: generated by scripts/paypal-setup.js (${mode} mode) — paste into the bot host's environment.`,
    '# Git-ignored. Do not commit or share this file.',
    `PAYPAL_ENV=${mode}`,
    `PAYPAL_CLIENT_ID=${clientId}`,
    `PAYPAL_CLIENT_SECRET=${clientSecret}`,
    ...(webhookId ? [`PAYPAL_WEBHOOK_ID=${webhookId}`] : []),
    ...WANT.map(w => `${w.env}=${ids[w.env]}`),
  ];
  // Keep everything else already in the file (Razorpay, the review sign-in…).
  const written = new Set(lines.map(l => l.split('=')[0]));
  const kept = Object.entries(previous).filter(([k]) => !written.has(k)).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(OUT_FILE, [...kept, ...lines, ''].join('\n'), { mode: 0o600 });
  console.log(`\nWrote ${path.relative(process.cwd(), OUT_FILE) || OUT_FILE} — ${lines.length - 2} PayPal values for the bot host.`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
