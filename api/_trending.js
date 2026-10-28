// ═══════════════════════════════════════════════════════════════════════════
//  Today's games — what the landing's hero and cover wall show.
//
//  Shared by the Vercel function (api/trending-games.js) and the Vite dev
//  middleware. The underscore keeps Vercel from deploying it on its own.
//
//  Two public Steam endpoints, no key:
//    * ISteamChartsService/GetMostPlayedGames — the top 100 by daily peak
//      players, with each game's rank last week. Steam rolls it up once a
//      day, which is what makes the page change daily.
//    * IStoreBrowseService/GetItems — names, app type, tags and the hashed
//      asset paths newer games keep their art under, for all 100 in one call.
//
//  The hero wants what is *hot*, not just what is big (the same three
//  shooters top the chart every day), so it ranks by momentum: places
//  climbed since last week, a recent release, and size, in that order.
//  The wall is simply the most played, so between them the page shows both.
//
//  Outbound hosts are fixed; nothing from a request reaches a URL.
// ═══════════════════════════════════════════════════════════════════════════

import { isAllowedArtUrl, normalizeTitle } from './_steamArt.js';

const MOST_PLAYED_URL = 'https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/';
const ITEMS_URL = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';
const ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';

export const HERO_COUNT = 6;
export const WALL_COUNT = 24;

// Store item type 0 is a game; 6 is software (Wallpaper Engine, OBS), 14 a
// mod (FiveM), 2 a tool (tModLoader). Only games make the page.
const TYPE_GAME = 0;
// "Idler" and "Desktop" tags: Bongo Cat and friends chart high on hours
// left running, and are nobody's idea of a game to ask a guide about.
const SKIP_TAGS = new Set([615955, 1320952]);
// Content descriptors 3 (adult only sexual content) and 4 (frequent nudity
// or sexual content) never make the front page.
const SKIP_DESCRIPTORS = new Set([3, 4]);

const DAY = 86400;
const RECENT_DAYS = 45;
// A game with no rank last week (new to the chart) is scored as if it came
// from just below the top 100.
const OFF_CHART = 150;

/** Absolute URL for one of an item's assets, or null if it has none (or it would be unsafe). */
export function assetUrl(assets, key) {
  const file = assets?.[key];
  const format = assets?.asset_url_format;
  if (typeof file !== 'string' || !file || typeof format !== 'string' || !format.includes('${FILENAME}')) return null;
  const url = ASSET_BASE + format.replace('${FILENAME}', file);
  return isAllowedArtUrl(url) ? url : null;
}

/** "Apex Legends™" → "Apex Legends". Marks dropped, whitespace tidied, bounded. */
export function cleanName(name) {
  return String(name || '')
    .replace(/[™®©]/g, '')
    .replace(/\s*[—–]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * Editions of one game share a key, so the page never shows two GTA Vs or
 * two years of the same football game.
 */
export function franchiseKey(name) {
  return normalizeTitle(name)
    .replace(/\b(legacy|enhanced|remastered|definitive edition|game of the year edition|goty)\b/g, '')
    .replace(/\b\d{2}\b/g, '') // EA SPORTS FC 26 / 27
    .replace(/\s+/g, ' ')
    .trim();
}

/** Seconds until the next 00:30 UTC: Steam has rolled the chart over by then. */
export function secondsUntilRollover(now = Date.now()) {
  const d = new Date(now);
  let next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 30);
  if (next <= now) next += DAY * 1000;
  return Math.max(300, Math.round((next - now) / 1000));
}

/** Momentum first, then freshness, then size. Pure, so it is testable. */
export function heatScore({ rank, lastWeekRank, releasedAt }, now = Date.now()) {
  const last = Number.isInteger(lastWeekRank) && lastWeekRank > 0 ? lastWeekRank : OFF_CHART;
  const climb = Math.min(3, Math.max(0, Math.log(last / rank)));
  const ageDays = releasedAt ? (now / 1000 - releasedAt) / DAY : Infinity;
  const fresh = ageDays >= 0 && ageDays <= RECENT_DAYS ? 1 : 0;
  return 1.4 * climb + fresh - 0.35 * Math.log(rank);
}

/** One chart row + its store item → a page-ready game, or null if it doesn't qualify. */
export function toGame(row, item) {
  if (!row || !item || item.success !== 1 || item.visible === false) return null;
  if (item.type !== TYPE_GAME) return null;
  if ((item.tagids || []).some(t => SKIP_TAGS.has(t))) return null;
  if ((item.content_descriptorids || []).some(d => SKIP_DESCRIPTORS.has(d))) return null;
  const name = cleanName(item.name);
  const hero = assetUrl(item.assets, 'library_hero');
  const cover = assetUrl(item.assets, 'library_capsule_2x') || assetUrl(item.assets, 'library_capsule');
  const header = assetUrl(item.assets, 'header');
  if (!name || !hero || !cover) return null;
  return {
    appid: row.appid,
    name,
    hero,
    cover,
    header,
    rank: row.rank,
    lastWeekRank: Number.isInteger(row.last_week_rank) && row.last_week_rank > 0 ? row.last_week_rank : null,
    peak: Number.isInteger(row.peak_in_game) ? row.peak_in_game : null,
    releasedAt: Number.isInteger(item.release?.steam_release_date) ? item.release.steam_release_date : null,
  };
}

/** Distinct by franchise, keeping the first (best) of each. */
function distinct(games, taken = new Set()) {
  const out = [];
  for (const g of games) {
    const k = franchiseKey(g.name);
    if (taken.has(k)) continue;
    taken.add(k);
    out.push(g);
  }
  return out;
}

const HOT_SLOTS = 4;
const BIG_POOL = 12;
// Where the two "biggest" picks sit among the hot ones: the hero opens on
// the hottest game and alternates from there.
const ORDER = ['hot', 'big', 'hot', 'hot', 'big', 'hot'];

/**
 * The hero's six and the wall's 24.
 *   hero: the four hottest, plus two of the day's twelve most played, chosen
 *         by date so even those slots change daily (the top three rarely move).
 *   wall: the most played, none repeated from the hero.
 * Either list may come up short; the client pads the wall.
 */
export function rankGames(ranks, items, now = Date.now()) {
  const byId = new Map((Array.isArray(items) ? items : []).map(i => [i?.appid ?? i?.id, i]));
  const games = distinct((Array.isArray(ranks) ? ranks : [])
    .filter(r => r && Number.isInteger(r.appid) && Number.isInteger(r.rank))
    .sort((a, b) => a.rank - b.rank)
    .map(r => toGame(r, byId.get(r.appid)))
    .filter(Boolean));

  const hot = [...games].sort((a, b) => heatScore(b, now) - heatScore(a, now)).slice(0, HOT_SLOTS);
  const hotIds = new Set(hot.map(g => g.appid));
  const pool = games.filter(g => !hotIds.has(g.appid)).slice(0, BIG_POOL);
  const day = Math.floor(now / 1000 / DAY);
  const big = pool.length
    ? [pool[day % pool.length], pool[(day + Math.ceil(pool.length / 2)) % pool.length]]
      .filter((g, i, a) => a.findIndex(x => x.appid === g.appid) === i)
    : [];

  const hero = [];
  const queues = { hot: [...hot], big: [...big] };
  for (const slot of ORDER) {
    const g = queues[slot].shift() || queues.hot.shift() || queues.big.shift();
    if (g) hero.push({ ...g, why: slot });
  }
  const heroIds = new Set(hero.map(g => g.appid));
  const wall = games
    .filter(g => !heroIds.has(g.appid))
    .slice(0, WALL_COUNT)
    .map(({ appid, name, cover }) => ({ appid, name, cover }));
  return { hero: hero.slice(0, HERO_COUNT), wall };
}

async function getJson(fetchImpl, url, timeoutMs) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'GameGuide-AI/1.0 (landing showcase)', Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`steam ${res.status}`);
  return res.json();
}

export function buildItemsUrl(appids) {
  const input = {
    ids: appids.map(appid => ({ appid })),
    context: { language: 'english', country_code: 'US' },
    data_request: { include_assets: true, include_release: true, include_tag_count: 12 },
  };
  return `${ITEMS_URL}?input_json=${encodeURIComponent(JSON.stringify(input))}`;
}

/**
 * @returns {Promise<{status:number, body:object, cacheControl?:string}>}
 *   body is { date, hero[], wall[] }. Cached at the edge until the next
 *   rollover, so Steam is asked about once a day per region.
 */
export async function resolveTrending({ fetchImpl = fetch, now = Date.now(), timeoutMs = 7000 } = {}) {
  try {
    const chart = await getJson(fetchImpl, MOST_PLAYED_URL, timeoutMs);
    const ranks = chart?.response?.ranks;
    if (!Array.isArray(ranks) || ranks.length < HERO_COUNT) throw new Error('empty chart');
    const ids = ranks.map(r => r?.appid).filter(Number.isInteger).slice(0, 100);
    const store = await getJson(fetchImpl, buildItemsUrl(ids), timeoutMs);
    const { hero, wall } = rankGames(ranks, store?.response?.store_items, now);
    if (hero.length < 3) throw new Error('too few games');
    const rolled = Number.isInteger(chart.response.rollup_date) ? chart.response.rollup_date * 1000 : now;
    const ttl = secondsUntilRollover(now);
    return {
      status: 200,
      cacheControl: `public, max-age=${Math.min(ttl, 3600)}, s-maxage=${ttl}, stale-while-revalidate=86400`,
      body: { date: new Date(rolled).toISOString().slice(0, 10), hero, wall },
    };
  } catch {
    // Never relay upstream error text. The page falls back to its own list.
    return { status: 502, cacheControl: 'public, max-age=60, s-maxage=300', body: { error: 'Unavailable' } };
  }
}
