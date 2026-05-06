// Web-search adapters — multi-strategy for maximum reliability.
//
// Strategy: Google Custom Search (if key set) → Serper (if key set) →
// SearXNG (free, rotated) → DuckDuckGo Lite HTML → Brave (if key set).
//
// Google CSE and Serper are the most reliable for current gaming data.
// SearXNG is a free fallback. DuckDuckGo Lite is last resort.

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  publishedISO?: string;        // best-effort date extraction
  source: 'google-cse' | 'serper' | 'searxng' | 'duckduckgo' | 'brave';
}

const SEARXNG_INSTANCES = [
  // Public, JSON-enabled SearXNG instances. Rotate to dodge per-instance rate limits.
  // Verify these are still up at deploy time — replace dead ones with fresh entries from
  // https://searx.space (filter by "JSON" support, sort by uptime).
  'https://searx.be',
  'https://search.brave4u.com',
  'https://paulgo.io',
  'https://searx.tiekoetter.com',
  'https://search.sapti.me',
  'https://priv.au',
  'https://searx.work',
];

async function fetchTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// ── Google Custom Search Engine (most reliable, 100 free queries/day) ────
export async function googleCSESearch(query: string, limit = 6, timeoutMs = 5000): Promise<SearchHit[]> {
  const apiKey = Deno.env.get('GOOGLE_CSE_API_KEY') || Deno.env.get('GOOGLE_API_KEY');
  const cseId = Deno.env.get('GOOGLE_CSE_ID');
  if (!apiKey || !cseId) return [];

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&num=${Math.min(limit, 10)}&dateRestrict=m3`;
    const res = await fetchTimeout(url, {
      headers: { 'Accept': 'application/json' },
    }, timeoutMs);
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.items || [];
    return items.slice(0, limit).map((r: any) => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
      publishedISO: r.pagemap?.metatags?.[0]?.['article:published_time'] || undefined,
      source: 'google-cse' as const,
    }));
  } catch {
    return [];
  }
}

// ── Serper.dev (Google SERP API, 2500 free/month) ────────────────────────
export async function serperSearch(query: string, limit = 6, timeoutMs = 5000): Promise<SearchHit[]> {
  const key = Deno.env.get('SERPER_API_KEY');
  if (!key) return [];

  try {
    const res = await fetchTimeout('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: limit,
        tbs: 'qdr:m3', // last 3 months
      }),
    }, timeoutMs);
    if (!res.ok) return [];
    const data = await res.json();

    const hits: SearchHit[] = [];

    // Extract AI overview / knowledge graph if present
    if (data.knowledgeGraph?.description) {
      hits.push({
        title: data.knowledgeGraph.title || 'Knowledge Graph',
        url: data.knowledgeGraph.website || '',
        snippet: data.knowledgeGraph.description,
        source: 'serper' as const,
      });
    }

    // Extract organic results
    const organic = data.organic || [];
    for (const r of organic.slice(0, limit)) {
      hits.push({
        title: r.title || '',
        url: r.link || '',
        snippet: r.snippet || '',
        publishedISO: r.date || undefined,
        source: 'serper' as const,
      });
    }

    // Extract "People Also Ask" as supplementary context
    if (data.peopleAlsoAsk?.length > 0) {
      for (const paa of data.peopleAlsoAsk.slice(0, 2)) {
        if (paa.snippet) {
          hits.push({
            title: paa.question || 'Related',
            url: paa.link || '',
            snippet: paa.snippet,
            source: 'serper' as const,
          });
        }
      }
    }

    return hits.slice(0, limit);
  } catch {
    return [];
  }
}

export async function searxngSearch(query: string, limit = 6, timeoutMs = 4500): Promise<SearchHit[]> {
  const instances = [...SEARXNG_INSTANCES].sort(() => Math.random() - 0.5);
  for (const base of instances) {
    try {
      const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=en&safesearch=0&time_range=month`;
      const res = await fetchTimeout(url, {
        headers: { 'User-Agent': 'GameGuide-AI/1.0 (free-tier search)' },
      }, timeoutMs);
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      const results = data?.results || [];
      if (!results.length) continue;
      return results.slice(0, limit).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.content || '',
        publishedISO: r.publishedDate || undefined,
        source: 'searxng' as const,
      }));
    } catch {
      continue;
    }
  }
  return [];
}

export async function duckduckgoSearch(query: string, limit = 6, timeoutMs = 4500): Promise<SearchHit[]> {
  try {
    // Use DuckDuckGo Lite which is more stable for parsing
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=us-en&df=m`;
    const res = await fetchTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    }, timeoutMs);
    if (!res.ok) return [];
    const html = await res.text();

    const hits: SearchHit[] = [];
    // DDG Lite uses a simpler table-based layout
    const linkRx = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const snippetRx = /<td[^>]*class="result-snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/td>/gi;
    
    const links: {url: string; title: string}[] = [];
    let m: RegExpExecArray | null;
    while ((m = linkRx.exec(html)) !== null && links.length < limit) {
      const linkUrl = m[1].startsWith('//') ? 'https:' + m[1] : m[1];
      if (linkUrl.includes('duckduckgo.com')) continue;
      links.push({ url: linkUrl, title: m[2].replace(/&amp;/g, '&').trim() });
    }
    
    const snippets: string[] = [];
    while ((m = snippetRx.exec(html)) !== null) {
      snippets.push(m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim());
    }

    for (let i = 0; i < links.length && i < limit; i++) {
      hits.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || '',
        source: 'duckduckgo' as const,
      });
    }

    // Fallback: try the standard HTML version if Lite returned nothing
    if (hits.length === 0) {
      const url2 = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en&df=m`;
      const res2 = await fetchTimeout(url2, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameGuide-AI/1.0)' },
      }, timeoutMs);
      if (res2.ok) {
        const html2 = await res2.text();
        const blockRx = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/g;
        while ((m = blockRx.exec(html2)) !== null && hits.length < limit) {
          const cleanText = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
          hits.push({
            title: cleanText(m[2]),
            url: m[1].startsWith('//') ? 'https:' + m[1] : m[1],
            snippet: cleanText(m[3]),
            source: 'duckduckgo' as const,
          });
        }
      }
    }

    return hits;
  } catch {
    return [];
  }
}

export async function braveSearch(query: string, limit = 6, timeoutMs = 4500): Promise<SearchHit[]> {
  const key = Deno.env.get('BRAVE_SEARCH_API_KEY');
  if (!key) return [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}&freshness=pm`;
    const res = await fetchTimeout(url, {
      headers: { 'X-Subscription-Token': key, 'Accept': 'application/json' },
    }, timeoutMs);
    if (!res.ok) return [];
    const data = await res.json();
    const results = data?.web?.results || [];
    return results.slice(0, limit).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || '',
      publishedISO: r.age || r.page_age || undefined,
      source: 'brave' as const,
    }));
  } catch {
    return [];
  }
}

/**
 * Multi-source web search with aggressive fallback chain.
 * Priority: Google CSE → Serper → Brave → SearXNG → DuckDuckGo
 *
 * Returns deduplicated results prioritizing paid/reliable sources.
 */
export async function multiWebSearch(query: string, limit = 8): Promise<SearchHit[]> {
  // Fire ALL sources in parallel — take the best results from whichever responds
  const [gcse, serp, brv, sx, ddg] = await Promise.allSettled([
    googleCSESearch(query, limit),
    serperSearch(query, limit),
    braveSearch(query, limit),
    searxngSearch(query, limit),
    duckduckgoSearch(query, limit),
  ]);

  // Priority order: Google CSE > Serper > Brave > SearXNG > DDG
  const all: SearchHit[] = [];
  if (gcse.status === 'fulfilled') all.push(...gcse.value);
  if (serp.status === 'fulfilled') all.push(...serp.value);
  if (brv.status === 'fulfilled') all.push(...brv.value);
  if (sx.status === 'fulfilled') all.push(...sx.value);
  if (ddg.status === 'fulfilled') all.push(...ddg.value);

  // Log which sources responded
  const counts = {
    gcse: gcse.status === 'fulfilled' ? gcse.value.length : 0,
    serper: serp.status === 'fulfilled' ? serp.value.length : 0,
    brave: brv.status === 'fulfilled' ? brv.value.length : 0,
    searxng: sx.status === 'fulfilled' ? sx.value.length : 0,
    ddg: ddg.status === 'fulfilled' ? ddg.value.length : 0,
  };
  console.log(`[WEB-SEARCH] Results: gcse=${counts.gcse} serper=${counts.serper} brave=${counts.brave} searxng=${counts.searxng} ddg=${counts.ddg} total=${all.length}`);

  const seen = new Set<string>();
  const dedup: SearchHit[] = [];
  for (const h of all) {
    try {
      const u = new URL(h.url);
      const key = u.hostname + u.pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(h);
    } catch {
      // Skip malformed URLs
    }
    if (dedup.length >= limit) break;
  }
  return dedup;
}
