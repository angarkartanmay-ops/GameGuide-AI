# 🎮 GameGuide-AI

Welcome to **GameGuide-AI** – the ultimate multimodal, highly structured support system built specifically for the gaming community. Unlike standard chatbots, GameGuide-AI comes equipped with real-time community intelligence, vision capabilities, and a responsive gamer-centric UI.

## ✨ Key Features

*   **🧠 Real-Time Intelligence Engine:** Injects live data directly from Reddit subreddits and Fandom Wikis. GameGuide-AI never gives outdated meta advice; it grounds its responses in what the community is saying *right now*.
*   **📸 Multimodal Vision Support:** Upload screenshots of bugs, error codes, skill trees, or locations, and GameGuide-AI will analyze them visually using the Gemini API.
*   **💬 Interactive Follow-Ups:** Replicates a premium "Claude-style" interactive experience. Instead of dead-end answers, the AI generates contextual follow-up question chips based on the user's perspective to keep the conversation flowing.
*   **🎨 Custom Game Theme Engine:** A powerful, vanilla CSS-based theme engine featuring 6 distinct, highly polished game styles:
    *   **Cyberpunk 2077** 
    *   **Fallout**
    *   **Valorant**
    *   **Subway Surfers**
    *   **Halo**
    *   *(Default Hacker aesthetic)*
*   **📊 Structured, Scannable Output:** Built to respect a gamer's time. Responses are strictly formatted avoiding walls of text, heavily utilizing Markdown tables for comparisons (e.g., assessing armor stats or speedrunner vs. completionist routes).
*   **🤖 Discord Bot Integration:** Access the full power of GameGuide-AI directly from your Discord server. The bot shares the exact same "brain" (Supabase Edge Function) as the web app, maintaining strict formatting rules and live scraping capabilities.

## 🛠️ Tech Stack

*   **Frontend:** React.js, Vite
*   **Styling:** Vanilla CSS (Tailored UI/UX without heavy frameworks)
*   **AI Integration:** Google Gemini API (`@google/genai`)
*   **Parsing & Markdown:** `react-markdown`, `remark-gfm`
*   **Icons:** `lucide-react`
*   **Data Scraper:** Node.js/Vite Middleware (Proxy APIs for Reddit & Fandom)

## 🚀 Getting Started

### Prerequisites
*   Node.js installed (v18+)
*   A free Google Gemini API Key (get one at [Google AI Studio](https://aistudio.google.com/))

### Installation
1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/GameGuide-AI.git
    cd GameGuide-AI
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Configure Environment Variables:**
    Create a `.env` file in the root directory and add your key:
    ```env
    VITE_GEMINI_API_KEY=your_gemini_api_key_here
    ```
4.  **Run the development server:**
    ```bash
    npm run dev
    ```
    The app will be running at `http://localhost:5173/`.

## 💡 Future Enhancements (Roadmap)
*   Migration of Vite Middleware to a full Node.js/Express backend for production-ready deployment.
*   Integration of persistent storage (Supabase/PostgreSQL) for user chat histories.
*   Expansion of the Wiki Mapping system to cover an even larger roster of AAA and indie titles.

---
*If you find this project interesting, feel free to drop a ⭐ on the repository!*
