// ═══════════════════════════════════════════════════════════════════════════
//  MODEL CATALOG — runtime discovery so the mesh self-heals
//  ───────────────────────────────────────────────────────────────────────
//  Hardcoded model ids rot, and they rot FAST. Measured on this project:
//  every OpenRouter id configured in v2 was dead by the time v3 was written,
//  and 3 of the 12 ids written into v3 were dead 11 days later (OpenRouter
//  retired two nemotron variants; Cerebras dropped zai-glm-4.7).
//
//  A dead id is the worst kind of failure because it is SILENT — the call
//  404s, the mesh falls through, and the symptom is "answers got worse",
//  never an error anyone sees. No amount of prompt tuning fixes it.
//
//  So: ask the provider what exists, at runtime, and route to that. The
//  static registry in meshRouter.ts stays as the cold-start fallback for when
//  discovery is unavailable — never as the source of truth.
//
//  Only OpenRouter is discovered live: it has a public unauthed catalog
//  endpoint and by far the highest churn. Groq, Cerebras and Gemini publish
//  short stable lists, and their dead ids are caught by the circuit breaker.
// ═══════════════════════════════════════════════════════════════════════════

import { MeshModel, Tier } from './meshRouter.ts';

const OPENROUTER_CATALOG = 'https://openrouter.ai/api/v1/models';

interface CatalogEntry {
  id: string;
  context_length?: number;
  architecture?: { input_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
}

export interface DiscoveryResult {
  models: MeshModel[];
  source: 'live' | 'cache' | 'fallback';
  fetchedAt: number;
  freeCount: number;
  visionCount: number;
}

// Discovery is a nice-to-have on the hot path: cache generously and never let
// it add latency to a chat. 6h is far shorter than the observed churn rate.
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
let cache: { ts: number; result: DiscoveryResult } | null = null;
let inflight: Promise<DiscoveryResult> | null = null;

/**
 * Model families trusted for this workload, best first.
 *
 * Ranked by instruction-following and grounding on retrieved context — NOT by
 * raw benchmark score. A model that writes beautifully but ignores injected
 * sources is actively harmful here, because the entire design depends on live
 * data overriding stale training.
 */
const QUALITY_ORDER: Array<{ rx: RegExp; tier: Tier; rank: number }> = [
  { rx: /^z-ai\/glm-[5-9]/i,                     tier: 'flagship', rank: 10 },
  { rx: /^deepseek\/deepseek-(v[4-9]|r[2-9])/i,  tier: 'flagship', rank: 12 },
  { rx: /^nvidia\/nemotron-\d+(\.\d+)?-ultra/i,  tier: 'flagship', rank: 15 },
  { rx: /^minimax\/minimax-m/i,                  tier: 'flagship', rank: 18 },
  { rx: /^qwen\/qwen3(\.\d+)?-(max|plus)/i,      tier: 'flagship', rank: 20 },
  { rx: /^openai\/gpt-oss-120b/i,                tier: 'flagship', rank: 22 },
  { rx: /^nvidia\/nemotron-\d+(\.\d+)?-super/i,  tier: 'flagship', rank: 25 },
  { rx: /^thinkingmachines\/inkling$/i,          tier: 'flagship', rank: 28 },
  { rx: /^google\/gemma-[4-9]/i,                 tier: 'balanced', rank: 30 },
  { rx: /^qwen\/qwen3(\.\d+)?-(flash|\d+b)/i,    tier: 'balanced', rank: 35 },
  { rx: /^openai\/gpt-oss-20b/i,                 tier: 'balanced', rank: 40 },
  { rx: /^thinkingmachines\/inkling-small/i,     tier: 'balanced', rank: 42 },
  { rx: /^poolside\/laguna-s/i,                  tier: 'balanced', rank: 45 },
  { rx: /^nvidia\/nemotron-\d+(\.\d+)?-nano/i,   tier: 'fast',     rank: 55 },
  { rx: /^liquid\/lfm/i,                         tier: 'fast',     rank: 60 },
  { rx: /^poolside\/laguna-xs/i,                 tier: 'fast',     rank: 62 },
];

// Never route user chat through these regardless of availability.
const EXCLUDE_RX = /(content-safety|safeguard|guard|moderation|embed|rerank|tts|whisper|image-gen|-code(?::free)?$|note-preview)/i;

function classify(id: string): { tier: Tier; rank: number } | null {
  for (const q of QUALITY_ORDER) {
    if (q.rx.test(id)) return { tier: q.tier, rank: q.rank };
  }
  return null;
}

function envInt(name: string, fallback: number): number {
  const v = Deno.env.get(name);
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Discover currently-live OpenRouter models.
 * Returns [] on any failure — the caller falls back to the static registry.
 */
export async function discoverOpenRouter(timeoutMs = 4000): Promise<MeshModel[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(OPENROUTER_CATALOG, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[CATALOG] OpenRouter returned HTTP ${res.status}`);
      return [];
    }
    const body = await res.json();
    const entries: CatalogEntry[] = body?.data || [];
    if (!entries.length) return [];

    const orCap = envInt('OPENROUTER_DAILY_CAP', 50);
    const allowPaid = Deno.env.get('ENABLE_PAID_FALLBACK') === '1';
    const maxPaidPrompt = parseFloat(Deno.env.get('MAX_PAID_PROMPT_USD_PER_MTOK') || '0.10') / 1e6;

    const out: Array<MeshModel & { rank: number }> = [];
    for (const e of entries) {
      if (!e?.id || EXCLUDE_RX.test(e.id)) continue;
      const isFree = e.id.endsWith(':free');
      const promptPrice = parseFloat(e.pricing?.prompt || '0');

      // Paid models are opt-in and only the genuinely cheap ones. At a few
      // users a day these cost cents, and the cap makes runaway spend
      // structurally impossible rather than merely unlikely.
      if (!isFree) {
        if (!allowPaid) continue;
        if (!(promptPrice > 0 && promptPrice <= maxPaidPrompt)) continue;
      }

      const cls = classify(e.id);
      if (!cls) continue;   // unknown family — don't gamble on unvetted models

      const vision = (e.architecture?.input_modalities || []).includes('image');
      out.push({
        provider: 'OpenRouter',
        id: e.id,
        vision,
        tier: cls.tier,
        dailyCap: isFree ? orCap : envInt('PAID_DAILY_CAP', 2000),
        // cost 1 = free-but-capped, 2 = paid. Keeps free tiers spent first.
        cost: isFree ? 1 : 2,
        ctx: e.context_length || 128000,
        rank: cls.rank,
      });
    }

    out.sort((a, b) => (a.cost - b.cost) || (a.rank - b.rank));
    console.log(`[CATALOG] discovered ${out.length} usable OpenRouter models (${out.filter(m => m.vision).length} vision)`);
    return out.map(({ rank: _rank, ...m }) => m);
  } catch (e) {
    console.warn('[CATALOG] discovery failed:', (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

/**
 * Cached discovery. Never throws, never blocks longer than the timeout, and
 * serves a stale cache in preference to nothing.
 */
export async function getDiscoveredModels(staticFallback: MeshModel[]): Promise<DiscoveryResult> {
  const now = Date.now();
  if (cache && now - cache.ts < CATALOG_TTL_MS) {
    return { ...cache.result, source: 'cache' };
  }
  if (inflight) return await inflight;

  inflight = (async (): Promise<DiscoveryResult> => {
    const live = await discoverOpenRouter();
    if (live.length > 0) {
      const result: DiscoveryResult = {
        models: live,
        source: 'live',
        fetchedAt: Date.now(),
        freeCount: live.filter(m => m.cost === 1).length,
        visionCount: live.filter(m => m.vision).length,
      };
      cache = { ts: Date.now(), result };
      return result;
    }
    // Discovery unavailable. Prefer a stale cache over the static list —
    // even yesterday's live catalog beats a list frozen at deploy time.
    if (cache) return { ...cache.result, source: 'cache' };
    const orStatic = staticFallback.filter(m => m.provider === 'OpenRouter');
    return {
      models: orStatic,
      source: 'fallback',
      fetchedAt: 0,
      freeCount: orStatic.length,
      visionCount: orStatic.filter(m => m.vision).length,
    };
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Test seam: drop the memo so a test can re-run discovery. */
export function __resetCatalogCache() {
  cache = null;
  inflight = null;
}
