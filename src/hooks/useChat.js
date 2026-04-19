import { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { generateChatResponse } from '../services/aiProvider';
import { searchReddit } from '../services/redditScraper';
import { searchWikis } from '../services/wikiScraper';

export default function useChat(user) {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [redditActive, setRedditActive] = useState(false);
  const [wikiActive, setWikiActive] = useState(false);

  useEffect(() => {
    if (user) {
      const fetchHistory = async () => {
        const { data, error } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true });
        
        if (!error && data) {
          setMessages(data.map(msg => ({
            id: msg.id || Date.now().toString(),
            text: msg.text,
            sender: msg.sender,
            images: msg.images || []
          })));
        }
      };
      setIsLoading(true);
      fetchHistory().finally(() => setIsLoading(false));
    } else {
      setMessages([]);
    }
  }, [user]);

  const sendMessage = async (text, attachments = []) => {
    // Build user message with optional image previews
    const userMessage = {
      id: Date.now().toString(),
      text,
      sender: 'user',
      // Store preview URLs for display (not the raw base64)
      images: attachments.map(a => ({
        previewUrl: `data:${a.mimeType};base64,${a.data}`,
        mimeType: a.mimeType,
      })),
    };

    setMessages((prev) => [...prev, userMessage]);
    
    if (user) {
      // Background sync, no await needed here for UX speed
      supabase.from('chat_messages').insert({
        user_id: user.id,
        text: userMessage.text,
        sender: userMessage.sender,
        images: userMessage.images
      }).then(({ error }) => {
        if (error) console.error("History sync error:", error);
      });
    }

    setIsLoading(true);
    setRedditActive(false);
    setWikiActive(false);

    try {
      // Step 1: Scrape Reddit + Wiki in parallel for speed
      let redditContext = '';
      let wikiContext = '';

      const [redditResult, wikiResult] = await Promise.allSettled([
        searchReddit(text),
        searchWikis(text),
      ]);

      if (redditResult.status === 'fulfilled' && redditResult.value) {
        redditContext = redditResult.value;
        setRedditActive(true);
      }
      if (wikiResult.status === 'fulfilled' && wikiResult.value) {
        wikiContext = wikiResult.value;
        setWikiActive(true);
      }

      // Step 2: Call AI with all gathered context + attachments
      const aiResponse = await generateChatResponse(
        null, text, messages, redditContext, wikiContext, attachments
      );

      // AI response is now { text, images }
      const aiMessage = {
        id: (Date.now() + 1).toString(),
        text: aiResponse.text,
        sender: 'ai',
        images: (aiResponse.images || []).map(img => ({
          previewUrl: `data:${img.mimeType};base64,${img.data}`,
          mimeType: img.mimeType,
        })),
      };

      setMessages((prev) => [...prev, aiMessage]);

      if (user) {
        supabase.from('chat_messages').insert({
          user_id: user.id,
          text: aiMessage.text,
          sender: aiMessage.sender,
          images: aiMessage.images
        }).then();
      }
    } catch (error) {
      console.error(error);
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        text: "System Error: Unable to fetch protocol response.",
        sender: 'ai',
        images: [],
      };
      setMessages((prev) => [...prev, errorMessage]);

      if (user) {
        supabase.from('chat_messages').insert({
          user_id: user.id,
          text: errorMessage.text,
          sender: errorMessage.sender,
          images: []
        }).then();
      }
    } finally {
      setIsLoading(false);
    }
  };

  return {
    messages,
    isLoading,
    sendMessage,
    redditActive,
    wikiActive,
  };
}
