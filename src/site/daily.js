// Today's games on the client: the landing's hero and cover wall.
//
// /api/trending-games answers with Steam's most-played chart, re-ranked for
// what is hot (see api/_trending.js). The answer is kept in localStorage for
// the rest of the UTC day, so a returning visitor's hero paints at once; a
// first visit waits for one edge-cached request (index.html preloads it).
//
// Accents are sampled from each game's header art in the browser, the same
// way the chat samples them, and saved with the day's list. Until one lands
// the page uses a neutral ink; @property --s-accent then fades to the game's.
//
// Anything wrong (offline, Steam down, a malformed answer) falls back to the
// hand-picked showcase in showcase.js. The page never waits more than
// FETCH_TIMEOUT_MS for the list.

import { isAllowedArtUrl } from '../../api/_steamArt.js';
import { HERO_GAMES, LIBRARY } from './showcase.js';

const STORE_KEY = 'gg.daily.v1';
export const FETCH_TIMEOUT_MS = 1800;
export const PENDING_ACCENT = '#d8d2c4';

export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

const int = (n) => (Number.isInteger(n) && n > 0 ? n : null);

/** One hero entry from the API, checked and narrowed, or null. */
function heroGame(g) {
  if (!g || !int(g.appid) || typeof g.name !== 'string' || !g.name.trim()) return null;
  if (!isAllowedArtUrl(g.hero) || !isAllowedArtUrl(g.cover)) return null;
  return {
    appid: g.appid,
    name: g.name.trim().slice(0, 60),
    hero: g.hero,
    cover: g.cover,
    header: isAllowedArtUrl(g.header) ? g.header : null,
    rank: int(g.rank),
    lastWeekRank: int(g.lastWeekRank),
    peak: int(g.peak),
    why: g.why === 'big' ? 'big' : 'hot',
  };
}

function wallGame(g) {
  if (!g || !int(g.appid) || typeof g.name !== 'string' || !isAllowedArtUrl(g.cover)) return null;
  return { appid: g.appid, name: g.name.trim().slice(0, 60), cover: g.cover };
}

/**
 * The API body → { hero[6], wall[24] }, or null if it can't fill a hero.
 * The wall is padded from the showcase so its three rows of eight stay full.
 */
export function parseDaily(body) {
  const hero = (Array.isArray(body?.hero) ? body.hero : []).map(heroGame).filter(Boolean).slice(0, 6);
  if (hero.length < 3) return null;
  const ids = new Set(hero.map(g => g.appid));
  const wall = [];
  for (const g of [...(Array.isArray(body?.wall) ? body.wall.map(wallGame) : []), ...LIBRARY]) {
    if (!g || ids.has(g.appid) || wall.length >= 24) continue;
    ids.add(g.appid);
    wall.push(g);
  }
  return { date: typeof body?.date === 'string' ? body.date.slice(0, 10) : null, hero, wall };
}

/** The fallback when there is no daily list: the hand-picked showcase. */
export function showcaseDaily() {
  return { source: 'showcase', date: null, hero: HERO_GAMES, wall: LIBRARY };
}

/** Colour each hero game from saved accents; unknown ones get the pending ink. */
export function withAccents(hero, accents = {}) {
  return hero.map(g => ({ ...g, accent: g.accent || accents[g.appid] || PENDING_ACCENT, accentReady: !!(g.accent || accents[g.appid]) }));
}

// ─── Storage ───────────────────────────────────────────────────────────────

export function readStored(storage, now = Date.now()) {
  try {
    const v = JSON.parse(storage?.getItem(STORE_KEY) || 'null');
    if (!v || v.day !== utcDay(now)) return null;
    const daily = parseDaily(v.body);
    return daily ? { daily, accents: v.accents && typeof v.accents === 'object' ? v.accents : {}, body: v.body } : null;
  } catch {
    return null;
  }
}

export function writeStored(storage, body, accents, now = Date.now()) {
  try {
    const clean = {};
    for (const [k, v] of Object.entries(accents || {})) if (/^#[0-9a-f]{6}$/i.test(v)) clean[k] = v;
    storage?.setItem(STORE_KEY, JSON.stringify({ day: utcDay(now), body, accents: clean }));
  } catch { /* storage blocked: this visit only */ }
}

/**
 * The day's API body, or null. Uses the request index.html already started
 * when there is one (once), so a first visit never asks twice.
 */
export async function fetchDaily({ fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS, early = takeEarly() } = {}) {
  try {
    const request = early || fetchImpl('/api/trending-games', { signal: AbortSignal.timeout(timeoutMs) })
      .then(res => (res.ok ? res.json() : null));
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), timeoutMs));
    const body = await Promise.race([request, timeout]);
    return parseDaily(body) ? body : null;
  } catch {
    return null;
  }
}

function takeEarly() {
  if (typeof window === 'undefined' || !window.__ggDaily) return null;
  const p = window.__ggDaily;
  window.__ggDaily = null;
  return p;
}

// ─── The line under the hero ───────────────────────────────────────────────

/** 356917 → "357k", 1244028 → "1.24M". */
export function compact(n) {
  if (!int(n)) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/**
 * What the hero says about a game, from Steam's own numbers:
 *   { rank: 5, move: { kind: 'up', by: 32 } | { kind: 'new' } | null, peak: '357k' }
 * null for showcase games, which have no numbers to show.
 */
export function heroStat(g) {
  if (!g?.rank) return null;
  let move = null;
  if (!g.lastWeekRank) move = { kind: 'new' };
  else if (g.lastWeekRank - g.rank >= 3) move = { kind: 'up', by: g.lastWeekRank - g.rank };
  return { rank: g.rank, move, peak: compact(g.peak) };
}

// ─── The info pages ────────────────────────────────────────────────────────

export const SITE_GAME_KEY = 'gg.site.game.v2';

/**
 * The game the visitor last saw on the landing (saved there by onGame), so
 * About, Terms and Plans open in the same world. Checked like API data;
 * anything off falls back to the first showcase game.
 */
export function lastSiteGame(storage) {
  try {
    const g = JSON.parse(storage?.getItem(SITE_GAME_KEY) || 'null');
    if (g && int(g.appid) && typeof g.name === 'string' && isAllowedArtUrl(g.hero) && /^#[0-9a-f]{6}$/i.test(g.accent)) {
      return { appid: g.appid, name: g.name.slice(0, 60), accent: g.accent, hero: g.hero };
    }
  } catch { /* fall through */ }
  return HERO_GAMES[0];
}
