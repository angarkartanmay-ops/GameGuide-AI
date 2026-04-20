import { supabase } from './supabaseClient';

/**
 * Standard text response using GameGuide-AI Supabase Edge Function.
 * Accepts optional image attachments for analysis.
 */
export const generateChatResponse = async (apiKey, prompt, chatHistory, redditContext = '', wikiContext = '', attachments = [], priceContext = '') => {
  try {
    const { data, error } = await supabase.functions.invoke('chat-proxy', {
      body: { prompt, chatHistory, redditContext, wikiContext, attachments, priceContext },
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
      }
    });

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error("No response returned from the proxy.");
    }

    return { text: data.text, images: data.images || [] };
  } catch (error) {
    console.error("AI Error:", error);
    
    // Check if it's a fetch error to localhost (for local development without running supabase)
    if (error.message && error.message.includes("fetch")) {
       return { text: `**Network Error:** Could not reach the API. Have you started your Supabase local edge functions using \`npx supabase start\`?`, images: [] };   
    }
    
    return { text: `**Error:** Failed to connect to Neural Net. Code: ${error.message}`, images: [] };
  }
};
