// Today's landing games: the server ranker (api/_trending.js) and the
// client's parsing, caching and wording (src/site/daily.js). Steam is never
// called; every response here is a fixture shaped like the real ones.

import {
  assetUrl, cleanName, franchiseKey, heatScore, toGame, rankGames, secondsUntilRollover,
  resolveTrending, buildItemsUrl, HERO_COUNT, WALL_COUNT,
} from '../api/_trending.js';
import {
  parseDaily, withAccents, readStored, writeStored, fetchDaily, heroStat, compact,
  lastSiteGame, utcDay, PENDING_ACCENT, SITE_GAME_KEY,
} from '../src/site/daily.js';
import { isAllowedArtUrl } from '../api/_steamArt.js';
import { HERO_GAMES, LIBRARY } from '../src/site/showcase.js';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

const NOW = Date.UTC(2026, 9, 10, 12, 0); // 10 Oct 2026, noon UTC
const DAY = 86400;

function assets(appid, { hero = true, cover = true } = {}) {
  return {
    asset_url_format: `steam/apps/${appid}/\${FILENAME}?t=1791504829`,
    ...(hero ? { library_hero: `${'a'.repeat(40)}/library_hero.jpg` } : {}),
    ...(cover ? { library_capsule: `${'b'.repeat(40)}/library_capsule.jpg`, library_capsule_2x: `${'b'.repeat(40)}/library_capsule_2x.jpg` } : {}),
    header: `${'c'.repeat(40)}/header.jpg`,
  };
}
function item(appid, name, extra = {}) {
  return { appid, id: appid, success: 1, visible: true, type: 0, name, assets: assets(appid), tagids: [], ...extra };
}

// ── Pieces ─────────────────────────────────────────────────────────────────
{
  const url = assetUrl(assets(42), 'library_hero');
  check('asset URL is on the shared CDN', url === `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/42/${'a'.repeat(40)}/library_hero.jpg?t=1791504829`, url);
  check('asset URL passes the art allow-list', isAllowedArtUrl(url));
  check('missing asset → null', assetUrl(assets(42, { hero: false }), 'library_hero') === null);
  check('format without a placeholder → null', assetUrl({ asset_url_format: 'x', header: 'h.jpg' }, 'header') === null);
  check('a quote in the path is refused', assetUrl({ asset_url_format: 'steam/apps/1/${FILENAME}', header: 'a").jpg' }, 'header') === null);
}
check('trademark marks dropped', cleanName('Apex Legends™') === 'Apex Legends');
check('Steam\'s em-dashes dropped', cleanName('The Witcher 3: Wild Hunt — Remastered') === 'The Witcher 3: Wild Hunt Remastered');
check('names are bounded', cleanName('x'.repeat(200)).length === 60);
check('GTA V editions share a key', franchiseKey('Grand Theft Auto V Legacy') === franchiseKey('Grand Theft Auto V Enhanced'));
check('two FC years share a key', franchiseKey('EA SPORTS FC™ 26') === franchiseKey('EA SPORTS FC™ 27'));
check('sequels stay apart', franchiseKey('Hades') !== franchiseKey('Hades II'));

check('a climber outscores a bigger game standing still',
  heatScore({ rank: 9, lastWeekRank: 59 }, NOW) > heatScore({ rank: 1, lastWeekRank: 1 }, NOW));
check('a recent release gets a lift',
  heatScore({ rank: 20, lastWeekRank: 20, releasedAt: NOW / 1000 - 5 * DAY }, NOW) > heatScore({ rank: 20, lastWeekRank: 20, releasedAt: NOW / 1000 - 400 * DAY }, NOW));
check('new to the chart counts as a climb', heatScore({ rank: 30, lastWeekRank: null }, NOW) > heatScore({ rank: 30, lastWeekRank: 30 }, NOW));
check('falling never scores below standing still', heatScore({ rank: 10, lastWeekRank: 3 }, NOW) === heatScore({ rank: 10, lastWeekRank: 10 }, NOW));

const row = (rank, appid, last = rank, peak = 1000) => ({ rank, appid, last_week_rank: last, peak_in_game: peak });
check('software is not a game', toGame(row(1, 431960), item(431960, 'Wallpaper Engine', { type: 6 })) === null);
check('idlers are skipped', toGame(row(1, 5), item(5, 'Bongo Cat', { tagids: [615955] })) === null);
check('adult content is skipped', toGame(row(1, 6), item(6, 'X', { content_descriptorids: [3] })) === null);
check('no hero art, no place', toGame(row(1, 7), { ...item(7, 'Y'), assets: assets(7, { hero: false }) }) === null);
check('an unsuccessful lookup is skipped', toGame(row(1, 8), { ...item(8, 'Z'), success: 2 }) === null);
{
  const g = toGame(row(5, 9, -1, 356917), item(9, 'AION 2', { release: { steam_release_date: 1791205224 } }));
  check('a game keeps its numbers', g && g.rank === 5 && g.peak === 356917 && g.releasedAt === 1791205224);
  check('rank -1 last week reads as new', g && g.lastWeekRank === null);
  check('cover prefers the 2x capsule', g && /library_capsule_2x/.test(g.cover));
}

// ── Ranking ────────────────────────────────────────────────────────────────
// 40 steady games, plus some movers and some things that must never show.
const ranks = [];
const items = [];
for (let r = 1; r <= 40; r++) {
  const appid = 1000 + r;
  ranks.push(row(r, appid));
  items.push(item(appid, `Steady no${r}`));
}
const mover = (rank, last, appid, name, extra) => {
  const i = ranks.findIndex(x => x.rank === rank);
  ranks[i] = row(rank, appid, last);
  items.push(item(appid, name, extra));
};
mover(5, 37, 1, 'Riser A', { release: { steam_release_date: NOW / 1000 - 5 * DAY } });
mover(9, 59, 2, 'Riser B');
mover(16, 52, 3, 'Riser C');
mover(25, 160, 4, 'Riser D');
mover(4, 4, 431960, 'Wallpaper Engine', { type: 6 });
mover(10, 10, 271590, 'Grand Theft Auto V Legacy');
mover(33, 31, 3240220, 'Grand Theft Auto V Enhanced');
{
  const { hero, wall } = rankGames(ranks, items, NOW);
  check('six in the hero', hero.length === HERO_COUNT, hero.length);
  check('the hottest opens the hero', hero[0].name === 'Riser A', hero[0].name);
  check('four hot, two big', hero.filter(g => g.why === 'hot').length === 4 && hero.filter(g => g.why === 'big').length === 2);
  check('hot ones are the risers', ['Riser A', 'Riser B', 'Riser C', 'Riser D'].every(n => hero.some(g => g.name === n && g.why === 'hot')));
  check('big ones come from the top twelve', hero.filter(g => g.why === 'big').every(g => g.rank <= 16));
  check('software never shows', ![...hero, ...wall].some(g => g.name === 'Wallpaper Engine'));
  check('one GTA V at most', [...hero, ...wall].filter(g => /Grand Theft Auto/.test(g.name)).length <= 1);
  check('the wall is full', wall.length === WALL_COUNT, wall.length);
  check('the wall repeats nothing from the hero', !wall.some(w => hero.some(h => h.appid === w.appid)));
  check('the wall runs in chart order', wall.every((g, i) => i === 0 || ranks.findIndex(r => r.appid === g.appid) > ranks.findIndex(r => r.appid === wall[i - 1].appid)));
  check('wall entries carry only what the wall needs', Object.keys(wall[0]).sort().join() === 'appid,cover,name');
  const tomorrow = rankGames(ranks, items, NOW + DAY * 1000).hero.filter(g => g.why === 'big').map(g => g.appid).join();
  const today = hero.filter(g => g.why === 'big').map(g => g.appid).join();
  check('the big picks rotate day to day', tomorrow !== today, `${today} vs ${tomorrow}`);
}
check('garbage in, nothing out', rankGames(null, null, NOW).hero.length === 0 && rankGames([{}], [{}], NOW).wall.length === 0);

check('cache lasts until 00:30 UTC tomorrow', secondsUntilRollover(NOW) === 12.5 * 3600);
check('just before 00:30 it waits for the same day',secondsUntilRollover(Date.UTC(2026, 9, 11, 0, 20)) === 600);
check('cache never under five minutes', secondsUntilRollover(Date.UTC(2026, 9, 11, 0, 29, 50)) === 300);
check('items URL is fixed to Steam', buildItemsUrl([1, 2]).startsWith('https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json='));

// ── The handler's resolver ─────────────────────────────────────────────────
function fakeFetch(map) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const key = Object.keys(map).find(k => url.startsWith(k));
    const v = key ? map[key] : null;
    if (v instanceof Error) throw v;
    return { ok: !!v, status: v ? 200 : 500, json: async () => v };
  };
  return { impl, calls };
}
{
  const { impl, calls } = fakeFetch({
    'https://api.steampowered.com/ISteamChartsService/': { response: { rollup_date: 1791504000, ranks } },
    'https://api.steampowered.com/IStoreBrowseService/': { response: { store_items: items } },
  });
  const r = await resolveTrending({ fetchImpl: impl, now: NOW });
  check('resolver answers 200', r.status === 200, r.status);
  check('date is the chart\'s rollup day', r.body.date === '2026-10-09', r.body.date);
  check('edge cache runs to the rollover', /s-maxage=45000\b/.test(r.cacheControl), r.cacheControl);
  check('only Steam\'s API host is called', calls.length === 2 && calls.every(u => u.startsWith('https://api.steampowered.com/')));
  check('every URL in the answer is allowed art', [...r.body.hero.flatMap(g => [g.hero, g.cover, g.header]), ...r.body.wall.map(g => g.cover)].every(isAllowedArtUrl));
}
{
  const { impl } = fakeFetch({ 'https://api.steampowered.com/ISteamChartsService/': new Error('secret upstream detail') });
  const r = await resolveTrending({ fetchImpl: impl, now: NOW });
  check('a failure is a 502', r.status === 502);
  check('upstream text never leaks', !JSON.stringify(r.body).includes('secret'));
  check('failures cache briefly', /max-age=60/.test(r.cacheControl));
}
{
  const { impl } = fakeFetch({ 'https://api.steampowered.com/ISteamChartsService/': { response: { ranks: [] } } });
  check('an empty chart is a failure, not an empty hero', (await resolveTrending({ fetchImpl: impl, now: NOW })).status === 502);
}

// ── Client ─────────────────────────────────────────────────────────────────
const { body: liveBody } = await resolveTrending({
  fetchImpl: fakeFetch({
    'https://api.steampowered.com/ISteamChartsService/': { response: { rollup_date: 1791504000, ranks } },
    'https://api.steampowered.com/IStoreBrowseService/': { response: { store_items: items } },
  }).impl,
  now: NOW,
});
{
  const d = parseDaily(liveBody);
  check('client reads the server\'s answer', d && d.hero.length === 6 && d.wall.length === 24);
  const short = parseDaily({ ...liveBody, wall: liveBody.wall.slice(0, 5) });
  check('a short wall is padded to 24 from the showcase', short.wall.length === 24 && short.wall.some(g => LIBRARY.some(l => l.appid === g.appid)));
  check('padding never repeats a game', new Set(short.wall.map(g => g.appid)).size === 24);
  const evil = { ...liveBody, hero: liveBody.hero.map((g, i) => (i === 0 ? { ...g, hero: 'https://evil.example/x.jpg' } : g)) };
  check('art off Steam\'s CDN is dropped', parseDaily(evil).hero.length === 5);
  check('fewer than three heroes is no daily list', parseDaily({ hero: liveBody.hero.slice(0, 2) }) === null);
  check('junk is no daily list', parseDaily(null) === null && parseDaily({ hero: 'x' }) === null);
  const coloured = withAccents(d.hero, { [d.hero[0].appid]: '#123456' });
  check('known accents are used', coloured[0].accent === '#123456' && coloured[0].accentReady);
  check('unknown accents wait in ink', coloured[1].accent === PENDING_ACCENT && coloured[1].accentReady === false);
  check('showcase games keep their own accents', withAccents(HERO_GAMES)[0].accent === HERO_GAMES[0].accent);
}
{
  const data = {};
  const mem = { getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  writeStored(mem, liveBody, { 1: '#abcdef', 2: 'red; }' }, NOW);
  const back = readStored(mem, NOW + 3600e3);
  check('the day\'s list is kept', back && back.daily.hero.length === 6);
  check('only hex accents are saved', back.accents[1] === '#abcdef' && !(2 in back.accents));
  check('it expires at the UTC day\'s end', readStored(mem, Date.UTC(2026, 9, 11, 0, 1)) === null);
  check('blocked storage is harmless', readStored({ getItem() { throw new Error('no'); } }, NOW) === null);
  writeStored({ setItem() { throw new Error('full'); } }, liveBody, {}, NOW);
  check('utcDay is ISO', utcDay(NOW) === '2026-10-10');
}
{
  const early = Promise.resolve(liveBody);
  let called = 0;
  const body = await fetchDaily({ early, fetchImpl: async () => { called++; return null; } });
  check('the early request is used, not a second one', body === liveBody && called === 0);
  const slow = await fetchDaily({ early: new Promise(() => {}), timeoutMs: 30 });
  check('a slow answer times out to null', slow === null);
  const bad = await fetchDaily({ early: null, fetchImpl: async () => ({ ok: false }) });
  check('an error answer is null', bad === null);
}
check('compact numbers', compact(356917) === '357k' && compact(1244028) === '1.24M' && compact(1500) === '1.5k' && compact(980) === '980' && compact(null) === '');
check('a climber says how far', heroStat({ rank: 5, lastWeekRank: 37, peak: 356917 })?.move?.by === 32);
check('a newcomer says new', heroStat({ rank: 90, lastWeekRank: null })?.move?.kind === 'new');
check('small moves are not news', heroStat({ rank: 9, lastWeekRank: 10 })?.move === null);
check('showcase games have no stat', heroStat(HERO_GAMES[0]) === null);
{
  const mem = (v) => ({ getItem: k => (k === SITE_GAME_KEY ? v : null) });
  const good = JSON.stringify({ appid: 9, name: 'AION 2', accent: '#aabbcc', hero: liveBody.hero[0].hero });
  check('info pages reuse the last game', lastSiteGame(mem(good)).name === 'AION 2');
  check('…but not with foreign art', lastSiteGame(mem(JSON.stringify({ appid: 9, name: 'x', accent: '#aabbcc', hero: 'https://evil.example/a.jpg' }))) === HERO_GAMES[0]);
  check('…or a bad accent', lastSiteGame(mem(JSON.stringify({ appid: 9, name: 'x', accent: 'red', hero: liveBody.hero[0].hero }))) === HERO_GAMES[0]);
  check('…or junk', lastSiteGame(mem('{oops')) === HERO_GAMES[0] && lastSiteGame(null) === HERO_GAMES[0]);
}
check('showcase games carry their own art', HERO_GAMES.every(g => isAllowedArtUrl(g.hero) && isAllowedArtUrl(g.cover)) && LIBRARY.every(g => isAllowedArtUrl(g.cover)));

console.log(`trending: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
