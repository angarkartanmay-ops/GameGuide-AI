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

export async function runPulse(
  prompt: string,
  game: string | null,
  todayISO: string,
): Promise<PulseResult> {
  const sig = detectTemporal(prompt);
  if (!sig.isTemporal) {
    return { fired: false, contextBlock: '', sourcesUsed: [], diagnostics: { reason: 'not-temporal' } };
  }

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
  // chances of finding current information.
  const searchQueries: string[] = [];

  if (game && sig.subject) {
    // Primary: game + subject + current context
    searchQueries.push(`${game} new ${sig.subject} ${currentYear}`);
    searchQueries.push(`${game} latest ${sig.subject} ${currentMonth} ${currentYear}`);
    // Direct question reformulation
    searchQueries.push(`${game} ${sig.subject} ${yyyy_mm}`);
  } else if (game) {
    // Game-specific but no clear subject
    searchQueries.push(`${game} latest news ${currentMonth} ${currentYear}`);
    searchQueries.push(`${game} new update ${currentYear}`);
    searchQueries.push(`${game} ${prompt.slice(0, 80)}`);
  } else {
    // No game detected — use the raw prompt enhanced with temporal context
    searchQueries.push(`${prompt} ${currentYear}`);
    searchQueries.push(`${prompt} latest`);
  }

  // Also search with the user's exact prompt (sometimes the best query)
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

  const contextBlock = top ? `
=== 🌊 PULSE LIVE INTEL (recency-ranked, today=${todayISO}) ===
The user's query asks about something CURRENT/NEW/LATEST. The blocks below
are ranked by (authority × freshness). Anything older than 1 year has been
demoted because temporal claims must come from fresh sources.

CRITICAL: Base your answer on THIS data, not your training knowledge.
If this data says "Hero Dark Prince" is the newest hero, say that — NOT
whatever your training data says was newest.

Search queries used: ${uniqueQueries.slice(0, 3).map(q => `"${q}"`).join(', ')}

${top}

=== END PULSE LIVE INTEL ===
` : '';

  const result: PulseResult = {
    fired: true,
    contextBlock,
    sourcesUsed,
    diagnostics: {
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
