# 📚 GameGuide-AI: Comprehensive Project Reference

This document serves as a highly detailed summary of the architecture, capabilities, and development history of the **GameGuide-AI** project. It is intended for future reference to rapidly recall how systems are integrated, the specific tech stack utilized, and the capabilities of the agent.

---

## 1. Project Overview & Philosophy
**GameGuide-AI** is a premium, web-based, AI-powered support application built specifically for the gaming community. 
**Core Philosophy:** Gamers do not want to read walls of text. They need high-density, accurate, well-structured data. The project was designed with a heavy emphasis on scannability (tables, bolding, bullet points), real-time accuracy (Wiki/Reddit/Price scraping), and an immersive UX (theme engines, loading animations, responsive layouts).

---

## 2. Core Capabilities & Engines Built

### 🤖 A. The LLM Engine (Gemini Integration)
*   **Provider:** Built entirely on the new `@google/genai` official Google SDK.
*   **Primary Models:** 
    *   `gemini-1.5-pro`: Primary model for high-complexity reasoning and multi-turn conversations.
    *   `gemini-1.5-flash`: Lightweight, high-availability fallback used to ensure 100% uptime when the Pro model hits capacity.
*   **System Prompt Engineering:** A highly specialized system prompt (`SYSTEM_INSTRUCTION` in the `chat-proxy` Edge Function) enforces strict constraints:
    *   **No paragraphs:** Forces the use of bullet points grouped under clear `##` headers.
    *   **Table Requirement:** Any comparison (gear, stats, characters, speedrunner vs. completionist strategies) *must* be formatted as a Markdown table.
    *   **ASCII Flowcharts:** AI is instructed to draw visual ASCII decision trees for troubleshooting or quest steps.
    *   **Suggested Next Questions:** Strict generation of 2-4 follow-up questions from the *user's perspective* using a `[?]` syntax wrapper.

### 🛡️ B. Robust Reliability (The Chat Proxy)
*   **Supabase Edge Function:** All AI communication is proxied through a Deno-based Edge Function (`supabase/functions/chat-proxy/index.ts`).
*   **Automatic Retry & Backoff:** Implements exponential backoff to handle `503` (High Demand) and `429` (Rate Limit) errors from Google.
*   **Model Fallback Chain:** If the primary model fails or is overloaded, the proxy automatically switches to the fallback model mid-flight, making the UI feel bulletproof.

### 🌐 C. The Intelligence Engine (Live Scraping)
Standard AI models suffer from knowledge cut-offs. We bypassed this by building an Intelligence Engine to ground the models.
*   **Vercel Proxy Functions:** Scrapers are deployed as serverless functions in `/api` (Reddit and Wiki) to bypass CORS while maintaining production stability.
*   **Reddit Scraper:** Pulls live JSON data from specific gaming subreddits to inject current community dialogue, complaints, meta discussions, and "sentiment".
*   **Wiki Scraper:** Maps game titles to Fandom MediaWiki endpoints, pulling lore, weapon stats, and quest steps directly from the source.
*   **Price Engine (Is It Worth It?):** Integrated with the **CheapShark API** (`src/services/priceScraper.js`). 
    *   Detects game titles in queries and fetches live pricing across multiple stores (Steam, GOG, Epic).
    *   Identifies **Historic Lows** and active deals.
    *   Renders a high-end `PriceBadge` widget with direct links and savings percentages.

### 👁️ D. Multimodal Systems (Vision & Generation)
*   **Image Analysis (Vision):** Users can attach up to 3 images. Images are processed into Base64 and injected into the Gemini context for UI reading, map identification, or character build analysis.
*   **Image Generation:** A Regex detector triggers a fallback chain of image generation models when keywords like `"generate image"` or `"draw me"` are detected. Images render inline with a `🎨 AI Generated` badge.

### ⌨️ E. Slash Command System
Implemented a "Power User" command palette (`useChat.js`) that allows instant interactions:
*   `/clear`: Wipe entire chat history from Supabase.
*   `/help`: View the interactive command reference table.
*   `/tip`: Generate a random random elite pro gaming tip.
*   `/lore`: Get a lore drop on a random iconic game universe.
*   **Easter Eggs:** `/konami`, `/noclip`, `/redpill`, and `/loading` for immersive gamer flavor.

### 🎭 F. The Gamer Theme Engine
*   **7 Custom Themes:** Rebranded from copyrighted names to creative alternatives (e.g., *Voxel World* instead of *Minecraft*, *Orbital Drop* instead of *Halo*).
*   **Persistence:** Active theme is saved to `localStorage`, ensuring preferences survive page refreshes.
*   **Loading Screen:** A full-screen randomized animation engine triggers on load/login. Features 6 particle effects (*Electric Nexus, Hyper-Space, Data Rain, Energy Shield, Cyber Vortex, Glitch System*) that adapt to the active theme's colors.

### 👾 G. Discord Bot Integration
*   A standalone Node.js process using `discord.js` located in `/discord-bot`.
*   **Shared Brain:** Rather than duplicating logic, the bot intercepts Discord messages and forwards them to the existing Supabase `chat-proxy` Edge Function.
*   **Formatting Parity:** Because Discord natively supports Markdown (tables, bold text, code blocks), the AI's strict formatting constraints render perfectly in-client.
*   **Deployment:** Designed to run as a continuous background worker (e.g., on Railway or Render).

---

## 3. The Tech Stack Breakdown

*   **Core:** React 18 / Vite
*   **Backend/DB:** Supabase (Auth, PostgreSQL, Edge Functions)
*   **Styling:** 100% Vanilla CSS (utilizing `100dvh` for mobile and CSS variables for the theme engine).
*   **Deployment:** Vercel (Frontend & Serverless API Scrapers).
*   **Markdown:** `react-markdown` + `remark-gfm` for table rendering.
*   **Responsiveness:** Dedicated mobile redesign with horizontally scrollable responsive tables and a centered "stacked" header layout.

---

## 4. Mobile Transformation
Moving beyond "basic stacking," the mobile UI features:
*   **Horizontal Scroll Tables:** AI tables wrap text and allow smooth horizontal scrolling within the chat bubble to prevent layout breaks.
*   **Centered Controls:** Brand and navigation elements are optimized for thumb-reach and visual clarity on small screens.
*   **Adaptive Density:** Message bubbles expand to 98% width on mobile to maximize information density.

---

## 5. Development History & Milestone Log
1.  **v1.0:** Initial React + Gemini setup.
2.  **v1.2:** Integrated Reddit/Wiki scraping via Vite proxy.
3.  **v1.5:** Migration to Supabase Auth & DB history persistence.
4.  **v2.0:** Production migration (Vercel APIs) and Theme Engine.
5.  **v2.1:** Price Engine (CheapShark) and Slash Commands integration.
6.  **v2.5:** Full Mobile Redesign, Loading Animation Engine, and Robust Proxy Retry Logic.
7.  **v3.0 (Current):** Discord Bot Integration leveraging existing Supabase Edge Functions.
