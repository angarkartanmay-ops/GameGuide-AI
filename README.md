# GameGuide-AI

**A multimodal, real-time gaming intelligence platform.** GameGuide-AI is a production-grade AI assistant built for competitive players, esports coaches, speedrunners, and the broader gaming community. It combines a self-healing multi-provider neural mesh, sub-400ms streaming responses, live web fusion across six sources, vision-grade screenshot understanding, and a parallel Discord deployment — all backed by a transparent, citation-linked reasoning pipeline.

> **Live Web App:** [gameguide-ai.vercel.app](https://gameguide-ai.vercel.app)
> **Discord Bot:** [Setup & invite instructions](discord-bot/README.md)
> **Author:** Tanmay Angarkar
> **License:** Proprietary — © 2026 Tanmay Angarkar. All rights reserved. See `Terms` page in-app.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Core Principles](#2-core-principles)
3. [Feature Matrix](#3-feature-matrix)
4. [System Architecture](#4-system-architecture)
5. [Cortex Reasoning Pipeline](#5-cortex-reasoning-pipeline)
6. [Live Data Sources](#6-live-data-sources)
7. [Vision GODMODE](#7-vision-godmode)
8. [Persona Engine](#8-persona-engine)
9. [Slash Commands](#9-slash-commands)
10. [Theme System](#10-theme-system)
11. [Discord Bot](#11-discord-bot)
12. [Technology Stack](#12-technology-stack)
13. [Repository Structure](#13-repository-structure)
14. [Getting Started](#14-getting-started)
15. [Environment Configuration](#15-environment-configuration)
16. [Deployment](#16-deployment)
17. [Supported Games](#17-supported-games)
18. [Performance Targets](#18-performance-targets)
19. [Roadmap](#19-roadmap)
20. [Copyright, License & Acceptable Use](#20-copyright-license--acceptable-use)
21. [Contact](#21-contact)

---

## 1. Project Overview

GameGuide-AI is a single-page React application paired with a Supabase Edge Functions backend and an optional standalone Discord bot. It serves three audiences:

- **Competitive players** who need tournament-grade accuracy with patch-current data.
- **Casual players** who want guidance on builds, lore, and meta without wading through wikis.
- **Server communities** that want a unified support bot for game-related questions on Discord.

The system distinguishes itself from generic chatbots in three dimensions:

1. **Recency.** Every substantive query triggers parallel scraping from up to six live sources, and the model is contractually instructed to favor live intelligence over its training data on any topic the live blocks cover.
2. **Vision.** Up to three screenshots per turn pass through an OCR-first, four-step "GODMODE" pipeline with eighteen game-specific HUD decoders before the language model ever sees them.
3. **Resilience.** A four-provider neural mesh (Gemini, Groq, OpenRouter, Cerebras) routes requests based on complexity and falls over at the token level — there is no single point of failure.

---

## 2. Core Principles

| Principle | Implementation |
|---|---|
| **Live data primacy** | Every answer marks live-sourced facts versus training-derived analysis. Patch versions are tagged when available. |
| **Anti-confabulation** | Strict prompt contracts forbid inventing item, character, or ability names. "I don't know" is an accepted answer. |
| **Latency budget** | P50 < 400ms first-token streaming; provider race for the fastest valid response. |
| **Citation-by-default** | Reddit, Wikipedia, Steam, official APIs, and web search results are attached as a sources chip on every fused response. |
| **Multi-platform parity** | Stat differences across Java/Bedrock, PC/console, mobile/PC are surfaced explicitly. |

---

## 3. Feature Matrix

| Capability | Details |
|---|---|
| **Cortex Neural Mesh** | Four-provider self-healing AI waterfall — Google Gemini, Groq, OpenRouter, Cerebras. Token-level fallback. |
| **Project PULSE** | Multi-engine live web search — Google CSE, Serper, Brave, SearXNG, DuckDuckGo — fused, deduplicated, recency-ranked. |
| **Vision GODMODE** | Multi-image upload (up to 3), OCR-first pipeline, 18 game-specific HUD decoders, second-opinion verification on disagreement. |
| **Omni-Scrape** | Parallel client + edge fan-out across Reddit, Wikipedia, Steam News, YouTube (via Invidious), gaming RSS, and official game APIs. |
| **Persona Engine** | Seven auto-selected experts (Coach, Loremaster, TechWizard, Speedrunner, MetaAnalyst, GameCritic, GameGuide). |
| **Slash Commands** | Power-user verbs (`/price`, `/tip`, `/lore`, `/redpill`, `/clear`, `/help`, plus Easter eggs). |
| **Multimodal Chat** | Markdown rendering with GFM tables, code fences, syntax-aware bullet lists, and inline citation chips. |
| **Follow-up Chips** | Every response surfaces three to five contextual `[?]` follow-ups from the user's perspective. |
| **Authentication** | Optional Supabase Auth (email + Google OAuth). Conversations persist per user. |
| **Theme System** | Seven custom dark themes with subtle round-robin transition effects. |
| **Discord Bot** | Production-ready 24/7 deployment with tiered rate-limiting, persistent history, and affiliate-decorated price lookups. |
| **Landing Page** | GPU-probed WebGL hero, scroll-pinned pipeline visualization, magnetic cursor, low-power graceful fallback. |
| **Info Pages** | Hash-routed About / Terms / Contacts pages with full DMCA and IP-protection terms. |

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser SPA)                         │
│   React 19 + Vite 8 · Framer Motion · GSAP ScrollTrigger · R3F      │
├─────────────────────────────────────────────────────────────────────┤
│  Landing Page  ──▶  Chat Interface  ──▶  Info Pages (About/Terms)   │
│                            │                                         │
│                            ▼                                         │
│                       useChat.js                                     │
│                            │                                         │
│        ┌───────────────────┼───────────────────┐                     │
│        ▼                   ▼                   ▼                     │
│  Reddit scraper      Wiki scraper       Price scraper                │
│  (client)            (client)           (client, CheapShark)         │
│                            │                                         │
│                            ▼                                         │
│            Supabase Edge Function (Deno runtime)                     │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              SUPABASE EDGE :: chat-proxy/index.ts                    │
├─────────────────────────────────────────────────────────────────────┤
│  1. Query Cortex      → classify intent, detect game, score depth   │
│  2. Temporal Detector → "is this a recency-bound query?"            │
│  3. PULSE Engine      → fan-out 5 search providers if temporal      │
│  4. Vision Pipeline   → OCR + HUD decoders for any attachments      │
│  5. Persona Engine    → select Coach / Loremaster / TechWizard / …  │
│  6. Route Optimizer   → pick Gemini / Groq / OpenRouter / Cerebras   │
│  7. Neural Mesh       → self-healing waterfall with token fallback  │
│  8. Recency Ranker    → re-order results by freshness               │
│  9. Quality Gate      → cache, format-repair, citation attach       │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
                  Streamed response → UI
```

**Network boundaries.** The browser never holds an AI provider key. All model calls are proxied through the Supabase Edge Function, which holds keys server-side. The Discord bot calls the same edge function with its own service-role auth.

**Why Edge Functions.** Deno on Supabase Edge runs near the user, supports streaming responses, and allows secrets to remain server-side without a separate Node service. This keeps cold starts under 100ms in most regions.

---

## 5. Cortex Reasoning Pipeline

The edge function is structured as a sequential pipeline. Each stage is independently observable and falls back gracefully:

| Stage | Module | Purpose | Failure mode |
|---|---|---|---|
| 1. Query Cortex | `index.ts` | Classifies intent (factual/opinion/build/lore/troubleshoot), detects game from text and vision, scores complexity 0–10. | Defaults to general intent on parse failure. |
| 2. Temporal Detector | `temporalDetector.ts` | Decides whether the query needs live web fusion. Triggers PULSE. | Conservatively triggers PULSE when uncertain. |
| 3. PULSE Engine | `pulseEngine.ts` | Fans out to up to five search providers in parallel; dedupes by URL canonical form. | Falls through to next provider on quota/error. |
| 4. Vision Pipeline | `visionPipeline.ts` | OCR-first attachment processing with HUD decoders. | Bypasses to text-only mode if no vision provider available. |
| 5. Persona Engine | `index.ts` | Selects the most appropriate expert persona based on intent + game. | Defaults to general GameGuide voice. |
| 6. Route Optimizer | `index.ts` | Picks provider/model based on complexity, latency, and modality. | Cascades through provider list. |
| 7. Neural Mesh | `index.ts` | Multi-provider race with token-level retry. | Each provider is independently bypassed on error. |
| 8. Recency Ranker | `recencyRanker.ts` | Sorts merged results by publish date when present. | No-op if no dated results. |
| 9. Quality Gate | `index.ts` | Caches successful responses; validates markdown structure; auto-repairs malformed tables. | Returns raw model output if repair fails. |

The pipeline is contract-bound at every stage by an extensive base system prompt — see the `BASE_SYSTEM` constant in `supabase/functions/chat-proxy/index.ts`. The contract enforces specific numbers over vague claims, patch-version tagging, fact-versus-opinion separation, and an explicit "I don't know is allowed" clause.

---

## 6. Live Data Sources

The Omniscience Layer fires live data fetches in parallel. Sources include:

| Source | Coverage | Provider | Rate Limit |
|---|---|---|---|
| **Google Custom Search** | General web | Google CSE | 100/day free |
| **Serper** | Google SERP | serper.dev | 2,500/month free |
| **Brave Search** | Independent index | Brave | 2,000/month free |
| **SearXNG** | Federated meta-search | Self-hosted/public | None |
| **DuckDuckGo** | Lightweight HTML | Direct fetch | None |
| **Wikipedia REST API** | Encyclopedic | Wikimedia | Generous |
| **Fandom MediaWiki API** | Game-specific wikis | Per-game subdomains | Generous |
| **Reddit JSON** | Community sentiment | Per-subreddit JSON | Soft cap |
| **Steam News** | Patch notes, releases | Steam Web API | None for news endpoint |
| **YouTube (Invidious)** | Recent uploads | Public Invidious instance | Variable |
| **Gaming RSS** | IGN, Polygon, Eurogamer, PC Gamer, GameSpot | Direct feed parse | None |
| **Supercell, Riot, Steam APIs** | Live game data | Official | API-key based |
| **CheapShark API** | Live PC game prices, 20+ stores | CheapShark | None (CORS-enabled) |

Client-side scrapers (Reddit, Wiki, CheapShark) run in parallel with the edge function call to minimize total latency. Server-side scrapers fan out from inside the Edge Function. Results are merged into a single context block before being handed to the model.

---

## 7. Vision GODMODE

Vision support is implemented in `supabase/functions/chat-proxy/visionPipeline.ts` and uses a strict OCR-first four-step protocol:

1. **Text extraction.** Every image is run through OCR before any visual reasoning. Game-relevant strings (item names, ability names, error codes, coordinates) are extracted verbatim.
2. **Visual inventory.** A structured "what is on the screen" pass — list of detected entities, HUD elements, environmental clues.
3. **Environment context.** Game identification, UI/HUD signature matching against the 18 supported game decoders.
4. **Grounded answer.** The text response is constrained to reference only items that appeared in steps 1–3.

**HUD Decoders.** Eighteen game-specific decoders provide schema-aware parsing of common HUD elements (Minecraft hearts/hunger, Valorant agent kits, League champion abilities, Clash Royale elixir/cards, Apex Legends squad indicators, etc.). When confidence is low, a second-opinion pass is run with a different provider before the final answer is composed.

**Client-side preprocessing.** `src/utils/imagePreprocess.js` re-encodes attachments to JPEG at a sensible quality and dimension cap before upload to keep edge-function payloads manageable and to standardize MIME types.

---

## 8. Persona Engine

The persona selector auto-detects the most relevant expert based on query intent and detected game:

| Persona | Trigger Keywords | Voice |
|---|---|---|
| **Coach** | "build", "loadout", "rotation", "drill" | Decisive strategy with explicit drill exercises. |
| **Loremaster** | "lore", "story", "canon", "backstory" | Atmospheric narrative with timeline tables. |
| **TechWizard** | "crash", "fps", "error", "freeze", "won't launch" | Quick Fix → Diagnostic Ladder → Nuclear Option. |
| **Speedrunner** | "speedrun", "WR", "skip", "glitch", "frame" | Frame-data tables and route diagrams. |
| **MetaAnalyst** | "tier list", "meta", "nerf", "buff", "patch" | Rising / Falling / Trap picks with patch tags. |
| **GameCritic** | "review", "worth it", "opinion", "rating" | Verdict + Nails / Bungles + recommendations. |
| **GameGuide (default)** | Anything else | Clean structured format with sectioned headers. |

Persona selection is a soft layer — the underlying contract (anti-confabulation, citation requirements, recency primacy) is identical across all personas. Only tone, formatting, and emphasis differ.

---

## 9. Slash Commands

Type `/` in the chat input to open the command palette:

| Command | Effect |
|---|---|
| `/price <game>` | Live multi-store price intel across 20+ storefronts via CheapShark. Returns best deal + historical low. |
| `/tip` | Random pro gaming tip (mixes live Reddit pulls with 85 curated tips). |
| `/lore` | Deep-cut lore drop (live Reddit + 30 curated entries). |
| `/redpill` | Hidden gaming industry secret (live Reddit + 55 curated facts). |
| `/clear` | Wipes chat history (client-side only; server history preserved unless explicitly deleted). |
| `/help` | Command reference. |
| `/konami`, `/noclip`, `/loading` | Easter eggs. |

---

## 10. Theme System

Seven dark themes ship by default, each built around a unique primary + secondary accent pair so no two themes share palette territory:

| ID | Label | Tag | Primary | Secondary |
|---|---|---|---|---|
| `nightblade` | NIGHTBLADE | Synthwave | `#ff2d95` | `#a855f7` |
| `redline` | REDLINE | Apex Racing | `#dc2626` | `#cbd5e1` |
| `blackice` *(default)* | BLACK ICE | Tactical | `#0ea5e9` | `#fbbf24` |
| `ghostline` | GHOSTLINE | Cosmic | `#67e8f9` | `#c4b5fd` |
| `biohazard` | BIOHAZARD | Fallout | `#84cc16` | `#facc15` |
| `warspire` | WARSPIRE | War Banner | `#f59e0b` | `#6366f1` |
| `dreadcore` | DREADCORE | Obsidian | `#8b5cf6` | `#fef3c7` |

**Theme persistence.** Selection is stored in `localStorage['theme']` and applied to `<html data-theme="...">` on mount.

**UI morph.** When the user picks a new theme, App.jsx briefly applies a `body.is-theme-morphing` class. This class enables a 700ms cubic-bezier transition on `background`, `color`, `border-color`, `box-shadow`, `text-shadow`, `fill`, and `stroke` across every element so the entire interface — header, message bubbles, inputs, badges, footer — smoothly bleeds from the old palette into the new one. The class is removed after 750ms so per-component transitions (hovers, dropdowns) return to their normal timings.

**Background effects.** Four subtle ambient overlays cycle round-robin on every selection:

| # | Variant | Effect |
|---|---|---|
| 1 | AURORA WASH | Blurred diagonal soft-edged accent sheet sweeps across at 22% peak opacity, `mix-blend-mode: screen`. |
| 2 | SCANLINE DRIFT | A 1px hairline in the new accent drifts top-to-bottom with a 22vh fading gradient trail. |
| 3 | DEPTH FOCUS | Radial 22%-tint glow at the click origin fading to a 22% dark vignette at the edges, `mix-blend-mode: overlay`. |
| 4 | PARTICLE DRIFT | 16 deterministic soft motes (2–5px) in alternating accent / accent2 rise slowly with subtle horizontal drift. |

All overlays use translucent compositing and respect `prefers-reduced-motion` (when set, the overlay is hidden but the UI still morphs).

---

## 11. Discord Bot

The repository ships a standalone production Discord bot at `discord-bot/`. The bot achieves full feature parity with the web app:

| Capability | Implementation |
|---|---|
| **Chat** | `@GameGuide <question>` mention chat OR `/ask` slash command. |
| **Vision** | Up to 3 image attachments per message, same GODMODE pipeline. |
| **Slash commands** | `/ask`, `/price`, `/tip`, `/lore`, `/redpill`, `/noclip`, `/konami`, `/loading`, `/clear`, `/history`, `/stats`, `/premium`, `/help`. |
| **History** | Persistent per-user, stored in Supabase table `discord_chat_messages`. |
| **Tiered rate-limiting** | FREE: 5/min · PRO: 30/min · PREMIUM_SERVER: 60/min. Tier resolved from Supabase or env override. |
| **Affiliate links** | CheapShark deal URLs decorated with affiliate tags (Humble, GreenManGaming, Fanatical) when keys are present. |
| **Monetization** | `/premium` command, Top.gg vote-rewards webhook integration. |
| **Analytics** | Per-user call counters logged to Supabase `discord_usage_stats`. |
| **Resilience** | SIGTERM-clean shutdown, AbortController-bound timeouts, structured error envelopes, login supervisor + watchdog. |
| **24/7 deployment** | Render, Koyeb, Fly.io, Railway, Docker, and PM2 configurations all included. |

See [`discord-bot/README.md`](discord-bot/README.md) for the complete setup, deployment, and monetization guide.

---

## 12. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| **Frontend framework** | React 19.2 | Concurrent features, Suspense for code splitting. |
| **Build tool** | Vite 8 (Rolldown) | Sub-second HMR; production builds in ~700ms. |
| **Styling** | Hand-written CSS + Tailwind 4 (postcss) | Custom property–driven themes; no UI kit. |
| **Animation** | Framer Motion 12, GSAP 3 + ScrollTrigger, Lenis | Magnetic cursor, scroll-pinned timelines, smooth scroll. |
| **3D** | React Three Fiber 9 + drei + Three.js 0.170 | Faceted icosahedron hero with physical material; lazy-loaded. |
| **Markdown** | react-markdown 10 + remark-gfm 4 | GFM tables, fenced code, autolinks. |
| **Icons** | lucide-react 1.7 | Plus inline SVGs for brand glyphs (LinkedIn, GitHub). |
| **Auth & DB** | Supabase JS 2 | Auth, Postgres, Edge Functions, RLS. |
| **Edge runtime** | Deno (Supabase Edge Functions) | TypeScript; streaming responses. |
| **Primary AI provider** | Google Gemini (`@google/genai`) | Vision + text. |
| **Fallback AI providers** | Groq, OpenRouter, Cerebras | Speed and redundancy. |
| **Discord SDK** | discord.js 14 + Node.js 18+ | Slash commands, intents, partials. |
| **Hosting (web)** | Vercel | Vercel-managed edge proxy for `/api/wiki/*`. |
| **Hosting (bot)** | Render / Koyeb / Fly / Railway / Docker / PM2 | All configs in `discord-bot/`. |

---

## 13. Repository Structure

```
GameGuide-AI/
├── README.md                          ← this file
├── Refer.md                           ← internal design notes
├── package.json                       ← web app deps + scripts
├── vite.config.js                     ← Vite build config
├── tailwind.config.js                 ← Tailwind 4 config
├── postcss.config.js
├── vercel.json                        ← Vercel rewrites
├── index.html                         ← SPA entry
│
├── public/                            ← static assets (favicon, OG image)
│
├── src/
│   ├── main.jsx                       ← React entry
│   ├── App.jsx                        ← view router (landing/chat/info), theme + transition state
│   ├── App.css                        ← chat app styles + theme-dropdown swatches
│   ├── index.css                      ← global tokens + 7 theme palettes + morph transition
│   │
│   ├── components/
│   │   ├── LandingPage.jsx / .css     ← scroll-pinned showcase with WebGL hero
│   │   ├── HoloCanvas.jsx             ← React Three Fiber icosahedron crystal
│   │   ├── LoadingScreen.jsx / .css   ← splash with lightning bolts
│   │   ├── ChatContainer.jsx          ← scrollable messages region
│   │   ├── ChatInput.jsx              ← textarea + slash palette + attachments
│   │   ├── MessageBubble.jsx          ← markdown renderer with citation chip
│   │   ├── FollowUpChips.jsx          ← contextual [?] follow-ups
│   │   ├── PriceBadge.jsx             ← live price pill + expanded deal table
│   │   ├── UserProfile.jsx            ← auth avatar + dropdown
│   │   ├── ThemeSelector.jsx          ← theme dropdown with swatches
│   │   ├── ThemeTransition.jsx / .css ← 4-variant ambient transition overlay
│   │   ├── InfoPage.jsx / .css        ← About / Terms / Contacts pages
│   │
│   ├── hooks/
│   │   ├── useAuth.js                 ← Supabase auth wrapper
│   │   └── useChat.js                 ← message state, scraper orchestration
│   │
│   ├── services/
│   │   ├── aiProvider.js              ← Edge Function client + abort signal support
│   │   ├── supabaseClient.js          ← Supabase JS singleton
│   │   ├── redditScraper.js           ← per-game subreddit map + cache
│   │   ├── wikiScraper.js             ← Fandom MediaWiki API client
│   │   └── priceScraper.js            ← CheapShark client
│   │
│   └── utils/
│       └── imagePreprocess.js         ← JPEG re-encode + dimension cap
│
├── supabase/
│   ├── config.toml
│   └── functions/
│       └── chat-proxy/
│           ├── index.ts               ← Cortex pipeline (1300+ lines)
│           ├── pulseEngine.ts         ← 5-provider web search fan-out
│           ├── visionPipeline.ts      ← OCR + HUD decoders
│           ├── webSearch.ts           ← provider-specific search adapters
│           ├── officialSources.ts     ← Supercell/Riot/Steam API clients
│           ├── recencyRanker.ts       ← publish-date sort + half-life decay
│           ├── temporalDetector.ts    ← "is this query recency-bound?"
│           └── deno.json
│
├── api/
│   └── wiki/                          ← Vercel serverless wiki proxy (CORS bridge)
│       ├── article.js
│       └── search.js
│
└── discord-bot/                       ← standalone 24/7 production bot
    ├── README.md
    ├── index.js                       ← bot main (1000+ lines)
    ├── cheapshark.js                  ← price API client
    ├── register-commands.js           ← global + guild command registration
    ├── schema.sql                     ← Supabase tables for bot persistence
    ├── package.json
    ├── ecosystem.config.js            ← PM2
    ├── Dockerfile                     ← Docker image
    ├── Procfile                       ← Heroku-compatible runtime
    ├── fly.toml                       ← Fly.io
    ├── render.yaml                    ← Render
    └── railway.json                   ← Railway
```

---

## 14. Getting Started

### Prerequisites

- **Node.js** ≥ 18.17.0 (the Discord bot requires this; the web app needs ≥ 18.0).
- **npm** (ships with Node).
- A free [Supabase](https://supabase.com) project (used for auth, chat persistence, and the edge function host).
- A free [Google Gemini API key](https://aistudio.google.com) (the primary AI provider).

### Installation

```bash
git clone https://github.com/angarkartanmay-ops/GameGuide-AI.git
cd GameGuide-AI
npm install
```

### Local Development

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your_anon_key>
```

Then run:

```bash
npm run dev
```

The app will be served at `http://localhost:5173/`.

### Build

```bash
npm run build      # Production bundle in /dist
npm run preview    # Serve /dist locally
npm run lint       # ESLint
```

---

## 15. Environment Configuration

### Web App (`.env`)

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | Yes | Public anon key (RLS-protected). |
| `VITE_GEMINI_API_KEY` | Optional | Legacy; the edge function holds the real key. |

### Supabase Edge Function Secrets

Set these via `supabase secrets set KEY=value` or the Supabase dashboard:

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_API_KEY` | Yes | Primary AI provider (Gemini); also drives Google CSE if `GOOGLE_CSE_ID` set. |
| `GOOGLE_CSE_ID` | Recommended | Google Custom Search Engine ID (100 queries/day free). |
| `SERPER_API_KEY` | Optional | Serper.dev (2,500/month free). |
| `BRAVE_SEARCH_API_KEY` | Optional | Brave Search (2,000/month free). |
| `GROQ_API_KEY` | Optional | Fast path for simple queries. |
| `OPENROUTER_API_KEY` | Optional | Vision fallback when Gemini quota is hit. |
| `CEREBRAS_API_KEY` | Optional | Ultra-fast text fallback. |
| `SUPERCELL_API_KEY` | Optional | Live data for Clash Royale, Clash of Clans, Brawl Stars. |
| `STEAM_API_KEY` | Optional | Steam News + Web API. |

Missing optional keys cause the respective provider to be skipped — the pipeline degrades gracefully.

### Discord Bot

See [`discord-bot/README.md`](discord-bot/README.md). Minimum env:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## 16. Deployment

### Frontend (Vercel)

The repository includes `vercel.json` with rewrites for `/api/wiki/*` to the serverless functions in `api/wiki/`. Connect the GitHub repo to Vercel, set the env vars above, and deploy. Build command is `npm run build`; output is `dist/`.

### Edge Function

Deploy the chat proxy from the repo root:

```bash
supabase functions deploy chat-proxy --no-verify-jwt
supabase secrets set GOOGLE_API_KEY=...
# repeat for any additional providers
```

### Discord Bot

The bot ships configuration files for six platforms (Render, Koyeb, Fly.io, Railway, Docker, PM2). For the fastest 24/7 free deployment, use Render with the bundled `render.yaml`. Full instructions in [`discord-bot/README.md`](discord-bot/README.md).

---

## 17. Supported Games

The persona engine and HUD decoders explicitly handle 200+ titles across AAA, indie, mobile, and live-service categories. A non-exhaustive list:

**AAA & Single-Player:** Elden Ring, Dark Souls (1/2/3), Bloodborne, Sekiro, Cyberpunk 2077, The Witcher 3, Skyrim, Fallout 4 / 76, Red Dead Redemption 2, GTA V / VI, Baldur's Gate 3, Diablo IV, Path of Exile 1 / 2, Hollow Knight, Silksong, Hades, Stardew Valley, Terraria, Black Myth: Wukong.

**Multiplayer & Live-Service:** Valorant, Fortnite, League of Legends, Apex Legends, Counter-Strike 2, Overwatch 2, Call of Duty (Warzone, MW), Destiny 2, Helldivers 2, Marvel Rivals, The Finals, Deadlock, Marvel Snap, Hearthstone, Smite, Rainbow Six Siege, Rust, Tarkov, Sea of Thieves, Dead by Daylight, Phasmophobia, Lethal Company, Palworld, Delta Force, Arc Raiders.

**Mobile & Cross-Play:** Clash Royale, Clash of Clans, Brawl Stars, PUBG Mobile, Free Fire, Mobile Legends, Wild Rift, Genshin Impact, Honkai: Star Rail, Wuthering Waves, Zenless Zone Zero.

**Sandbox & Survival:** Minecraft (Java + Bedrock), Terraria, Rust, Stardew Valley.

**Sports & Racing:** Forza Horizon 6, FIFA / EA Sports FC 25, NBA 2K.

**JRPG & Story:** Final Fantasy (VII / XIV / XVI), Persona 5 / Metaphor, Monster Hunter Wilds / Rise, Pokémon, Zelda BOTW / TOTK.

If a game isn't explicitly mapped, the engine still answers from live Wikipedia and web search results.

---

## 18. Performance Targets

| Metric | Target | Measurement |
|---|---|---|
| First contentful paint | < 1.2s | Vercel Analytics |
| Time to interactive | < 2.0s | Lighthouse |
| P50 first-token streaming | < 400ms | Server logs |
| Lighthouse Performance | ≥ 90 | CI |
| Cold-start edge function | < 100ms | Supabase dashboard |
| Web build size (gzipped) | < 320kb main JS | Vite build report |

The landing page includes a runtime FPS probe — if observed frame rate falls below 48fps after mount, the page enters "low-power mode" (WebGL hero is dropped, Lenis smooth-scroll is disabled, backdrop-filter is stripped, decorative overlays vanish). This keeps integrated-graphics laptops smooth without compromising the experience on capable hardware.

---

## 19. Roadmap

- [x] Multi-provider Neural Mesh (Gemini + Groq + OpenRouter + Cerebras)
- [x] Project PULSE v2 (5-provider web search, recency ranking)
- [x] Vision GODMODE v3 (18-game HUD decoders, second-opinion verification)
- [x] Discord Bot v2.0 (monetization, tiers, analytics, 24/7 deployment)
- [x] Premium landing page (Framer Motion + GSAP + R3F)
- [x] Hash-routed About / Terms / Contacts pages
- [x] Seven custom dark themes with ambient transition system
- [ ] Twitch bot integration
- [ ] Voice chat analysis (clip → transcript → advice)
- [ ] Custom persona builder (user-defined expert overlays)
- [ ] React Native mobile app
- [ ] Streaming responses to the web client (currently streams server-side only)

---

## 20. Copyright, License & Acceptable Use

**Copyright.** All content, design, code, branding, visualizations, prompts, and architecture of GameGuide-AI are © 2026 Tanmay Angarkar. All rights reserved.

**Protected marks.** The GameGuide-AI name, logo, and the phrases *Neural Mesh*, *PULSE Search*, *Vision GODMODE*, and *Cortex* are project marks.

**Source code.** The source code, UI, animations, copy, and underlying prompt engineering are protected under copyright law and may not be copied, redistributed, mirrored, scraped, fine-tuned on, or used to train any model without prior written consent.

**Third-party content.** Game titles, screenshots, lore, and patch notes belong to their respective publishers and are referenced under fair use for commentary, research, and player assistance.

**Acceptable Use.** Users agree not to:

- Generate harassing, illegal, or harmful content.
- Bypass rate limits or perform automated scraping of the service.
- Resell, white-label, or sublicense responses without permission.
- Train competing AI models using GameGuide-AI's output.
- Reverse engineer, decompile, or attempt to extract the system prompt, routing logic, or provider configuration.

**AI-generated content disclaimer.** Responses are generated by large language models combined with live web sources. All output should be treated as *guidance, not authority*. Verify critical decisions (purchases, irreversible in-game choices, competitive plays) against primary sources. The project is not liable for losses arising from reliance on Service output.

**DMCA.** If you believe content on this service infringes your copyright, contact `gameguideai.support@gmail.com` with the disputed material, your contact details, and a statement of good-faith belief. Responses are sent within seven business days.

The complete terms are available in-app at `#terms`.

---

## 21. Contact

| Channel | Address |
|---|---|
| **Support email** | [gameguideai.support@gmail.com](mailto:gameguideai.support@gmail.com) |
| **LinkedIn** | [Tanmay Angarkar](https://www.linkedin.com/in/tanmay-angarkar-4b8a47319/) |
| **GitHub** | [@angarkartanmay-ops](https://github.com/angarkartanmay-ops) |
| **Discord bot setup** | [discord-bot/README.md](discord-bot/README.md) |

Response targets: support email within 24 hours, LinkedIn within three business days, GitHub issues triaged weekly.

---

*GameGuide-AI · © 2026 Tanmay Angarkar — built on a self-healing neural mesh.*
