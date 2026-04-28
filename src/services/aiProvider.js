import { supabase } from './supabaseClient';

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
