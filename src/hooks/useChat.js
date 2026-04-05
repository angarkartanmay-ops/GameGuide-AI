import { useState } from 'react';
import { generateChatResponse } from '../services/aiProvider';
import { searchReddit } from '../services/redditScraper';
import { searchWikis } from '../services/wikiScraper';

export default function useChat() {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [redditActive, setRedditActive] = useState(false);
  const [wikiActive, setWikiActive] = useState(false);

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
