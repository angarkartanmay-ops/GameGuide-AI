#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  Billing go-live — everything after "the keys are in .env", in one go.
//  ───────────────────────────────────────────────────────────────────────
//     node scripts/billing-go-live.js              do every step that can run
//     node scripts/billing-go-live.js --diagnose   only: the Render service's
//                                                  state and its latest logs
//
//  Reads discord-bot/.env (the five pasted values) and .env.render, then:
//    1. Razorpay  → scripts/razorpay-setup.js   (six rupee plans, webhook secret)
//    2. PayPal    → scripts/paypal-setup.js     (product, six dollar plans, webhook)
//    3. Render    → copies the billing values to the bot service's environment,
//                   redeploys it, waits until it is live (logs if it is not)
//    4. Checks    → scripts/billing-check.js --bot <BOT_PUBLIC_URL>
//  and finally lists what only a human can do (the Razorpay webhook form).
//  Any step whose keys are missing is skipped and said so. Never prints a secret.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
const loadEnv = () => ({ ...readEnvFile(path.join(BOT, '.env')), ...readEnvFile(path.join(BOT, '.env.render')), ...process.env });

let env = loadEnv();
const BOT_URL = (env.BOT_PUBLIC_URL || 'https://gameguide-bot.onrender.com').replace(/\/+$/, '');
const SITE_URL = (env.SITE_URL || 'https://gameguide.online').replace(/\/+$/, '');
const diagnoseOnly = process.argv.includes('--diagnose');
const left = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const step = (n, t) => console.log(`\n── ${n}. ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`);

function run(script, args = []) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { cwd: BOT, stdio: 'inherit' });
  return r.status === 0;
}

// ─── Render ────────────────────────────────────────────────────────────────

async function render(method, url, body) {
  const res = await fetch(`https://api.render.com/v1${url}`, {
    method,
    headers: { Authorization: `Bearer ${env.RENDER_API_KEY}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error(`render ${res.status}${data?.message ? `: ${String(data.message).slice(0, 120)}` : ''}`);
  return data;
}

async function findService() {
  const host = new URL(BOT_URL).hostname;
  const list = await render('GET', '/services?limit=50');
  const services = (list || []).map(x => x.service || x);
  return services.find(s => (s.serviceDetails?.url || '').includes(host))
    || services.find(s => s.name === 'gameguide-bot') || null;
}

async function printLogs(svc, limit = 40) {
  try {
    const q = new URLSearchParams({ ownerId: svc.ownerId, resource: svc.id, limit: String(limit), direction: 'backward' });
    const out = await render('GET', `/logs?${q}`);
    const logs = (out?.logs || []).reverse();
    if (!logs.length) return console.log('  (no recent logs)');
    console.log(`  Last ${logs.length} log lines:`);
    for (const l of logs) console.log(`    ${String(l.timestamp || '').slice(11, 19)}  ${String(l.message || '').slice(0, 220)}`);
  } catch (e) {
    console.log(`  (could not read logs: ${e.message})`);
  }
}

async function latestDeploy(svc) {
  const d = await render('GET', `/services/${svc.id}/deploys?limit=1`);
  return (d?.[0]?.deploy) || d?.[0] || null;
}

async function diagnose(svc) {
  console.log(`  Service ${svc.name} (${svc.id}) · ${svc.type || ''} · branch ${svc.branch || '?'} · ${svc.suspended === 'suspended' ? 'SUSPENDED' : 'not suspended'}`);
  console.log(`  Repo ${svc.repo || '?'} · auto-deploy ${svc.autoDeploy || '?'} · plan ${svc.serviceDetails?.plan || '?'}`);
  const d = await latestDeploy(svc);
  if (d) console.log(`  Latest deploy ${d.id}: ${d.status} (${d.commit?.message ? d.commit.message.split('\n')[0].slice(0, 70) : 'no commit info'}) at ${d.finishedAt || d.createdAt || '?'}`);
  await printLogs(svc);
}

// Values the bot needs for billing. Only these are copied to Render: the
// rest of the bot's environment is already there and is left alone.
const RENDER_KEYS = [
  'UPGRADE_LINK_SECRET', 'REVIEW_LOGIN_EMAIL', 'REVIEW_LOGIN_PASSWORD',
  'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
  'RAZORPAY_PLAN_BASE', 'RAZORPAY_PLAN_BASE_YEARLY', 'RAZORPAY_PLAN_PRO', 'RAZORPAY_PLAN_PRO_YEARLY',
  'RAZORPAY_PLAN_SERVER', 'RAZORPAY_PLAN_SERVER_YEARLY',
  'PAYPAL_ENV', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID',
  'PAYPAL_PLAN_BASE', 'PAYPAL_PLAN_BASE_YEARLY', 'PAYPAL_PLAN_PRO', 'PAYPAL_PLAN_PRO_YEARLY',
  'PAYPAL_PLAN_SERVER', 'PAYPAL_PLAN_SERVER_YEARLY',
];

async function goRender() {
  if (!env.RENDER_API_KEY) {
    console.log('  skipped: RENDER_API_KEY is empty in discord-bot/.env');
    left.push('Paste RENDER_API_KEY into discord-bot/.env (Render → Account Settings → API Keys) so the bot host can be configured.');
    return false;
  }
  const svc = await findService();
  if (!svc) {
    console.log(`  No Render service serves ${BOT_URL}.`);
    left.push('The Render API key cannot see the bot service: check it belongs to the account that owns gameguide-bot.');
    return false;
  }
  if (diagnoseOnly) { await diagnose(svc); return true; }

  if (svc.suspended === 'suspended') {
    await render('POST', `/services/${svc.id}/resume`);
    console.log('  resumed the suspended service');
  }
  const values = { ...Object.fromEntries(RENDER_KEYS.filter(k => env[k]).map(k => [k, env[k]])), SITE_URL };
  for (const [key, value] of Object.entries(values)) await render('PUT', `/services/${svc.id}/env-vars/${key}`, { value });
  console.log(`  set ${Object.keys(values).length} environment values on ${svc.name}: ${Object.keys(values).join(', ')}`);

  const dep = await render('POST', `/services/${svc.id}/deploys`, { clearCache: 'do_not_clear' });
  const id = dep?.id || dep?.deploy?.id;
  console.log(`  deploying (${id}) from branch ${svc.branch || '?'} …`);
  const until = Date.now() + 15 * 60_000;
  let status = '';
  while (Date.now() < until) {
    await sleep(15_000);
    const d = await render('GET', `/services/${svc.id}/deploys/${id}`);
    if (d.status !== status) console.log(`  … ${d.status}`);
    status = d.status;
    if (['live', 'build_failed', 'update_failed', 'canceled', 'deactivated', 'pre_deploy_failed'].includes(status)) break;
  }
  if (status !== 'live') {
    console.log(`  The deploy did not go live (${status || 'timed out'}).`);
    await printLogs(svc);
    left.push('The bot did not deploy cleanly on Render — the log lines above say why.');
    return false;
  }
  // A free Render service sleeps; give it time to answer.
  for (let i = 0; i < 12; i++) {
    try { if ((await fetch(`${BOT_URL}/health`, { signal: AbortSignal.timeout(20_000) })).ok) { console.log('  bot is answering /health'); return true; } } catch { /* waking */ }
    await sleep(10_000);
  }
  console.log('  live, but /health did not answer in time');
  await printLogs(svc);
  return false;
}

(async () => {
  if (diagnoseOnly) {
    step(1, 'Render service');
    await goRender();
    return;
  }

  step(1, 'Razorpay');
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
    if (!run('razorpay-setup.js')) left.push('Razorpay setup failed — see the message above (wrong or expired keys?).');
  } else {
    console.log('  skipped: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are empty in discord-bot/.env');
    left.push('Paste RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (Test mode) into discord-bot/.env.');
  }

  step(2, 'PayPal');
  if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) {
    if (!run('paypal-setup.js', ['--webhook', `${BOT_URL}/paypal-webhook`])) left.push('PayPal setup failed — see the message above.');
  } else {
    console.log('  skipped: PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are empty in discord-bot/.env');
    left.push('Paste PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (Sandbox app) into discord-bot/.env.');
  }
  env = loadEnv();   // pick up what the setup scripts wrote

  step(3, 'Render (the bot host)');
  let live = false;
  try { live = await goRender(); } catch (e) { console.log(`  ${e.message}`); left.push(`Render step failed: ${e.message}`); }

  step(4, 'Checks against the real providers');
  run('billing-check.js', live ? ['--bot', BOT_URL] : []);

  if (env.RAZORPAY_WEBHOOK_SECRET) {
    left.push([
      'Razorpay webhook (Razorpay has no API for this, so it is a form):',
      '   Dashboard (Test mode) → Account & Settings → Webhooks → Add New Webhook',
      `   URL:     ${BOT_URL}/razorpay-webhook`,
      '   Secret:  the RAZORPAY_WEBHOOK_SECRET line in discord-bot/.env.render',
      '   Events:  subscription.activated, .charged, .pending, .halted, .cancelled, .completed,',
      '            .paused, .resumed, .updated, payment_link.paid, refund.processed, payment.dispute.created',
    ].join('\n'));
  }
  console.log('\n══ Left for a human ═══════════════════════════════════════════');
  console.log(left.length ? left.map(l => `• ${l}`).join('\n') : 'Nothing. Billing is live in test mode.');
})().catch((e) => { console.error(e.message); process.exit(1); });
