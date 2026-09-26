// ═══════════════════════════════════════════════════════════════════════════
//  Spoiler Shield preferences for the web client.
//
//  Kept in localStorage so the shield works without an account: the player
//  says "I just beat Margit" once and every later answer about that game stays
//  behind that line, on this device. Sent to the server as prompt context with
//  each question (the Discord bot sends the same shape from its own table).
//
//  Storage can throw (private windows, blocked site data), so every access is
//  guarded and the shield simply falls back to its default: on, no progress.
// ═══════════════════════════════════════════════════════════════════════════

const KEY = 'gg.spoilerShield.v1';
const MAX_GAMES = 30;
const MAX_LEN = 60;

const DEFAULTS = Object.freeze({ mode: 'shield', progress: {} });

function clean(s, max = MAX_LEN) {
  return String(s ?? '').replace(/[\r\n\t|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function loadSpoilerPrefs() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, progress: {} };
    const p = JSON.parse(raw);
    return {
      mode: p?.mode === 'off' ? 'off' : 'shield',
      progress: p?.progress && typeof p.progress === 'object' ? p.progress : {},
    };
  } catch {
    return { ...DEFAULTS, progress: {} };
  }
}

function save(prefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

export function setSpoilerMode(mode) {
  const prefs = loadSpoilerPrefs();
  prefs.mode = mode === 'off' ? 'off' : 'shield';
  return save(prefs) ? prefs : null;
}

/** Record where the player is in a game. Newest games kept; oldest dropped. */
export function setGameProgress(game, where) {
  const g = clean(game).toLowerCase();
  const w = clean(where);
  if (!g || !w) return null;
  const prefs = loadSpoilerPrefs();
  const { [g]: _old, ...rest } = prefs.progress;
  const entries = Object.entries(rest).slice(-(MAX_GAMES - 1));
  prefs.progress = Object.fromEntries([...entries, [g, w]]);
  return save(prefs) ? prefs : null;
}

export function clearGameProgress(game) {
  const prefs = loadSpoilerPrefs();
  if (game) {
    const g = clean(game).toLowerCase();
    const { [g]: _drop, ...rest } = prefs.progress;
    prefs.progress = rest;
  } else {
    prefs.progress = {};
  }
  return save(prefs) ? prefs : null;
}

/**
 * Parse "/progress" arguments: "<game> | <where>", "<game>: <where>" or
 * "<game> - <where>". Returns null when the input has no separator, so the
 * caller can show usage instead of guessing where the game name ends.
 */
export function parseProgressArgs(args) {
  const m = /^(.+?)\s*(?:\||:|\s-\s|—)\s*(.+)$/.exec(String(args || '').trim());
  if (!m) return null;
  const game = clean(m[1]);
  const where = clean(m[2]);
  return game && where ? { game, where } : null;
}
