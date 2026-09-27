// ↑ ↑ ↓ ↓ ← → ← → B A — the landing page's secret. A pure matcher: the
// listener feeds it keys and keeps the returned position.

export const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
];

const norm = (key) => (typeof key === 'string' && key.length === 1 ? key.toLowerCase() : key);

/**
 * Feed one key. Returns the new position and whether the code just completed.
 * A wrong key doesn't always start over: "↑ ↑ ↑ ↓ ↓…" still counts, because
 * the longest tail of what was typed that begins the code is kept.
 */
export function advance(pos, key) {
  const k = norm(key);
  if (k === KONAMI[pos]) {
    return pos + 1 === KONAMI.length ? { pos: 0, done: true } : { pos: pos + 1, done: false };
  }
  const typed = [...KONAMI.slice(0, pos), k];
  for (let len = Math.min(typed.length, KONAMI.length - 1); len > 0; len--) {
    const tail = typed.slice(-len);
    if (tail.every((t, i) => t === KONAMI[i])) return { pos: len, done: false };
  }
  return { pos: 0, done: false };
}

/** Keys typed into a field belong to the field, not the secret. */
export function isTypingTarget(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = String(el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}
