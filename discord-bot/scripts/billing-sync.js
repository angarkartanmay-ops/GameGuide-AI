#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  Billing sync — apply paid Razorpay subscriptions the bot never heard about.
//  ───────────────────────────────────────────────────────────────────────
//     node scripts/billing-sync.js            show what would be applied
//     node scripts/billing-sync.js --apply    deliver it to the bot
//
//  Webhooks can be lost: a wrong secret in the Razorpay form (every event is
//  refused), the bot down past Razorpay's retry window, a webhook added after
//  the purchase. This asks Razorpay's API — the source of truth — for every
//  ACTIVE subscription that carries a Discord id, keeps the best one per
//  person (highest plan, then newest), and delivers it to the bot's own
//  /razorpay-webhook as a signed `subscription.activated`, so the normal
//  rules apply (once per event, upgrades stop the older plan, a DM to the
//  buyer). Duplicates are listed, not applied.
//
//  It also checks that the webhook secret on the bot host (Render) is the
//  one in .env.render, since a mismatch there looks exactly like a mismatch
//  in the Razorpay form. Never prints a secret.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { razorpayConfig } = require('../billing-razorpay');
const { PERSONAL_RANK } = require('../plans');

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
const BOT_URL = (env.BOT_PUBLIC_URL || '').replace(/\/+$/, '');
const apply = process.argv.includes('--apply');
const cfg = razorpayConfig(env);

if (!cfg || !BOT_URL) {
  console.error('Needs the Razorpay keys, RAZORPAY_WEBHOOK_SECRET (.env.render) and BOT_PUBLIC_URL.');
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`;
async function rzp(url) {
  const res = await fetch(`https://api.razorpay.com/v1${url}`, { headers: { Authorization: auth } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`razorpay ${res.status}: ${data?.error?.description || ''}`);
  return data;
}

async function renderSecretMatches() {
  if (!env.RENDER_API_KEY) return null;
  const h = { Authorization: `Bearer ${env.RENDER_API_KEY}`, Accept: 'application/json' };
  const list = await (await fetch('https://api.render.com/v1/services?limit=50', { headers: h })).json();
  const host = new URL(BOT_URL).hostname;
  const svc = (list || []).map(x => x.service || x).find(s => (s.serviceDetails?.url || '').includes(host));
  if (!svc) return null;
  const vars = await (await fetch(`https://api.render.com/v1/services/${svc.id}/env-vars?limit=100`, { headers: h })).json();
  const v = (vars || []).map(x => x.envVar || x).find(e => e.key === 'RAZORPAY_WEBHOOK_SECRET');
  return !!v && crypto.timingSafeEqual(crypto.createHash('sha256').update(String(v.value)).digest(), crypto.createHash('sha256').update(cfg.webhookSecret).digest());
}

(async () => {
  const match = await renderSecretMatches().catch(() => null);
  console.log(`Bot host webhook secret: ${match === null ? 'could not check' : match ? 'matches .env.render' : 'DIFFERS from .env.render — re-run billing-go-live.js'}`);

  const planOf = (id) => Object.entries(cfg.plans).find(([, v]) => v && v === id)?.[0]?.replace(/_yearly$/, '') || null;
  const subs = (await rzp('/subscriptions?count=100')).items || [];
  const live = subs.filter(s => s.status === 'active' && /^\d{17,20}$/.test(String(s.notes?.discord_user_id || '')) && planOf(s.plan_id));

  // The best one per person (or per server, for server plans).
  const best = new Map();
  const extra = [];
  const rank = (s) => (planOf(s.plan_id) === 'server' ? 0 : PERSONAL_RANK[planOf(s.plan_id)] ?? 0);
  for (const s of live) {
    const key = planOf(s.plan_id) === 'server' ? `g:${s.notes.discord_guild_id}` : `u:${s.notes.discord_user_id}`;
    const cur = best.get(key);
    if (!cur || rank(s) > rank(cur) || (rank(s) === rank(cur) && s.created_at > cur.created_at)) {
      if (cur) extra.push(cur);
      best.set(key, s);
    } else extra.push(s);
  }

  console.log(`\n${live.length} active subscription(s) with a Discord id; ${best.size} to apply.`);
  for (const s of best.values()) {
    const line = `  ${s.id}  ${planOf(s.plan_id).padEnd(6)} user ${s.notes.discord_user_id}  paid ${s.paid_count}x  until ${new Date(s.current_end * 1000).toISOString().slice(0, 10)}`;
    if (!apply) { console.log(`${line}  (dry run)`); continue; }
    const body = JSON.stringify({ entity: 'event', event: 'subscription.activated', payload: { subscription: { entity: s } }, created_at: Math.floor(Date.now() / 1000) });
    const sig = crypto.createHmac('sha256', cfg.webhookSecret).update(body).digest('hex');
    let status = 0;
    try {
      const res = await fetch(`${BOT_URL}/razorpay-webhook`, {
        method: 'POST', signal: AbortSignal.timeout(90_000),
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig, 'X-Razorpay-Event-Id': `sync_${s.id}_${s.current_end}` },
        body,
      });
      status = res.status;
    } catch (e) { status = e.name; }
    console.log(`${line}  → bot answered ${status}`);
  }
  if (extra.length) {
    console.log('\nNot applied (the same person already has a plan above — these keep billing until cancelled):');
    for (const s of extra) console.log(`  ${s.id}  ${planOf(s.plan_id)}  user ${s.notes.discord_user_id}  created ${new Date(s.created_at * 1000).toISOString().slice(0, 16)}`);
  }
  if (!apply) console.log('\nRun again with --apply to deliver.');
})().catch((e) => { console.error(e.message); process.exit(1); });
