// Free web-search adapters — NO PAID APIS REQUIRED.
//
// Strategy: try SearXNG (best quality, JSON output) → DuckDuckGo HTML → Brave (only if key set).
// Each adapter returns the SAME shape so the caller can rank uniformly.

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  publishedISO?: string;        // best-effort date extraction
  source: 'searxng' | 'duckduckgo' | 'brave';
}

const SEARXNG_INSTANCES = [
  // Public, JSON-enabled SearXNG instances. Rotate to dodge per-instance rate limits.
  // Verify these are still up at deploy time — replace dead ones with fresh entries from
  // https://searx.space (filter by "JSON" support, sort by uptime).
  'https://searx.be',
  'https://search.brave4u.com',
  'https://paulgo.io',
  'https://searx.tiekoetter.com',
];

async function fetchTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
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
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en&df=m`;
    const res = await fetchTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GameGuide-AI/1.0)' },
    }, timeoutMs);
    if (!res.ok) return [];
    const html = await res.text();

    const hits: SearchHit[] = [];
    const blockRx = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = blockRx.exec(html)) !== null && hits.length < limit) {
      const cleanText = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      hits.push({
        title: cleanText(m[2]),
        url: m[1].startsWith('//') ? 'https:' + m[1] : m[1],
        snippet: cleanText(m[3]),
        source: 'duckduckgo' as const,
      });
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

export async function multiWebSearch(query: string, limit = 6): Promise<SearchHit[]> {
  const [sx, ddg, brv] = await Promise.allSettled([
    searxngSearch(query, limit),
    duckduckgoSearch(query, limit),
    braveSearch(query, limit),
  ]);
  const all: SearchHit[] = [];
  if (brv.status === 'fulfilled') all.push(...brv.value);
  if (sx.status === 'fulfilled') all.push(...sx.value);
  if (ddg.status === 'fulfilled') all.push(...ddg.value);

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
