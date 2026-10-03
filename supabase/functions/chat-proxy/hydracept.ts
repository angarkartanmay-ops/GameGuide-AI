// ═══════════════════════════════════════════════════════════════════════════
//  HYDRACEPT — the paid model behind the free mesh
//  ───────────────────────────────────────────────────────────────────────
//  Everything else in the mesh runs on free tiers, and free tiers run out:
//  locally Groq answered 429, Cerebras 402 "payment required" and the agentic
//  model 404, all in one session. When every free model has failed, a turn
//  used to end in "MESH_EXHAUSTED". Hydracept (managed inference, prepaid
//  credit) answers it instead.
//
//  It also leads for one kind of question: a /missables list. On the free
//  models those lists invented items outright (one run described Bloodborne
//  mechanics for Elden Ring), and an invented "you can miss this" is worse
//  than no answer. A stronger model is worth a fraction of a cent there.
//
//  Text only (no images), synchronous invoke: the fast text capability is
//  capped at ~60s and 2048 output tokens on that route, which fits a chat
//  answer. Off unless HYDRACEPT_API_KEY and HYDRACEPT_PROJECT_ID are set.
//  The key stays server-side — never ship it to the browser or the bot.
//
//  Pure apart from fetch and Deno.env, so tests can stub both.
// ═══════════════════════════════════════════════════════════════════════════

export const HYDRACEPT_CAPABILITY = 'text.general.fast.v1';
const API = 'https://api.hydracept.com';
const MAX_OUTPUT = 2048;          // the invoke route's ceiling for this capability
const TIMEOUT_MS = 55_000;        // just under the route's ~60s envelope

type Role = 'system' | 'user' | 'assistant';
export interface HydraceptMessage { role: Role; content: string }

export interface HydraceptConfig {
  apiKey: string;
  projectId: string;
  environment: string;
  /** 'fallback' (default): only after every free model failed. 'off': never. */
  mode: 'fallback' | 'off';
  /** Lead with Hydracept for missables lists (default on). */
  missablesFirst: boolean;
}

const env = (k: string): string => {
  try { return (globalThis as any).Deno?.env.get(k) ?? ''; } catch { return ''; }
};

export function hydraceptConfig(): HydraceptConfig | null {
  const apiKey = env('HYDRACEPT_API_KEY').trim();
  const projectId = env('HYDRACEPT_PROJECT_ID').trim();
  if (!apiKey || !projectId) return null;
  const mode = env('HYDRACEPT_MODE').trim().toLowerCase() === 'off' ? 'off' : 'fallback';
  if (mode === 'off') return null;
  return {
    apiKey,
    projectId,
    environment: env('HYDRACEPT_ENVIRONMENT').trim() || 'development',
    mode,
    missablesFirst: env('HYDRACEPT_MISSABLES_FIRST').trim() !== '0',
  };
}

/**
 * The mesh's OpenAI-style messages, reduced to what the capability accepts:
 * plain-string content, three roles, nothing empty. Image parts are dropped
 * (callers don't route vision turns here).
 */
export function toHydraceptMessages(msgs: Array<{ role: string; content: unknown }>): HydraceptMessage[] {
  const out: HydraceptMessage[] = [];
  for (const m of msgs || []) {
    const role: Role = m?.role === 'system' ? 'system' : m?.role === 'user' ? 'user' : 'assistant';
    const content = typeof m?.content === 'string'
      ? m.content
      : Array.isArray(m?.content)
        ? (m.content as any[]).filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n')
        : '';
    if (content.trim()) out.push({ role, content });
  }
  return out;
}

export interface HydraceptResult { text: string; provider: string; model: string; costUsd: number | null }

/**
 * One synchronous completion. Throws on any failure — the caller treats it
 * like any other provider error. Error messages carry the HTTP status and
 * Hydracept's error code only, never the response body.
 */
export async function callHydracept(
  cfg: HydraceptConfig,
  messages: HydraceptMessage[],
  opts: { maxTokens?: number; signal?: AbortSignal; ref?: string; retryDelayMs?: number } = {},
): Promise<HydraceptResult> {
  // While wiring this up the invoke route answered HTTP 500 to several calls
  // in a row, identical calls a minute later succeeding. One retry on a 5xx;
  // anything else (4xx, a failed execution) is final.
  try {
    return await invokeOnce(cfg, messages, opts);
  } catch (e) {
    if (!/^HTTP_5\d\d/.test((e as Error).message) || opts.signal?.aborted) throw e;
    await new Promise(r => setTimeout(r, opts.retryDelayMs ?? 800));
    return await invokeOnce(cfg, messages, opts);
  }
}

async function invokeOnce(
  cfg: HydraceptConfig,
  messages: HydraceptMessage[],
  opts: { maxTokens?: number; signal?: AbortSignal; ref?: string },
): Promise<HydraceptResult> {
  const body = {
    context: { projectId: cfg.projectId, productId: cfg.projectId, environment: cfg.environment },
    input: { messages, maxOutputTokens: Math.min(MAX_OUTPUT, Math.max(256, opts.maxTokens ?? 1800)) },
    execution: { executionPreference: 'automatic', billingMode: 'managed' },
    tags: ['gameguide', 'chat'],
    ...(opts.ref ? { externalRef: opts.ref.slice(0, 255) } : {}),
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  opts.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(`${API}/v1/capabilities/${HYDRACEPT_CAPABILITY}/invoke`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
    });
    let data: any = null;
    try { data = await res.json(); } catch { /* fall through to the status check */ }
    if (!res.ok) {
      const code = typeof data?.errorCode === 'string' ? data.errorCode
        : typeof data?.code === 'string' ? data.code
        : typeof data?.error?.code === 'string' ? data.error.code : '';
      throw new Error(`HTTP_${res.status}${code ? `:${code.slice(0, 60)}` : ''}`);
    }
    const status = String(data?.status || '').toLowerCase();
    const text = typeof data?.typedOutput === 'string' ? data.typedOutput : '';
    if (status !== 'succeeded' || !text.trim()) {
      throw new Error(`HYDRACEPT_${(data?.errorCode || data?.terminationReason || status || 'empty').toString().slice(0, 60)}`);
    }
    const cost = Number(data?.actualCost ?? data?.usage?.actualCost);
    return {
      text,
      provider: 'Hydracept',
      model: typeof data?.resolvedModel === 'string' && data.resolvedModel ? data.resolvedModel : HYDRACEPT_CAPABILITY,
      costUsd: Number.isFinite(cost) ? cost : null,
    };
  } finally {
    clearTimeout(timer);
  }
}
