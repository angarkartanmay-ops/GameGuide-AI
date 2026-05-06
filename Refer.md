# 📚 GameGuide-AI: Comprehensive Project Reference

This document serves as a highly detailed summary of the architecture, capabilities, and development history of the **GameGuide-AI** project. It is intended for future reference to rapidly recall how systems are integrated, the specific tech stack utilized, and the capabilities of the agent.

---

## 1. Project Overview & Philosophy
**GameGuide-AI** is a premium, web-based, AI-powered support application built specifically for the gaming community.
**Core Philosophy:** Gamers do not want to read walls of text. They need high-density, accurate, well-structured data. The project was designed with a heavy emphasis on scannability (tables, bolding, bullet points), real-time accuracy (Wiki/Reddit/Price/PULSE scraping), and an immersive UX (theme engines, loading animations, landing page, responsive layouts).

---

## 2. Core Capabilities & Engines Built

### 🤖 A. The LLM Engine (Cortex v4.2 — Multi-Provider Neural Mesh)
*   **Primary Provider:** Google Gemini, via the official `@google/genai` SDK.
*   **Primary Models (Gemini tier):**
    *   `gemini-2.0-flash`: Primary model for speed + quality.
    *   `gemini-2.5-flash`: Newest stable flash model.
    *   `gemini-2.0-flash-lite`: Ultra-fast fallback for overload conditions.
*   **External Provider Mesh (self-healing waterfall):**
    *   **Groq** — `llama-3.3-70b-versatile`, `llama-4-scout-17b-16e-instruct`, `llama-3.1-8b-instant` (text only; used for the **Speed Fast-Path** on simple queries for sub-500ms response).
    *   **OpenRouter (Free tier)** — `google/gemini-2.0-flash-exp:free` (vision), `meta-llama/llama-4-scout-17b-16e-instruct:free` (vision), `mistralai/pixtral-12b:free` (vision), `deepseek/deepseek-chat-v3-0324:free`, `meta-llama/llama-3.3-70b-instruct:free`, `mistralai/mistral-small-3.1-24b-instruct:free`.
    *   **Cerebras** — `llama-3.3-70b`, `llama3.1-8b` (text only, ultra-fast inference).
*   **Routing Strategy:** The **Route Optimizer** selects the best (provider, model) order based on the query profile: simple queries prefer fast/small models; deep/lore queries prefer flagship 70B; vision queries go native Gemini first, with OpenRouter vision fallback.
*   **System Prompt Engineering:** A highly specialized system prompt (`BASE_SYSTEM` in the `chat-proxy` Edge Function) enforces strict constraints:
    *   **No paragraphs:** Forces the use of bullet points grouped under clear `##` headers.
    *   **Table Requirement:** Any comparison (gear, stats, characters, speedrunner vs. completionist strategies) *must* be formatted as a Markdown table.
    *   **ASCII Flowcharts:** AI is instructed to draw visual ASCII decision trees for troubleshooting or quest steps.
    *   **Suggested Next Questions:** Strict generation of 2-4 follow-up questions from the *user's perspective* using a `[?]` syntax wrapper.
    *   **Pro-Gamer Accuracy Contract:** Nine explicit rules enforcing specific numbers over vague claims, patch-version tags, anti-confabulation, and allowing "I don't know" rather than hallucination.

### 🧠 B. The 6-Stage Reasoning Pipeline (Cortex Architecture)
All AI communication is proxied through a Deno-based Supabase Edge Function (`supabase/functions/chat-proxy/index.ts`), implementing the following pipeline:

| Stage | Name | Purpose |
|-------|------|---------|
| 1 | **Query Cortex** | Classifies intent (lore/build/troubleshoot/speedrun/meta/review/comparison/general), detects game (from 200+ known titles), scores complexity (simple/medium/deep) |
| 2 | **Persona Engine** | Selects from 7 expert personas (Coach, Loremaster, TechWizard, Speedrunner, MetaAnalyst, GameCritic, Generalist) |
| 3 | **PULSE Detector** | Fires the temporal-detection + live-search pipeline on recency queries (see §2C) |
| 4 | **Route Optimizer** | Picks optimal provider/model based on query profile |
| 5 | **Neural Mesh** | Self-healing multi-provider waterfall with exponential backoff and model fallback |
| 6 | **Quality Gate** | Response cache (SHA-256 keyed, 5-min TTL), follow-up question injection, vision uncertainty scrubbing |

*   **Automatic Retry & Backoff:** Implements exponential backoff to handle `503` (High Demand), `429` (Rate Limit), `400` (with MIME normalization retry for images), and `404` (model not found → skip) errors.
*   **Model Fallback Chain:** If the primary model fails, the proxy automatically cascades through alternatives, making the UI feel bulletproof.
*   **Speed Fast-Path:** Simple text queries with Groq key configured skip the full mesh and go directly to `llama-3.1-8b-instant` for sub-500ms responses.
*   **In-Memory Response Cache:** SHA-256 content-addressed with 5-minute TTL. Cache key includes prompt, last 2 history messages, context block lengths, and per-attachment SHA-256 hashes. Cache is checked before AND after omni-scraping to avoid redundant LLM calls.

### 🌐 C. The Intelligence Engine (Project PULSE + Omni-Scrape)
We bypass LLM training-data staleness with a two-tier live-data system:

**Project PULSE v2 (recency-first, temporal queries only):**
*   **Temporal Detector** (`temporalDetector.ts`) flags queries containing words like "new", "latest", "current", "this season", "patch X", "202[4-9]", superlatives ("strongest"), feature checks ("does X have"), count queries ("how many"), and competitive roster references. v2 adds implicit-temporal-subject boosting — catches queries like "Clash Royale hero card" even without explicit "new" keyword.
*   **Official Sources Registry** (`officialSources.ts`) maps 15 known games to their authoritative endpoints — Supercell APIs (Clash Royale / CoC / Brawl Stars), Mojang RSS (Minecraft), fortnite-api.com (Fortnite), and HTML news pages for Valorant / League / Apex / Overwatch / BGMI / PUBG Mobile / Genshin / HSR / Destiny 2 / Call of Duty.
*   **Multi-Strategy Web Search** (`webSearch.ts`) — five providers fired in parallel:
    *   **Google Custom Search Engine** (100 free/day, most reliable, `dateRestrict=m3`).
    *   **Serper.dev** (2500 free/month, Google SERP API, extracts Knowledge Graph + People Also Ask).
    *   **Brave Search API** (if `BRAVE_SEARCH_API_KEY` env is set, free 2000/mo).
    *   **SearXNG** public instances (7 rotated instances, JSON output, no key needed).
    *   **DuckDuckGo Lite** HTML (regex-parsed, no key needed, with standard HTML fallback).
*   **Aggressive Multi-Angle Search:** PULSE v2 formulates up to 4 search queries in parallel per temporal query (e.g., `{game} new {subject} {year}`, `{game} latest {subject} {month} {year}`, raw prompt), deduplicates by URL, and extracts up to 5 top-ranked results.
*   **Recency Ranker** (`recencyRanker.ts`) scores every block as `authority × freshness_multiplier`. Anything >1 year old is demoted to 0.3×, <7 days gets 1.6×, <30 days gets 1.3×. Web-search hits on official publisher domains (26 domains recognized) get an authority bump to 9.
*   **Date Grounding** — every system prompt now contains today's ISO date and a 6-rule hard contract: "Never claim 'newest/latest' from training data alone." If no live data exists, the model MUST say "I don't have verified live data on this right now."

**Omni-Scrape (standard live scraping, always-on for game-detected queries):**
*   **6 parallel sources** with 3-second total budget:
    1.  **Supercell Official APIs** — full card/brawler roster from `api.clashroyale.com`, `api.brawlstars.com` (canonical, authority=10).
    2.  **Wikipedia REST API** — `en.wikipedia.org/api/rest_v1/page/summary`, with 4-variant title disambiguation + fallback opensearch (authority=8).
    3.  **Steam News API** — `ISteamNews/GetNewsForApp/v2` mapped via 90+ game→appId lookup table. BBCode/HTML stripped, 5 most recent items (authority=8).
    4.  **Invidious/YouTube** — rotates 4 Invidious instances, searches `{game} update guide {year}`, word-boundary filters for relevance (authority=7).
    5.  **Gaming RSS** — IGN, Polygon, Eurogamer, PCGamer, GameSpot feeds in parallel. Regex-parsed XML, game-name word-boundary filtered (authority=5).
    6.  **Web Search for Game** — calls `multiWebSearch()` with `{game} latest news update {year}` (authority=7).
*   **Rank & Cap:** Results sorted by authority score descending, deduplicated by source, hard-capped to 6000 chars total. High-score blocks (≥7) get truncated to remaining budget rather than dropped.
*   **Accuracy Lock:** When high-authority sources (score ≥8) confirm a game identification, an `ACCURACY LOCK` block is appended to the prompt preventing the model from overriding live data with training bias.
*   **Vercel proxy functions** for Reddit (`/api/reddit-proxy` via `vercel.json` rewrite) and Wiki (`/api/wiki-proxy` via Vite custom plugin `fandomProxyPlugin`) — bypass CORS for client-side fallbacks.
*   CheapShark API for live game pricing (integrated via `/price` slash command).

The two systems are complementary: PULSE handles "what is the newest X" queries with publisher-grade authority; standard Omni-Scrape handles general lore/strategy/community-sentiment queries.

### 👁️ D. Multimodal Systems (Vision & Generation)
*   **Image Analysis (Vision):** Users can attach up to 3 images. Pipeline:
    1.  **Client-side preprocessing** (`src/utils/imagePreprocess.js`): Canvas-API resize to 1568px long-edge, EXIF strip, JPEG re-encode at 88% quality, hard 4MB cap. Handles HEIC/AVIF/WebP transparently.
    2.  **Three-tier vision mesh** in `chat-proxy`:
        - **Tier 1 (Native Gemini, always-first):** `gemini-2.0-flash` → `gemini-2.5-flash` → `gemini-2.0-flash-lite`, with 3 retry attempts per model including exponential backoff (2s, 4s) on 429/503. MIME normalization retry on 400 errors (re-flag all attachments as `image/jpeg`).
        - **Tier 2 (OpenRouter vision fallback):** `google/gemini-2.0-flash-exp:free`, `meta-llama/llama-4-scout:free`, `mistralai/pixtral-12b:free` — kicks in on Tier-1 exhaustion.
        - **Tier 3:** Graceful refusal with specific error context.
    3.  **GODMODE Vision Protocol v3** (`VISION_GODMODE_INSTRUCTION`): forces 4-step reasoning:
        - STEP 1: OCR & Text Extraction (character-by-character, no auto-correction).
        - STEP 2: Visual Inventory & HUD (color-based material identification).
        - STEP 3: Environment & Context (biome, structures, mobs, lighting).
        - STEP 4: Answer (grounded only in Steps 1-3 evidence).
        - Hard refusal clause for unreadable images. Temperature locked at 0.15 for vision.
    4.  **Game-Specific HUD Knowledge Base** — 18 game-specific HUD decoder specifications (Minecraft, Fortnite, Valorant, LoL, Apex, CoD, Warzone, Zelda, Elden Ring, Dark Souls, Genshin, Fallout, Destiny, Cyberpunk, Overwatch, Pokémon, Diablo, Terraria, Hollow Knight) teaching the model what icons/regions/colors mean for THAT game.
    5.  **Game Resolver** — runs when vision is active but no game detected from text. OpenRouter `gemini-2.0-flash-exp:free` first (separate quota), native Gemini Flash fallback. Structured output: `GAME: <name> | CONFIDENCE: high|medium|low`.
    6.  **Second-Opinion Hop** — triggers when the first vision response on an identification-critical query (`what/which/who is this`) contains uncertainty language. Cross-checks against a second vision provider and presents a labeled comparison.
    7.  **Post-processing** — scrubs common "appears to be [number]" hallucination patterns, replacing with `(uncertain — verify in-game)`.
*   **Image Generation:** A keyword detector triggers a fallback chain of Gemini image generation models (`gemini-2.0-flash-exp`, `gemini-2.0-flash`) when keywords like `"generate image"` or `"draw me"` are detected. Images render inline with a `🎨 AI Generated` badge.

### ⌨️ E. Slash Command System
Implemented a "Power User" command palette (`useChat.js`) that allows instant interactions:
*   `/clear`: Wipe entire chat history from Supabase.
*   `/help`: View the interactive command reference table.
*   `/tip`: Generate a random pro gaming tip (60% chance live Reddit scrape from r/gamingtips, r/truegaming, r/gaming; fallback to 85+ curated tips across 13 categories: FPS, RPG, competitive, speedrun, settings, MMO, mobile, strategy, general, streaming, health, pricing, genre-specific).
*   `/lore`: Get a lore drop (60% chance live Reddit scrape from r/FanTheories, r/GameTheorists, r/gamelore, r/Eldenring, r/darksouls, r/HollowKnight, r/truezelda, r/FFXIV, r/GenshinImpact, r/Bloodborne; fallback to 30+ curated deep-cut lore entries).
*   `/redpill`: Unlock a hidden gaming industry secret (60% chance live Reddit scrape from r/GamingDetails, r/gaming, r/truegaming; fallback to 55+ curated industry secrets).
*   `/price <game>`: Live multi-store prices via CheapShark API. Uses `fetchPriceDirect()` with exact-match-first + fuzzy-scored fallback to avoid misfires. Shows structured `PriceBadge` sidebar UI with parallel `fetchPriceSummaryDirect()`.
*   **Easter Eggs:** `/konami`, `/noclip`, `/loading` for immersive gamer flavor.

### 🎭 F. The Gamer Theme Engine
*   **7 Custom Themes:** Creatively named to avoid copyright issues:
    1.  🌆 **Neon Synth** (Default — cyberpunk aesthetic)
    2.  ☢️ **Wasteland Terminal** (Fallout/post-apocalyptic)
    3.  🎯 **Tactical Strike** (military stealth)
    4.  🛹 **Urban Graffiti** (street/subway surfers)
    5.  🪖 **Orbital Drop** (sci-fi/Halo)
    6.  ⛏️ **Voxel World** (Minecraft-inspired)
    7.  🚀 **Nitro Arena** (racing/neon)
*   **Persistence:** Active theme is saved to `localStorage`, ensuring preferences survive page refreshes.
*   **CSS Variables:** Entire theme system built on CSS custom properties toggled via `data-theme` attribute on `<html>`.
*   **Loading Screen:** A full-screen randomized animation engine triggers on first load (plays exactly once per session via `splashShownRef`). Features 6 particle effects (*Electric Nexus, Hyper-Space, Data Rain, Energy Shield, Cyber Vortex, Glitch System*) that adapt to the active theme's colors. Exit animation: 500ms fade-out.

### 🚀 G. Premium Landing Page
*   Built with **Framer Motion** for scroll-driven parallax, staggered reveals, and spring-based micro-interactions.
*   **7 sections:** Nav → Hero (per-character animation, orbital rings, mesh-gradient blobs) → Marquee (infinite horizontal scroll) → Capabilities (6 feature cards with hover lift + glow) → Pipeline (6-stage animated node chain) → Chat Demo (live-preview with simulated typing indicator) → CTA (pulsing aura card) → Footer.
*   **Scroll-aware:** Progress bar tracks `scrollYProgress`; hero parallax fades on scroll.
*   **Session-gated:** `sessionStorage('gg_entered')` prevents re-showing the landing within the same browser session.

### 👾 H. Discord Bot Integration (v2.0)
*   A standalone Node.js process using `discord.js` located in `/discord-bot`.
*   **Full Feature Parity:** 12 slash commands (`/ask`, `/price`, `/tip`, `/lore`, `/redpill`, `/noclip`, `/konami`, `/loading`, `/clear`, `/history`, `/stats`, `/premium`, `/help`) + `@mention` chat with vision support (up to 3 image attachments).
*   **Shared Brain:** Rather than duplicating logic, the bot intercepts Discord messages and forwards them to the existing Supabase `chat-proxy` Edge Function via raw `fetch()` with AbortController timeout (60s).
*   **Tiered Rate Limiting:** FREE 5/min · PRO 30/min · PREMIUM_SERVER 60/min. Tier resolution via Stripe-driven Supabase row (`discord_premium` table) OR env-variable override (`PREMIUM_USER_IDS`, `PREMIUM_GUILD_IDS`).
*   **Persistent History:** Per-user chat history stored in Supabase (`discord_chat_messages` table), 10-message context window, 30s in-memory cache for deduplication.
*   **Monetization Hooks:** `/premium` command with Stripe, Patreon, Ko-fi, and Top.gg vote buttons. Affiliate link decoration for CheapShark deal URLs (Humble, GreenManGaming, Fanatical).
*   **Vote Rewards:** Top.gg webhook listener grants 12h (24h on weekends) free PRO tier on vote.
*   **Analytics:** Per-user call counters + vision call counters → Supabase (`discord_usage_stats`).
*   **Resilience:** SIGTERM/SIGINT graceful shutdown, structured error messages, typing indicator pulses every 8s during processing.
*   **Formatting Parity:** Because Discord natively supports Markdown (tables, bold text, code blocks), the AI's strict formatting constraints render perfectly in-client.
*   **Deployment:** Designed to run as a continuous background worker (e.g., on Railway or Render). Includes `Dockerfile`, `Procfile`, `railway.json`.

---

## 3. The Tech Stack Breakdown

| Layer | Technology |
|-------|-----------|
| **Core** | React 19 / Vite 8 |
| **Backend/DB** | Supabase (Auth, PostgreSQL, Deno Edge Functions) |
| **Styling** | 100% Vanilla CSS (utilizing `100dvh` for mobile and CSS variables for the theme engine) |
| **Animations** | Framer Motion (landing page parallax, stagger, spring physics) |
| **AI SDKs** | `@google/genai` (Gemini native), OpenAI-compatible REST for Groq/OpenRouter/Cerebras |
| **Deployment** | Vercel (Frontend & Serverless API Scrapers via `vercel.json` rewrites) |
| **Markdown** | `react-markdown` + `remark-gfm` for table rendering |
| **Icons** | `lucide-react` |
| **Discord Bot** | `discord.js` v14 + `@supabase/supabase-js` (Node.js 18+) |
| **Responsiveness** | Dedicated mobile redesign with horizontally scrollable responsive tables and a centered "stacked" header layout |

---

## 4. File Architecture

```
GameGuide-AI/
├── index.html                          # SPA entry point (Google Fonts preconnect)
├── package.json                        # React 19, Vite 8, Framer Motion, lucide-react
├── vite.config.js                      # Fandom wiki proxy plugin + Reddit proxy config
├── vercel.json                         # Reddit API rewrite for production
├── eslint.config.js                    # ESLint 9 flat config
│
├── src/
│   ├── main.jsx                        # React DOM root
│   ├── App.jsx                         # Root: Landing → LoadingScreen → Chat shell
│   ├── App.css                         # Master stylesheet (29KB, 7 themes, responsive)
│   ├── index.css                       # Base resets + CSS custom properties
│   │
│   ├── components/
│   │   ├── LandingPage.jsx             # Framer Motion 7-section landing page
│   │   ├── LandingPage.css             # Landing page styles (19KB)
│   │   ├── LoadingScreen.jsx           # 6-effect particle animation engine
│   │   ├── LoadingScreen.css           # Loading screen styles
│   │   ├── ChatContainer.jsx           # Message list + auto-scroll
│   │   ├── ChatInput.jsx               # Input with slash-command autocomplete + image upload
│   │   ├── MessageBubble.jsx           # User/AI bubbles with markdown + image rendering
│   │   ├── FollowUpChips.jsx           # [?] follow-up question chips parser
│   │   ├── ThemeSelector.jsx           # 7-theme dropdown with localStorage
│   │   ├── UserProfile.jsx             # Supabase auth state display
│   │   └── PriceBadge.jsx              # CheapShark price sidebar widget
│   │
│   ├── hooks/
│   │   ├── useAuth.js                  # Supabase auth listener
│   │   └── useChat.js                  # 843-line chat orchestrator (slash commands, scraping, abort, rate limiting)
│   │
│   ├── services/
│   │   ├── supabaseClient.js           # Supabase JS client singleton
│   │   ├── aiProvider.js               # Chat proxy caller with AbortSignal support
│   │   ├── redditScraper.js            # Client-side Reddit JSON scraper
│   │   ├── wikiScraper.js              # Client-side Fandom MediaWiki scraper
│   │   └── priceScraper.js             # CheapShark price fetcher (exact + fuzzy)
│   │
│   └── utils/
│       └── imagePreprocess.js          # Canvas resize + EXIF strip + JPEG re-encode
│
├── supabase/
│   └── functions/
│       └── chat-proxy/
│           ├── index.ts                # 2113-line Cortex v4.2 Edge Function
│           ├── pulseEngine.ts          # Project PULSE v2 orchestrator
│           ├── temporalDetector.ts     # 12-pattern temporal intent classifier
│           ├── officialSources.ts      # 15-game official endpoint registry
│           ├── webSearch.ts            # 5-provider web search (Google CSE/Serper/Brave/SearXNG/DDG)
│           ├── recencyRanker.ts        # Authority × freshness scoring + top-N compaction
│           └── deno.json               # Deno config (npm specifiers)
│
├── discord-bot/
│   ├── index.js                        # 774-line Discord bot v2.0 (full feature parity)
│   ├── register-commands.js            # Slash command registration script
│   ├── schema.sql                      # Supabase table schemas for Discord
│   ├── package.json                    # discord.js + @supabase/supabase-js
│   ├── Dockerfile                      # Container deployment
│   ├── Procfile                        # Railway deployment
│   ├── railway.json                    # Railway config
│   └── README.md                       # Discord bot setup guide
│
├── api/
│   └── wiki/                           # Vercel serverless wiki proxy (if needed)
│
└── public/
    └── favicon.jpg                     # App icon
```

---

## 5. Mobile Transformation
Moving beyond "basic stacking," the mobile UI features:
*   **Horizontal Scroll Tables:** AI tables wrap text and allow smooth horizontal scrolling within the chat bubble to prevent layout breaks.
*   **Centered Controls:** Brand and navigation elements are optimized for thumb-reach and visual clarity on small screens.
*   **Adaptive Density:** Message bubbles expand to 98% width on mobile to maximize information density.
*   **`100dvh` Units:** Proper mobile viewport handling using dynamic viewport height units.

---

## 6. Development History & Milestone Log
1.  **v1.0:** Initial React + Gemini setup.
2.  **v1.2:** Integrated Reddit/Wiki scraping via Vite proxy.
3.  **v1.5:** Migration to Supabase Auth & DB history persistence.
4.  **v2.0:** Production migration (Vercel APIs) and Theme Engine (7 themes).
5.  **v2.1:** Price Engine (CheapShark) and Slash Commands integration.
6.  **v2.5:** Full Mobile Redesign, Loading Animation Engine, and Robust Proxy Retry Logic.
7.  **v3.0:** Discord Bot v1.0 Integration leveraging existing Supabase Edge Functions.
8.  **v3.5:** Discord Bot v2.0 — tiered rate limiting, persistent history, monetization hooks (Stripe/Patreon/Ko-fi/Top.gg), affiliate links, analytics, slash command parity.
9.  **v4.0:** Cortex v4.0 — Multi-provider Neural Mesh (Groq + OpenRouter + Cerebras), Persona Engine (7 personas), Query Cortex (intent/game/complexity classifier), Speed Fast-Path, response caching, Omni-Scrape (Wikipedia + Steam News + YouTube + Gaming RSS + Supercell APIs + Web Search).
10. **v4.2 (Current):** Project PULSE v2 — aggressive multi-angle web search (Google CSE, Serper, Brave, SearXNG, DuckDuckGo), temporal detection v2 with implicit-subject boosting, date grounding with 6-rule hard contract, recency ranker with 26-domain official authority bumps. Vision GODMODE v3 — native-Gemini-only vision path, game-specific HUD decoders (18 games), second-opinion hop, uncertainty scrubbing. Premium Landing Page with Framer Motion.
