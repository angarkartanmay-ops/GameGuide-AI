// Project PULSE — orchestrates Official Sources + Web Search + Ranking
// for temporal queries. Returns a compact context block to inject into the
// system prompt.

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
const PULSE_TTL_MS = 10 * 60 * 1000;

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

  // ── Stage 1: Official source (highest authority) ─────────────────────
  const official = findOfficial(game);
  if (official) {
    const officialBlocks = await fetchOfficial(official);
    blocks.push(...officialBlocks);
    if (officialBlocks.length) sourcesUsed.push(`official:${official.game}`);
  }

  // ── Stage 2: Free web search ─────────────────────────────────────────
  const yyyy_mm = todayISO.slice(0, 7);
  const subjectStr = sig.subject ? sig.subject : '';
  const wsQuery = game
    ? `${game} ${subjectStr} new latest ${yyyy_mm}`.replace(/\s+/g, ' ').trim()
    : `${prompt} ${yyyy_mm}`;
  const webHits = await multiWebSearch(wsQuery, 6);
  for (const h of webHits) {
    blocks.push({
      source: 'web-search',
      text: `${h.title} — ${h.snippet}`,
      url: h.url,
      publishedISO: h.publishedISO,
      baseAuthority: 6,
    });
  }
  if (webHits.length) sourcesUsed.push(`web:${webHits.length}`);

  // ── Stage 3: Rank + compact ──────────────────────────────────────────
  const ranked = rankBlocks(blocks);
  const top = topNCompact(ranked, 3, 800);

  const contextBlock = top ? `
=== 🌊 PULSE LIVE INTEL (recency-ranked, today=${todayISO}) ===
The user's query asks about something CURRENT/NEW/LATEST. The blocks below
are ranked by (authority × freshness). Anything older than 1 year has been
demoted because temporal claims must come from fresh sources.

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
      blocksUsed: Math.min(3, ranked.length),
      query: wsQuery,
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
  const t = setTimeout(() => ctrl.abort(), 4000);

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
