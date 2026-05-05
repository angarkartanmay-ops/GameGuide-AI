// Detects whether a user query is asking about CURRENT/NEWEST/LATEST state.
// Triggers the PULSE pipeline ONLY for these queries to keep token costs low.

export interface TemporalSignal {
  isTemporal: boolean;
  reasons: string[];           // which patterns matched (for telemetry)
  subject: string | null;      // what they want the latest of, e.g. "hero", "card", "patch"
}

const TEMPORAL_PATTERNS: Array<{ rx: RegExp; reason: string }> = [
  { rx: /\b(new(?:est)?|latest|current|recent|just released|this (?:season|month|week|year|patch|update))\b/i, reason: 'recency-word' },
  { rx: /\b(202[4-9]|20[3-9]\d)\b/, reason: 'recent-year' },
  { rx: /\b(season|patch|update|version)\s+\d+/i, reason: 'season-number' },
  { rx: /\bwhat'?s\s+(new|happening|out)\b/i, reason: 'whats-new' },
  { rx: /\b(meta|tier list|tierlist)\b/i, reason: 'meta-query' },
  { rx: /\b(today|right now|currently)\b/i, reason: 'now-word' },
  { rx: /\b(release date|when (?:did|does|will))\b/i, reason: 'release-query' },
];

const SUBJECT_PATTERNS: Array<{ rx: RegExp; subject: string }> = [
  { rx: /\b(hero|champion|brawler|operator|legend|character|agent)\b/i, subject: 'character' },
  { rx: /\b(card|troop|spell|building)\b/i, subject: 'card' },
  { rx: /\b(weapon|gun|skin|cosmetic|bundle)\b/i, subject: 'item' },
  { rx: /\b(map|mode|game ?mode|playlist)\b/i, subject: 'mode' },
  { rx: /\b(patch|update|version|season|event)\b/i, subject: 'patch' },
  { rx: /\b(tier list|meta)\b/i, subject: 'meta' },
];

export function detectTemporal(prompt: string): TemporalSignal {
  const reasons: string[] = [];
  for (const p of TEMPORAL_PATTERNS) {
    if (p.rx.test(prompt)) reasons.push(p.reason);
  }
  let subject: string | null = null;
  for (const s of SUBJECT_PATTERNS) {
    if (s.rx.test(prompt)) { subject = s.subject; break; }
  }
  return { isTemporal: reasons.length > 0, reasons, subject };
}
