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

  // Fetch history on login, clear on logout
  useEffect(() => {
    if (!user) {
      setMessages([]);
      return;
    }

    const fetchHistory = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: true });
        
      if (!error && data) {
        setMessages(data.map(msg => ({
          id: msg.id,
          text: msg.text,
          sender: msg.sender,
          images: msg.images || []
        })));
      } else if (error) {
        console.error('Error fetching chat history:', error);
      }
      setIsLoading(false);
    };

    fetchHistory();
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

    // Persist to DB if logged in
    if (user) {
      supabase.from('chat_messages').insert([{
        user_id: user.id,
        text: userMessage.text,
        sender: 'user',
        images: userMessage.images
      }]).then(({error}) => { if(error) console.error("History insert error:", error) });
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

      // Persist to DB if logged in
      if (user) {
        supabase.from('chat_messages').insert([{
          user_id: user.id,
          text: aiMessage.text,
          sender: 'ai',
          images: aiMessage.images
        }]).then(({error}) => { if(error) console.error("History insert error:", error) });
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
