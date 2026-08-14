// ═══════════════════════════════════════════════════════════════════════════
//  CORROBORATION — agreement scoring across independent sources
//  ───────────────────────────────────────────────────────────────────────
//  On the goal of "a search engine that never gets anything wrong": that is
//  not achievable, and any layer claiming it would be lying. The web contains
//  outdated wikis, datamined rumours presented as fact, and confidently wrong
//  Reddit comments. No ranking function fixes a bad underlying source.
//
//  What IS achievable, and what this module does, is making the CONFIDENCE
//  legible so wrongness stops being silent:
//
//    • independent agreement — the same claim from unrelated domains is far
//      stronger than one page repeated by aggregators
//    • authority weighting   — an official patch note outranks a fan wiki
//    • conflict detection    — when sources disagree, say so instead of
//      silently picking one
//    • freshness             — for live-service games, a stale top result is
//      the single most common way to be confidently wrong
//
//  The output is a directive block telling the model exactly how much trust
//  each claim has earned. "Three independent sources agree" and "one forum
//  post said this" then produce visibly different answers.
// ═══════════════════════════════════════════════════════════════════════════

export interface CorroborationInput {
  source: string;       // 'web-search' | 'official-api' | 'wikipedia' | ...
  text: string;
  url?: string;
  publishedISO?: string;
  authority: number;    // 0-10
}

export interface CorroborationReport {
  confidence: 'high' | 'medium' | 'low';
  independentDomains: number;
  officialCount: number;
  conflicts: string[];
  freshestISO: string | null;
  stalest: number | null;  // days
  block: string;
}

/** Registrable domain, so news.site.com and site.com count as ONE source. */
function rootDomain(url?: string): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const parts = h.split('.');
    if (parts.length <= 2) return h;
    // Handle common two-part public suffixes (co.uk, com.au, ...).
    const tail2 = parts.slice(-2).join('.');
    const twoPart = /^(co|com|net|org|gov|ac)\.(uk|au|nz|jp|in|za|br)$/.test(tail2);
    return parts.slice(twoPart ? -3 : -2).join('.');
  } catch {
    return null;
  }
}

// Aggregators and social platforms republish each other; counting them as
// independent corroboration is exactly how one wrong claim comes to look like
// a consensus. Matched against the FULL hostname, because collapsing to the
// registrable domain first would turn news.google.com into google.com and
// sneak it past this filter.
const AGGREGATOR_RX = /\b(msn|google|bing|duckduckgo|flipboard|yahoo|reddit|quora|pinterest|facebook|twitter|x|medium|tumblr|substack)\.[a-z.]+$/i;

function fullHost(url?: string): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

const OFFICIAL_RX = /(official-api|official-news|steam-news)/i;

// Numeric claims are where "confidently wrong" actually hurts (damage values,
// release dates, patch numbers), so those are what we cross-check.
function extractNumericClaims(text: string): Map<string, Set<string>> {
  const claims = new Map<string, Set<string>>();
  const patterns: Array<[string, RegExp]> = [
    // Allow the small connector words people actually write between the noun
    // and the number ("the current patch is 3.4", "version: 3.7").
    ['version',  /\b(?:patch|update|version|v)\.?\s*(?:is\s+|are\s+|:\s*|=\s*)?(\d+\.\d+(?:\.\d+)?)\b/gi],
    ['season',   /\bseason\s*(?:is\s+|:\s*)?(\d{1,3})\b/gi],
    ['date',     /\b(\d{4}-\d{2}-\d{2})\b/g],
    ['year',     /\b(20[2-9]\d)\b/g],
  ];
  for (const [kind, rx] of patterns) {
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      if (!claims.has(kind)) claims.set(kind, new Set());
      claims.get(kind)!.add(m[1]);
    }
  }
  return claims;
}

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function corroborate(inputs: CorroborationInput[], isTemporal: boolean): CorroborationReport {
  // Low floor on purpose: official API and patch-note entries are often a
  // single terse line ("Patch 3.4 released"), and those are the highest-value
  // sources we have. Only drop entries that carry no claim at all.
  const usable = inputs.filter(i => i.text && i.text.trim().length >= 12);

  if (usable.length === 0) {
    return {
      confidence: 'low', independentDomains: 0, officialCount: 0,
      conflicts: [], freshestISO: null, stalest: null,
      block: `=== 🔎 SOURCE CONFIDENCE: NONE ===
No live sources returned usable results for this question.

You are answering from TRAINING DATA ALONE. You must:
- Say so plainly, up front — one short line, not a disclaimer paragraph.
- Avoid all specific numbers, dates, patch versions and "current/latest" claims.
- Point them at the authoritative place to check (official patch notes, the in-game client, the game's wiki).
Never present training-era recall as verified fact.
=== END SOURCE CONFIDENCE ===`,
    };
  }

  // ── Independence ─────────────────────────────────────────────────────────
  const domains = new Set<string>();
  let officialCount = 0;
  for (const i of usable) {
    if (OFFICIAL_RX.test(i.source)) officialCount++;
    const host = fullHost(i.url);
    const d = rootDomain(i.url);
    // Aggregator check uses the full hostname; dedup uses the registrable
    // domain so news.site.com and site.com count once.
    if (d && host && !AGGREGATOR_RX.test(host)) domains.add(d);
  }
  const independentDomains = domains.size;

  // ── Conflicts ────────────────────────────────────────────────────────────
  const merged = new Map<string, Set<string>>();
  for (const i of usable) {
    for (const [kind, vals] of extractNumericClaims(i.text)) {
      if (!merged.has(kind)) merged.set(kind, new Set());
      for (const v of vals) merged.get(kind)!.add(v);
    }
  }
  const conflicts: string[] = [];
  for (const [kind, vals] of merged) {
    // Years are noisy (copyright footers, unrelated mentions) — ignore.
    if (kind === 'year') continue;
    if (vals.size > 1) {
      conflicts.push(`${kind}: sources disagree — ${[...vals].slice(0, 4).join(' vs ')}`);
    }
  }

  // ── Freshness ────────────────────────────────────────────────────────────
  const dated = usable.map(i => i.publishedISO).filter(Boolean) as string[];
  dated.sort((a, b) => Date.parse(b) - Date.parse(a));
  const freshestISO = dated[0] || null;
  const stalest = daysSince(freshestISO);

  // ── Confidence ───────────────────────────────────────────────────────────
  let confidence: 'high' | 'medium' | 'low';
  if (officialCount > 0 && conflicts.length === 0) {
    confidence = 'high';
  } else if (independentDomains >= 3 && conflicts.length === 0) {
    confidence = 'high';
  } else if (independentDomains >= 2 || officialCount > 0) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }
  // A temporal question answered only from months-old pages is not high
  // confidence no matter how many sites agree — they may all be stale together.
  if (isTemporal && stalest !== null && stalest > 45 && confidence === 'high') {
    confidence = 'medium';
  }

  const guidance: Record<typeof confidence, string> = {
    high: `State these facts directly. Cite the source inline ("per the official patch notes"). No hedging language — hedging on well-corroborated facts is its own kind of noise.`,
    medium: `State the facts, but attribute them ("according to <source>") rather than asserting them as settled. If the user is about to spend money or hours on this, add one line telling them where to confirm.`,
    low: `Lead with the uncertainty in ONE short sentence, then give the best available answer. Do not invent specifics to fill gaps. Naming what you don't know is better than a confident guess.`,
  };

  const lines = [
    `=== 🔎 SOURCE CONFIDENCE: ${confidence.toUpperCase()} ===`,
    `Independent domains agreeing: ${independentDomains}`,
    `Official/first-party sources: ${officialCount}`,
    freshestISO ? `Freshest source: ${freshestISO}${stalest !== null ? ` (${stalest}d ago)` : ''}` : `Freshest source: undated`,
  ];

  if (conflicts.length) {
    lines.push(
      '',
      '⚠️ CONFLICTING CLAIMS DETECTED:',
      ...conflicts.map(c => `  - ${c}`),
      '',
      'When sources disagree you MUST surface the disagreement rather than silently picking one. Say which reading is better supported and why, and tell the user how to settle it themselves.',
    );
  }

  lines.push('', `HOW TO USE THIS: ${guidance[confidence]}`);

  if (isTemporal && stalest !== null && stalest > 45) {
    lines.push('', `⏳ This is a "what's current" question but the freshest source is ${stalest} days old. Say explicitly that anything more recent may not be reflected here.`);
  }

  lines.push('=== END SOURCE CONFIDENCE ===');

  return {
    confidence, independentDomains, officialCount, conflicts,
    freshestISO, stalest, block: lines.join('\n'),
  };
}
