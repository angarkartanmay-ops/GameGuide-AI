// Detects whether a user query is asking about CURRENT/NEWEST/LATEST state.
// Triggers the PULSE pipeline for these queries.
//
// v2: Much more aggressive detection — catches implicit temporal queries like
// "which hero is Clash Royale releasing" (no explicit "new" or "latest" keyword,
// but clearly asking about current/upcoming content).

export interface TemporalSignal {
  isTemporal: boolean;
  reasons: string[];           // which patterns matched (for telemetry)
  subject: string | null;      // what they want the latest of, e.g. "hero", "card", "patch"
}

const TEMPORAL_PATTERNS: Array<{ rx: RegExp; reason: string }> = [
  // Explicit recency words
  { rx: /\b(new(?:est)?|latest|current|recent(?:ly)?|just released|upcoming|releasing|coming out|this (?:season|month|week|year|patch|update))\b/i, reason: 'recency-word' },
  // Year mentions (2024-2029)
  { rx: /\b(202[4-9]|20[3-9]\d)\b/, reason: 'recent-year' },
  // Season/patch with number
  { rx: /\b(season|patch|update|version)\s+\d+/i, reason: 'season-number' },
  // "What's new/happening/out"
  { rx: /\bwhat'?s\s+(new|happening|out|changed|different)\b/i, reason: 'whats-new' },
  // Meta/tier queries (always temporal — meta changes every patch)
  { rx: /\b(meta|tier list|tierlist)\b/i, reason: 'meta-query' },
  // Now/today/currently
  { rx: /\b(today|right now|currently|at the moment|these days|nowadays)\b/i, reason: 'now-word' },
  // Release/date queries
  { rx: /\b(release date|when (?:did|does|will|is)|coming soon|announced)\b/i, reason: 'release-query' },
  // "Which is the [X]" pattern — implies asking about current state
  { rx: /\bwhich (?:is|are|was) the\b/i, reason: 'which-is-the' },
  // Implicit temporal: "releasing", "added", "introduced"
  { rx: /\b(is\s+releasing|being\s+released|been\s+added|just\s+added|introduced|launched|dropped|revealed|unveiled|announced)\b/i, reason: 'release-verb' },
  // Best right now / strongest / weakest / most popular
  { rx: /\b(strongest|weakest|most popular|most played|best .{0,20}(?:right now|currently|this season|this patch|today))\b/i, reason: 'superlative-temporal' },
  // "Does [game] have [feature]" — often temporal (checking if a feature was added)
  { rx: /\bdoes .{2,30} have\b/i, reason: 'feature-check' },
  // "How many [things] are there" — roster size changes over time
  { rx: /\bhow many .{2,20} (?:are there|exist|does .{2,15} have)\b/i, reason: 'count-query' },
  // Any question about "hero" or "card" in context of competitive games
  { rx: /\b(?:hero(?:es)?|champion|brawler|card|troop|operator|agent|legend)\b.*\b(?:clash|brawl|league|valorant|apex|overwatch|fortnite|dota)\b/i, reason: 'competitive-roster' },
  { rx: /\b(?:clash|brawl|league|valorant|apex|overwatch|fortnite|dota)\b.*\b(?:hero(?:es)?|champion|brawler|card|troop|operator|agent|legend)\b/i, reason: 'competitive-roster' },
];

const SUBJECT_PATTERNS: Array<{ rx: RegExp; subject: string }> = [
  { rx: /\b(hero(?:es)?|champion|brawler|operator|legend|character|agent)\b/i, subject: 'character' },
  { rx: /\b(card|troop|spell|building|unit)\b/i, subject: 'card' },
  { rx: /\b(weapon|gun|skin|cosmetic|bundle)\b/i, subject: 'item' },
  { rx: /\b(map|mode|game ?mode|playlist)\b/i, subject: 'mode' },
  { rx: /\b(patch|update|version|season|event|battle ?pass)\b/i, subject: 'patch' },
  { rx: /\b(tier list|meta|balance)\b/i, subject: 'meta' },
  { rx: /\b(banner|summon|gacha|wish|pull|rate[- ]?up)\b/i, subject: 'banner' },
  { rx: /\b(nerf|buff|rework|change|adjustment)\b/i, subject: 'balance-change' },
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

  // BOOST: If no explicit temporal pattern matched but there IS a subject AND a
  // known game, treat it as temporal with lower confidence — the PULSE pipeline
  // will still fire and provide grounding data. This catches queries like
  // "Clash Royale hero card" which don't have "new" or "latest" but are clearly
  // asking about current state.
  if (reasons.length === 0 && subject) {
    const hasImplicitTemporalSubject = ['character', 'card', 'banner', 'balance-change', 'meta'].includes(subject);
    if (hasImplicitTemporalSubject) {
      reasons.push('implicit-temporal-subject');
    }
  }

  return { isTemporal: reasons.length > 0, reasons, subject };
}
