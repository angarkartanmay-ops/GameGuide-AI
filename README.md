# GameGuide-AI

<div align="center">

<img src="public/favicon.svg" alt="GameGuide-AI Logo" width="84" height="84" />

### Real-Time Multimodal Gaming Intelligence Platform

*Sub-400ms streaming responses, self-healing multi-provider neural mesh, multi-model free-tier quota rotation, live web fusion across six sources, and vision-grade HUD/screenshot analysis.*

[![CI Pipeline](https://github.com/angarkartanmay-ops/GameGuide-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/angarkartanmay-ops/GameGuide-AI/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Proprietary-blue.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19.2-61dafb.svg?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff.svg?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-Edge%20Functions-3ecf8e.svg?logo=supabase&logoColor=white)](https://supabase.com)
[![Discord](https://img.shields.io/badge/Discord-Bot%20v2.0-5865F2.svg?logo=discord&logoColor=white)](discord-bot/README.md)

[🌐 Live Web Application](https://game-guide-ai-plum.vercel.app) • [🤖 Discord Bot Setup](discord-bot/README.md) • [🧪 Local Testing Guide](LOCAL_TESTING.md) • [🔒 Security Policy](SECURITY.md)

</div>

---

## 📖 Table of Contents

1. [Platform Overview](#-platform-overview)
2. [Core Architecture & Neural Mesh](#-core-architecture--neural-mesh)
3. [Reasoning Pipeline (Cortex v4.2)](#-reasoning-pipeline-cortex-v42)
4. [Live Intelligence (Project PULSE & Omni-Scrape)](#-live-intelligence-project-pulse--omni-scrape)
5. [Multimodal Vision (GODMODE Protocol)](#-multimodal-vision-godmode-protocol)
6. [Feature Matrix](#-feature-matrix)
7. [Expert Persona Engine](#-expert-persona-engine)
8. [Interactive Slash Commands](#-interactive-slash-commands)
9. [Dark Theme & Atmospheric Transition Engine](#-dark-theme--atmospheric-transition-engine)
10. [Discord Bot Deployment](#-discord-bot-deployment)
11. [Repository Structure](#-repository-structure)
12. [Quickstart & Local Development](#-quickstart--local-development)
13. [Environment Configuration](#-environment-configuration)
14. [Deployment Guide](#-deployment-guide)
15. [Automated Test & Regression Suite](#-automated-test--regression-suite)
16. [Security & Responsible Disclosure](#-security--responsible-disclosure)
17. [License & Intellectual Property](#-license--intellectual-property)
18. [Contact & Support](#-contact--support)

---

## 🌟 Platform Overview

**GameGuide-AI** is a production-ready, multimodal AI assistant engineered specifically for competitive players, esports coaches, theorycrafters, speedrunners, and gaming communities. It solves the three fundamental flaws of generic LLMs in gaming:

1. **Training Data Staleness** — Real-time game patches, balance adjustments, and new releases (e.g. 2026 titles) are actively fused via multi-angle live search and official publisher APIs before the model answers.
2. **Hallucination & Vagueness** — A strict anti-confabulation contract enforces exact numbers, build routes, frame data, and patch-version tags rather than vague generic advice.
3. **Provider Outages & Quotas** — A self-healing neural mesh rotates between Google Gemini (multi-model quota rotation), Groq, OpenRouter, and Cerebras with token-level fallback and zero single points of failure.

---

## 🏛️ Core Architecture & Neural Mesh

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT PLATFORMS                                     │
│   Web Application (React 19, Vite 8, Framer Motion)   │   Discord Bot (24/7)     │
└─────────────────────────────────────────┬────────────────────────────────────────┘
                                          │
                                          ▼ HTTPS / SSE Stream
┌──────────────────────────────────────────────────────────────────────────────────┐
│              SUPABASE EDGE FUNCTION (Deno Runtime :: chat-proxy)                 │
├──────────────────────────────────────────────────────────────────────────────────┤
│  1. Query Cortex      → Intent classification (lore/build/meta/tech/speedrun)    │
│  2. Temporal Detector → Recency evaluation & implicit temporal boosting          │
│  3. PULSE Engine      → 5-provider parallel live search + authority ranking      │
│  4. Vision GODMODE    → Preprocessed OCR + 18 game-specific HUD decoders         │
│  5. Route Optimizer   → Self-balancing provider selection (latency vs depth)     │
│  6. Neural Mesh v3    → Multi-provider waterfall with per-model quota rotation   │
│  7. Corroboration     → Multi-source cross-verification & confidence scoring     │
│  8. Quality Gate      → Response caching (SHA-256), stream packaging, citations  │
└─────────────────────────────────────────┬────────────────────────────────────────┘
                                          │
                  ┌───────────────────────┼───────────────────────┐
                  ▼                       ▼                       ▼
          [ Google Gemini ]            [ Groq ]          [ OpenRouter / Cerebras ]
       Multi-Model Quota Pool      Fast-Path / Compound     Flagship Fallbacks
```

### Self-Balancing Multi-Model Quota Pool
Free-tier request quotas on Google Gemini are tracked **per model ID**, not pooled across the entire API key. GameGuide-AI dynamically rotates across 7 Gemini model tiers (`gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-3-flash-preview`), automatically prioritizing whichever model has the most remaining daily headroom.

---

## 🧠 Reasoning Pipeline (Cortex v4.2)

Every query processed by the backend passes through an 8-stage observable pipeline:

| Stage | Module | Functionality | Resilience & Fallback |
|---|---|---|---|
| **1. Query Cortex** | `index.ts` | Intent classification, game recognition (200+ titles), complexity scoring (0–10). | Defaults to general gamer intent on ambiguity. |
| **2. Temporal Detector** | `temporalDetector.ts` | Evaluates if the query is recency-bound ("latest patch", "current meta", new releases). | Conservatively triggers PULSE when recency is implied. |
| **3. PULSE Engine** | `pulseEngine.ts` | Parallel fan-out to Google CSE, Serper, Brave, SearXNG, and DuckDuckGo. | Deduplicates URLs, falls back to Groq compound search if starved. |
| **4. Vision Pipeline** | `visionPipeline.ts` | OCR-first image processing, inventory detection, HUD signature matching. | Automatically skips to text if no attachments present. |
| **5. Route Optimizer** | `meshRouter.ts` | Dynamically selects model tier based on task complexity and quota health. | Auto-balances across all configured API pools. |
| **6. Neural Mesh** | `index.ts` | Executes inference with exponential backoff on 429/503/500 errors. | Cascades seamlessly to next provider in waterfall. |
| **7. Corroboration** | `corroboration.ts` | Evaluates source agreement and computes confidence scores. | Flags uncorroborated claims to the model. |
| **8. Quality Gate** | `index.ts` | Manages SHA-256 response caching, formats markdown tables, attaches citations. | Returns clean stream payload with follow-up chips. |

---

## 🌐 Live Intelligence (Project PULSE & Omni-Scrape)

To guarantee that answers reflect current patches and releases, GameGuide-AI deploys two complementary retrieval engines:

### 1. Project PULSE (Recency-Bound Queries)
- **Multi-Angle Formulation**: Expands queries into up to 4 search permutations in parallel (e.g., `{game} new {subject} 2026`, `{game} patch notes`).
- **Publisher Domain Boosting**: Recognizes 26 official gaming domains (Riot, Valve, Blizzard, Supercell, Bungie, etc.) and elevates their authority score to 9/10.
- **Recency Half-Life Decay**: Freshness multiplier weights results under 7 days at 1.6× and demotes content older than 1 year to 0.3×.

### 2. Omni-Scrape (General Game Inquiries)
- **Supercell Official APIs**: Live brawler/card rosters and stats from `api.clashroyale.com` and `api.brawlstars.com`.
- **Wikipedia & MediaWiki APIs**: Clean wiki extraction with automatic title disambiguation.
- **Steam News API**: Recent patch notes and developer announcements mapped via a 90+ Steam AppID registry.
- **CheapShark API**: Live PC game price comparison across 20+ digital storefronts (Steam, Epic, GOG, Humble, Fanatical).

---

## 👁️ Multimodal Vision (GODMODE Protocol)

Users can attach up to 3 screenshots or UI captures per message. Attachment processing follows a strict 4-step pipeline:

```
[ Image Upload ] ──▶ [ Client Preprocess (1568px, JPEG 88%) ] ──▶ [ Step 1: OCR Text Extraction ]
                                                                             │
[ Step 4: Grounded Output ] ◀── [ Step 3: HUD Signature Match ] ◀── [ Step 2: Visual Inventory ]
```

- **Step 1 (OCR Extraction)**: Verbatim text reading of item names, ability titles, error codes, and coordinates.
- **Step 2 (Visual Inventory)**: Detection of HUD elements, inventory slots, skill bars, and health indicators.
- **Step 3 (HUD Signature Matching)**: 18 specialized game decoders (Minecraft, Valorant, League of Legends, Apex Legends, Elden Ring, Genshin Impact, Cyberpunk 2077, etc.).
- **Step 4 (Grounded Response)**: Restricts the reasoning model to explicitly reference verified elements from Steps 1–3.

---

## ⚡ Feature Matrix

| Capability | Web Application | Discord Bot |
|---|:---:|:---:|
| **Sub-400ms Streaming Inference** | ✅ | ✅ (Chunked / Edit) |
| **Self-Healing Neural Mesh** | ✅ | ✅ |
| **Project PULSE Live Web Fusion** | ✅ | ✅ |
| **Vision Screenshot Analysis** | ✅ (Up to 3 images) | ✅ (Attachments) |
| **Contextual Follow-up Chips** | ✅ (Interactive pills) | ✅ (Inline suggestions) |
| **Live Multi-Store Price Intel (`/price`)** | ✅ | ✅ (Affiliate decorated) |
| **Dark Theme Switcher (7 Themes)** | ✅ (Smooth morph) | — |
| **Player Authentication & History** | ✅ (Supabase Auth) | ✅ (Discord User ID) |
| **Stealth / Incognito Mode (`/stealth`)** | ✅ | — |
| **Tiered Rate Limiting** | ✅ (IP/User Token Bucket) | ✅ (Tiered Quotas) |

---

## 🎭 Expert Persona Engine

GameGuide-AI dynamically adapts its tone and formatting structure depending on player intent:

```
├── 🎯 The Coach        ── Strategy breakdowns, rotation drills, practice routines
├── 📜 The Loremaster   ── Canonical lore, timeline tables, narrative context
├── 🧙 The TechWizard   ── Crash diagnostics, error resolution, FPS optimization ladders
├── ⚡ The Speedrunner  ── Route maps, frame data, glitch execution steps
├── 📊 The MetaAnalyst  ── Tier lists, patch delta analysis, rising/falling picks
├── 🎮 The GameCritic   ── Balanced verdicts, strengths, weaknesses, purchasing advice
└── 🛡️ The GameGuide    ── Structured, scannable answers with bullet points and comparison tables
```

---

## ⌨️ Interactive Slash Commands

Type `/` in the chat input or Discord to trigger power-user actions:

| Command | Action |
|---|---|
| `/price <game>` | Fetches live multi-store price comparisons and historic lows via CheapShark. |
| `/tip` | Surfaces a pro-tier gameplay tip (blended from live community data and curated knowledge). |
| `/lore` | Deep lore summary on iconic gaming franchises and character backstories. |
| `/redpill` | Intriguing, little-known game development secrets and Easter eggs. |
| `/stealth` | Activates incognito mode — conversations are never stored or logged. |
| `/clear` | Wipes the active conversation viewport. |
| `/help` | Displays the complete command reference palette. |

---

## 🎨 Dark Theme & Atmospheric Transition Engine

GameGuide-AI features seven custom-engineered dark themes with synchronized palette transitions:

| Theme | Accent 1 | Accent 2 | Aesthetic |
|---|---|---|---|
| **Black Ice** *(Default)* | `#0ea5e9` | `#fbbf24` | Tactical Oceanic Cyan & Gold |
| **Nightblade** | `#ff2d95` | `#a855f7` | Cyberpunk Neon Synthwave |
| **Redline** | `#dc2626` | `#cbd5e1` | High-RPM Apex Racing |
| **Ghostline** | `#67e8f9` | `#c4b5fd` | Ethereal Cosmic Violet |
| **Biohazard** | `#84cc16` | `#facc15` | Post-Apocalyptic Wasteland Green |
| **Warspire** | `#f59e0b` | `#6366f1` | Medieval War Banner Amber |
| **Dreadcore** | `#8b5cf6` | `#fef3c7` | Obsidian Dark Fantasy |

**Atmospheric Transitions**: Switching themes engages a 700ms full-interface cubic-bezier color morph accompanied by one of four deterministic ambient visual overlays (*Aurora Wash*, *Scanline Drift*, *Depth Focus*, or *Particle Drift*).

---

## 🤖 Discord Bot Deployment

The repository includes a standalone 24/7 Discord bot located in `discord-bot/`.

### Key Features:
- Mention `@GameGuide <query>` or `/ask <query>` in any channel.
- Attach up to 3 screenshots directly in Discord for instant vision analysis.
- Tiered per-user rate limits with automatic 429 retry handling.
- Persistent conversation memory across sessions backed by Supabase.
- Ready-to-deploy configurations for **Render**, **Fly.io**, **Railway**, **Docker**, and **PM2**.

*For complete setup and deployment instructions, see [`discord-bot/README.md`](discord-bot/README.md).*

---

## 📁 Repository Structure

```
GameGuide-AI/
├── .github/
│   ├── workflows/ci.yml               ← Automated CI pipeline (Node 20, tests, build)
│   ├── ISSUE_TEMPLATE/                ← Structured bug and feature templates
│   └── PULL_REQUEST_TEMPLATE.md       ← PR verification checklist
│
├── api/
│   └── wiki/                          ← Serverless CORS proxy for MediaWiki API
│
├── discord-bot/                       ← Standalone 24/7 Discord bot
│   ├── index.js                       ← Bot main engine
│   ├── Dockerfile, fly.toml, render.yaml
│   └── README.md
│
├── public/                            ← Static web assets, icons, llms.txt
│
├── src/
│   ├── components/                    ← UI components (LandingPage, Chat, InfoPages)
│   ├── hooks/                         ← State management (useChat, useAuth)
│   ├── services/                      ← Scrapers, API clients, Supabase singleton
│   └── utils/                         ← Image preprocessing and OCR utilities
│
├── supabase/
│   ├── functions/chat-proxy/          ← Cortex neural mesh edge function (Deno)
│   └── migrations/                    ← PostgreSQL schema, rate limiting, RLS
│
├── tests/                             ← Regression & evaluation test suites
│   ├── behaviour.test.ts              ← User correction & persona test suite
│   ├── corroboration.test.ts          ← Source-agreement scoring suite
│   ├── detection.test.ts              ← Game-title and installment parsing
│   ├── gemini.test.ts                 ← Multi-model quota rotation suite
│   ├── ssrf.test.mjs                  ← Wiki proxy security validation
│   └── run.mjs                        ← Master test runner
│
├── LOCAL_TESTING.md                   ← Guide for running the mesh locally on free keys
├── SECURITY.md                        ← Responsible disclosure policy
├── CONTRIBUTING.md                    ← Contribution guidelines
└── LICENSE                            ← Proprietary software license
```

---

## 🚀 Quickstart & Local Development

### Prerequisites
- **Node.js** ≥ 18.17.0
- **npm** ≥ 9.0.0
- A free [Google Gemini API Key](https://aistudio.google.com) (recommended)
- A free [Supabase Project](https://supabase.com) (for auth & database persistence)

### 1. Clone & Install
```bash
git clone https://github.com/angarkartanmay-ops/GameGuide-AI.git
cd GameGuide-AI
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env.local
cp supabase/functions/.env.example supabase/functions/.env
```

### 3. Run Development Server
```bash
# Terminal 1: Run frontend application
npm run dev

# Terminal 2 (Optional): Run local chat-proxy Edge Function with Deno
npm run dev:api
```

The web client will be available at `http://localhost:5173`.

---

## ⚙️ Environment Configuration

### Client Configuration (`.env.local`)
| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project API URL (e.g. `https://<id>.supabase.co`). |
| `VITE_SUPABASE_ANON_KEY` | Public anonymous API key with RLS enforcement. |

### Edge Function Secrets (`supabase/functions/.env`)
| Variable | Required | Description |
|---|:---:|---|
| `GOOGLE_API_KEY` | **Yes** | Primary AI provider for Gemini text, vision, and OCR. |
| `GROQ_API_KEY` | Optional | Fast-path reasoning and compound search routing. |
| `OPENROUTER_API_KEY` | Optional | Extended vision model fallback and multi-provider options. |
| `CEREBRAS_API_KEY` | Optional | Ultra-fast low-latency text fallback. |
| `SERPER_API_KEY` | Optional | Google SERP API for Project PULSE (2,500 free queries/mo). |
| `GOOGLE_CSE_ID` | Optional | Google Custom Search Engine ID (100 free queries/day). |
| `BRAVE_SEARCH_API_KEY` | Optional | Brave Search API (2,000 free queries/mo). |
| `SUPERCELL_API_KEY` | Optional | Official Supercell API token (Clash Royale / Brawl Stars). |
| `STEAM_API_KEY` | Optional | Steam Web API key for live patch news retrieval. |

---

## 🚢 Deployment Guide

### Web Frontend (Vercel)
1. Import the GitHub repository into your [Vercel Dashboard](https://vercel.com).
2. Set Framework Preset to **Vite**.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to Environment Variables.
4. Deploy. The bundled `vercel.json` automatically manages SPA rewrites and serverless proxy routes.

### Supabase Edge Functions
```bash
# Push database schema & migrations
supabase db push

# Deploy chat proxy function
supabase functions deploy chat-proxy --no-verify-jwt

# Set runtime secrets
supabase secrets set GOOGLE_API_KEY="your_api_key"
```

---

## 🧪 Automated Test & Regression Suite

GameGuide-AI includes a comprehensive offline and live evaluation test suite:

```bash
# Execute master test suite (190+ tests)
npm test
```

### Verified Test Suites:
- `detection.test.ts`: Game name parsing, installment number extraction, and alias resolution.
- `behaviour.test.ts`: User correction acceptance and follow-up chip suppression.
- `gemini.test.ts`: Multi-model quota rotation and load balancing.
- `corroboration.test.ts`: Source-agreement scoring and claim confidence metrics.
- `ssrf.test.mjs`: Fandom/Wiki proxy URL sanitization and SSRF prevention.
- `eval/pipeline.test.mjs`: Golden-set retrieval and routing accuracy verification.

---

## 🔒 Security & Responsible Disclosure

We take application security and user data privacy seriously:
- **No Client-Side Secrets**: All third-party AI provider keys are strictly isolated inside Supabase Edge Functions.
- **SSRF Hardening**: All proxy endpoints strictly validate incoming hosts and reject arbitrary or private IP ranges.
- **Vulnerability Reporting**: If you find a security issue, please consult [SECURITY.md](SECURITY.md) or email [gameguideai.support@gmail.com](mailto:gameguideai.support@gmail.com).

---

## 📄 License & Intellectual Property

Copyright © 2026 Tanmay Angarkar. All rights reserved.

This software, its source code, architecture, system prompts, and branding are proprietary. Unauthorized copying, distribution, modification, reverse engineering, model scraping, or training of competing AI models is strictly prohibited. See [LICENSE](LICENSE) for terms.

---

## 📬 Contact & Support

<div align="center">

| Channel | Contact |
|---|---|
| **Product Support** | [gameguideai.support@gmail.com](mailto:gameguideai.support@gmail.com) |
| **LinkedIn** | [Tanmay Angarkar](https://www.linkedin.com/in/tanmay-angarkar-4b8a47319/) |
| **GitHub** | [@angarkartanmay-ops](https://github.com/angarkartanmay-ops) |

</div>
