// Small pure helpers the chat shell uses to know which game is in context and
// what the pipeline is doing. Kept out of components so they can be tested.

// Retrieval runs before the first token exists, so the wait is several seconds
// of nothing. Naming the stage turns a blank spinner into visible progress.
export const STAGE_COPY = {
  'searching': 'Searching live sources…',
  'scanning-sources': 'Reading wikis, patch notes and community threads…',
  'reading-image': 'Reading your screenshot…',
  'identifying-game': 'Identifying the game…',
  'generating': 'Thinking…',
  'streaming': 'Writing…',
};

/**
 * useChat encodes an optional detail as "stage:detail". Split on the FIRST
 * colon only: game titles have colons of their own ("Clair Obscur:
 * Expedition 33"), and splitting on every one cut the title short.
 */
export function parseStreamStage(streamStage) {
  if (!streamStage) return { stage: null, detail: null };
  const s = String(streamStage);
  const i = s.indexOf(':');
  if (i === -1) return { stage: s, detail: null };
  const detail = s.slice(i + 1).trim();
  return { stage: s.slice(0, i), detail: detail || null };
}

export function stageLabel(streamStage) {
  const { stage } = parseStreamStage(streamStage);
  return (stage && STAGE_COPY[stage]) || null;
}

/** "Elden Ring™ " → "elden ring" — one key per game however it was typed. */
export function normalizeGameKey(name) {
  return String(name || '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function titleCase(s) {
  return String(s || '').replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** The game named by the newest answer (slash-command replies don't count). */
export function latestGameFromMessages(messages) {
  for (let i = (messages?.length || 0) - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.sender !== 'ai' || m.isCommand || m.streaming) continue;
    const g = m.meta?.game;
    if (typeof g === 'string' && g.trim()) return g.trim();
  }
  return null;
}

/** The newest answer's Spoiler Shield state, for the context pill. */
export function latestSpoilerMeta(messages) {
  for (let i = (messages?.length || 0) - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.sender === 'ai' && !m.isCommand && m.meta?.spoiler) return m.meta.spoiler;
  }
  return null;
}
