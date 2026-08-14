import { supabase } from './supabaseClient';

/**
 * Streaming chat via Server-Sent Events.
 *
 * The backend runs retrieval (live web search, wiki/Reddit scraping, OCR)
 * before the first token exists, so it emits `stage` events during that phase
 * and `delta` events once generation starts. Surfacing the stages is the whole
 * point — it replaces a multi-second blank spinner with visible progress.
 *
 * Callbacks:
 *   onStage(stage, detail) — retrieval progress
 *   onDelta(textChunk)     — append to the visible message
 *   onFinal(text, meta)    — authoritative final text; REPLACES the accumulated
 *                            deltas, because the server applies post-processing
 *                            (follow-up chips, uncertainty scrubbing) only once
 *                            the full response exists.
 *
 * Falls back to the non-streaming endpoint if streaming fails before any token
 * arrives, so a proxy that buffers SSE cannot break chat entirely.
 */
export const streamChatResponse = async (
  prompt,
  chatHistory,
  {
    redditContext = '',
    wikiContext = '',
    priceContext = '',
    attachments = [],
    signal = null,
    ephemeral = false,
    onStage = () => {},
    onDelta = () => {},
    onFinal = () => {},
  } = {},
) => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const MAX_HISTORY_MESSAGES = 12;

  // Prefer the signed-in user's token so the server buckets rate limits by
  // account (a much higher allowance) rather than by shared IP.
  let authToken = anonKey;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) authToken = data.session.access_token;
  } catch { /* not signed in — anon key is fine */ }

  let sawToken = false;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/chat-proxy`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'apikey': anonKey,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        prompt,
        chatHistory: chatHistory.slice(-MAX_HISTORY_MESSAGES),
        redditContext,
        wikiContext,
        priceContext,
        attachments,
        stream: true,
        ephemeral,
      }),
    });

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      onFinal(data.text || 'Rate limit reached — give it a moment.', data._meta || { rateLimited: true });
      return { text: data.text || '', images: [], meta: data._meta || null };
    }
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    let finalText = null;
    let finalMeta = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Frames are blank-line separated and may split across network chunks.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (!payload) continue;
          let ev;
          try { ev = JSON.parse(payload); } catch { continue; }

          if (ev.type === 'stage') {
            onStage(ev.stage, ev.detail);
          } else if (ev.type === 'delta') {
            sawToken = true;
            accumulated += ev.text;
            onDelta(ev.text);
          } else if (ev.type === 'final') {
            finalText = ev.text || accumulated;
            finalMeta = ev.meta || null;
          } else if (ev.type === 'error') {
            throw new Error(ev.message || 'stream error');
          }
        }
      }
    }

    const text = finalText ?? accumulated;
    if (!text.trim()) throw new Error('EMPTY_STREAM');
    onFinal(text, finalMeta);
    return { text, images: [], meta: finalMeta };

  } catch (error) {
    if (error.name === 'AbortError') throw error;

    // Once tokens have rendered we cannot silently restart — a second answer
    // would contradict what the user already read. Surface it instead.
    if (sawToken) throw error;

    console.warn('[stream] falling back to non-streaming:', error.message);
    const res = await generateChatResponse(
      null, prompt, chatHistory, redditContext, wikiContext, attachments, priceContext, signal,
    );
    onFinal(res.text, res.meta);
    return res;
  }
};

/**
 * Standard text response using GameGuide-AI Supabase Edge Function.
 * Accepts optional image attachments for analysis.
 * Accepts an AbortSignal so the caller can cancel mid-flight.
 */
export const generateChatResponse = async (
  apiKey,
  prompt,
  chatHistory,
  redditContext = '',
  wikiContext = '',
  attachments = [],
  priceContext = '',
  signal = null   // ← AbortSignal for cancellation
) => {
  try {
    // ── Context trimming: only send last 12 message pairs to save tokens ──────
    const MAX_HISTORY_MESSAGES = 12;
    const trimmedHistory = chatHistory.slice(-MAX_HISTORY_MESSAGES);

    const invokeOptions = {
      body: {
        prompt,
        chatHistory: trimmedHistory,
        redditContext,
        wikiContext,
        attachments,
        priceContext,
      },
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
      },
    };

    // Supabase JS client doesn't expose signal directly, so we use a raw fetch
    // when a signal is provided so we can actually abort mid-flight.
    if (signal) {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(
        `${supabaseUrl}/functions/v1/chat-proxy`,
        {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`,
            'apikey': anonKey,
          },
          body: JSON.stringify(invokeOptions.body),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const data = await res.json();
      return { text: data.text, images: data.images || [], meta: data._meta || null };
    }

    // Fallback: no signal — use Supabase JS client (original path)
    const { data, error } = await supabase.functions.invoke('chat-proxy', invokeOptions);

    if (error) throw error;
    if (!data) throw new Error('No response returned from the proxy.');

    return { text: data.text, images: data.images || [], meta: data._meta || null };

  } catch (error) {
    // If the request was deliberately aborted — propagate so useChat can handle it cleanly
    if (error.name === 'AbortError') throw error;

    console.error('AI Error:', error);

    if (error.message && error.message.includes('fetch')) {
      return {
        text: `**Network Error:** Could not reach the API. Have you started your Supabase local edge functions?`,
        images: [],
      };
    }

    return {
      text: `**Error:** Failed to connect to Neural Net. Code: ${error.message}`,
      images: [],
    };
  }
};
