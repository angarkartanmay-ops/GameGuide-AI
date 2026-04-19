# 📚 GameGuide-AI: Comprehensive Project Reference

This document serves as a highly detailed summary of the architecture, capabilities, and development history of the **GameGuide-AI** project. It is intended for future reference to rapidly recall how systems are integrated, the specific tech stack utilized, and the capabilities of the agent.

---

## 1. Project Overview & Philosophy
**GameGuide-AI** is a premium, web-based, AI-powered support application built specifically for the gaming community. 
**Core Philosophy:** Gamers do not want to read walls of text. They need high-density, accurate, well-structured data. The project was designed with a heavy emphasis on scannability (tables, bolding, bullet points), real-time accuracy (Wiki/Reddit scraping), and an immersive UX (theme engines, responsive layouts).

---

## 2. Core Capabilities & Engines Built

### 🤖 A. The LLM Engine (Gemini Integration)
*   **Provider:** Built entirely on the new `@google/genai` official Google SDK.
*   **Primary Models:** 
    *   `gemini-2.5-flash`: Used for all text generation, context handling, and image analysis (vision). Lightning-fast and highly capable.
    *   `gemini-2.5-flash-image` / `gemini-3.1-flash-image-preview`: Utilized specifically when image generation requests are detected.
*   **System Prompt Engineering:** A highly specialized system prompt (`SYSTEM_INSTRUCTION` in `aiProvider.js`) enforces strict constraints:
    *   **No paragraphs:** Forces the use of bullet points grouped under clear `##` headers.
    *   **Table Requirement:** Any comparison (gear, stats, characters, speedrunner vs. completionist strategies) *must* be formatted as a Markdown table.
    *   **ASCII Flowcharts:** AI is instructed to draw visual ASCII decision trees for troubleshooting or quest steps.
    *   **Suggested Next Questions:** Strict generation of 2-4 follow-up questions from the *user's perspective* using a `[?]` syntax wrapper.

### 🌐 B. The Intelligence Engine (Live Scraping)
Standard AI models suffer from knowledge cut-offs. We bypassed this by building an Intelligence Engine to ground the models.
*   **Vite Middleware Proxy:** To bypass browser CORS security limitations, we wrote custom middleware directly into `vite.config.js`. This allows the React app to fetch `/api/reddit` and `/api/wiki` securely.
*   **Reddit Scraper:** Pulls live JSON data from specific gaming subreddits based on keyword presence to inject current community dialogue, complaints, meta discussions, and "sentiment".
*   **Wiki Scraper:** A `GAME_WIKI_MAP` maps specific game titles to their Fandom MediaWiki endpoints. When appropriate, it pulls high-density lore, weapon stats, and quest steps directly from the wiki to ensure factual precision.
*   *Note on Execution:* The scrapers execute in parallel using `Promise.allSettled` to drastically reduce wait times before the AI runs.

### 👁️ C. Multimodal Systems (Vision & Generation)
*   **Image Attachments (Vision):**
    *   Users can attach up to 3 images (using the 📎 paperclip UI) under 10MB each.
    *   Images are processed into Base64 format and injected into the Gemini context via `inlineData`.
    *   The AI will use these images to read screen errors, identify map locations, or critique character builds visually.
*   **Image Generation:**
    *   A Regex detector watches user prompts for keywords like `"generate an image"`, `"draw me"`, `"visualize"`.
    *   If triggered, normal chat routing halts, and the payload is sent to Gemini's native image generation models via a custom **3-Model Fallback Chain** to guarantee the highest chance of success depending on API key tier limits.
    *   Images render seamlessly inline, wrapped in a clickable UI with a `🎨 AI Generated` badge. Features graceful UI failure messages if the user is out of API quota.

### 🖱️ D. Interactive Follow-Ups (Claude-Style UX)
*   Instead of the conversation ending coldly, the AI generates questions the user might logically ask next.
*   **Custom Parser:** A sophisticated regex script (`parseFollowUps` in `FollowUpChips.jsx`) scans the LLM output for the `[?]` tags, safely excises them from the main body paragraph, and transforms them into an array of UI chips.
*   **Clickable UI:** These chips are rendered at the bottom of the message as cyan "glass" buttons under the header *"You might also want to ask:"*. Clicking immediately fires the text into the chat.

### 🎭 E. The Game Theme Engine
*   An overarching Vanilla CSS architecture leveraging CSS variables (`--bg`, `--accent`, `--glass-bg`).
*   A React dropdown modifies a global `data-theme` attribute on the base HTML document line, instantly causing a total visual cascade across the app without reloading.
*   **6 Custom Top-Tier Game Themes Available:**
    1.  **Neon Synth** (Dark slate, neon pink/cyan borders)
    2.  **Wasteland Terminal** (Black/green CRT terminal aesthetic, mono-style)
    3.  **Tactical Strike** (Clean slate gray, sharp aggressive red accents)
    4.  **Urban Graffiti** (Bright, vibrant playful colors, graffiti aesthetic)
    5.  **Orbital Drop** (UNSC tactical grey with sci-fi blue accents)
    6.  **Voxel World** (Blocky earthy tones, grass green/stone gray combos)

---

## 3. The Tech Stack Breakdown

*   **Core Framework Setup:** React 18 / Vite Server
*   **Styling:** 100% Vanilla CSS (`App.css`, `index.css`). Avoided Tailwind precisely to have absolute fine-tuned control over intricate CSS animations (glows, glassmorphism `backdrop-filter`, sliding fade-ins).
*   **Icons Library:** `lucide-react` used for consistent, scalable SVG icons across UI components.
*   **Markdown Rendering:** Used `react-markdown` layered tightly with `remark-gfm` (GitHub Flavored Markdown) to ensure HTML tables, bold tags, and list indentations format dynamically out-of-the-box.
*   **API Interactions:** Local `.env` management linking out to public Fandom APIs, public Reddit JSON drops, and the official Google generative API.

---

## 4. Database & Persistence Layer
*   **PostgreSQL via Supabase:** The application utilizes a customized strict `chat_messages` table within the managed Supabase environment to securely save chat histories for logged-in users.
*   **Row Level Security (RLS):** Policies are enforced natively at the database level so authenticated users (`auth.uid() = user_id`) can only view or append their specific conversation.
*   **State Hydration:** When a user logs in via Google OAuth, the `useChat` hook automatically queries Supabase, reconstructs the message object array seamlessly alongside Base64 image context, and maps it directly back into React state. 

---

## 5. Current State & Future Architecture Migration (Next Steps)
The application presently is highly stable and fully operational utilizing a combined Vite local proxy and Vercel Serverless Function architecture in production.

**Future Considerations:**
*   Migrating the heavy Base64 image payload strings found in the `chat_messages` PostgreSQL `jsonb` array out into proper **Supabase Storage buckets** if database bloat becomes an issue due to extreme scale.
