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
  // Optional hyphen: OpenRouter/Groq publish `qwen3.8-27b`, Cerebras publishes
  // `qwen-3.8-27b`. Same family, two spellings.
  { rx: /^qwen\/qwen-?3(\.\d+)?-(flash|\d+b)/i,  tier: 'balanced', rank: 35 },
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

// ── OpenAI-compatible provider discovery (Groq, Cerebras) ─────────────────
//  These were originally left out on the premise that they "publish short
//  stable lists". Measured 2026-09-05, that premise was false: Groq had
//  retired BOTH Llama entries (llama-3.3-70b-versatile, llama-3.1-8b-instant)
//  — half the registry, including the entire `fast` tier — while gaining two
//  Qwen models nothing knew to use. Cerebras had likewise gained one.
//
//  The circuit breaker does eventually route around a dead id, but only after
//  paying a failed round trip, on every cold start, forever. Both providers
//  expose a standard /v1/models endpoint, so ask them instead of guessing.

interface ProviderProbe {
  provider: string;
  url: string;
  keyEnv: string;
  capEnv: string;
  capDefault: number;
  ctx: number;
}

const OPENAI_COMPAT_PROBES: ProviderProbe[] = [
  { provider: 'Groq',     url: 'https://api.groq.com/openai/v1/models', keyEnv: 'GROQ_API_KEY',     capEnv: 'GROQ_DAILY_CAP',     capDefault: 1000, ctx: 131072 },
  { provider: 'Cerebras', url: 'https://api.cerebras.ai/v1/models',     keyEnv: 'CEREBRAS_API_KEY', capEnv: 'CEREBRAS_DAILY_CAP', capDefault: 800,  ctx: 65000 },
];

/**
 * Discover live chat models on an OpenAI-compatible provider.
 *
 * Reuses the same QUALITY_ORDER/EXCLUDE_RX vetting as OpenRouter, so a
 * newly-appeared model is only adopted if it belongs to a family already
 * trusted for this workload — discovery widens coverage without lowering the
 * bar. Bare ids (Cerebras style, e.g. `gpt-oss-120b`) are matched by
 * normalising to a vendor-prefixed form first.
 */
export async function discoverOpenAICompat(probe: ProviderProbe, timeoutMs = 4000): Promise<MeshModel[]> {
  const key = Deno.env.get(probe.keyEnv);
  if (!key) return [];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(probe.url, {
      signal: ctrl.signal,
      headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[CATALOG] ${probe.provider} returned HTTP ${res.status}`);
      return [];
    }
    const body = await res.json();
    const ids: string[] = (body?.data || []).map((m: any) => m?.id).filter(Boolean);
    if (!ids.length) return [];

    const cap = envInt(probe.capEnv, probe.capDefault);
    const out: Array<MeshModel & { rank: number }> = [];
    for (const id of ids) {
      if (EXCLUDE_RX.test(id)) continue;
      // Agentic systems are routed separately (see meshRouter GROQ_AGENTIC);
      // they must not enter the general chat rotation.
      if (/^groq\/compound/i.test(id)) continue;
      // Cerebras publishes bare ids; try the id as-is and vendor-prefixed so
      // the shared QUALITY_ORDER patterns (which expect `vendor/model`) match.
      const cls = classify(id) || classify(`openai/${id}`) || classify(`qwen/${id}`) || classify(`google/${id}`);
      if (!cls) continue;
      out.push({
        provider: probe.provider,
        id,
        vision: false,          // none of these expose image input today
        tier: cls.tier,
        dailyCap: cap,
        cost: 0,                // free and rate-limited, not credit-metered
        ctx: probe.ctx,
        rank: cls.rank,
      });
    }
    out.sort((a, b) => a.rank - b.rank);
    console.log(`[CATALOG] ${probe.provider}: discovered ${out.length} usable models`);
    return out.map(({ rank: _rank, ...m }) => m);
  } catch (e) {
    console.warn(`[CATALOG] ${probe.provider} discovery failed:`, (e as Error).message);
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
    // All three providers in parallel — one slow or failing provider must not
    // hold up the others, and each falls back to [] independently.
    const [orLive, ...compatLive] = await Promise.all([
      discoverOpenRouter(),
      ...OPENAI_COMPAT_PROBES.map(p => discoverOpenAICompat(p)),
    ]);

    // Keep each provider's static entries only where discovery came back
    // empty, so a transient outage degrades to the old list per-provider
    // rather than wiping that provider from the mesh entirely.
    const discovered: MeshModel[] = [...orLive];
    for (let i = 0; i < OPENAI_COMPAT_PROBES.length; i++) {
      const probe = OPENAI_COMPAT_PROBES[i];
      const found = compatLive[i] || [];
      discovered.push(...(found.length ? found : staticFallback.filter(m => m.provider === probe.provider)));
    }
    if (!orLive.length) {
      discovered.push(...staticFallback.filter(m => m.provider === 'OpenRouter'));
    }

    if (orLive.length > 0 || compatLive.some(l => l.length > 0)) {
      const result: DiscoveryResult = {
        models: discovered,
        source: 'live',
        fetchedAt: Date.now(),
        freeCount: discovered.filter(m => m.cost <= 1).length,
        visionCount: discovered.filter(m => m.vision).length,
      };
      cache = { ts: Date.now(), result };
      return result;
    }
    // Discovery unavailable everywhere. Prefer a stale cache over the static
    // list — even yesterday's live catalog beats a list frozen at deploy time.
    if (cache) return { ...cache.result, source: 'cache' };
    const anyStatic = staticFallback.filter(m => m.provider !== 'Gemini');
    return {
      models: anyStatic,
      source: 'fallback',
      fetchedAt: 0,
      freeCount: anyStatic.length,
      visionCount: anyStatic.filter(m => m.vision).length,
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
