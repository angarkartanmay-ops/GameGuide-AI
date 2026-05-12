// Project PULSE v2 — orchestrates Official Sources + Web Search + Ranking
// for temporal queries. Returns a compact context block to inject into the
// system prompt.
//
// v2 Changes:
// - Much more aggressive web search queries (game-specific, multiple variants)
// - Fires MULTIPLE web searches in parallel for different angles
// - Increased result budget (top 5 instead of 3)
// - Uses current year dynamically
// - Better query formulation for "what's new" type questions

import { detectTemporal } from './temporalDetector.ts';
import { findOfficial, OfficialSource } from './officialSources.ts';
import { multiWebSearch } from './webSearch.ts';
import { rankBlocks, topNCompact, RankableBlock } from './recencyRanker.ts';

interface PulseResult {
  fired: boolean;
  contextBlock: string;
  sourcesUsed: string[];
  diagnostics: Record<string, any>;
}

const PULSE_CACHE = new Map<string, { ts: number; result: PulseResult }>();
const PULSE_TTL_MS = 8 * 60 * 1000; // 8 min (reduced from 10 for fresher data)

// Pure chitchat — never worth a live search.
// Anything beyond a one-word greeting/thanks goes through PULSE.
const CHITCHAT_RX = /^(hi+|hello+|hey+|yo+|sup|hru|thanks?|thx|ty|ok+|okay|cool|lol+|lmao|haha+|nice|gg|bye+|cya|cheers|test|ping|👋|🙏|❤️)[.!?\s]*$/i;

function isPureChitchat(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return true;
  if (trimmed.length < 3) return true;
  return CHITCHAT_RX.test(trimmed);
}

export async function runPulse(
  prompt: string,
  game: string | null,
  todayISO: string,
): Promise<PulseResult> {
  // Skip ONLY pure chitchat ("hi", "thanks", "lol"). Every real question
  // — temporal or not — gets a live search. The model then fuses live data
  // with its training-side reasoning for the final answer.
  if (isPureChitchat(prompt)) {
    return { fired: false, contextBlock: '', sourcesUsed: [], diagnostics: { reason: 'chitchat' } };
  }

  const sig = detectTemporal(prompt);
  const isTemporal = sig.isTemporal;

  const cacheKey = `${game || 'nogame'}|${prompt.slice(0, 200).toLowerCase()}`;
  const cached = PULSE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < PULSE_TTL_MS) {
    return { ...cached.result, diagnostics: { ...cached.result.diagnostics, cache: 'hit' } };
  }

  const blocks: RankableBlock[] = [];
  const sourcesUsed: string[] = [];

  // Get current year/month for query formulation
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().toLocaleString('en-US', { month: 'long' });
  const yyyy_mm = todayISO.slice(0, 7);

  // ── Stage 1: Official source (highest authority) ─────────────────────
  const official = findOfficial(game);
  if (official) {
    const officialBlocks = await fetchOfficial(official);
    blocks.push(...officialBlocks);
    if (officialBlocks.length) sourcesUsed.push(`official:${official.game}`);
  }

  // ── Stage 2: Aggressive multi-angle web search ──────────────────────
  // Build multiple search queries for different angles to maximize
  // chances of finding current information. Queries differ depending on
  // whether the user used temporal language — but PULSE always fires.
  const searchQueries: string[] = [];
  const promptForSearch = prompt.length > 200 ? prompt.slice(0, 200) : prompt;

  if (isTemporal) {
    if (game && sig.subject) {
      searchQueries.push(`${game} new ${sig.subject} ${currentYear}`);
      searchQueries.push(`${game} latest ${sig.subject} ${currentMonth} ${currentYear}`);
      searchQueries.push(`${game} ${sig.subject} ${yyyy_mm}`);
    } else if (game) {
      searchQueries.push(`${game} latest news ${currentMonth} ${currentYear}`);
      searchQueries.push(`${game} new update ${currentYear}`);
      searchQueries.push(`${game} ${promptForSearch}`);
    } else {
      searchQueries.push(`${promptForSearch} ${currentYear}`);
      searchQueries.push(`${promptForSearch} latest`);
    }
  } else {
    // Evergreen / non-temporal query — lead with the user's actual question so
    // we get directly relevant results, then add game-anchored variants for breadth.
    searchQueries.push(promptForSearch);
    if (game) {
      searchQueries.push(`${game} ${promptForSearch}`);
      searchQueries.push(`${game} guide ${currentYear}`);
    } else {
      searchQueries.push(`${promptForSearch} ${currentYear}`);
    }
  }

  // Always include the raw prompt as a final fallback query
  if (prompt.length > 10 && prompt.length < 200) {
    searchQueries.push(prompt);
  }

  // Deduplicate queries
  const uniqueQueries = [...new Set(searchQueries.map(q => q.replace(/\s+/g, ' ').trim()))];

  console.log(`[PULSE] Firing ${uniqueQueries.length} web searches: ${uniqueQueries.map(q => `"${q.slice(0, 60)}"`).join(', ')}`);

  // Fire all searches in parallel
  const searchResults = await Promise.allSettled(
    uniqueQueries.slice(0, 4).map(q => multiWebSearch(q, 6))
  );

  // Collect all hits, dedup by URL
  const seenUrls = new Set<string>();
  for (const result of searchResults) {
    if (result.status !== 'fulfilled') continue;
    for (const h of result.value) {
      if (seenUrls.has(h.url)) continue;
      seenUrls.add(h.url);
      blocks.push({
        source: 'web-search',
        text: `${h.title} — ${h.snippet}`,
        url: h.url,
        publishedISO: h.publishedISO,
        baseAuthority: h.source === 'google-cse' || h.source === 'serper' ? 8 : 6,
      });
    }
  }
  const webHitCount = blocks.filter(b => b.source === 'web-search').length;
  if (webHitCount > 0) sourcesUsed.push(`web:${webHitCount}`);

  // ── Stage 3: Rank + compact ──────────────────────────────────────────
  const ranked = rankBlocks(blocks);
  const top = topNCompact(ranked, 5, 900); // Increased from 3→5 blocks, 800→900 chars

  const headerLine = isTemporal
    ? `The user's query asks about CURRENT / NEW / LATEST state. Live data below OVERRIDES your training on any fact it covers.`
    : `Live data fetched for this query just now. FUSE these facts with your training-side reasoning — live data wins on any conflict.`;

  const contextBlock = top ? `
=== 🌊 PULSE LIVE INTEL (recency-ranked, today=${todayISO}) ===
${headerLine}

The blocks below are ranked by (authority × freshness). Stale items are demoted.

ANSWERING CONTRACT (NON-NEGOTIABLE):
1. Read every block before answering. Treat them as ground truth for any fact they cover.
2. If the blocks contradict your training, the blocks win — your training is stale by months/years.
3. If the blocks are silent on a sub-question, you may use training reasoning, but mark it clearly: "*based on training, not live data*".
4. Cite which block confirmed each non-obvious fact ("*per Steam News*", "*per Wikipedia*", "*per official API*").
5. Combine: live data for facts/numbers/dates, your reasoning for analysis/explanation/recommendation.
6. Never tell the user you "can't browse the internet" — these blocks ARE the internet, fetched seconds ago.

Search queries used: ${uniqueQueries.slice(0, 3).map(q => `"${q}"`).join(', ')}

${top}

=== END PULSE LIVE INTEL ===
` : '';

  const result: PulseResult = {
    fired: true,
    contextBlock,
    sourcesUsed,
    diagnostics: {
      mode: isTemporal ? 'temporal' : 'evergreen',
      temporalReasons: sig.reasons,
      subject: sig.subject,
      blocksFound: blocks.length,
      blocksUsed: Math.min(5, ranked.length),
      queries: uniqueQueries,
      webHits: webHitCount,
    },
  };

  PULSE_CACHE.set(cacheKey, { ts: Date.now(), result });
  if (PULSE_CACHE.size > 100) {
    const oldest = [...PULSE_CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) PULSE_CACHE.delete(oldest[0]);
  }
  return result;
}

async function fetchOfficial(src: OfficialSource): Promise<RankableBlock[]> {
  const out: RankableBlock[] = [];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000); // Increased from 4s

  try {
    if (src.endpoints.api) {
      const ep = src.endpoints.api;
      const headers: Record<string, string> = { 'User-Agent': 'GameGuide-AI/1.0' };
      if (ep.authEnv) {
        const k = Deno.env.get(ep.authEnv);
        if (k) headers[ep.headerKey || 'Authorization'] = ep.headerKey === 'Authorization' ? `Bearer ${k}` : k;
      }
      try {
        const res = await fetch(ep.url, { headers, signal: ctrl.signal });
        if (res.ok) {
          const json = await res.json();
          const text = compactJson(json, ep.parser, src.game);
          if (text) {
            out.push({
              source: 'official-api',
              text: `${src.game.toUpperCase()} OFFICIAL API:\n${text}`,
              url: ep.url,
              baseAuthority: 10,
              publishedISO: new Date().toISOString(),
            });
          }
        }
      } catch { /* swallow */ }
    }

    if (src.endpoints.rss) {
      try {
        const res = await fetch(src.endpoints.rss, { signal: ctrl.signal, headers: { 'User-Agent': 'GameGuide-AI/1.0' } });
        if (res.ok) {
          const xml = await res.text();
          const items = parseRssLite(xml).slice(0, 5);
          for (const it of items) {
            out.push({
              source: 'official-news',
              text: `${it.title}\n${it.description.slice(0, 400)}`,
              url: it.link,
              publishedISO: it.pubDate,
              baseAuthority: 9,
            });
          }
        }
      } catch { /* swallow */ }
    }

    if (src.endpoints.htmlNews && out.length === 0) {
      try {
        const res = await fetch(src.endpoints.htmlNews, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameGuide-AI/1.0)' } });
        if (res.ok) {
          const html = await res.text();
          const titles = extractTitles(html).slice(0, 5);
          if (titles.length) {
            out.push({
              source: 'official-news',
              text: `${src.game.toUpperCase()} OFFICIAL NEWS PAGE — recent headlines:\n${titles.join('\n')}`,
              url: src.endpoints.htmlNews,
              publishedISO: new Date().toISOString(),
              baseAuthority: 9,
            });
          }
        }
      } catch { /* swallow */ }
    }
  } finally {
    clearTimeout(t);
  }

  return out;
}

function compactJson(json: any, parser: string, game: string): string {
  if (parser === 'supercell') {
    const items = json?.items || [];
    if (!items.length) return '';
    const recent = items.slice(-12).reverse();
    return `Recent ${game} entries (newest first):\n` + recent.map((i: any) => `- ${i.name || i.title || JSON.stringify(i).slice(0, 80)}`).join('\n');
  }
  if (parser === 'json-news') {
    const news = json?.data?.br?.motds || json?.data?.news || json?.news || [];
    if (!Array.isArray(news) || !news.length) return JSON.stringify(json).slice(0, 600);
    return news.slice(0, 5).map((n: any) => `- ${n.title || n.body || ''}`).filter(Boolean).join('\n');
  }
  return JSON.stringify(json).slice(0, 600);
}

interface RssItem { title: string; link: string; description: string; pubDate?: string; }

function parseRssLite(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  const get = (block: string, tag: string) => {
    const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
    return r ? r[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim() : '';
  };
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1];
    items.push({
      title: get(block, 'title'),
      link: get(block, 'link'),
      description: get(block, 'description'),
      pubDate: get(block, 'pubDate') || undefined,
    });
  }
  return items;
}

function extractTitles(html: string): string[] {
  const titles: string[] = [];
  const headRx = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m: RegExpExecArray | null;
  while ((m = headRx.exec(html)) !== null && titles.length < 10) {
    const t = m[1].replace(/<[^>]+>/g, '').trim();
    if (t && t.length > 8 && t.length < 200) titles.push(`- ${t}`);
  }
  return titles;
}
