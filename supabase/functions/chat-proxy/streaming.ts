// ═══════════════════════════════════════════════════════════════════════════
//  STREAMING — Server-Sent Events for the chat proxy
//  ───────────────────────────────────────────────────────────────────────
//  Why this matters here more than in a typical chat app: PULSE and the omni
//  scraper both run to completion BEFORE the first token is generated, so the
//  user previously watched a spinner for several seconds with no signal that
//  anything was happening. Streaming carries two payloads:
//
//    1. stage events during retrieval  ("searching official sources…")
//    2. token deltas once generation starts
//
//  ── Fallback semantics ─────────────────────────────────────────────────
//  A provider that fails BEFORE its first token is simply swapped out. One
//  that stops part-way — the connection drops, or the model halts on a
//  RECITATION / SAFETY stop and returns half an answer as if it were whole —
//  throws StreamCutError. The mesh then sends a `reset` event, which clears
//  the partial text on the client, before the next model starts, so the
//  reader never sees two answers glued together. (One production /missables
//  reply ended at "### 1. Right" and was delivered as complete.)
// ═══════════════════════════════════════════════════════════════════════════

import { createReasoningFilter, stripReasoning } from './reasoning.ts';

export type SseEvent =
  | { type: 'stage'; stage: string; detail?: string }
  | { type: 'meta'; meta: Record<string, unknown> }
  | { type: 'delta'; text: string }
  | { type: 'final'; text: string; meta?: Record<string, unknown> }
  | { type: 'reset' }
  | { type: 'error'; message: string };

/** A stream that started and then stopped short. `partial` is what it said. */
export class StreamCutError extends Error {
  reason: string;
  partial: string;
  constructor(reason: string, partial: string) {
    super(`STREAM_CUT:${reason}`);
    this.name = 'StreamCutError';
    this.reason = reason;
    this.partial = partial;
  }
}

// Gemini stops that still mean "the answer is finished". MAX_TOKENS is a
// long answer hitting the cap — complete enough to keep, not a failure.
const GEMINI_DONE = new Set(['STOP', 'MAX_TOKENS', 'FINISH_REASON_UNSPECIFIED']);

export function sseHeaders(cors: Record<string, string>) {
  return {
    ...cors,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // Disable proxy buffering, which otherwise defeats the whole point.
    'X-Accel-Buffering': 'no',
  };
}

export function encodeSse(ev: SseEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(ev)}\n\n`);
}

/** Writer bound to one response stream. Swallows post-close writes. */
export class SseWriter {
  private closed = false;
  // A plain field, not a parameter property: the test suite loads this file
  // with Node's type stripping, which can't compile parameter properties.
  private ctrl: ReadableStreamDefaultController<Uint8Array>;
  constructor(ctrl: ReadableStreamDefaultController<Uint8Array>) { this.ctrl = ctrl; }

  send(ev: SseEvent) {
    if (this.closed) return;
    try {
      this.ctrl.enqueue(encodeSse(ev));
    } catch {
      // Client hung up mid-write; stop trying.
      this.closed = true;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.ctrl.close(); } catch { /* already closed */ }
  }

  get isClosed() { return this.closed; }
}

// ───────────────────────────────────────────────────────────────────────────
//  OpenAI-compatible streaming
// ───────────────────────────────────────────────────────────────────────────

export interface StreamAttempt {
  /** Resolves once the first token arrives; rejects if the model never starts. */
  firstToken: Promise<void>;
  /** Full text once the stream completes. */
  done: Promise<string>;
}

/**
 * Stream one OpenAI-compatible completion, forwarding deltas to `onDelta`.
 *
 * Returns only after the stream ends. Throws if the request fails before any
 * token is produced, which is the signal the caller uses to try another model.
 */
export async function streamOpenAICompat(
  endpoint: string,
  apiKey: string,
  modelId: string,
  messages: unknown[],
  opts: {
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    extraHeaders?: Record<string, string>;
    onDelta: (text: string) => void;
    onFirstToken?: () => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
  opts.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  // Outside the try so the catch can tell a failure before the first token
  // (swap models) from one after it (a cut — the client must be reset).
  let full = '';
  let sawToken = false;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(opts.extraHeaders || {}),
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: opts.temperature ?? 0.72,
        max_tokens: opts.maxTokens ?? 2400,
        top_p: 0.95,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP_${res.status}:${errText.slice(0, 240)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawDone = false;
    let finishReason: string | null = null;
    // Reasoning models emit <think>…</think> inline. Filter the visible
    // stream; the full buffer still accumulates raw so we can strip it once at the end.
    const reasoning = createReasoningFilter();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; a frame may hold several
      // "data:" lines and can split across chunk boundaries.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') { sawDone = true; continue; }
          if (!payload) continue;
          try {
            const json = JSON.parse(payload);
            const fin = json?.choices?.[0]?.finish_reason;
            if (typeof fin === 'string' && fin) finishReason = fin;
            const delta = json?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length) {
              full += delta;
              const visible = reasoning.push(delta);
              if (visible) {
                // Only count a token as "first" once something real is shown —
                // otherwise the UI drops its progress indicator while the model
                // is still silently thinking.
                if (!sawToken) { sawToken = true; opts.onFirstToken?.(); }
                opts.onDelta(visible);
              }
            }
          } catch {
            // Partial or non-JSON keepalive frame — ignore.
          }
        }
      }
    }

    const tail = reasoning.finish();
    if (tail) {
      if (!sawToken) { sawToken = true; opts.onFirstToken?.(); }
      opts.onDelta(tail);
    }
    const cleaned = stripReasoning(full);
    if (!cleaned.trim()) throw new Error('EMPTY_RESPONSE');
    // No finish_reason and no [DONE]: the connection ended mid-answer.
    if (!sawDone && !finishReason) throw new StreamCutError('dropped', cleaned);
    if (finishReason === 'content_filter') throw new StreamCutError('content_filter', cleaned);
    return cleaned;
  } catch (e) {
    // A network error after text was shown is a cut, not a clean failure.
    if (e instanceof StreamCutError || !(e instanceof Error) || e.message === 'EMPTY_RESPONSE') throw e;
    if (sawToken) throw new StreamCutError(e.name === 'AbortError' ? 'timeout' : 'network', stripReasoning(full));
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Gemini streaming (native SDK)
// ───────────────────────────────────────────────────────────────────────────

export async function streamGemini(
  ai: any,
  model: string,
  contents: unknown,
  systemInstruction: string,
  opts: {
    temperature?: number;
    maxOutputTokens?: number;
    onDelta: (text: string) => void;
    onFirstToken?: () => void;
  },
): Promise<string> {
  const stream = await ai.models.generateContentStream({
    model,
    contents,
    config: {
      systemInstruction,
      temperature: opts.temperature ?? 0.72,
      maxOutputTokens: opts.maxOutputTokens ?? 2400,
    },
  });

  let full = '';
  let sawToken = false;
  let finish: string | null = null;
  const reasoning = createReasoningFilter();
  try {
    for await (const chunk of stream) {
      const reason = chunk?.candidates?.[0]?.finishReason;
      if (typeof reason === 'string' && reason) finish = reason;
      const t = chunk?.text;
      if (typeof t === 'string' && t.length) {
        full += t;
        const visible = reasoning.push(t);
        if (visible) {
          if (!sawToken) { sawToken = true; opts.onFirstToken?.(); }
          opts.onDelta(visible);
        }
      }
    }
  } catch (e) {
    if (sawToken) throw new StreamCutError('network', stripReasoning(full));
    throw e;
  }
  const tail = reasoning.finish();
  if (tail) {
    if (!sawToken) { sawToken = true; opts.onFirstToken?.(); }
    opts.onDelta(tail);
  }
  const cleaned = stripReasoning(full);
  if (!cleaned.trim()) throw new Error('EMPTY_RESPONSE');
  // RECITATION, SAFETY, OTHER…: the model stopped, and the SDK hands back
  // the half answer as though it were complete.
  if (finish && !GEMINI_DONE.has(finish)) throw new StreamCutError(finish.toLowerCase(), cleaned);
  return cleaned;
}
