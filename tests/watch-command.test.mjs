// /watch — the real interaction handler in discord-bot/index.js, driven with
// fake interactions. discord.js login is stubbed (no gateway), the repo is an
// in-memory fake, and Steam lookups are canned — everything else, including
// the permission checks and reply copy, is the production code path.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'discord-bot');
const require = createRequire(join(BOT, 'package.json'));

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

Object.assign(process.env, {
  SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  DISCORD_TOKEN: 'fake', PORT: '0', WATCHTOWER_ENABLED: '0', KEEPALIVE_URL: '',
});

// ── stubs ──────────────────────────────────────────────────────────────────
const discord = require('discord.js');
const { ChannelType, PermissionFlagsBits: P } = discord;
let client = null;
discord.Client.prototype.login = function () { client = this; return Promise.resolve('ok'); };

const rows = [];
let nextId = 1;
let premium = false;
const fakeRepo = {
  async listGuildWatches(g) { return rows.filter(r => r.guild_id === g).map(r => ({ ...r })); },
  async guildIsPremium() { return premium; },
  async upsertWatch(row) {
    const hit = rows.find(r => r.guild_id === row.guild_id && r.channel_id === row.channel_id && r.steam_appid === row.steam_appid);
    if (hit) { Object.assign(hit, row, { paused_reason: null }); return { id: hit.id }; }
    const r = { id: nextId++, paused_reason: null, ...row };
    rows.push(r);
    return { id: r.id };
  },
  async deleteWatches(ids) { for (const id of ids) rows.splice(rows.findIndex(r => r.id === id), 1); },
  async deleteGuild(g) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].guild_id === g) rows.splice(i, 1); },
  async deleteChannel(c) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].channel_id === c) rows.splice(i, 1); },
};
const watchtower = require('./watchtower.js');
watchtower.supabaseRepo = () => fakeRepo;
const cheapshark = require('./cheapshark.js');
cheapshark.fetchJson = async (url) => {
  if (url.includes('storesearch')) {
    const term = decodeURIComponent(url.match(/term=([^&]+)/)[1]).toLowerCase();
    const catalog = [
      { type: 'app', id: 1245620, name: 'ELDEN RING' },
      { type: 'app', id: 374320, name: 'DARK SOULS III' },
      { type: 'app', id: 570940, name: 'DARK SOULS: REMASTERED' },
    ];
    return { items: catalog.filter(a => a.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').includes(term.replace(/[^a-z0-9 ]/g, '').split(' ')[0])) };
  }
  if (url.includes('GetNewsForApp')) {
    return { appnews: { newsitems: [{ gid: '9', title: 'Patch 1.16', date: 1790000000, feedname: 'steam_community_announcements', feed_type: 1, tags: ['patchnotes'] }] } };
  }
  return null;
};

require('./index.js');
await new Promise(r => setTimeout(r, 50));
check('bot booted with login stubbed', !!client);
client.user = { id: '1499622566472712202', tag: 'GameGuide#0001' };

// ── fake interactions ──────────────────────────────────────────────────────
const G = '1400000000000000001';
const chan = (id, { bot = [P.ViewChannel, P.SendMessages, P.EmbedLinks], user = [P.ViewChannel, P.SendMessages], type = ChannelType.GuildText } = {}) => ({
  id, type,
  permissionsFor: (who) => {
    const set = who === client.user ? bot : user;
    return { has: (p) => (Array.isArray(p) ? p : [p]).every(x => set.includes(x)) };
  },
});
const GENERAL = chan('1400000000000000010');
const MODS = chan('1400000000000000011', { user: [] });
const LOCKED = chan('1400000000000000012', { bot: [P.ViewChannel, P.SendMessages] });
const THREAD = chan('1400000000000000013', { type: ChannelType.PublicThread });

async function run(sub, opts = {}, { channel = GENERAL, inGuild = true } = {}) {
  const out = { replies: [] };
  const record = (kind) => async (p) => { out.replies.push({ kind, content: typeof p === 'string' ? p : p?.content, flags: p?.flags }); };
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'watch',
    user: { id: '1400000000000000099' },
    member: { id: '1400000000000000099' },
    guildId: inGuild ? G : null,
    inGuild: () => inGuild,
    channel,
    deferred: false, replied: false,
    options: {
      getSubcommand: () => sub,
      getString: (k) => opts[k] ?? null,
      getChannel: (k) => opts[k] ?? null,
    },
    reply: record('reply'),
    deferReply: async (p) => { interaction.deferred = true; out.replies.push({ kind: 'defer', flags: p?.flags }); },
    editReply: record('edit'),
  };
  client.emit('interactionCreate', interaction);
  await new Promise(r => setTimeout(r, 30));
  out.text = out.replies.map(r => r.content || '').join('\n');
  return out;
}

// ── add ────────────────────────────────────────────────────────────────────
{
  const r = await run('add', { game: 'elden ring' });
  check('add: watching the resolved game', /Watching ELDEN RING/.test(r.text), r.text);
  check('add: shows the latest patch as proof', r.text.includes('Patch 1.16'));
  check('add: reply is private', r.replies.every(x => x.kind === 'edit' || x.flags));
  check('add: saved with default alerts', rows.length === 1 && rows[0].news === 'patches' && rows[0].deals === false);
  check('add: channel id stored as the exact snowflake', rows[0].channel_id === GENERAL.id);
}
{
  const r = await run('add', { game: 'elden ring', alerts: 'patches+deals' });
  check('re-add updates instead of duplicating', rows.length === 1 && rows[0].deals === true && /Updated/.test(r.text), r.text);
}
{
  const r = await run('add', { game: 'elden ring', channel: MODS });
  check('mod cannot aim the bot at a channel they cannot post in', /can't post in/.test(r.text) && rows.length === 1, r.text);
  const r2 = await run('add', { game: 'elden ring', channel: LOCKED });
  check('missing Embed Links is named', /Embed Links/.test(r2.text) && rows.length === 1, r2.text);
  const r3 = await run('add', { game: 'elden ring' }, { channel: THREAD });
  check('threads are refused with a reason', /text or announcement channel/.test(r3.text));
  const r4 = await run('add', { game: 'zzzz no such game' });
  check('unknown game: nothing saved', /couldn't find/.test(r4.text) && rows.length === 1, r4.text);
  const r5 = await run('list', {}, { inGuild: false });
  check('outside a server: explained, nothing thrown', /inside a server/.test(r5.text), r5.text);
}
{
  // Free limit: 3.
  await run('add', { game: 'dark souls iii' });
  await run('add', { game: 'dark souls remastered' });
  const r = await run('add', { game: 'elden ring', channel: chan('1400000000000000020') });
  check('free servers stop at 3', rows.length === 3 && /3\/3/.test(r.text) && /premium/.test(r.text), r.text);
  premium = true;
  const r2 = await run('add', { game: 'elden ring', channel: chan('1400000000000000020') });
  check('Server plan lifts the limit', rows.length === 4, r2.text);
}

// ── list / remove ──────────────────────────────────────────────────────────
{
  const r = await run('list');
  check('list shows every watch with its channel', (r.text.match(/<#\d+>/g) || []).length === 4, r.text);
  const vague = await run('remove', { game: 'dark' });
  check('a vague term matching two games deletes nothing', rows.length === 4 && /use the full name/.test(vague.text), vague.text);
  const one = await run('remove', { game: 'e' });
  check('a one-letter term cannot wipe the list', rows.length === 4, one.text);
  const exact = await run('remove', { game: 'elden ring' });
  check('exact name removes that game in every channel', rows.length === 2 && /Stopped/.test(exact.text), exact.text);
  const byPart = await run('remove', { game: 'iii' });
  check('a partial naming one game removes it', rows.length === 1 && rows[0].game_name === 'DARK SOULS: REMASTERED', byPart.text);
}

// ── lifecycle cleanup ──────────────────────────────────────────────────────
{
  client.emit('channelDelete', { id: rows[0].channel_id, guildId: G });
  await new Promise(r => setTimeout(r, 10));
  check('deleting the channel deletes its watches', rows.length === 0);
  await run('add', { game: 'elden ring' });
  client.emit('guildDelete', { id: G, available: false });
  await new Promise(r => setTimeout(r, 10));
  check('an outage (guild unavailable) keeps the config', rows.length === 1);
  client.emit('guildDelete', { id: G, available: true });
  await new Promise(r => setTimeout(r, 10));
  check('removing the bot deletes the server\'s watches', rows.length === 0);
}

console.log(`watch-command: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
