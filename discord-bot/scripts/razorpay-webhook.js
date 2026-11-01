#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  Razorpay webhook — everything the dashboard form needs, secret on the
//  clipboard.
//  ───────────────────────────────────────────────────────────────────────
//     node scripts/razorpay-webhook.js
//
//  Razorpay has no API for adding a webhook, so it is a form. The usual way
//  it goes wrong is the secret: copying the whole RAZORPAY_WEBHOOK_SECRET=…
//  line, or a stray space, and every event is then refused by the bot with
//  "signature verification failed". This copies ONLY the secret's value to
//  the clipboard (it is never printed) and prints the rest of the form.
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
const env = { ...readEnvFile(path.join(BOT, '.env')), ...readEnvFile(path.join(BOT, '.env.render')), ...process.env };
const secret = (env.RAZORPAY_WEBHOOK_SECRET || '').trim();
const bot = (env.BOT_PUBLIC_URL || 'https://gameguide-bot-7cf4.onrender.com').replace(/\/+$/, '');
const mode = (env.RAZORPAY_KEY_ID || '').startsWith('rzp_live_') ? 'LIVE' : 'TEST';

if (!secret) {
  console.error('No RAZORPAY_WEBHOOK_SECRET in discord-bot/.env.render — run node scripts/billing-go-live.js first.');
  process.exit(1);
}

// The platform's clipboard tool; the secret goes in on stdin, never argv.
const tools = process.platform === 'win32' ? [['clip']]
  : process.platform === 'darwin' ? [['pbcopy']]
    : [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']];
const copied = tools.some(([cmd, ...args]) => spawnSync(cmd, args, { input: secret }).status === 0);

console.log(`Razorpay dashboard → switch to ${mode} MODE (top bar) → Account & Settings → Webhooks`);
console.log('Edit the existing GameGuide webhook (or Add New Webhook) and set:\n');
console.log(`  Webhook URL   ${bot}/razorpay-webhook`);
console.log(`  Secret        ${copied ? 'PASTE (Ctrl+V): it is on your clipboard now' : 'could not reach the clipboard: open discord-bot/.env.render and double-click the value after RAZORPAY_WEBHOOK_SECRET='}`);
console.log('                (clear the field first; 48 characters, nothing else)');
console.log('  Alert email   your email');
console.log('  Active events subscription.activated  subscription.charged  subscription.pending');
console.log('                subscription.halted  subscription.cancelled  subscription.completed');
console.log('                subscription.paused  subscription.resumed  subscription.updated');
console.log('                payment_link.paid  refund.processed  payment.dispute.created');
console.log('\nSave. Then check it took: node scripts/billing-go-live.js --diagnose');
console.log('(no new "[razorpay] signature verification failed" lines = fixed).');
console.log('Anything paid while it was wrong: node scripts/billing-sync.js --apply');
