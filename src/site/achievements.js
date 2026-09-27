// Landing-page achievements. Kept per session (a returning visitor gets to
// earn them again) and entirely optional: blocked storage just means they
// aren't remembered across reloads.

export const ACHIEVEMENTS = [
  { id: 'tutorial', title: 'Tutorial complete', text: 'Watched an answer come together.' },
  { id: 'spoiler-safe', title: 'Spoiler-safe', text: 'Told the guide where you are.' },
  { id: 'collector', title: 'Collector', text: 'Looked through five games in the library.' },
  { id: 'menu-diver', title: 'Menu diver', text: 'Opened four entries in the loadout.' },
  { id: 'watchman', title: 'Watchman', text: 'Saw Watchtower post into a server.' },
  { id: 'old-school', title: 'Old school', text: 'Entered the code. Arcade mode is on.' },
];

const KEY = 'gg.site.achievements.v1';
const IDS = new Set(ACHIEVEMENTS.map(a => a.id));

/**
 * A small store over any Storage-like object. `unlock` returns the
 * achievement only the first time, so callers can toast exactly once.
 */
export function createAchievements(storage) {
  let unlocked = new Set();
  try {
    const raw = storage?.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) unlocked = new Set(list.filter(id => IDS.has(id)));
  } catch { /* unreadable storage: start empty */ }

  const listeners = new Set();
  const save = () => {
    try { storage?.setItem(KEY, JSON.stringify([...unlocked])); } catch { /* quota / blocked: keep in memory */ }
  };

  return {
    has: (id) => unlocked.has(id),
    count: () => unlocked.size,
    total: ACHIEVEMENTS.length,
    unlock(id) {
      if (!IDS.has(id) || unlocked.has(id)) return null;
      unlocked.add(id);
      save();
      const a = ACHIEVEMENTS.find(x => x.id === id);
      listeners.forEach(fn => fn(a));
      return a;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

let shared = null;
/** The page-wide store (sessionStorage when it's available). */
export function achievements() {
  if (!shared) {
    let storage = null;
    try { storage = typeof window !== 'undefined' ? window.sessionStorage : null; } catch { storage = null; }
    shared = createAchievements(storage);
  }
  return shared;
}
