// The live count on the landing page — players, answers and games, read from
// gg_public_stats() (supabase/migrations/20261002_public_stats.sql).
//
// Real numbers or nothing: if the function isn't deployed, the call fails or
// the reply is malformed, the count simply doesn't render. It never falls back
// to a made-up figure.

const CACHE_KEY = 'gg.site.stats';
const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 4000;

/** Below this many players the line stays hidden (raise it if you'd rather wait). */
export const SHOW_FROM_PLAYERS = 1;

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

/** Validate the RPC reply. Returns { players, answers, games } or null. */
export function parseStats(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { players, answers, games } = raw;
  if (![players, answers, games].every(isCount)) return null;
  return { players, answers, games };
}

/** 1,284 · 12.4k · 1.2M — exact while small, compact once it isn't. */
export function formatCount(n) {
  if (!isCount(n)) return '';
  if (n < 10_000) return n.toLocaleString('en-US');
  const [div, unit] = n < 1_000_000 ? [1_000, 'k'] : [1_000_000, 'M'];
  const v = Math.floor((n / div) * 10) / 10;
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}${unit}`;
}

const part = (n, one, many) => ({ value: formatCount(n), label: n === 1 ? one : many });

/**
 * The pieces of the line, in reading order: [{ value: '1,284', label: 'players' }, …].
 * Empty when there's nothing honest to show.
 */
export function statParts(stats) {
  if (!stats || stats.players < SHOW_FROM_PLAYERS) return [];
  const parts = [part(stats.players, 'player', 'players')];
  if (stats.answers > 0) parts.push(part(stats.answers, 'answer researched', 'answers researched'));
  if (stats.games > 0) parts.push(part(stats.games, 'game', 'games'));
  return parts;
}

/** The same line as plain text, for screen readers and titles. */
export function statSentence(parts) {
  return parts.map(p => `${p.value} ${p.label}`).join(', ');
}

function readCache(now) {
  try {
    const hit = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (hit && now - hit.at < CACHE_MS) return parseStats(hit.stats);
  } catch { /* storage blocked — just fetch */ }
  return null;
}

function writeCache(stats, now) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, stats })); } catch { /* fine */ }
}

/** Fetch once per visit. Resolves to stats or null; never throws. */
export async function fetchPublicStats(client, now = Date.now()) {
  const cached = readCache(now);
  if (cached) return cached;
  try {
    const call = client.rpc('gg_public_stats');
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ error: 'timeout' }), TIMEOUT_MS));
    const { data, error } = await Promise.race([call, timeout]);
    if (error) return null;
    const stats = parseStats(data);
    if (stats) writeCache(stats, now);
    return stats;
  } catch {
    return null;
  }
}
