// ═══════════════════════════════════════════════════════════════════════════
//  NEURAL MESH v3 — model registry + budget-aware router
//  ───────────────────────────────────────────────────────────────────────
//  Replaces the v2 waterfall, which walked a hardcoded list on every request
//  and had two structural problems:
//
//    1. Dead models. Every OpenRouter id in v2 had been retired upstream, so
//       the entire fallback tier — including all three vision models — failed
//       100% of the time. Verified against the live /models endpoints.
//    2. No memory. A rate-limited provider was retried on every subsequent
//       request, paying the full timeout each time, because the breaker lived
//       in per-isolate memory that cold starts kept discarding.
//
//  v3 fixes both: ids are verified, health lives in Postgres (shared across
//  isolates), and routing spends the free tiers in cost order while staying
//  inside each one's daily allowance.
//
//  ── Refresh procedure (do this, don't guess) ────────────────────────────
//    Groq:       https://console.groq.com/docs/models
//    OpenRouter: curl -s https://openrouter.ai/api/v1/models \
//                  | jq -r '.data[] | select(.id|endswith(":free")) | .id'
//    Cerebras:   https://inference-docs.cerebras.ai/models/overview
//    Gemini:     https://ai.google.dev/gemini-api/docs/models
//  A dead id is invisible at deploy time and only shows up as silent
//  degradation, so re-verify whenever quality drops for no obvious reason.
// ═══════════════════════════════════════════════════════════════════════════

import { MeshState } from './meshDb.ts';

export type Tier = 'flagship' | 'balanced' | 'fast';

export interface MeshModel {
  provider: string;
  id: string;
  vision: boolean;
  tier: Tier;
  /** Conservative free-tier requests/day. Override via env when you upgrade. */
  dailyCap: number;
  /** Lower spends first. 0 = truly free and rate-limited only. */
  cost: number;
  ctx: number;
}

export interface ProviderConfig {
  name: string;
  endpoint: string;
  keyEnv: string;
  timeoutMs: number;
  extraHeaders?: Record<string, string>;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  Groq: {
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    keyEnv: 'GROQ_API_KEY',
    timeoutMs: 25_000,
  },
  Cerebras: {
    name: 'Cerebras',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
    keyEnv: 'CEREBRAS_API_KEY',
    timeoutMs: 20_000,
  },
  OpenRouter: {
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    keyEnv: 'OPENROUTER_API_KEY',
    timeoutMs: 30_000,
    extraHeaders: {
      'HTTP-Referer': 'https://game-guide-ai-plum.vercel.app',
      'X-Title': 'GameGuide-AI',
    },
  },
};

function envInt(name: string, fallback: number): number {
  const v = Deno.env.get(name);
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── Verified registry ──────────────────────────────────────────────────────
// Groq free tier is rate-limited (30 RPM / ~1000 RPD per model) rather than
// credit-metered — no card, nothing to run out of. That makes it the default
// workhorse and the reason regular daily use by a few people costs nothing.
export function buildRegistry(): MeshModel[] {
  const groqCap = envInt('GROQ_DAILY_CAP', 1000);
  const cerebrasCap = envInt('CEREBRAS_DAILY_CAP', 800);
  // OpenRouter free models allow ~50/day with no credit balance, ~1000/day
  // once the account holds credit. Default assumes the free case.
  const orCap = envInt('OPENROUTER_DAILY_CAP', 50);

  return [
    // ── Groq: fastest + effectively unmetered. Spend here first. ──────────
    { provider: 'Groq', id: 'openai/gpt-oss-120b',      vision: false, tier: 'flagship', dailyCap: groqCap, cost: 0, ctx: 131072 },
    { provider: 'Groq', id: 'llama-3.3-70b-versatile',  vision: false, tier: 'flagship', dailyCap: groqCap, cost: 0, ctx: 131072 },
    { provider: 'Groq', id: 'openai/gpt-oss-20b',       vision: false, tier: 'balanced', dailyCap: groqCap, cost: 0, ctx: 131072 },
    { provider: 'Groq', id: 'llama-3.1-8b-instant',     vision: false, tier: 'fast',     dailyCap: groqCap, cost: 0, ctx: 131072 },

    // ── Cerebras: also very fast, separate quota pool. ────────────────────
    { provider: 'Cerebras', id: 'gpt-oss-120b', vision: false, tier: 'flagship', dailyCap: cerebrasCap, cost: 0, ctx: 65000 },
    // NOTE: zai-glm-4.7 was retired upstream (verified 2026-08-25); Cerebras
    // now publishes only gpt-oss-120b and gemma-4-31b.
    { provider: 'Cerebras', id: 'gemma-4-31b',  vision: false, tier: 'balanced', dailyCap: cerebrasCap, cost: 0, ctx: 65000 },

    // ── OpenRouter free tier: smallest daily allowance, so it sits last. ──
    // These are the only free VISION models available anywhere in the mesh
    // besides Gemini, which is why the vision chain leans on Gemini first.
    { provider: 'OpenRouter', id: 'google/gemma-4-31b-it:free',            vision: true,  tier: 'balanced', dailyCap: orCap, cost: 1, ctx: 262144 },
    { provider: 'OpenRouter', id: 'nvidia/nemotron-3-ultra-550b-a55b:free', vision: false, tier: 'flagship', dailyCap: orCap, cost: 1, ctx: 1000000 },
    { provider: 'OpenRouter', id: 'nvidia/nemotron-3-super-120b-a12b:free', vision: false, tier: 'flagship', dailyCap: orCap, cost: 1, ctx: 262144 },
  ];
}

// ── Agentic systems ────────────────────────────────────────────────────────
//  Groq's compound systems run their own web search, page visits, code
//  execution and Wolfram lookups server-side before answering, using the same
//  chat-completions API. That matters here more than a benchmark score:
//  the failure this project keeps hitting is recency, and a model that can
//  search for itself closes that gap even when our own retrieval comes back
//  thin. They are billed as normal Groq free-tier traffic (rate-limited, not
//  credit-metered), so using them costs nothing extra.
//
//  compound-mini makes a single tool call at ~3x lower latency; compound
//  makes several. Reserve the slower one for genuinely deep questions.
export const GROQ_AGENTIC = {
  // Verified 2026-08-25: groq/compound returns HTTP 413 for our request size
  // even with a minimal system prompt, while compound-mini succeeds. Mini is
  // also ~3x lower latency, which matters because its tool calls run before
  // the first token. Both entries point at mini until that changes.
  fast: 'groq/compound-mini',
  deep: 'groq/compound-mini',
};

/**
 * Should this query go to an agentic (self-searching) model?
 *
 * Only when recency is actually load-bearing. Routing everything here would
 * add tool-call latency to questions that a plain model answers correctly
 * from the context we already injected.
 */
export function wantsAgentic(need: RouteNeed & { temporal?: boolean }): 'fast' | 'deep' | null {
  if (!Deno.env.get('GROQ_API_KEY')) return null;
  if (Deno.env.get('DISABLE_AGENTIC') === '1') return null;
  // Vision is not supported by the compound systems.
  if (need.vision) return null;
  if (!need.temporal) return null;
  return need.complexity === 'deep' ? 'deep' : 'fast';
}

// Gemini is called through its own SDK rather than the OpenAI-compatible path,
// so it is routed separately. Ordered newest-capable first with an older
// stable id as the safety net.
export const GEMINI_TEXT_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
];
export const GEMINI_VISION_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
];
export const GEMINI_OCR_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_IMAGE_MODELS = [
  'gemini-3.1-flash-image',
  'gemini-2.5-flash-image',
];

// ── Routing ────────────────────────────────────────────────────────────────

export interface RouteNeed {
  vision: boolean;
  complexity: 'simple' | 'medium' | 'deep';
  intent: string;
  /** True when the question is about current/latest state; drives agentic routing. */
  temporal?: boolean;
}

export interface RouteCandidate {
  provider: ProviderConfig;
  model: MeshModel;
  /** Why this slot was chosen — surfaced in logs for debugging. */
  reason: string;
}

/** Fraction of a model's daily cap past which we start avoiding it. */
const SOFT_BUDGET = 0.85;

/**
 * Order the mesh for one request.
 *
 * Ranking, in order of precedence:
 *   1. Capability   — a text-only model can never serve a vision request.
 *   2. Availability — models in circuit-breaker cooldown drop to the back.
 *   3. Budget       — models past their soft cap drop; past the hard cap, out.
 *   4. Cost         — free-and-unmetered before free-but-capped.
 *   5. Fit          — tier matched to query complexity.
 */
export function planRoute(
  need: RouteNeed,
  state: MeshState,
  registry = buildRegistry(),
  discovered?: MeshModel[],
): RouteCandidate[] {
  // Live discovery supersedes the static OpenRouter entries entirely. Those
  // ids are frozen at deploy time and measurably rot within days; a live
  // catalog is always the better source of truth when we have one.
  if (discovered && discovered.length) {
    registry = registry.filter(m => m.provider !== 'OpenRouter').concat(discovered);
  }
  const wantTier: Tier =
    need.complexity === 'simple' ? 'fast'
    : need.complexity === 'deep' || need.intent === 'lore' || need.intent === 'build' || need.intent === 'comparison'
      ? 'flagship'
      : 'balanced';

  const tierRank = (t: Tier): number => {
    if (t === wantTier) return 0;
    // Prefer trading up over trading down: a bigger model on a simple question
    // is merely wasteful, a tiny model on a deep one is a bad answer.
    if (wantTier === 'fast') return t === 'balanced' ? 1 : 2;
    if (wantTier === 'balanced') return t === 'flagship' ? 1 : 2;
    return t === 'balanced' ? 1 : 2;
  };

  const scored = registry
    .filter(m => !!Deno.env.get(PROVIDERS[m.provider]?.keyEnv || ''))
    .filter(m => (need.vision ? m.vision : true))
    .map(m => {
      const key = `${m.provider}|${m.id}`;
      const cooldown = state.cooldowns[key] || 0;
      const used = state.usage[key] || 0;
      const overSoft = used >= m.dailyCap * SOFT_BUDGET;
      const overHard = used >= m.dailyCap;
      return { m, key, cooldown, used, overSoft, overHard };
    })
    // A model past its hard cap is removed entirely — calling it would either
    // fail or start costing money, and both defeat the point.
    .filter(x => !x.overHard)
    .sort((a, b) => {
      if ((a.cooldown > 0) !== (b.cooldown > 0)) return a.cooldown > 0 ? 1 : -1;
      if (a.overSoft !== b.overSoft) return a.overSoft ? 1 : -1;
      if (a.m.cost !== b.m.cost) return a.m.cost - b.m.cost;
      const tr = tierRank(a.m.tier) - tierRank(b.m.tier);
      if (tr !== 0) return tr;
      // Spread load across equivalent models so one never starves first.
      return (a.used / a.m.dailyCap) - (b.used / b.m.dailyCap);
    });

  return scored.map(x => ({
    provider: PROVIDERS[x.m.provider],
    model: x.m,
    reason: x.cooldown > 0 ? `cooldown ${x.cooldown}s`
          : x.overSoft ? `soft-capped ${x.used}/${x.m.dailyCap}`
          : `${x.used}/${x.m.dailyCap}`,
  }));
}

/**
 * Should Gemini be tried before the OpenAI-compatible mesh?
 *
 * For vision, yes — it is the strongest free vision model available and the
 * OpenRouter vision models have a 50/day allowance we want to preserve.
 * For text, no — Groq is faster and effectively unmetered, so Gemini is held
 * in reserve as a fallback.
 */
export function geminiFirst(need: RouteNeed, state: MeshState, route?: RouteCandidate[]): boolean {
  if (!Deno.env.get('GOOGLE_API_KEY')) return false;
  const cd = state.cooldowns['Gemini|vision'] || 0;
  if (cd > 0) return false;

  // Vision: Gemini is the strongest free option and it preserves the 50/day
  // OpenRouter vision allowance.
  if (need.vision) return true;

  // Text: Groq and Cerebras are far faster, so Gemini normally waits. But when
  // both are rate-limited the route falls through to OpenRouter's free tier,
  // which QUEUES — measured at 80s for a single answer. Gemini Flash is
  // seconds. If nothing unmetered survives, go to Gemini before the queue.
  if (route && route.length > 0 && route[0].model.cost > 0) return true;

  return false;
}
