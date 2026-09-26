// Recent games for the empty state's cover shelf. Per-device convenience only
// (localStorage, guarded): nothing breaks when storage is blocked, and stealth
// never writes here.

const KEY = 'gg.recentGames.v1';
const MAX = 8;

// Shown when the player has no history yet. Well-known Steam appids, so the
// shelf renders real covers straight from Steam's CDN with no lookup.
export const CURATED = [
  { key: 'elden ring', name: 'Elden Ring', appid: 1245620 },
  { key: "baldur's gate 3", name: "Baldur's Gate 3", appid: 1086940 },
  { key: 'cyberpunk 2077', name: 'Cyberpunk 2077', appid: 1091500 },
  { key: 'hades ii', name: 'Hades II', appid: 1145350 },
  { key: 'helldivers 2', name: 'Helldivers 2', appid: 553850 },
  { key: 'hollow knight', name: 'Hollow Knight', appid: 367520 },
];

export const coverUrl = (appid) => `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`;

const keyOf = (name) => String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Newest first, one entry per game, at most `max`. Pure. */
export function addRecent(list, entry, max = MAX) {
  const name = String(entry?.name || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 80) return list;
  const key = keyOf(name);
  const next = { key, name, ...(Number.isInteger(entry.appid) ? { appid: entry.appid } : {}) };
  return [next, ...(list || []).filter(e => e?.key !== key)].slice(0, max);
}

/**
 * The shelf: recent games first (with where the player is, from Spoiler
 * Shield progress), then games that only have progress, then curated picks.
 */
export function buildShelf(recent, progress = {}, curated = CURATED, max = 6) {
  const out = [];
  const seen = new Set();
  const push = (e) => {
    if (!e?.key || seen.has(e.key) || out.length >= max) return;
    seen.add(e.key);
    out.push({ ...e, progress: progress[e.key] || e.progress || null });
  };
  for (const e of recent || []) push(e);
  for (const k of Object.keys(progress || {})) {
    const known = curated.find(c => c.key === k);
    push(known || { key: k, name: k.replace(/\b([a-z])/g, (m) => m.toUpperCase()) });
  }
  for (const c of curated) push(c);
  return out;
}

export function loadRecentGames() {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter(e => e && typeof e.key === 'string' && typeof e.name === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberGame(entry) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(addRecent(loadRecentGames(), entry)));
  } catch { /* storage blocked: the shelf just falls back to curated picks */ }
}
