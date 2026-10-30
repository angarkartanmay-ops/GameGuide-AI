#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  Put the GameGuide brand on Discord: the bot's avatar and profile banner,
//  and the application icon (what the App Directory, top.gg and invite
//  screens show). Images come from brand/ (node brand/render.mjs).
//
//     node scripts/brand-discord.js
//
//  Uses DISCORD_TOKEN from discord-bot/.env. Discord rate-limits avatar
//  changes (a couple per hour), so run it once per rebrand.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BOT = path.join(__dirname, '..');
const BRAND = path.join(BOT, '..', 'brand');
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return out;
}
const env = { ...readEnvFile(path.join(BOT, '.env')), ...process.env };
const token = (env.DISCORD_TOKEN || '').trim();
if (!token) { console.error('DISCORD_TOKEN is not set in discord-bot/.env'); process.exit(1); }

const dataUri = (file) => `data:image/png;base64,${fs.readFileSync(path.join(BRAND, file)).toString('base64')}`;

async function discord(method, route, body) {
  const res = await fetch(`https://discord.com/api/v10${route}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = data?.message || '';
    const retry = data?.retry_after ? ` (retry in ${Math.ceil(data.retry_after)}s)` : '';
    throw new Error(`${res.status} ${why}${retry}`.trim());
  }
  return data;
}

(async () => {
  let ok = true;
  try {
    const me = await discord('PATCH', '/users/@me', { avatar: dataUri('discord-avatar.png'), banner: dataUri('discord-banner.png') });
    console.log(`✓ bot ${me.username}: avatar ${me.avatar ? 'set' : 'missing'}, banner ${me.banner ? 'set' : 'missing'}`);
  } catch (e) {
    ok = false;
    console.log(`✗ bot avatar/banner: ${e.message}`);
  }
  try {
    const app = await discord('PATCH', '/applications/@me', { icon: dataUri('discord-avatar.png') });
    console.log(`✓ application ${app.name}: icon ${app.icon ? 'set' : 'missing'}`);
  } catch (e) {
    ok = false;
    console.log(`✗ application icon: ${e.message}`);
  }
  process.exit(ok ? 0 : 1);
})();
