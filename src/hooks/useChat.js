import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase, supabaseAnonKey } from '../services/supabaseClient';
import { generateChatResponse } from '../services/aiProvider';
import { searchReddit } from '../services/redditScraper';
import { searchWikis } from '../services/wikiScraper';
import { fetchPriceDirect, fetchPriceSummaryDirect } from '../services/priceScraper';

// Cheap client-side heuristic: does this message warrant Reddit/Wiki scraping?
// Skip the 2-3s scrape for greetings, meta-questions ("what can you do"), and
// generic chit-chat. The server's omniscience layer still fires when a real
// game is detected from text or vision.
const GAME_INFO_RX = /\b(meta|tier|patch|update|nerf|buff|build|loadout|gear|stat|talent|skill tree|ability|character|class|hero|champion|operator|legend|agent|card|deck|weapon|item|quest|dungeon|raid|boss|level|guide|walkthrough|achievement|trophy|lore|story|backstory|canon|timeline|how (to|do)|how can i|why (does|is)|fix|error|crash|bug|glitch|launch|install|optim|fps|graphics|setting|controller|keybind|mouse|sens|aim|farm|grind|exp|xp|currency|skin|cosmetic|battle pass|season|patch notes|nerfed|buffed|broken|op|underrated)\b/i;
// Lite list of high-recall game name fragments — extend as needed
const GAME_NAME_HINTS = /\b(minecraft|valorant|fortnite|elden ring|dark souls|sekiro|bloodborne|gta|rdr|cyberpunk|witcher|skyrim|fallout|destiny|warzone|cod|apex|overwatch|league|lol|dota|cs2|cs:?go|tarkov|rust|terraria|stardew|hollow knight|silksong|hades|baldur|bg3|diablo|poe|wow|ffxiv|ff14|ff7|ff16|persona|metaphor|zelda|botw|totk|pokemon|monster hunter|mh wilds|mh rise|genshin|honkai|wuthering|clash royale|clash of clans|brawl stars|pubg|free fire|mobile legends|wild rift|marvel rivals|black myth|wukong|helldivers|palworld|lethal company|phasmophobia|forza|fifa|fc 25|nba 2k|sea of thieves|dead by daylight|dbd|rainbow six|siege|r6|smite|hearthstone|marvel snap|the finals|delta force|arc raiders)\b/i;

function needsGameContext(text) {
  if (!text || text.length < 4) return false;
  return GAME_INFO_RX.test(text) || GAME_NAME_HINTS.test(text);
}

export default function useChat(user) {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [redditActive, setRedditActive] = useState(false);
  const [wikiActive, setWikiActive] = useState(false);
  const [webActive, setWebActive] = useState(false);
  const [priceActive, setPriceActive] = useState(false);
  const [priceData, setPriceData] = useState([]);

  // ─── Credit-saving refs ────────────────────────────────────────────────────
  const abortControllerRef = useRef(null);   // for Stop Response
  const lastMessageRef = useRef('');         // for duplicate guard
  const cooldownRef = useRef(false);         // for rate limiting (2s)
  const cooldownTimerRef = useRef(null);     // to clear on unmount

  // Depend on user?.id (stable string) instead of the user object reference.
  // Supabase rebuilds the user object on every TOKEN_REFRESHED event (which
  // fires whenever the tab regains focus); using `user` directly would refetch
  // history every tab switch. Using user.id only re-fires when the actual
  // logged-in user changes.
  const userId = user?.id || null;
  useEffect(() => {
    if (userId) {
      const fetchHistory = async () => {
        const { data, error } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('user_id', userId)
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
  }, [userId]);

  // Clear cooldown timer on unmount
  useEffect(() => () => clearTimeout(cooldownTimerRef.current), []);

  /** Stop the in-flight AI request immediately. */
  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setRedditActive(false);
    setWikiActive(false);
    setWebActive(false);
    setPriceActive(false);
  }, []);

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
        text: `## 📖 GameGuide-AI Command Reference\n\n| Command | Description |\n|---------|-------------|\n| \`/clear\` | 🗑️ Wipe your entire chat history |\n| \`/help\` | 📖 Show this command list |\n| \`/tip\` | 💡 Get a random pro gaming tip (live + curated) |\n| \`/redpill\` | 🔴 Unlock a spicy hidden gaming fact (live + curated) |\n| \`/lore\` | 📜 Lore drop on a random iconic game (live + curated) |\n| \`/price <game>\` | 💰 Get live multi-store prices via CheapShark |\n| \`/noclip\` | 👻 Secret glitch mode activated |\n| \`/konami\` | 🎮 Unlock the legendary Konami Easter Egg |\n| \`/loading\` | ⏳ The eternal gamer struggle |`,
        images: [],
        isCommand: true,
      }),
    },
    {
      trigger: '/price',
      description: 'Live multi-store price check (e.g. /price elden ring)',
      emoji: '💰',
      action: async (args) => {
        const game = (args || '').trim();
        if (!game) {
          return {
            text: `## 💰 Live Price Check\n\n**Usage:** \`/price <game name>\`\n\n**Examples:**\n- \`/price elden ring\`\n- \`/price baldur's gate 3\`\n- \`/price helldivers 2\`\n- \`/price stardew valley\`\n\nPulls live prices from **20+ stores** (Steam, GOG, Humble, Fanatical, Epic, etc.) via CheapShark.`,
            images: [],
            isCommand: true,
          };
        }

        // Run both calls in parallel — fetchPrices for the markdown body,
        // fetchPricesSummary for the structured PriceBadge sidebar UI.
        setPriceActive(false);
        setPriceData([]);

        try {
          // Direct functions skip the noisy detectGames() heuristic and use
          // the user's literal /price arg as the CheapShark search title.
          // Inside fetchGamePrice we now also try exact=1 first and score
          // fuzzy fallbacks to avoid "Minecraft → Minecraft Legends" misfires.
          const [textResult, summaryResult] = await Promise.allSettled([
            fetchPriceDirect(game),
            fetchPriceSummaryDirect(game),
          ]);

          const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : [];
          const priceBlock = textResult.status === 'fulfilled' ? textResult.value : '';

          if (summary && summary.length > 0) {
            setPriceData(summary);
            setPriceActive(true);
          }

          if (!priceBlock) {
            return {
              text: `## 💰 Live Price Check — **${game}**\n\nNo current price data found on **CheapShark** for "${game}".\n\nPossible reasons:\n- The title spelling differs (try \`/price ${game.split(' ')[0]}\`)\n- Free-to-play game (Valorant, Fortnite, League — no price to track)\n- Mobile-only or console-exclusive (CheapShark covers PC stores only)\n- Recently delisted\n\nYou can also browse manually at https://www.cheapshark.com/`,
              images: [],
              isCommand: true,
            };
          }

          // Convert the raw === LIVE PRICE INTEL === block into a chat-friendly markdown view
          const cleaned = priceBlock
            .replace(/^=== LIVE PRICE INTEL[^=]*===\n?/i, '')
            .replace(/\n?=== END PRICE INTEL ===$/i, '')
            .trim();

          return {
            text: `## 💰 Live Price Check — **${game}**\n\n${cleaned}\n\n*— prices via CheapShark, refreshed every 15 min*`,
            images: [],
            isCommand: true,
          };
        } catch {
          return {
            text: `## 💰 Live Price Check — **${game}**\n\n**Error contacting CheapShark.** This is usually temporary — try again in a few seconds.`,
            images: [],
            isCommand: true,
          };
        }
      },
    },
    {
      trigger: '/tip',
      description: 'Get a random elite pro gaming tip (live + curated)',
      emoji: '💡',
      action: async () => {
        // ── Try live Reddit scrape first (60% of the time, 2.5s timeout) ──
        if (Math.random() < 0.6) {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 2500);
            // r/gamingtips + r/truegaming + r/gaming aggregated, top of week
            const subs = ['gamingtips', 'truegaming', 'gaming'];
            const sub = subs[Math.floor(Math.random() * subs.length)];
            const url = `/api/reddit/r/${sub}/top.json?t=week&limit=30`;
            const res = await fetch(url, { signal: ctrl.signal });
            clearTimeout(t);
            if (res.ok) {
              const data = await res.json();
              const posts = (data?.data?.children || [])
                .map(p => p?.data)
                .filter(p =>
                  p && !p.stickied && !p.over_18 &&
                  p.score > 30 &&
                  ((p.selftext && p.selftext.length > 100 && p.selftext.length < 1500) || p.title.length > 40)
                );
              if (posts.length > 0) {
                const pick = posts[Math.floor(Math.random() * posts.length)];
                const title = (pick.title || '')
                  .replace(/^\[(?:tip|psa|guide|til|advice)\][\s:]*/i, '')
                  .replace(/^(?:tip|psa|guide|til|advice)[\s:]+/i, '')
                  .trim();
                let body = (pick.selftext || '').trim();
                // Tidy reddit-isms
                body = body
                  .replace(/&amp;#x200B;/g, '')
                  .replace(/&amp;/g, '&')
                  .replace(/&#x200B;/g, '')
                  .replace(/\n{3,}/g, '\n\n')
                  .slice(0, 700);
                if (body.length > 80 || title.length > 40) {
                  return {
                    text: `## 💡 Live Pro Tip — fresh from the gaming community\n\n**${title}**\n\n${body}${body.length === 700 ? '…' : ''}\n\n*— shared by r/${pick.subreddit} this week (${pick.score.toLocaleString()} upvotes)*`,
                    images: [],
                    isCommand: true,
                  };
                }
              }
            }
          } catch { /* silent fallback to curated */ }
        }

        // ── Curated fallback bank (~85 tips, themed and deduped) ──────────
        const TIPS = [
          // FPS / multiplayer
          'Always check your **mini-map** every 3–5 seconds. Most deaths come from not tracking enemy movement.',
          '**Footsteps matter.** In any FPS, crouching reduces your audio signature to nearly zero.',
          '**Pre-aim corners.** Whip your crosshair at head-height where an enemy *might* peek before you commit to looking.',
          '**Reload between fights, never during.** A slow reload at the wrong moment ends matches.',
          '**Sound is information.** Wear headphones — locating an enemy by ear is a 30%+ skill ceiling raise in any shooter.',
          'In team shooters, **trade kills are wins.** Don\'t solo-push — peek with a teammate watching the same angle.',
          '**Flashbangs and smokes are mid-fight tools, not opening moves.** Use them when you\'re committed to a push, not from spawn.',
          '**Crosshair placement > flicks.** If your crosshair is already at head-height, you don\'t need fast aim.',
          '**Stop holding right-click constantly.** ADS-walking slows you down. Hipfire close, ADS only when an enemy peeks.',
          '**Dropshotting works once.** After that, the enemy expects it. Keep them guessing.',

          // RPG / open world
          'Dying in a new area is **free intel.** Note enemy positions, patrol routes, and loot before your next attempt.',
          '**Inventory management is a skill.** Sort by weight or value regularly — you will always find something to drop.',
          'If a boss has a yellow glow on its attack windup, **interrupt it.** Almost every modern game punishes ignored casts.',
          'Every RPG has a **"broken" build.** Experiment with passive abilities — they are almost always underrated.',
          '**Talk to every NPC twice.** Many games gate quests behind a second dialogue trigger after a key event.',
          '**Read item descriptions in full.** Devs hide mechanic hints, lore, and quest leads in flavor text constantly.',
          'When a boss feels impossible, **leave and come back at +2 levels.** Most "souls-lite" games scale enemies linearly.',
          '**Don\'t hoard consumables.** A potion in your bag at the end credits is a wasted item.',
          '**Dodge timing > dodge spam.** Watch the wind-up, dodge on the *commit* frame, not the telegraph.',
          'In open-world games, **fast travel as little as possible early on.** You learn the map by walking it.',
          '**Side quests sometimes outclass the main quest.** Always check the quest log before the point of no return.',
          '**The "weak" stat is rarely weak.** A min-maxed underdog stat often unlocks broken late-game scaling.',
          '**Save before every major decision.** The game will not remind you. Cloud saves can be a lifesaver.',
          '**Use parry over block** when the option exists — parries usually skip damage AND open punish windows.',

          // Competitive / mental game
          'The best players lose **intentionally** sometimes. Dying teaches you map layouts faster than winning.',
          'After 3 losses in a row, **stop queuing.** Tilt costs more rank than skill gain in a recovery session.',
          'Watch a VOD of YOUR loss, not your win. **Wins teach nothing — losses teach everything.**',
          '**Pick one champ/agent/character per week.** Mastery beats variety in ranked.',
          'When stuck on rank, **change your warmup routine** before changing your build. Aim is a state, not a setting.',
          '**Mute toxic teammates immediately.** Every second arguing in chat is a second not winning.',
          '**Hydration affects reaction time** more than RAM does. Drink water mid-session.',
          '**Take a 5-min break every 50 minutes.** Looking at distance for 30s resets your eye fatigue.',
          'When you\'re losing, **slow down your decisions** — the brain speeds up under tilt and makes worse calls.',

          // Speedrun / optimization
          'For any game, the **fastest route is rarely the obvious one.** Check speedrun.com — there\'s a 99% chance someone found a skip.',
          '**Frame-perfect tricks are a myth for 99% of players.** Most useful skips have a 5–10 frame window — practice them.',
          'A **pause-buffer** can save you from 90% of "i had no time" deaths in action games.',
          '**Menus are slower than you think.** Speedrun routes optimize menu navigation as aggressively as combat.',

          // Settings / hardware
          'Most pros play on **lower sensitivity** than you think — sub-30cm/360° in shooters is normal.',
          '**Disable mouse acceleration** in your OS. Period. There\'s never a competitive reason to keep it on.',
          'Your **monitor refresh rate matters more than your GPU** for competitive play. 144Hz beats 240Hz beats 60Hz, but 1080p beats 4K for visibility.',
          '**Cap your FPS slightly below your monitor\'s refresh rate** to reduce input lag from frame queueing.',
          'For controller players: **deadzone too high = input lag, too low = drift.** 4–6% is the sweet spot for most sticks.',
          '**Custom button mapping isn\'t cheating** — claw grip and paddle remaps are why pros react faster.',
          'A **wired mouse and headset** beat any wireless model for competitive latency, even in 2025.',

          // MMO / live service
          'In any MMO, **find a guild before you out-level the early content.** Solo MMO is a slog.',
          '**Daily chores are a trap** in live-service games. Skip them once a week — your sanity > FOMO.',
          'New seasons reset the meta. **Don\'t pay for a battle pass on day one** — wait 48h to see if exploits get patched.',
          'In gacha games, **save your premium currency** for the rate-up banners with kit synergy. Whaling losers is the #1 regret.',

          // Mobile / casual
          '**Mobile games on PC emulators** unlock keyboard binds and bigger screens — most games allow it under their TOS.',
          'For mobile shooters, a **simple finger guard or grip case** outperforms expensive trigger attachments for most players.',
          'In **Clash Royale / TFT / Marvel Snap**, deck-tracker apps are legal and free. Use them.',

          // Strategy / fighting
          'In fighting games, **block first, attack second.** Defense unlocks the meta — pure offense plateaus at low rank.',
          'In RTS games, **scout every 90 seconds.** Information beats unit count.',
          'In any deckbuilder/auto-chess, **commit to a comp by mid-game.** Pivoting late = always losing economy.',
          'In strategy games, **the "boring" build (more economy)** wins more than the flashy aggression rush.',

          // General gaming wisdom
          'If a game has **photo mode**, take screenshots — you\'ll thank yourself when revisiting old saves years later.',
          '**Refund window:** Steam, GOG, Epic all allow refunds within ~2h of playtime. Use it. Don\'t suffer through bad games.',
          '**Patch notes are a cheat sheet.** Read them every update — devs literally tell you what\'s strong now.',
          'When stuck, **try a fresh character build instead of grinding.** New mechanics are more fun than +5 levels.',
          '**Co-op is hard mode in most games.** Enemy scaling usually makes 2-player tougher than solo.',
          '**Backup your saves to the cloud.** Even single-player games. One corrupted file = 80h gone.',
          'For RPGs: **always over-prepare for the boss before "boss-coded" cutscenes.** Sell unused gear, max consumables.',
          'When buying a game, **wait for a -50% sale** unless it\'s a service-game season pass with FOMO content.',
          'Most games have a **dynamic difficulty curve.** Dying multiple times in a row often makes the next attempt easier — don\'t give up.',
          '**Read the in-game tutorials at least once.** Modern UIs hide critical mechanics behind tooltip-only explanations.',
          'In any souls-like, **fashion souls is a viable build.** Looking cool gives a real psychological tilt advantage.',

          // Streaming / recording
          'If you\'re streaming, **set up Shadow-replay** (NVIDIA Shadowplay / AMD ReLive) — clip your highlights without thinking.',
          'Use **OBS scene profiles**, not one massive config. Switching games shouldn\'t mean rebuilding your overlay.',
          '**Discord push-to-talk** > open mic, every time. No one wants to hear your keyboard chatter on stream.',

          // Recovery / health
          'After a 4h+ session, **stand up and stretch your wrists.** Gamer\'s tendinitis is real and lifelong.',
          'Bright monitor + dim room = **eye strain in 60 minutes.** Add a $15 bias light behind your screen.',
          '**Sleep > grinding.** Reaction time drops 25% after sleep deprivation — equivalent to playing while mildly drunk.',
          '**Wrist rests are not a meme.** They prevent ulnar nerve compression that wrecks long-term aim.',

          // Pricing / library
          'Bought a game and bouncing off it? **Refund it within 2 hours.** Don\'t guilt yourself into a slog.',
          'On Steam, **wishlist + sale alert > impulse buying.** Most games hit 50% off within 6 months.',
          'Free game claim policy: **Epic giveaways stack forever.** Claim every Thursday even if you\'ll never play it — you might.',

          // Genre-specific gold
          'In Soulsbornes: **leveling Vigor / HP first** carries new players further than any weapon upgrade.',
          'In Roguelikes (Hades, Isaac, Slay the Spire): **commit to a build by floor 2.** Indecision = death.',
          'In Survival games (Valheim, Subnautica, Terraria): **build a small base near the next biome before exploring it.** Travel time kills momentum.',
          'In Stealth games: **distractions > kills.** A pebble thrown is a guaranteed reroute; a kill is a body to hide.',
          'In Racing games: **brake earlier, exit faster.** "Slow in, fast out" beats "fast in, panic brake".',
          'In Platformers: **always use coyote-time.** Most modern platformers give you 4–8 frames of jump grace after leaving a ledge.',

          // Meta lessons
          'The "best" weapon in any game isn\'t the highest-damage one — **it\'s the one that fits your playstyle.**',
          'When you finish a game, **leave a Steam review.** It helps the next player decide and supports the dev.',
          'Before buying DLC, **check if the base game\'s ending is satisfying.** Some DLCs are essential, others are optional fluff.',
          'Don\'t play **multiplayer when sleep-deprived.** You\'ll tank your rank AND form bad habits that stick.',
          'Every gamer has a "comfort game" they replay. **Lean into it during burnout.** Trying to force fun in a new game just amplifies the slump.',
        ];

        return {
          text: `## 💡 Pro Tip Unlocked\n\n${TIPS[Math.floor(Math.random() * TIPS.length)]}`,
          images: [],
          isCommand: true,
        };
      },
    },
    {
      trigger: '/redpill',
      description: 'Discover a hidden secret about the gaming industry (live + curated)',
      emoji: '🔴',
      action: async () => {
        // ── Try live Reddit scrape from gaming-secrets/details subs ───────
        if (Math.random() < 0.6) {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 2500);
            // r/GamingDetails is the gold standard for "I just noticed..." facts
            const subs = ['GamingDetails', 'gaming', 'truegaming'];
            const sub = subs[Math.floor(Math.random() * subs.length)];
            const url = `/api/reddit/r/${sub}/top.json?t=month&limit=40`;
            const res = await fetch(url, { signal: ctrl.signal });
            clearTimeout(t);
            if (res.ok) {
              const data = await res.json();
              const posts = (data?.data?.children || [])
                .map(p => p?.data)
                .filter(p =>
                  p && !p.stickied && !p.over_18 &&
                  p.score > 200 &&
                  // Prefer "TIL", "Did you know", "I just noticed", "Hidden", "Secret", "Easter egg"
                  (sub === 'GamingDetails' ||
                   /\b(til|did you know|i just noticed|hidden|secret|easter egg|fun fact|never knew|unused|cut content)\b/i.test(p.title)) &&
                  ((p.selftext && p.selftext.length > 60) || p.title.length > 60)
                );
              if (posts.length > 0) {
                const pick = posts[Math.floor(Math.random() * posts.length)];
                const title = (pick.title || '')
                  .replace(/^\[(?:til|fact|secret|detail)\][\s:]*/i, '')
                  .trim();
                let body = (pick.selftext || '').trim();
                body = body
                  .replace(/&amp;#x200B;/g, '')
                  .replace(/&amp;/g, '&')
                  .replace(/&#x200B;/g, '')
                  .replace(/\n{3,}/g, '\n\n')
                  .slice(0, 700);
                return {
                  text: `## 🔴 Truth Unlocked — fresh from the gaming detective community\n\n**${title}**\n\n${body || '*(thread is mostly visual — check the source for the full detail)*'}${body.length === 700 ? '…' : ''}\n\n*— uncovered by r/${pick.subreddit} (${pick.score.toLocaleString()} ↑)*`,
                  images: [],
                  isCommand: true,
                };
              }
            }
          } catch { /* silent fallback */ }
        }

        // ── Curated industry secrets (~55 entries) ─────────────────────────
        const REDPILLS = [
          // Iconic accidents / origins
          '**Minecraft\'s** iconic creeper was a **coding accident.** Notch mixed up width and height values for the pig model. The rest is history.',
          '**Pac-Man\'s** kill screen at level 256 is caused by an **8-bit integer overflow** — the game never expected you to get that far.',
          'The **Konami Code** was created by Kazuhisa Hashimoto in 1986 because he found Gradius too hard while testing it. He forgot to remove the cheat before shipping.',
          '**Halo\'s** sniper-rifle scope sound was created by **dropping a wrench into a steel pipe.** Bungie\'s sound designer made the pipe in his garage.',
          '**Doom\'s** original music was almost entirely **soundalikes of Metallica and Slayer tracks** — Bobby Prince got within copyright-suit distance and id Software just shipped it anyway.',
          '**Half-Life 2\'s** Combine Soldier voice was made by recording a real person and then **playing it backwards through a vocoder twice.**',

          // Hidden mechanics
          '**Left 4 Dead\'s** AI Director monitors your stress level in real-time and spawns enemies dynamically — quiet stretches mean a horde is being prepared.',
          '**Resident Evil 4\'s** difficulty silently scales DOWN if you die too often. There\'s a hidden stat called the "Game Tension" meter.',
          '**Skyrim\'s** Falmer language is a complete cipher of English — every line of "Falmer text" is a real English word with a substitution alphabet.',
          'In **Dark Souls**, the NPCs that go insane are showing you the canonical fate of every player who gives up and never returns.',
          '**Bioshock\'s** "Would you kindly?" mind-control trigger was foreshadowed in the box art if you knew where to look — Andrew Ryan\'s slogan is visible in tiny text.',
          '**Sekiro** internally tracks how many times you\'ve died and makes very specific NPCs comment on it — the more deaths, the more lore drops.',
          'In **Skyrim**, NPCs have a hidden "disposition" stat. **Saying "I don\'t know you" enough times can make a guard forget your bounty.**',
          '**The Witcher 3\'s** Geralt has a hidden idle animation — if you stand still for 10 minutes in Novigrad, he\'ll start playing Gwent against himself in his head.',

          // Easter eggs / unsolved mysteries
          '**GTA San Andreas** has a ghost car on Mount Chiliad that rolls down the hill with no driver. **Still unexplained 20 years later.**',
          '**GTA V\'s** Mount Chiliad mystery was officially confirmed by Rockstar to have a solution — but as of today, **the community has not fully cracked it.**',
          'The **Mantis-thing** in **Doom** had a hidden room with the developer\'s heads on pikes — accessing it required a noclip code that wasn\'t in any manual.',
          '**Diablo 2** has a "Cow Level" because in Diablo 1, players found a cow they couldn\'t kill. The cow level was the dev team\'s revenge joke.',
          '**Fallout 4** has a unique NPC named "Dogmeat" — but in the game files, **his real name is "Mutt."** Bethesda never updated the asset name.',

          // Industry / dev decisions
          'The **"Aerith Dies"** twist in FF7 was so spoiler-sensitive that **developers internally faked the script** to mislead leakers.',
          '**Mass Effect 3\'s** original ending was leaked 6 months early — Bioware rewrote the entire third act in a panic, which is why fans hated the result.',
          '**Cyberpunk 2077\'s** infamous launch had over **9 million pre-orders** based on its E3 trailers — most of which were pre-rendered cinematics, not gameplay.',
          'The **No Man\'s Sky** marketing scandal led to the developers receiving **death threats** for 2 years. Sean Murray didn\'t tweet for 18 months.',
          '**Among Us** existed for 2 years with virtually zero players. **A single Twitch streamer (sodapoppin)** caused its viral explosion in 2020.',
          '**Elden Ring** was originally pitched to George R.R. Martin as a side project to take a break from writing Winds of Winter. **He still hasn\'t finished Winds of Winter.**',
          '**Persona 5** took 6 years to release in the West because of a single Japanese voice actor who wouldn\'t sign the localization rights — Atlus had to recast around him.',

          // Cut content / unused assets
          '**Pokémon Red/Blue** was meant to have **a 152nd Pokémon** called Mew. It was added in the last week of development as an inside joke — and accidentally left in 11 game cartridges.',
          '**Halo 2** had its third act cut entirely 4 months before launch. The "ending" you played was originally **the cliffhanger of Act 2.**',
          '**Dark Souls 1** has unused boss-arena geometry beneath Lordran for a boss called "The Stray Demon Twin" — never implemented.',
          '**Goldeneye 007** has full mocap animations for **Roger Moore, Sean Connery, and Timothy Dalton** as Bond — Rare hoped to license their likenesses, but failed.',

          // Speedrun science
          '**Super Mario 64\'s** "A Press Counting" community spent 13 years to determine if a single jump in Tick Tock Clock could be saved. **The answer required cosmic ray physics.**',
          '**Pokémon Red\'s** speedrun world record exploits an **arbitrary code execution glitch** that lets the runner write directly to RAM mid-gameplay using only the in-game item menu.',
          '**Ocarina of Time\'s** Any% speedrun is **under 4 minutes** because of a glitch that lets Link teleport directly to Ganon\'s castle by getting hit by a deku scrub at frame-perfect timing.',

          // Cultural impact
          'The **Elder Scrolls: Daggerfall** map is **larger than Great Britain.** Most of it is procedurally generated wilderness — most players never saw 99% of the world.',
          'World of Warcraft\'s **"Corrupted Blood Plague" of 2005** was used by epidemiologists as a real model for COVID-19 spread patterns.',
          '**EVE Online\'s** "Bloodbath of B-R5RB" battle in 2014 had **$330,000 USD worth of in-game ships destroyed** in a single 21-hour fight.',

          // Tech / engine secrets
          '**The Sims** plumbob (the green diamond) is technically **the Sim\'s soul** in the game\'s code — without it, the Sim has no AI behavior tree.',
          '**Skyrim** runs on the same engine as **Morrowind (2002)** with patches — the "Creation Engine" name is a marketing rebrand of Gamebryo.',
          '**Half-Life: Alyx** has a hidden physics interaction where you can pick up a magnetic crowbar and stick it to metal surfaces — **a 17-year-old reference to Gordon Freeman\'s weapon.**',

          // Modding lore
          'The **DOTA** mod for Warcraft 3 made Blizzard so much money that they sold the Warcraft 3 Reforged remake **specifically to keep DOTA players on Battle.net.** Reforged failed.',
          '**Counter-Strike** was a **Half-Life mod** before Valve hired the modders and bought the rights for $300,000. Today CS2 generates ~$1B/year.',
          'The **PUBG** developer Brendan Greene started by modding **Arma 3 for a battle-royale gametype.** He named the mode "PlayerUnknown\'s Battle Royale" — his Arma username became the company name.',

          // Weird historical
          '**Tetris** was developed in the Soviet Union, and for years **its profits went directly to the USSR government.** It was the first game to legally cross the Iron Curtain.',
          '**Final Fantasy 1** was named "Final" because Square thought the company was going **bankrupt** and this would be their last game.',
          '**Hideo Kojima** was forced out of Konami in 2015. To this day, his name is being **manually scrubbed** from every Metal Gear product page on Konami\'s website.',
          '**Atari** buried millions of unsold E.T. cartridges in a New Mexico landfill in 1983. **Archaeologists excavated them in 2014.** Some sold for $1,500 each on eBay.',

          // Modern dev secrets
          '**Bethesda** uses an internal tool called **"Creation Kit Pro"** that has **20+ years of legacy code** — every modder uses a stripped-down version that\'s missing half the features.',
          '**Riot Games** has a hidden internal "smurf detection" system that **silently shadow-bans accounts** by matching behavioral fingerprints (mouse movement, click cadence) across logins.',
          '**Activision Blizzard** has a patent on **matchmaking that intentionally pairs you with players who own skins you don\'t**, to encourage purchases. Multiple games in their catalog use it.',
          '**Steam reviews** below 100 are weighted differently than reviews above 100 — so a 50-review game with 90% positive can rank LOWER than a 1000-review game with 80% positive.',

          // Speedrunning / glitches
          '**OutOfBounds (OOB)** speedruns sometimes load **dev rooms** — Halo 3\'s "Test Room A" contains a giant cube of every weapon in the game stacked in a single pile.',
          '**Banjo-Kazooie\'s** unfinished sequel "Stop \'N\' Swop" feature was supposed to **transfer items between cartridges** through a hardware exploit. Nintendo killed it before launch.',
          'The **Crash Bandicoot** team famously had to bribe Naughty Dog\'s engineers with **espresso machines** to convince them to optimize the PS1 RAM swap routine that made the game possible.',

          // Indie miracles
          '**Stardew Valley** was made by **one person (Eric Barone) over 5 years.** He made every pixel, every line of code, every song, every dialog. He still solo-patches it as of 2025.',
          '**Hollow Knight** Team Cherry was **3 people in a small Australian studio.** Silksong has been "almost done" for 6+ years.',
          '**Undertale** was made by **Toby Fox alone** in GameMaker over 3 years. He used Earthbound\'s dev tools as a reference because he couldn\'t afford other engines.',
        ];

        return {
          text: `## 🔴 Truth Unlocked\n\n${REDPILLS[Math.floor(Math.random() * REDPILLS.length)]}`,
          images: [],
          isCommand: true,
        };
      },
    },
    {
      trigger: '/noclip',
      description: 'Secret glitch mode activated',
      emoji: '👻',
      action: async () => ({
        text: `## 👻 NOCLIP MODE ACTIVATED\n\n\`\`\`\nWARNING: You have clipped outside the world boundary.\nPhysics: DISABLED\nCollision: DISABLED  \nGame Master awareness: ENABLED\n\nYou can see the void now.\nThe dev notes are everywhere.\nSomeone left a sticky note that says: 'fix this before launch'\nThey did not fix it before launch.\n\`\`\`\n*Type anything to re-enter the simulation.*`,
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
      description: 'Get a lore drop on a random iconic game universe (live + curated)',
      emoji: '📜',
      action: async () => {
        // ── Try live Reddit scrape from lore + theory subreddits ──────────
        if (Math.random() < 0.6) {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 2500);
            // Cycle across general theory subs + iconic-game-specific lore subs
            const subs = [
              'FanTheories',
              'GameTheorists',
              'gamelore',
              'Eldenring',
              'darksouls',
              'HollowKnight',
              'truezelda',
              'FFXIV',
              'GenshinImpact',
              'Bloodborne',
            ];
            const sub = subs[Math.floor(Math.random() * subs.length)];
            const url = `/api/reddit/r/${sub}/top.json?t=month&limit=40`;
            const res = await fetch(url, { signal: ctrl.signal });
            clearTimeout(t);
            if (res.ok) {
              const data = await res.json();
              const posts = (data?.data?.children || [])
                .map(p => p?.data)
                .filter(p =>
                  p && !p.stickied && !p.over_18 &&
                  p.score > 100 &&
                  // Prefer lore/theory keywords; lore-specific subs are pre-filtered by topic
                  (/(lore|theory|theories|story|origin|connection|symbolism|mythology|backstory|canon|timeline|ending explained|secret|hidden meaning)/i.test(p.title) ||
                   ['gamelore', 'FanTheories', 'GameTheorists', 'truezelda'].includes(sub)) &&
                  p.selftext && p.selftext.length > 200 && p.selftext.length < 2000
                );
              if (posts.length > 0) {
                const pick = posts[Math.floor(Math.random() * posts.length)];
                const title = (pick.title || '')
                  .replace(/^\[(?:lore|theory|spoilers?)\][\s:]*/i, '')
                  .trim();
                let body = (pick.selftext || '').trim();
                body = body
                  .replace(/&amp;#x200B;/g, '')
                  .replace(/&amp;/g, '&')
                  .replace(/&#x200B;/g, '')
                  .replace(/\n{3,}/g, '\n\n')
                  .slice(0, 900);
                return {
                  text: `## 📜 Lore Drop — fresh community theory\n\n**${title}**\n\n${body}${body.length === 900 ? '…' : ''}\n\n*— theorized in r/${pick.subreddit} (${pick.score.toLocaleString()} ↑)*\n\n*⚠️ Community theory — treat as "fan canon" unless confirmed by the developer.*`,
                  images: [],
                  isCommand: true,
                };
              }
            }
          } catch { /* silent fallback */ }
        }

        // ── Curated lore drops (~30 deep cuts across genres) ──────────────
        const LORE = [
          // Souls / Fromsoft
          `**Dark Souls Lore:** The entire Age of Fire is a lie. Gwyn, the "god" you avenge throughout the trilogy, sacrificed his own humanity to link the First Flame and *condemned all life to an eternal cycle of burning and dying* just to delay the inevitable Age of Dark. You are not a hero. You are a battery.`,
          `**Bloodborne Lore:** The "blood" everyone in Yharnam is addicted to isn't medicine — it's **Old Blood**, the ichor of an Eldritch alien being trapped beneath the Healing Church. Every healer in town is unknowingly ritualistically feeding their patients pieces of a god.`,
          `**Sekiro Lore:** Wolf isn't loyal to Kuro because of duty — he's loyal because **Kuro saved his life as a child** by sharing the Dragon's Heritage. Every "death" Wolf experiences is technically Kuro dying with him.`,
          `**Elden Ring Lore:** The "Elden Ring" is just *a really good rune.* Queen Marika shattered it not by accident but deliberately — she wanted to break the Golden Order system her husband Godfrey built, because she had watched it destroy everyone she loved. Every boss you kill was once someone she cared about.`,
          `**Demon's Souls Lore:** The Old One was never the villain. It was a **storage system** for human despair, intentionally created by the Nexus to keep the world stable. The Maiden in Black guides you to "free" it, but freeing it brings the Age of Fog — i.e., death of consciousness.`,

          // Zelda
          `**Zelda Lore:** There are three parallel timelines, two caused by Link's victory and one by his **defeat**. The entire Legend of Zelda franchise canonically acknowledges a timeline where the Hero of Time was **killed by Ganon** during Ocarina of Time. Most classic Zelda games take place in the aftermath of Link losing.`,
          `**Majora's Mask Lore:** The Skull Kid isn't possessed by the mask — **Skull Kid is one of the Lost Children of the Lost Woods.** Specifically, he's a Kokiri who left the forest, which canonically turns Kokiri into Stalkids. The mask just amplified his existing trauma.`,
          `**Tears of the Kingdom Lore:** The Zonai aren't a "lost civilization." They're **Sheikah refugees from the Era of the Calamity** who used the depths to hide for 10,000 years. The "ancient" tech and the modern Sheikah tech are the same lineage, just split by time.`,

          // Indie greats
          `**Hollow Knight Lore:** The Pale King didn't create the infection seal out of compassion — he did it to **save his kingdom's economic model**. The bugs of Hallownest ran entirely on SOUL energy. A world without minds meant no soul, no kingdom, no legacy. The Hollow Knight is not a savior. It's a business decision.`,
          `**Hades Lore:** Zagreus's escape attempts aren't him fighting his father — they're a **family therapy ritual.** Every god in the pantheon is using Zag's escape to communicate with each other after centuries of silence. The dynamic at Olympus is entirely his fault.`,
          `**Undertale Lore:** Sans isn't lazy — he's **mathematically certain you'll reset the timeline.** The sweat in his judgement-hall sprite is implied to be lifeforce burning. The "you've been here before" lines are quantum awareness, not metaphor.`,
          `**Celeste Lore:** Madeline isn't climbing a mountain. **The mountain is the inside of her own mind during a panic attack**, and "Badeline" is her depression. Reaching the summit and reconciling with her isn't "winning" — it's accepting that depression is part of you.`,
          `**Outer Wilds Lore:** The 22-minute time loop isn't a sci-fi puzzle gimmick. It's **a meditation on knowing the universe will end.** Once you "complete" the game, the loop ends — and what waits for you is one of gaming's most beautiful explorations of acceptance.`,
          `**Disco Elysium Lore:** Detective Du Bois is so broken because he **deleted his own personality with alcohol on purpose** to forget his ex-fiancée. Every skill voice in his head is a fragment of the man he chose to erase.`,

          // Classic AAA
          `**Minecraft Lore:** The Endermen are **corrupted Endermen.** The original humans of Minecraft, known as the "Ancient Builders", built the End Portals to escape an ancient plague. Some escaped. Some stayed and built the Nether. The ones who entered the End were slowly consumed by it and became the Endermen — still clutching blocks, still building, forever lost.`,
          `**Skyrim Lore:** The dragons aren't "returning" — they were never gone. The Dragon Cult **trapped Alduin in time** with the Elder Scroll, but every dragon Alduin resurrects in Skyrim is a dragon that the Greybeards **had to spare** because killing one would unmake history. Paarthurnax is alive because killing him erases the Greybeards.`,
          `**Mass Effect Lore:** The Reapers aren't a single hostile race. **They are the AI-uplifted memories of every advanced civilization that came before.** Each Reaper is a new "harvested" species turned into the next Reaper. The Catalyst's "solution" is to kill organics before they create AI that wipes them out — by becoming the AI that wipes them out first.`,
          `**Half-Life Lore:** The G-Man isn't an alien or a government. **He's the player.** Multiple developer comments imply he's an interdimensional entity who curates universes by occasionally yanking Gordon Freeman in and out of stasis. Every cutscene where he speaks is technically him speaking to *you*.`,
          `**Bioshock Lore:** Atlas isn't a freedom fighter. He's **Frank Fontaine** — Andrew Ryan's business rival — who used the trigger phrase "Would you kindly?" to compel Jack into killing Ryan. The entire game is a 30-year-long con. The protagonist is the weapon.`,
          `**Witcher 3 Lore:** Ciri isn't just an Elder Blood carrier — she's **the only being who can travel between dimensions on foot**. Geralt's fight against the Wild Hunt is a fight against **interdimensional refugees from a world the White Frost already ate.**`,

          // Franchise deep cuts
          `**Final Fantasy 7 Lore:** Sephiroth's mother is technically **an alien named Jenova** that Shinra dug out of a 2,000-year-old crater. Sephiroth never found out his "real" mother was Lucrecia — a human Shinra scientist. Every character's tragedy in FF7 traces back to Shinra digging up something they shouldn't have.`,
          `**Persona 5 Lore:** The "Phantom Thieves" are technically **Jungian Shadow projections.** The Metaverse is the collective unconscious. Each Palace boss isn't really their target — it's the *worst version of themselves* the target lets exist. The thieves are stealing distorted self-perception, not literal hearts.`,
          `**Pokémon Lore:** Cubone wears the skull of its dead mother. **Marowak in Pokémon Red is canonically the ghost of a Cubone's mother killed by Team Rocket** in the Pokémon Tower. The Cubone wandering Lavender Town is its orphaned child. Game Freak put this in a children's game in 1996.`,
          `**Kingdom Hearts Lore:** The convoluted timeline is intentional. **Tetsuya Nomura confirmed the lore is impossible to follow** because Sora's identity is meant to feel disjointed, mirroring the game's themes of fragmented memory and identity.`,

          // Modern indie / live service
          `**Genshin Impact Lore:** The "Traveler" is **not human.** Aether and Lumine are technically a species called "Descenders" who traverse universes. The Sustainer of Heavenly Principles imprisoned them for being a threat to the world's narrative — your sibling chose to join the Abyss because they realized **Teyvat is a prison.**`,
          `**Honkai Star Rail Lore:** The "Aeons" aren't gods — they're **mortals who consumed a Path concept.** Each Aeon was once a person who fully embodied a single philosophical concept (Destruction, Preservation, etc.) and ascended. They're cosmic horror dressed in pretty UI.`,
          `**Wuthering Waves Lore:** The "Lament" wasn't a single event — it was **multiple recursive realities collapsing into each other.** Every Resonator who survived has memories from a dead timeline, which is why some have abilities they "shouldn't" have learned.`,

          // Cult classics
          `**Silent Hill 2 Lore:** James Sunderland didn't get a letter from his dead wife. **He killed her.** The entire town manifests his guilt and grief. Pyramid Head is his self-imposed executioner. Every monster is a fragment of his suppressed memory of the murder.`,
          `**Resident Evil 4 Lore:** Las Plagas isn't an infection — it's **a 600-year-old parasitic ecosystem.** The Salazar family discovered it underground, used it for power, and Saddler weaponized it. Leon's mission "rescue the President's daughter" is incidental to the parasites being a global apocalypse waiting to happen.`,
          `**Metal Gear Solid 2 Lore:** Raiden isn't a soldier — he's **a deliberately constructed personality** built by the Patriots to test whether they could mass-produce loyal "Snake-tier" assets. The entire game is a simulation Kojima built to test if YOU, the player, would notice you weren't playing as Snake.`,
          `**Death Stranding Lore:** The "Death Stranding" is **the boundary between life and afterlife dissolving.** BB units are babies in a coma between worlds — they can perceive BTs because they're technically half-dead themselves. Sam isn't delivering packages; he's reconnecting **the literal grid that holds reality together.**`,
          `**Control Lore:** The "Hiss" isn't an entity — it's **a memetic incantation that rewrites consciousness through repetition.** Every infected agent is repeating it because hearing it once embeds the loop in their brain. Jesse Faden survives because she has a "counter-mantra" from her time with Polaris.`,
        ];

        return {
          text: `## 📜 Lore Drop Incoming...\n\n${LORE[Math.floor(Math.random() * LORE.length)]}`,
          images: [],
          isCommand: true,
        };
      },
    },
  ], [clearChat]);

  const processCommand = async (text) => {
    const trimmed = text.trim().toLowerCase();
    const cmd = SLASH_COMMANDS.find(c => trimmed === c.trigger || trimmed.startsWith(c.trigger + ' '));
    if (!cmd) return false;
    // Pass any text after the trigger as args (e.g. "/price elden ring" → "elden ring")
    const args = text.trim().slice(cmd.trigger.length).trim();
    const result = await cmd.action(args);
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
    // ── Slash commands ──────────────────────────────────────────────────────
    if (text.trim().startsWith('/')) {
      const handled = await processCommand(text);
      if (handled) return;
    }

    // ── Duplicate guard ─────────────────────────────────────────────────────
    if (text.trim() === lastMessageRef.current && attachments.length === 0) {
      console.warn('Duplicate message blocked.');
      return;
    }

    // ── Cooldown guard (2 seconds between requests) ─────────────────────────
    if (cooldownRef.current) {
      console.warn('Rate limit: please wait before sending another message.');
      return;
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

    lastMessageRef.current = text.trim(); // record for duplicate guard

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
    setWebActive(false);
    setPriceActive(false);
    setPriceData([]);

    // Create a new AbortController for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Start 2-second cooldown
    cooldownRef.current = true;
    cooldownTimerRef.current = setTimeout(() => { cooldownRef.current = false; }, 2000);

    try {
      // ─── SPEED OPTIMIZATION ────────────────────────────────────────────
      // Skip client-side scraping entirely for non-game-related queries
      // (greetings, meta-questions about the bot, casual chitchat). The
      // omniscience layer on the server still fans out when needed.
      // Price-fetching is now opt-in via the /price slash command — no
      // longer fires on every message.
      let redditContext = '';
      let wikiContext = '';
      const priceContext = ''; // /price command handles this exclusively now

      const isLikelyGameRelated = needsGameContext(text);

      if (isLikelyGameRelated) {
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
      }

      // Step 2: Call AI with all gathered context + attachments
      const aiResponse = await generateChatResponse(
        null, text, messages, redditContext, wikiContext, attachments, priceContext,
        controller.signal  // ← pass abort signal
      );

      // Light up the Web Intel badge if the edge function's omni / pulse pipeline
      // pulled in live web-search results for this turn.
      if (aiResponse.meta?.sources?.includes?.('web-search')) {
        setWebActive(true);
      }

      // AI response is now { text, images, meta }
      const aiMessage = {
        id: (Date.now() + 1).toString(),
        text: aiResponse.text,
        sender: 'ai',
        images: (aiResponse.images || []).map(img => ({
          previewUrl: `data:${img.mimeType};base64,${img.data}`,
          mimeType: img.mimeType,
        })),
        meta: aiResponse.meta || null,
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
      // AbortError = user clicked Stop — don't show any error message
      if (error.name === 'AbortError') {
        console.info('Request cancelled by user.');
        return;
      }
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
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  };

  return {
    messages,
    isLoading,
    sendMessage,
    cancelRequest,
    clearChat,
    redditActive,
    wikiActive,
    webActive,
    priceActive,
    priceData,
    SLASH_COMMANDS,
  };
}
