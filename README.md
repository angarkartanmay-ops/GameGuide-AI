# 🎮 GameGuide-AI

**The ultimate multimodal, AI-powered support system built for the gaming community.**

GameGuide-AI combines real-time web intelligence, vision-grounded screenshot analysis, and a 6-stage reasoning pipeline to deliver tournament-grade gaming answers — not generic chatbot responses.

> 🌐 **Live Demo:** [gameguide-ai.vercel.app](https://gameguide-ai.vercel.app)
> 🤖 **Discord Bot:** [Add to your server](https://github.com/angarkartanmay-ops/GameGuide-AI/tree/main/discord-bot)

---

## ✨ Key Features

### 🧠 Cortex v4.2 — Multi-Provider Neural Mesh
A self-healing AI pipeline that cascades through **Gemini, Groq, OpenRouter, and Cerebras** — so the bot never goes down. Query classification, persona selection, and model routing happen automatically based on your question's intent and complexity.

### 🌊 Project PULSE — Real-Time Intelligence
Never get outdated meta advice again. PULSE detects temporal queries ("what's the newest hero?", "current tier list") and fires **5 search engines in parallel** (Google CSE, Serper, Brave, SearXNG, DuckDuckGo) plus official game APIs. Answers are grounded in data fetched *seconds ago*, not stale training data.

### 👁️ Vision GODMODE — Screenshot Analysis
Upload up to 3 screenshots of bugs, builds, HUDs, or in-game text. The **GODMODE protocol** forces a 4-step OCR-first analysis (text extraction → visual inventory → environment context → grounded answer) with **18 game-specific HUD decoders** — from Minecraft hearts to Valorant agent abilities.

### 🔎 Omni-Scrape — 6-Source Live Data
Every game query triggers parallel scraping from:
- **Official Game APIs** (Supercell, Fortnite, Steam)
- **Wikipedia** (REST API, multi-variant disambiguation)
- **Steam News** (90+ games mapped)
- **YouTube** (via Invidious, newest uploads)
- **Gaming RSS** (IGN, Polygon, Eurogamer, PCGamer, GameSpot)
- **Web Search** (multi-provider, deduplicated)

### 🎭 7 Expert Personas
Auto-selected based on your question's intent:

| Persona | Trigger | Style |
|---------|---------|-------|
| 🎯 Coach | Builds, loadouts | Decisive strategy with drill exercises |
| 📜 Loremaster | Story, lore, backstory | Atmospheric narrative with timelines |
| 🛠️ TechWizard | Crashes, FPS, errors | Quick Fix → Diagnostic Ladder → Nuclear Options |
| 🏎️ Speedrunner | Speedruns, skips | Frame-data tables, WR routes |
| ⚔️ MetaAnalyst | Tier lists, meta | Rising/Falling/Trap picks with patch tags |
| 🎨 GameCritic | Reviews, opinions | Verdict + Nails/Bungles + recommendations |
| 🎮 GameGuide | General questions | Clean structured format |

### 📸 Multimodal Vision Support
Upload screenshots of bugs, error codes, skill trees, or locations, and GameGuide-AI analyzes them visually with game-aware HUD decoding across 18 supported game UIs.

### 💬 Interactive Follow-Ups
Every response ends with contextual `[?]` follow-up question chips from the user's perspective — keeping conversations flowing like a pro-level coaching session.

### 🎨 7 Custom Game Themes
Switch between **Neon Synth**, **Wasteland Terminal**, **Tactical Strike**, **Urban Graffiti**, **Orbital Drop**, **Voxel World**, and **Nitro Arena** — all with CSS custom properties and localStorage persistence.

### ⌨️ Slash Commands
Type `/` for instant power-user interactions:
- `/tip` — Random pro gaming tip (live Reddit + 85 curated tips)
- `/lore` — Deep-cut lore drop (live Reddit + 30 curated entries)
- `/redpill` — Hidden gaming industry secret (live Reddit + 55 curated facts)
- `/price <game>` — Live multi-store prices via CheapShark
- `/clear` — Wipe chat history
- `/help` — Command reference
- `/konami`, `/noclip`, `/loading` — Easter eggs

### 🤖 Discord Bot Integration (v2.0)
Full feature parity with the web app: 12 slash commands, @mention chat, vision support, persistent history, tiered rate limiting (Free/Pro/Premium Server), monetization hooks, and affiliate link decoration.

### 🚀 Premium Landing Page
A scroll-driven showcase built with **Framer Motion** — featuring parallax hero, capability cards, animated pipeline visualization, live chat demo, and spring-physics CTAs.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8 |
| Styling | 100% Vanilla CSS (7 themes, responsive, `100dvh`) |
| Animations | Framer Motion |
| AI | Google Gemini (`@google/genai`), Groq, OpenRouter, Cerebras |
| Backend | Supabase (Auth, PostgreSQL, Deno Edge Functions) |
| Markdown | `react-markdown` + `remark-gfm` |
| Icons | `lucide-react` |
| Deployment | Vercel (Frontend + API proxies) |
| Discord Bot | `discord.js` v14, Node.js 18+ |

---

## 🚀 Getting Started

### Prerequisites
- Node.js v18+
- A free [Google Gemini API Key](https://aistudio.google.com/)
- A free [Supabase](https://supabase.com/) project

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/angarkartanmay-ops/GameGuide-AI.git
   cd GameGuide-AI
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Create a `.env` file in the root directory:
   ```env
   VITE_GEMINI_API_KEY=your_gemini_api_key
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```
   The app will be running at `http://localhost:5173/`

### Optional: Enhanced Search (PULSE)
For full Project PULSE functionality, add these to your Supabase Edge Function environment:
```env
GOOGLE_API_KEY=...            # Gemini + Google CSE (required)
GOOGLE_CSE_ID=...             # Google Custom Search Engine ID (optional, 100/day free)
SERPER_API_KEY=...            # Serper.dev (optional, 2500/month free)
BRAVE_SEARCH_API_KEY=...      # Brave Search (optional, 2000/month free)
GROQ_API_KEY=...              # Groq (optional, fast-path for simple queries)
OPENROUTER_API_KEY=...        # OpenRouter (optional, vision fallback)
CEREBRAS_API_KEY=...          # Cerebras (optional, ultra-fast text fallback)
```

### Discord Bot Setup
See the dedicated [Discord Bot README](discord-bot/README.md) for setup instructions.

---

## 📊 Architecture

```
User → Landing Page → Chat Interface
                          ↓
                     useChat.js (client)
                      ├── Reddit scraper (client-side)
                      ├── Wiki scraper (client-side)
                      └── Supabase Edge Function call
                              ↓
                    chat-proxy/index.ts (server)
                      ├── Query Cortex (classify)
                      ├── PULSE (temporal → web search)
                      ├── Omni-Scrape (6 parallel sources)
                      ├── Persona Engine (7 experts)
                      ├── Route Optimizer (provider selection)
                      ├── Neural Mesh (self-healing waterfall)
                      └── Quality Gate (cache + format repair)
                              ↓
                         AI Response → UI
```

---

## 🎯 Supported Games (200+)

Covers AAA, indie, mobile, and live-service titles including: Minecraft, Valorant, Fortnite, Elden Ring, Genshin Impact, Honkai Star Rail, League of Legends, Apex Legends, Call of Duty, Destiny 2, Clash Royale, Clash of Clans, Brawl Stars, PUBG, Counter-Strike 2, Overwatch 2, Diablo 4, Path of Exile, Baldur's Gate 3, Zelda, Pokémon, Final Fantasy, Persona, Monster Hunter, and many more.

---

## 📈 Roadmap
- [x] Multi-provider Neural Mesh (Gemini + Groq + OpenRouter + Cerebras)
- [x] Project PULSE v2 (5-provider web search, recency ranking)
- [x] Vision GODMODE v3 (18-game HUD decoders, second-opinion)
- [x] Discord Bot v2.0 (monetization, tiers, analytics)
- [x] Premium Landing Page (Framer Motion)
- [ ] Twitch bot integration
- [ ] Voice chat analysis (clip → transcript → advice)
- [ ] Custom persona builder (user-defined expert overlays)
- [ ] Mobile app (React Native)

---

*If you find this project useful, drop a ⭐ on the repository!*
