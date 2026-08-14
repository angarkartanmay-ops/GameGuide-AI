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
//  A provider may only be swapped out BEFORE it emits its first token. Once
//  text has reached the client we are committed: silently restarting on a
//  different model would duplicate or contradict what the user already read.
//  So a mid-stream failure ends the turn with an explicit error event rather
//  than a silent retry.
// ═══════════════════════════════════════════════════════════════════════════

export type SseEvent =
  | { type: 'stage'; stage: string; detail?: string }
  | { type: 'meta'; meta: Record<string, unknown> }
  | { type: 'delta'; text: string }
  | { type: 'final'; text: string; meta?: Record<string, unknown> }
  | { type: 'error'; message: string };

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
  constructor(private ctrl: ReadableStreamDefaultController<Uint8Array>) {}

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
    let full = '';
    let sawToken = false;

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
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length) {
              if (!sawToken) { sawToken = true; opts.onFirstToken?.(); }
              full += delta;
              opts.onDelta(delta);
            }
          } catch {
            // Partial or non-JSON keepalive frame — ignore.
          }
        }
      }
    }

    if (!full.trim()) throw new Error('EMPTY_RESPONSE');
    return full;
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
  for await (const chunk of stream) {
    const t = chunk?.text;
    if (typeof t === 'string' && t.length) {
      if (!sawToken) { sawToken = true; opts.onFirstToken?.(); }
      full += t;
      opts.onDelta(t);
    }
  }
  if (!full.trim()) throw new Error('EMPTY_RESPONSE');
  return full;
}
