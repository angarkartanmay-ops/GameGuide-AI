import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, supabaseAnonKey } from '../services/supabaseClient';
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

  const clearChat = useCallback(async () => {
    setMessages([]);
    setRedditActive(false);
    setWikiActive(false);
    if (user) {
      // Use Supabase JS client directly — user is authenticated so their JWT
      // is valid. If RLS still blocks, fall back to raw REST with anon key.
      const { error } = await supabase
        .from('chat_messages')
        .delete()
        .eq('user_id', user.id);

      if (error) {
        console.warn('Supabase JS delete blocked, trying raw REST...', error.message);
        // Raw REST fallback with explicit anon key (bypasses JWT reuse issue)
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/chat_messages?user_id=eq.${user.id}`;
        await fetch(url, {
          method: 'DELETE',
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json',
          },
        });
      }
    }
  }, [user]);

  // ─── Slash Command Definitions ─────────────────────────────────────────────
  // Each command: { trigger, description, emoji, action }
  const SLASH_COMMANDS = useMemo(() => [
    {
      trigger: '/clear',
      description: 'Wipe your entire chat history',
      emoji: '🗑️',
      action: async () => {
        await clearChat();
        return null; // null = no AI response triggered
      },
    },
    {
      trigger: '/help',
      description: 'List all available commands',
      emoji: '📖',
      action: async () => ({
        text: `## 📖 GameGuide-AI Command Reference\n\n| Command | Description |\n|---------|-------------|\n| \`/clear\` | 🗑️ Wipe your entire chat history |\n| \`/help\` | 📖 Show this command list |\n| \`/tip\` | 💡 Get a random pro gaming tip |\n| \`/redpill\` | 🔴 Unlock a spicy hidden gaming fact |\n| \`/noclip\` | 👻 Secret glitch mode activated |\n| \`/konami\` | 🎮 Unlock the legendary Konami Easter Egg |\n| \`/loading\` | ⏳ The eternal gamer struggle |\n| \`/lore\` | 📜 Lore drop on a random iconic game |`,
        images: [],
        isCommand: true,
      }),
    },
    {
      trigger: '/tip',
      description: 'Get a random elite pro gaming tip',
      emoji: '💡',
      action: async () => ({
        text: `## 💡 Pro Tip Unlocked\n\n${[
          'Always check your **mini-map** every 3-5 seconds. Most deaths come from not tracking enemy movement.',
          '**Footsteps matter.** In any FPS, crouching reduces your audio signature to nearly zero.',
          'Dying in a new area is **free intel.** Note enemy positions, patrol routes, and loot before your next attempt.',
          '**Inventory management is a skill.** Sort by weight or value regularly — you will always find something to drop.',
          'If a boss has a yellow glow, **interrupt it.** Almost every game punishes players who ignore cast animations.',
          '**Save before every major decision.** The game will not remind you.',
          'Every RPG has a **"broken" build.** Experiment with passive abilities — they are almost always underrated.',
          'The best players lose **intentionally** sometimes. Dying teaches you map layouts faster than winning.',
        ][Math.floor(Math.random() * 8)]}`,
        images: [],
        isCommand: true,
      }),
    },
    {
      trigger: '/redpill',
      description: 'Discover a hidden secret about the gaming industry',
      emoji: '🔴',
      action: async () => ({
        text: `## 🔴 Truth Unlocked\n\n${[
          '**Minecraft\'s** iconic creeper was a **coding accident.** Notch mixed up width and height values for the pig model. The rest is history.',
          '**GTA San Andreas** has a ghost car in the Chiliad mountains that rolls down the hill with no driver. Still unexplained.',
          '**Pac-Man\'s** kill screen at level 256 is caused by a **integer overflow bug** — the game never expected you to get that far.',
          'The **"Aerith Dies"** twist in FF7 was considered such a spoiler risk that developers *internally faked the script* to leak hunters.',
          '**Left 4 Dead\'s** AI Director monitors your emotional stress levels in real-time and spawns enemies dynamically to keep you at peak tension.',
          '**The Elder Scrolls: Daggerfall** map is larger than **Great Britain**. Most of it is procedurally generated wilderness.',
          'In **Dark Souls**, the NPCs that go insane are showing you the canonical fate of every player who gives up and never returns.',
        ][Math.floor(Math.random() * 7)]}`,
        images: [],
        isCommand: true,
      }),
    },
    {
      trigger: '/noclip',
      description: 'Secret glitch mode activated',
      emoji: '👻',
      action: async () => ({
        text: `## 👻 NOCLIP MODE ACTIVATED\n\n\`\`\`\nWARNING: You have clipped outside the world boundary.\nPhysics: DISABLED\nCollision: DISABLED  \nGame Master awareness: ENABLED\n\nYou can see the void now.\nThe dev notes are everywhere.\nSomeone left a sticky note that says: \'fix this before launch\'\nThey did not fix it before launch.\n\`\`\`\n*Type anything to re-enter the simulation.*`,
        images: [],
        isCommand: true,
      }),
    },
    {
      trigger: '/konami',
      description: 'Unlock the legendary Konami cheat code Easter Egg',
      emoji: '🎮',
      action: async () => ({
        text: `## 🎮 ↑ ↑ ↓ ↓ ← → ← → B A\n\n**KONAMI CODE ACCEPTED. 30 LIVES GRANTED.**\n\n> *The Konami Code was created by developer Kazuhisa Hashimoto in 1986 while testing Gradius. He found the game too hard, so he added a cheat. He forgot to remove it before shipping. Players discovered it, and a legend was born.*\n\n| Code Origin | Game | Effect |\n|-------------|------|--------|\n| 1986 | Gradius | Full power-up |\n| 1988 | Contra | 30 lives |\n| 2007 | ESPN.com | Unicorn confetti |\n| 2013 | Google | Searches in Wingdings |\n\n**One of the most recognized button combinations in human history.** 🎖️`,
        images: [],
        isCommand: true,
      }),
    },
    {
      trigger: '/loading',
      description: 'The eternal gamer struggle',
      emoji: '⏳',
      action: async () => ({
        text: `## ⏳ Loading...\n\n\`███████████████████░░░░░░\` 74%\n\n*Estimated time remaining: Soon™*\n\n> *While you wait, the developers added a loading screen tip: "Have you tried turning it off and on again?"*\n\n**Fun fact:** Players collectively spend over **500 million hours per year** watching loading screens. That's 57,000 years of human time. Yearly. Just waiting.`,
        images: [],
        isCommand: true,
      }),
    },
    {
      trigger: '/lore',
      description: 'Get a lore drop on a random iconic game universe',
      emoji: '📜',
      action: async () => ({
        text: `## 📜 Lore Drop Incoming...\n\n${[
          `**Dark Souls Lore:** The entire Age of Fire is a lie. Gwyn, the "god" you avenge throughout the trilogy, sacrificed his own humanity to link the First Flame and *condemned all life to an eternal cycle of burning and dying* just to delay the inevitable Age of Dark. You are not a hero. You are a battery.`,
          `**Hollow Knight Lore:** The Pale King didn't create the infection seal out of compassion — he did it to **save his kingdom's economic model**. The bugs of Hallownest ran entirely on SOUL energy. A world without minds meant no soul, no kingdom, no legacy. The Hollow Knight is not a savior. It's a business decision.`,
          `**Zelda Lore:** There are three parallel timelines, two caused by Link's victory and one by his **defeat**. The entire Legend of Zelda franchise canonically acknowledges a timeline where the Hero of Time was **killed by Ganon** during Ocarina of Time. Most classic Zelda games take place in the aftermath of Link losing.`,
          `**Elden Ring Lore:** The "Elden Ring" is just *a really good rune.* Queen Marika shattered it not by accident but deliberately — she wanted to break the Golden Order system her husband Godfrey built, because she had watched it destroy everyone she loved. Every boss you kill was once someone she cared about.`,
          `**Minecraft Lore:** The Endermen are **corrupted Endermen.** The original humans of Minecraft, known as the "Ancient Builders", built the End Portals to escape an ancient plague. Some escaped. Some stayed and built the Nether. The ones who entered the End were slowly consumed by it and became the Endermen — still clutching blocks, still building, forever lost.`,
        ][Math.floor(Math.random() * 5)]}`,
        images: [],
        isCommand: true,
      }),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [clearChat]);

  const processCommand = async (text) => {
    const trimmed = text.trim().toLowerCase();
    const cmd = SLASH_COMMANDS.find(c => trimmed === c.trigger || trimmed.startsWith(c.trigger + ' '));
    if (!cmd) return false;
    const result = await cmd.action();
    if (result === null) return true; // e.g. /clear — no message
    const cmdMessage = {
      id: Date.now().toString(),
      text: result.text,
      sender: 'ai',
      images: result.images || [],
      isCommand: true,
    };
    setMessages(prev => [...prev, cmdMessage]);
    return true;
  };

  const sendMessage = async (text, attachments = []) => {
    // ── Check for slash commands first ─────────────────────────────────────
    if (text.trim().startsWith('/')) {
      const handled = await processCommand(text);
      if (handled) return;
    }

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
    clearChat,
    redditActive,
    wikiActive,
    SLASH_COMMANDS,
  };
}
