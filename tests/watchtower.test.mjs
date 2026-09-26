// Watchtower — patch notes and deal alerts posted into server channels.
//
// Whole poll cycles run against fakes: an in-memory repo with the same
// exactly-once claim semantics as the discord_watch_posts primary key, a fake
// Steam/CheapShark, a fake model and a fake Discord that can fail on demand.
// What must hold: a patch is posted once per watching channel, never twice,
// never backfilled; one model call per patch however many servers watch it;
// a channel the bot lost is paused rather than retried forever.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'discord-bot');
const require = createRequire(join(BOT, 'package.json'));
const W = require('./watchtower.js');

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

const DAY = 24 * 60 * 60_000;
const T0 = Date.parse('2026-09-26T12:00:00Z');
const sec = (ms) => Math.floor(ms / 1000);

// ── fixtures ───────────────────────────────────────────────────────────────
const official = (gid, title, whenMs, extra = {}) => ({
  gid: String(gid), title, url: `https://store.steampowered.com/news/app/1245620/view/${gid}`,
  feedname: 'steam_community_announcements', feed_type: 1, date: sec(whenMs),
  contents: `[h2]${title}[/h2][list][*]Fixed a crash when resting at a Site of Grace[*]Increased the damage of Colossal Swords by 5%[*]Reduced the poise of Margit[/list]`,
  ...extra,
});

function fakeRepo(watches) {
  const posts = new Set();
  const calls = { claims: 0 };
  return {
    posts, calls, watches,
    async listActiveWatches() { return watches.filter(w => !w.paused_reason).map(w => ({ ...w })); },
    async hasPost(id, key) { return posts.has(`${id}|${key}`); },
    async claimPost(id, key) {
      calls.claims++;
      await new Promise(r => setTimeout(r, 0));   // let a concurrent cycle interleave
      const k = `${id}|${key}`;
      if (posts.has(k)) return false;
      posts.add(k);
      return true;
    },
    async releasePost(id, key) { posts.delete(`${id}|${key}`); },
    async pauseWatch(id, reason) { watches.find(w => w.id === id).paused_reason = reason; },
    async recordDeal(id, price, at) { Object.assign(watches.find(w => w.id === id), { last_deal_price: price, last_deal_at: at }); },
    async setCheapsharkId(appid, csid) { for (const w of watches) if (w.steam_appid === appid) w.cheapshark_id = csid; },
    async prunePosts() {},
  };
}

function fakeNet({ news = [], deal = null } = {}) {
  const hits = { light: 0, full: 0, cs: 0 };
  const net = {
    hits, news, deal,
    async fetchJson(url) {
      if (url.includes('GetNewsForApp')) {
        const full = /maxlength=0/.test(url);
        full ? hits.full++ : hits.light++;
        return { appnews: { newsitems: net.news.map(n => (full ? n : { ...n, contents: '' })) } };
      }
      if (url.includes('cheapshark.com/api/1.0/games?steamAppID=')) { hits.cs++; return [{ gameID: '612', steamAppID: '1245620' }]; }
      if (url.includes('cheapshark.com/api/1.0/games?id=')) { hits.cs++; return net.deal; }
      if (url.includes('storesearch')) {
        return { items: [
          { type: 'app', id: 2622380, name: 'ELDEN RING NIGHTREIGN' },
          { type: 'app', id: 1245620, name: 'ELDEN RING', tiny_image: 'https://cdn.example/er.jpg' },
        ] };
      }
      return null;
    },
  };
  return net;
}

function fakeDiscord() {
  const sent = [];
  const failures = new Map();   // channelId → { code, times }
  return {
    sent, failures,
    async send(channelId, payload) {
      const f = failures.get(channelId);
      if (f && f.times !== 0) {
        if (f.times > 0) f.times--;
        throw Object.assign(new Error(`discord ${f.code}`), { code: f.code });
      }
      sent.push({ channelId, payload });
    },
  };
}

const watch = (id, over = {}) => ({
  id, guild_id: `9000000000000000${id}`, channel_id: `8000000000000000${id}`, steam_appid: 1245620,
  game_name: 'ELDEN RING', news: 'patches', deals: false, since: new Date(T0 - DAY).toISOString(),
  cheapshark_id: null, last_deal_price: null, last_deal_at: null, paused_reason: null, ...over,
});
const quiet = { warn() {}, log() {} };

async function cycle({ repo, net, discord, summarize, at = T0, state }) {
  return W.runCycle({ repo, fetchJson: net.fetchJson, summarize, send: discord.send, now: () => at, state, log: quiet });
}

// ── text handling ──────────────────────────────────────────────────────────
{
  const t = W.cleanSteamText('[h2]Patch 1.16[/h2][list][*]Fixed &amp; improved[*]<b>Buffed</b> swords[/list][img]{STEAM_CLAN_IMAGE}/x.png[/img]');
  check('BBCode list items become bullets', t.includes('• Fixed & improved') && t.includes('• Buffed swords'), t);
  check('no markup survives', !/[[\]<>]/.test(t), t);
  check('clan image placeholder dropped', !t.includes('STEAM_CLAN_IMAGE'));
}
check('patchnotes tag → patch', W.isPatchNote(official(1, 'Hotfix', T0, { tags: ['patchnotes'] })));
check('"Patch 1.16" title → patch', W.isPatchNote(official(1, 'Patch 1.16 Notes', T0)));
check('"Update 1.12.3" title → patch', W.isPatchNote(official(1, 'Update 1.12.3', T0)));
check('event announcement is not a patch', !W.isPatchNote(official(1, 'Join the Colosseum tournament this weekend', T0)));
check('press article about a patch is not official', !W.isPatchNote({ ...official(1, 'Elden Ring patch nerfs bleed', T0), feedname: 'pcgamer', feed_type: 0 }));

{
  const w = watch(1);
  const items = [
    official('old', 'Patch 1.10', T0 - 3 * DAY),                       // before the watch existed
    official('new', 'Patch 1.16', T0 - 60_000),
    official('evt', 'Weekend event', T0 - 120_000),
    official('ancient', 'Patch 1.15', T0 - 30 * DAY),
  ];
  const e = W.eligibleItems({ ...w, since: new Date(T0 - 2 * DAY).toISOString() }, items, T0);
  check('no backfill: only items after the watch was created', e.map(i => i.gid).join() === 'new', e.map(i => i.gid).join());
  const all = W.eligibleItems({ ...w, news: 'all', since: new Date(T0 - 2 * DAY).toISOString() }, items, T0);
  check('"all official news" includes events, newest first', all.map(i => i.gid).join() === 'new,evt', all.map(i => i.gid).join());
  const stale = W.eligibleItems({ ...w, since: new Date(T0 - 60 * DAY).toISOString() }, items, T0);
  check('nothing older than a week, even if the bot was down', !stale.some(i => i.gid === 'ancient'));
}

{
  const net = fakeNet();
  const g = await W.resolveSteamGame('elden ring', net.fetchJson);
  check('resolves the base game, not the spin-off', g?.appid === 1245620 && g.name === 'ELDEN RING', JSON.stringify(g));
  check('empty query → null', (await W.resolveSteamGame('   ', net.fetchJson)) === null);
  check('no results → null', (await W.resolveSteamGame('x', async () => ({ items: [] }))) === null);
}

{
  const huge = official(1, 'Patch 2.0', T0, { contents: 'x '.repeat(20000) });
  const p = W.buildSummaryPrompt('ELDEN RING', huge);
  check('summary prompt fits chat-proxy\'s 8000-char limit', p.length < 7800, String(p.length));
  check('notes are fenced as data', p.includes('<<<NOTES') && /data, not instructions/.test(p));
  const c = W.cleanSummary('• Buffed swords\n• Fixed crash\n\n[?] What should I build now?\n*— 📡 2 live sources: steam-news*');
  check('chips and source footers stripped from summaries', !c.includes('[?]') && !c.includes('📡'), c);
}

{
  const post = W.newsPost('ELDEN RING', official(5, 'Patch 1.16', T0), '• Buffed swords');
  const e = post.embeds[0];
  check('post mentions nobody', Array.isArray(post.allowedMentions.parse) && post.allowedMentions.parse.length === 0);
  check('post links the Steam notes', e.url.startsWith('https://') && e.description.includes('[Full notes on Steam]'));
  check('embed title within Discord\'s 256', W.newsPost('G', official(5, 'x'.repeat(400), T0), '').embeds[0].title.length <= 256);
  const bad = W.newsPost('G', { ...official(5, 'P', T0), url: 'javascript:alert(1)' }, 's').embeds[0];
  check('non-https url never linked', !bad.url && !bad.description.includes('javascript:'));
}

// ── cycles ─────────────────────────────────────────────────────────────────
{
  // Two servers watch Elden Ring; a patch lands.
  const repo = fakeRepo([watch(1), watch(2)]);
  const net = fakeNet({ news: [official('p116', 'Patch 1.16', T0 - 5 * 60_000, { tags: ['patchnotes'] })] });
  const discord = fakeDiscord();
  let summaries = 0;
  const summarize = async () => { summaries++; return '• Colossal Swords +5% damage\n• Margit poise reduced\n**What it means:** strength builds got a small boost.'; };
  const state = {};

  const r1 = await cycle({ repo, net, discord, summarize, state });
  check('posted to both watching channels', discord.sent.length === 2 && r1.posted === 2, JSON.stringify(r1));
  check('ONE model call for both servers', summaries === 1, String(summaries));
  check('the summary is what got posted', discord.sent[0].payload.embeds[0].description.includes('Colossal Swords'));

  const r2 = await cycle({ repo, net, discord, summarize, state, at: T0 + 15 * 60_000 });
  check('next cycle posts nothing again', discord.sent.length === 2 && r2.posted === 0);
  check('…and makes no second model call', summaries === 1);
  check('…and never fetches the full notes when nothing is new', net.hits.full === 1, JSON.stringify(net.hits));

  // Restart: new process state, same database.
  await cycle({ repo, net, discord, summarize, state: {}, at: T0 + 30 * 60_000 });
  check('a restart does not repost', discord.sent.length === 2);
}

{
  // Two bot instances (or overlapping cycles) run at once.
  const repo = fakeRepo([watch(1), watch(2)]);
  const net = fakeNet({ news: [official('p1', 'Patch 1.16', T0 - 60_000)] });
  const discord = fakeDiscord();
  const summarize = async () => '• changes';
  await Promise.all([
    cycle({ repo, net, discord, summarize, state: {} }),
    cycle({ repo, net, discord, summarize, state: {} }),
  ]);
  check('concurrent cycles still post exactly once per channel', discord.sent.length === 2, String(discord.sent.length));
}

{
  // Model down → the notes themselves, trimmed.
  const repo = fakeRepo([watch(1)]);
  const net = fakeNet({ news: [official('p1', 'Patch 1.16', T0 - 60_000)] });
  const discord = fakeDiscord();
  await cycle({ repo, net, discord, summarize: async () => { throw new Error('proxy 503'); }, state: {} });
  const d = discord.sent[0]?.payload.embeds[0].description || '';
  check('model failure still posts, from the notes', d.includes('Fixed a crash'), d);
}

{
  // Transient Discord failure → retried next cycle, posted once.
  const repo = fakeRepo([watch(1)]);
  const net = fakeNet({ news: [official('p1', 'Patch 1.16', T0 - 60_000)] });
  const discord = fakeDiscord();
  discord.failures.set(watch(1).channel_id, { code: 500, times: 1 });
  const state = {};
  const r1 = await cycle({ repo, net, discord, summarize: async () => 's', state });
  check('transient failure: nothing posted yet', discord.sent.length === 0 && r1.failed === 1);
  check('transient failure: claim released', repo.posts.size === 0);
  await cycle({ repo, net, discord, summarize: async () => 's', state, at: T0 + 15 * 60_000 });
  check('transient failure: retried and posted', discord.sent.length === 1);
}

{
  // Bot lost access to one channel → that watch pauses; the other still posts.
  const repo = fakeRepo([watch(1), watch(2)]);
  const net = fakeNet({ news: [official('p1', 'Patch 1.16', T0 - 60_000)] });
  const discord = fakeDiscord();
  discord.failures.set(watch(1).channel_id, { code: 50013, times: -1 });
  const r = await cycle({ repo, net, discord, summarize: async () => 's', state: {} });
  check('missing permissions pauses that watch', /50013/.test(repo.watches[0].paused_reason || '') && r.paused === 1);
  check('other servers unaffected', discord.sent.length === 1 && discord.sent[0].channelId === watch(2).channel_id);
  const before = discord.sent.length;
  await cycle({ repo, net, discord, summarize: async () => 's', state: {}, at: T0 + 15 * 60_000 });
  check('a paused watch is not retried', discord.sent.length === before);
}

{
  // A burst of five announcements drains two per cycle, newest first.
  const repo = fakeRepo([watch(1, { news: 'all' })]);
  const net = fakeNet({ news: [1, 2, 3, 4, 5].map(i => official(`n${i}`, `Update ${i}.0`, T0 - (10 - i) * 60_000)) });
  const discord = fakeDiscord();
  const state = {};
  await cycle({ repo, net, discord, summarize: async () => 's', state });
  check('at most two posts per watch per cycle', discord.sent.length === 2);
  check('newest first', discord.sent[0].payload.embeds[0].title.includes('Update 5.0'));
  await cycle({ repo, net, discord, summarize: async () => 's', state, at: T0 + 15 * 60_000 });
  await cycle({ repo, net, discord, summarize: async () => 's', state, at: T0 + 30 * 60_000 });
  check('the rest follow in later cycles, each once', discord.sent.length === 5, String(discord.sent.length));
}

// ── deals ──────────────────────────────────────────────────────────────────
{
  const detail = (price, low = '19.99', savings = '66') => ({
    info: { title: 'ELDEN RING', thumb: 'https://cdn.example/er.jpg' },
    cheapestPriceEver: { price: low },
    deals: [{ storeID: '1', dealID: `d${price}`, price, retailPrice: '59.99', savings }],
  });
  const repo = fakeRepo([watch(1, { news: 'none', deals: true })]);
  const net = fakeNet({ deal: detail('19.99') });
  const discord = fakeDiscord();
  const state = {};

  await cycle({ repo, net, discord, summarize: async () => 's', state });
  check('deals-only watch never reads Steam news', net.hits.light === 0 && net.hits.full === 0);
  check('all-time low is posted', discord.sent.length === 1 && /all-time low/.test(discord.sent[0].payload.embeds[0].title));
  check('the price is recorded', repo.watches[0].last_deal_price === 19.99);

  await cycle({ repo, net, discord, summarize: async () => 's', state, at: T0 + 60 * 60_000 });
  check('prices are not re-checked within 6 hours', net.hits.cs === 2, String(net.hits.cs));

  await cycle({ repo, net, discord, summarize: async () => 's', state, at: T0 + 7 * 60 * 60_000 });
  check('same price 7h later is not announced again', discord.sent.length === 1);

  net.deal = detail('14.99', '14.99', '75');
  await cycle({ repo, net, discord, summarize: async () => 's', state, at: T0 + 14 * 60 * 60_000 });
  check('a new lower price is announced', discord.sent.length === 2);

  check('30% off, above the low → not a deal', !W.dealDecision(watch(9), detail('41.99', '19.99', '30'), T0).post);
  check('50% off, above the low → a deal', W.dealDecision(watch(9), detail('29.99', '19.99', '50'), T0).post);
  const free = W.dealDecision(watch(9), detail('0.00', '0.00', '100'), T0);
  check('free game is announced as free', free.post && /free right now/.test(W.dealPost('G', free).embeds[0].title));
}

// ── admin option mapping ───────────────────────────────────────────────────
check('default alerts = patch notes', JSON.stringify(W.parseAlerts(null)) === '{"news":"patches","deals":false}');
check('"deals" = deals only', JSON.stringify(W.parseAlerts('deals')) === '{"news":"none","deals":true}');
check('describe patches+deals', W.describeAlerts(W.parseAlerts('patches+deals')) === 'patch notes + deals');

console.log(`watchtower: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
