// Rank scraped blocks by (authority × freshness). Older content gets demoted hard
// because the WHOLE POINT of PULSE is to surface what's new.

export interface RankableBlock {
  source: string;             // 'official-api' | 'official-news' | 'wikipedia' | 'rss' | 'web-search' | 'reddit' | ...
  text: string;
  url?: string;
  publishedISO?: string;
  baseAuthority: number;      // 1-10
}

export interface RankedBlock extends RankableBlock {
  ageDays: number;            // Infinity if unknown
  finalScore: number;
}

const AUTHORITY_FLOOR: Record<string, number> = {
  'official-api': 10,
  'supercell-api': 10,
  'official-news': 9,
  'wikipedia': 7,
  'steam-news': 7,
  'rss': 6,
  'web-search': 6,
  'youtube': 5,
  'reddit': 4,
};

const OFFICIAL_DOMAIN_RX = /\b(supercell\.com|minecraft\.net|fortnite\.com|playvalorant\.com|leagueoflegends\.com|ea\.com|battle\.net|overwatch\.blizzard\.com|bungie\.net|callofduty\.com|hoyoverse\.com|riotgames\.com|krafton\.com|battlegroundsmobileindia\.com|pubgmobile\.com|epicgames\.com)\b/i;

export function rankBlocks(blocks: RankableBlock[], now = Date.now()): RankedBlock[] {
  return blocks.map(b => {
    let ageDays = Infinity;
    if (b.publishedISO) {
      const t = Date.parse(b.publishedISO);
      if (!isNaN(t)) ageDays = (now - t) / 86_400_000;
    }

    let mult: number;
    if (ageDays < 7) mult = 1.6;
    else if (ageDays < 30) mult = 1.3;
    else if (ageDays < 90) mult = 1.0;
    else if (ageDays < 180) mult = 0.85;
    else if (ageDays < 365) mult = 0.6;
    else if (ageDays === Infinity) mult = 0.7;
    else mult = 0.3;

    let auth = b.baseAuthority || AUTHORITY_FLOOR[b.source] || 4;
    if (b.source === 'web-search' && b.url && OFFICIAL_DOMAIN_RX.test(b.url)) {
      auth = Math.max(auth, 9);
    }

    return { ...b, ageDays, finalScore: auth * mult };
  }).sort((a, b) => b.finalScore - a.finalScore);
}

export function topNCompact(blocks: RankedBlock[], n = 3, charsPerBlock = 800): string {
  return blocks.slice(0, n).map((b, i) => {
    const ageStr = b.ageDays === Infinity ? 'date-unknown' : b.ageDays < 1 ? 'today' : b.ageDays < 30 ? `${Math.round(b.ageDays)}d ago` : b.ageDays < 365 ? `${Math.round(b.ageDays/30)}mo ago` : `${Math.round(b.ageDays/365)}y ago`;
    const head = `[${i+1}] ${b.source.toUpperCase()} (${ageStr}, score=${b.finalScore.toFixed(1)})${b.url ? ' — ' + b.url : ''}`;
    const body = b.text.slice(0, charsPerBlock).replace(/\s+/g, ' ').trim();
    return `${head}\n${body}`;
  }).join('\n\n');
}
