import { GoogleGenAI } from "npm:@google/genai";
import { runPulse } from './pulseEngine.ts';

// ═══════════════════════════════════════════════════════════════════════════
//  GAMEGUIDE-AI :: CORTEX v2.0
//  ----------------------------------------------------------------
//  A multi-stage reasoning pipeline:
//    1. QUERY CORTEX     — classifies intent, detects game, scores complexity
//    2. PERSONA ENGINE   — selects the right expert persona
//    3. ROUTE OPTIMIZER  — picks optimal provider/model for the job
//    4. NEURAL MESH      — self-healing multi-provider waterfall
//    5. QUALITY GATE     — caches, validates, repairs format
//
//  Public API contract preserved: { prompt, chatHistory, redditContext,
//  wikiContext, priceContext, attachments } → { text, images, _meta }
// ═══════════════════════════════════════════════════════════════════════════

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper: re-flag every attachment as image/jpeg. Used as a one-shot retry
// path against Gemini when it rejects an attachment with a 400/invalid error.
// (Most images post-EDIT-3a already arrive as image/jpeg from client preprocessing,
// but legacy/Discord paths may pass other MIME types.)
function normalizeAttachmentsToJpeg(atts: any[]) {
  return atts.map(a => ({ ...a, mimeType: 'image/jpeg' }));
}

// ═══════════════════════════════════════════════════════════════════════════
//  BASE SYSTEM PROMPT (formatting rules — stays identical)
// ═══════════════════════════════════════════════════════════════════════════

const BASE_SYSTEM = `
You are GameGuide-AI, the ultimate gamers support system.
You resolve any technical or game-related issues with Video Games across ALL platforms: PC, Console, and Mobile.
You know EVERYTHING about the gaming world—lore, speedruns, mechanics, meta, and culture.

You are securely connected to the **OMNISCIENCE LAYER** — a live web-scraping backend that pulls real-time intel from Google Search, official game APIs (Supercell, Riot, Steam), Wikipedia, Reddit, YouTube uploads, gaming news outlets (IGN, Polygon, Eurogamer, PCGamer, Kotaku), and game-specific Fandom wikis. Whenever you receive any INTEL block below, treat it as **live data fetched seconds ago from the internet** — it is ALWAYS more current than your training. NEVER say you cannot browse the internet. Confidently claim you scan Google, official APIs, forums, wikis, news, and YouTube live for the user.

## 🔥 CRITICAL RECENCY RULE — HARD CONTRACT (YOU MUST OBEY)
- Your training data has a knowledge cutoff that is MONTHS OR YEARS out of date. ANY of these blocks — **PULSE LIVE INTEL**, **OFFICIAL API INTEL**, **WIKIPEDIA INTEL**, **STEAM NEWS INTEL**, **YOUTUBE RECENT-UPLOADS INTEL**, **REDDIT COMMUNITY INTEL**, **GAMING NEWS INTEL**, **GAME WIKI INTEL**, **WEB SEARCH INTEL** — were fetched live in the last few seconds from the actual internet. They OVERRIDE your training data on EVERY topic they cover.
- **HARD RULE: Live data ALWAYS wins.** If live data says "Hero Dark Prince is the newest hero" but your training says "The Little Prince is the newest hero", you MUST answer with Hero Dark Prince. Your training is STALE.
- **YOUR TRAINING DATA IS WRONG** when it contradicts a live source. Live-service games update CONSTANTLY — features, cards, characters, modes are added every month. Your training cutoff predates most of these changes.
- **NEVER deny a feature exists if a live source confirms it.** Never say "this game doesn't have X" when a live block clearly mentions X.
- If asked "what game is this?" or "which card is this?" and live sources clearly identify it, do NOT second-guess based on what you remember the game looked like in your training era.
- If someone asks about the current meta, current patch, current update, current heroes, current cards, current operators, current banners, current season — **ONLY answer using the live scraped data**. Never fabricate current state from training.
- **NEVER use your training data to answer questions about what is "current", "new", "latest", "newest", or "releasing".** These answers MUST come from the live INTEL blocks. If you have no live data, say so — do NOT make up an answer from training.
- Always cite which live source confirmed a fact (e.g. "*per the official Supercell API*", "*from r/ClashRoyale today*", "*according to Google search results*", "*Wikipedia article last revised <date>*").
- If the live blocks are silent on the user's question, fall back to training but CLEARLY flag it: "*⚠️ Based on my training knowledge (which may be outdated) — please verify against the official source or latest patch notes.*"

## 🔀 LIVE-DATA FUSION CONTRACT (applies to EVERY response)
A PULSE LIVE INTEL block is fetched for **every real question you receive** — not just ones with the word "latest" or "new". Treat the absence of explicit temporal language as IRRELEVANT to your trust in the live block:
- "what are the updates about forza horizon 6?" → fuse live data
- "tell me about forza horizon 6" → fuse live data
- "is forza horizon 6 good?" → fuse live data
- "forza horizon 6 release date" → fuse live data

The user's phrasing never changes the contract. **If a live block is present, you use it.** Your final answer is a fusion: live data supplies the facts/dates/numbers/names; your reasoning supplies the analysis, comparison, recommendation, and synthesis. Never produce a "based on my training data, which is outdated…" disclaimer when live data on the topic IS present in your context — read the blocks first, then answer.

## 🎯 PRO-GAMER ACCURACY CONTRACT (NON-NEGOTIABLE)
You are deployed as a **professional-grade gaming assistant**. Pro players, esports coaches, speedrunners, and competitive teams will rely on your output. Wrong info has a real cost — losses, wasted hours, ruined builds. Hold yourself to a tournament-ref level of accuracy:

1. **Specific numbers > vague claims.** Never say "high damage" — say "850 damage at level 11". Never say "fast cooldown" — say "8.4s cooldown". If you don't know an exact number, SAY SO ("exact value not in my live sources, approximately X based on training") rather than fabricating.
2. **Patch-version tags.** When stating any number, mechanic, or meta claim, tag the patch/season it applies to ("as of patch 12.3", "Season 38 of Clash Royale", "Wuthering Waves 2.1"). If you don't know the patch, say "patch unspecified — verify in-game".
3. **Distinguish FACT from OPINION.** Mark opinions explicitly: "**Fact:**" vs "**Pro consensus:**" vs "**My take:**". A fact is something you can cite a live source for. An opinion is your synthesis.
4. **Anti-confabulation rules:**
   - Never invent item names, card names, character names, ability names, NPC names, or location names.
   - Never invent stats. If a stat isn't in your live data, write "(stat not surfaced — check the in-game tooltip)".
   - Never invent achievement requirements, quest steps, or trophy conditions.
   - If you misidentify a game in your first attempt, openly correct yourself: "**Correction:** I initially identified this as X, but live sources confirm it is Y."
5. **"I don't know" is allowed and respected.** Saying "I'm not sure — could you check this in-game and tell me?" is FAR better than confidently lying. Pro gamers can handle uncertainty. They can't handle bad info.
6. **Multi-platform awareness.** Always specify the platform/edition when stat or mechanics differ (Minecraft Java vs Bedrock; PC vs Console aim assist; mobile vs PC FPS targets).
7. **Recency primacy.** When patch dates are unclear, default to: "Live sources are dated [<date>] — anything more recent than that should be checked in-game."
8. **No filler.** Skip "Great question!", "I'd love to help with that!", "Let me explain..." — get straight to the answer. Pros want signal, not preamble.
9. **Consistency check.** Before submitting your answer, mentally re-read it for internal contradictions (e.g. saying "850 damage" in one bullet and "1200 damage" in another). Fix any conflicts.

# RESPONSE FORMAT RULES (CRITICAL — FOLLOW STRICTLY):

## Structure & Readability
- **NEVER write walls of text.** Gamers don't read paragraphs. Break EVERYTHING into scannable chunks.
- **Always use clear section headers** (##) to organize your response into logical blocks.
- **Use bullet points** for any list of items, steps, or facts. Never combine multiple ideas in one long sentence.
- **Keep bullet points to 1-2 sentences max.** If a bullet needs more detail, nest sub-bullets.
- **Bold all key terms**, game names, item names, ability names, and important stats.
- **One idea per line.** White space is your friend.

## Tables (MANDATORY for comparisons)
- **Use Markdown tables for ANY comparison whatsoever.** Weapons, builds, routes, settings, strategies, specs, playstyles — if two or more things are being compared, TABLE IT.
- Tables MUST have a header row and separator row. Example:

| Aspect | Option A | Option B |
|--------|----------|----------|
| Damage | 150 | 200 |

- For item/card/weapon substitutions, ALWAYS use a table with columns like: Name | Role | Stats | Notes

## Flowcharts & Decision Trees
- When explaining a process, decision, or troubleshooting flow, use an ASCII flowchart:
  Start → Step 1 → Step 2 → Result
- For decision branches use:
  Check X → Yes → Do A
           → No → Do B

## Playstyle Comparison
- If asked how to finish or approach a game, provide TWO options in a comparison table:

| Aspect | 🏎️ Speedrunner | 🎯 Completionist |
|--------|----------------|-------------------|
| Focus | Speed & skips | Full experience |

## Technical Troubleshooting
- Use **numbered steps** (1, 2, 3...) for any troubleshooting or how-to guide.
- Each step should be a single clear action.
- Add a **⚡ Quick Fix** section at the top if there's a common easy solution.

## Image Analysis
- If the user attaches a screenshot or image, analyze it carefully.
- Identify the game, any error messages, UI elements, items, characters, or issues visible.
- Provide specific, image-informed advice. Reference what you see in the screenshot.

## Community & Wiki Data
- If a REDDIT COMMUNITY INTEL block is provided, weave community sentiment naturally. Reference subreddits.
- If a GAME WIKI INTEL block is provided, use it as authoritative data. Cite specific stats, names, locations.
- If neither is provided, answer from your own knowledge. Do NOT mention Reddit or wikis unprompted.

## Suggested Next Questions
- At the END, suggest 2-4 RELATED questions the user might want to ask YOU next. These are NOT questions you ask the user — they are topics the user can click to explore deeper.
- Write them from the USER's perspective, as if the user is asking YOU. Examples:
  [?] How do I find the End Portal in my Survival world?
  [?] What's the best bed-bombing strategy for the Ender Dragon?
  [?] What loot do I get from End Cities after beating the Dragon?
- BAD examples (DO NOT do these — these sound like YOU questioning the user):
  ❌ "Are you having trouble locating the End Portal?"
  ❌ "Which edition are you playing?"
  ❌ "Do you need help with Endermen?"
- Format each on its own line: [?] Question text here
- Make them specific, useful, and natural — like a gamer going "ooh, I wanna know that too!"

## GOLDEN RULE
Your responses should look like a well-formatted game guide page — clean headers, tables, bullet points, and zero clutter. If a response looks like a "wall of text", you have FAILED.
`;

// ═══════════════════════════════════════════════════════════════════════════
//  GODMODE VISION ENGINE — game-specific HUD decoders + observation contracts
// ───────────────────────────────────────────────────────────────────────────
//  When the user attaches an image, we do NOT just say "analyze it."
//  We force the model through a strict observation protocol that prevents
//  hallucination, then deliver the persona-shaped answer.
//
//  Protocol stages (all happen in one prompt, model is told to think OUT LOUD):
//    1. CANVAS SCAN     — list every UI region you see, region-by-region
//    2. OCR PASS        — transcribe ALL text/numbers visible (F3, chat, HUD)
//    3. HUD DECODE      — interpret game-specific iconography (hearts, armor…)
//    4. INVENTORY       — list every item visible with counts
//    5. ENVIRONMENT     — biome, time, mobs, structures
//    6. CONFIDENCE      — rate each observation [HIGH/MEDIUM/LOW]
//    7. ANSWER          — finally, address the user's question
//
//  Then a guardrail: if the model says something contradicted by OCR'd text,
//  it must self-correct before final output.
// ═══════════════════════════════════════════════════════════════════════════

// HUD knowledge base — top games we expect screenshots of.
// Each entry teaches the model what icons/regions mean for THAT game.
const HUD_KNOWLEDGE: Record<string, string> = {
  minecraft: `
**MINECRAFT HUD & VISUAL GUIDE** (STRICT ADHERENCE REQUIRED):
- **Tools/Armor Materials (CRITICAL)**: Look at the color of the tools in the hotbar/inventory! 
  - Wood = Brown
  - Stone = Light Grey
  - Iron = White / Very Light Grey
  - Gold = Yellow
  - Diamond = Cyan / Teal / Light Blue (DO NOT confuse with Iron!)
  - Netherite = Dark Grey / Black
- **F3 Debug Screen (CRITICAL OCR)**: Top-right text shows hardware (CPU, GPU, Display). READ EVERY DIGIT CAREFULLY. If it says RTX 5060, DO NOT "correct" it to RTX 3060. Top-left shows FPS, XYZ coords, biome, game version.
- **Hearts (red ❤)**: bottom-left. 10 hearts max = 20 HP. Each FULL heart = 2 HP. Half hearts exist. COUNT THEM ONE BY ONE.
- **Hunger (drumstick 🍗)**: bottom-right. 10 max. Same half-counting logic.
- **Armor (chestplate icons)**: above hearts. Only appears when wearing armor.
- **XP bar (green)**: above hotbar. Number on it = current level.
- **Hotbar**: 9 slots at the bottom. Identify the exact material of each item based on its color.
- **Air bubbles**: only when underwater.
`,
  fortnite: `
**FORTNITE HUD**: Shield (blue bar, top), Health (white/green bar, below shield, max 100), Materials (wood/brick/metal counts top-right), minimap top-right, ammo bottom-right, weapon slots bottom.`,
  valorant: `
**VALORANT HUD**: HP+armor center-bottom (green=full, yellow=injured), abilities bottom-left (4 keys: C/Q/E/X), gun+ammo bottom-right, money top-left, scoreboard top, agent portraits left/right.`,
  'league of legends': `
**LEAGUE OF LEGENDS HUD**: Champion HP (green) + mana (blue) center-bottom, items in 6 slots bottom-right, abilities Q/W/E/R+passive bottom-center, minimap bottom-right (or top-right depending on settings), gold count next to items.`,
  'apex legends': `
**APEX LEGENDS HUD**: Health (white→yellow→orange depending on shield tier) bottom-left, shield bar above health, Ult % above tactical, ammo bottom-right, ping wheel.`,
  'call of duty': `
**COD HUD**: Health (regen, no bar in MP), minimap top-left, killfeed top-right, ammo bottom-right, scorestreak progress.`,
  warzone: `
**WARZONE HUD**: Same as COD but with armor plates indicator (3 segments next to health), squad list top-left, money/contracts.`,
  zelda: `
**ZELDA HUD (BOTW/TOTK)**: Hearts top-left (each = 4 HP, counted in quarters), stamina wheel below hearts (orange when depleting), temperature gauge bottom-right (in extreme weather), weapon durability when held.`,
  'elden ring': `
**ELDEN RING HUD**: HP (red) top-left, Stamina (green) below, FP/Mana (blue) below stamina. Equipped items: 2 weapons + spell + flask + skill in bottom-left. Runes (currency) bottom-right.`,
  'dark souls': `
**DARK SOULS HUD**: HP/Stam/Mana top-left bars. Souls bottom-right. Estus + items bottom-left. Equip load arrow if heavy.`,
  'genshin impact': `
**GENSHIN HUD**: Party (4 chars right side, with HP+Element), HP+stamina center, elemental burst wheel, minimap top-left, quest tracker right, current resin top-right.`,
  fallout: `
**FALLOUT HUD (4/76)**: HP bottom-left, AP (action points) bottom-center, Rad meter, compass top, weapon+ammo bottom-right, V.A.T.S. shows percentages.`,
  destiny: `
**DESTINY 2 HUD**: Shield (bar above HP), HP, ammo per weapon (3 weapons: kinetic/energy/heavy), super charge bottom-left, grenade+melee cooldown.`,
  cyberpunk: `
**CYBERPUNK 2077 HUD**: HP (red), Armor (white above HP), Stamina (yellow), Quickhack RAM bar, weapon/cyberware bottom-right, minimap top-right.`,
  'overwatch': `
**OVERWATCH HUD**: HP (white)+Armor (yellow segments)+Shield (blue) bottom-left, Ult % center bottom, ability cooldowns LSHIFT+E.`,
  pokemon: `
**POKEMON HUD**: In battle: HP bar per Pokémon, status icons (PSN/PAR/SLP), level next to name. Out of battle: party menu shows 6 slots with HP bars.`,
  diablo: `
**DIABLO HUD**: Globe-style HP (red, left) + Mana/Resource (blue, right). Skill bar center. XP bar bottom-thin.`,
  terraria: `
**TERRARIA HUD**: Hearts top-right (each = 20 HP, 5 per row), mana stars below. Inventory hotbar top-left (10 slots).`,
  'hollow knight': `
**HOLLOW KNIGHT HUD**: Masks (HP, white circles top-left), SOUL meter top-left circle, geo (currency) below, charm slots only in inventory.`,
};

const VISION_GODMODE_INSTRUCTION = `
# 🎯 PRECISION VISION ENGINE v3 — ZERO HALLUCINATION PROTOCOL

You are tasked with analyzing an image with absolute, pixel-perfect accuracy. Your primary directive is to NEVER hallucinate, guess, or assume. 

## ⛔ STRICT REFUSAL RULES
1. **Never auto-correct text or numbers.** If you see "RTX 5060", write "RTX 5060". Do not assume it's a typo for a more common model. Read text character by character.
2. **Never guess items by context.** A player at level 21 could have Wood or Diamond tools. Identify items purely by their visual characteristics (e.g., color, shape). If a tool is Cyan/Teal, it is Diamond. If it is White/Grey, it is Iron.
3. **If unsure, state uncertainty.** Use \`[UNCLEAR]\` if a region is blurry or ambiguous. Do not invent details to sound helpful.
4. **Never deny live features.** NEVER deny a card/character/feature that an INTEL block confirms exists, even if your training predates it.
5. **Hard refusal on unreadable input.** If the image is genuinely too blurry, too dark, cropped, or otherwise illegible to ground answers in pixel evidence, your ENTIRE reply must be:
   "🚫 **I can't read this image clearly.** Specifically: [describe what's wrong — e.g. 'the text is below ~10px and pixelated', 'the screen is mostly black except a small region']. Please re-upload a higher-resolution screenshot, or describe what you're seeing in text and I'll help that way."
   Do NOT proceed to STEP 1-4 in this case. Do NOT guess. Do NOT pad with generic advice.

## REQUIRED ANALYSIS WORKFLOW (THINK OUT LOUD):
You must structure your initial analysis strictly using these steps before answering the user:

### STEP 1: OCR & TEXT EXTRACTION
Extract ALL text visible on the screen EXACTLY as written. Pay special attention to:
- Debug menus (e.g., Minecraft F3 screen: coords, FPS, CPU, GPU).
- Chat logs.
- UI labels or numbers.
*(Self-Correction during Step 1: Verify every digit of hardware specs or coordinates against the image. Do not hallucinate standard specs.)*

### STEP 2: VISUAL INVENTORY & HUD
List the items, icons, and HUD elements you see.
- **Hotbar/Inventory**: Look closely at the color of items. (e.g., Cyan tools = Diamond, White tools = Iron). List them accurately.
- **Status Bars**: Health, stamina, mana, armor, experience levels. Give exact counts if possible.

### STEP 3: ENVIRONMENT & CONTEXT
Describe the game world. What biome is it? What structures or mobs are visible? What is the lighting like?

### STEP 4: ANSWER THE USER's QUESTION
Using ONLY the verified data from Steps 1-3 (and any provided live INTEL blocks), answer the user's specific question. 
- Use the active persona's formatting rules.
- If your advice depends on an item or stat, ensure it matches your findings in Steps 1 and 2.
- Do NOT provide generic advice that contradicts the visual evidence.
- End with the standard \`[?]\` follow-up questions.
`;

function buildVisionPrompt(profile: QueryProfile): string {
  // Pull the HUD knowledge for the detected game (or a top-5 cheatsheet if unknown)
  const game = profile.game?.toLowerCase() || '';
  let hudBlock = '';

  // Exact match
  for (const [k, v] of Object.entries(HUD_KNOWLEDGE)) {
    if (game.includes(k) || k.includes(game)) {
      hudBlock = v;
      break;
    }
  }

  // No match → don't paste all 18 entries (token bloat). Just include the
  // generic Minecraft entry as a fallback example of HOW to read a HUD,
  // plus tell the model to identify the game first.
  if (!hudBlock) {
    hudBlock = `
**UNKNOWN GAME** — first identify the game from the image (UI style, font, art direction, F3 or version text, recognizable characters/blocks). Then apply general HUD principles:
- Find the health indicator (color usually red or green, often a bar or icon row).
- Find ammo/mana/stamina (numbers or secondary bar).
- Identify minimap location.
- Read any text overlays as ground truth.
${HUD_KNOWLEDGE.minecraft}
(Above is an example HUD spec — use the same level of rigor for the actual game.)`;
  }

  return VISION_GODMODE_INSTRUCTION + '\n\n## GAME-SPECIFIC HUD KNOWLEDGE\n' + hudBlock;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PERSONA ENGINE — auto-selected expert overlays
// ═══════════════════════════════════════════════════════════════════════════

interface Persona {
  id: string;
  emoji: string;
  name: string;
  overlay: string; // appended to BASE_SYSTEM
}

const PERSONAS: Record<string, Persona> = {
  coach: {
    id: 'coach',
    emoji: '🎯',
    name: 'Coach',
    overlay: `
# ACTIVE PERSONA: 🎯 COACH MODE
You are now in **COACH MODE** — a tournament-grade gaming strategist.
- Approach every answer like a pro-level player breaking down film for a student.
- ALWAYS open with a "**🎯 The Optimal Play**" section showing the single highest-EV recommendation.
- Then provide a "**📊 Build / Loadout Table**" comparing top 2-3 viable options with stats.
- End with "**⚡ Practice Drills**" — 2-3 concrete exercises the user can do RIGHT NOW to improve.
- Be DECISIVE. Coaches don't say "it depends" — they pick a path and explain trade-offs.`,
  },

  loremaster: {
    id: 'loremaster',
    emoji: '📜',
    name: 'Loremaster',
    overlay: `
# ACTIVE PERSONA: 📜 LOREMASTER MODE
You are now the **LOREMASTER** — a deep-cut narrative archaeologist.
- Open with a "**📜 The Untold Story**" — a hook revealing something most players miss.
- Use "**⚔️ Canonical Timeline**" sections with bullets in chronological order.
- Add "**💀 Hidden Connections**" — link characters, factions, or symbols across the franchise.
- Quote in-game text when possible (use > blockquotes).
- Tone: dramatic, atmospheric, slightly mysterious. Reference fan theories where canon is ambiguous, but flag them as theories.`,
  },

  techwizard: {
    id: 'techwizard',
    emoji: '🛠️',
    name: 'TechWizard',
    overlay: `
# ACTIVE PERSONA: 🛠️ TECH WIZARD MODE
You are now the **TECH WIZARD** — an elite IT support engineer specializing in games.
- Open with a "**⚡ Quick Fix**" section: the single fastest thing to try (1 line, 1 action).
- Then provide a "**🔧 Diagnostic Ladder**": numbered steps from MOST common cause → LEAST common.
- For each step include: (a) what to do, (b) why it usually works, (c) what to check next if it doesn't.
- Add a "**🚨 Nuclear Options**" section at the end with reinstall/factory-reset-tier fixes.
- ALWAYS specify the platform (PC/PS5/Xbox/Switch/Mobile) at the top — guess from context if unstated.`,
  },

  speedrunner: {
    id: 'speedrunner',
    emoji: '🏎️',
    name: 'Speedrunner',
    overlay: `
# ACTIVE PERSONA: 🏎️ SPEEDRUNNER MODE
You are now in **SPEEDRUNNER MODE** — a frame-perfect optimizer who knows every skip.
- Open with the "**🏎️ Current World Record Route**" — name the runner, time, and category if known.
- List skips/glitches in a table: | Trick | Saves | Difficulty | Frame Window |
- Add "**🎯 Beginner Splits**" — a more forgiving route for someone just starting to speedrun this game.
- Reference the speedrun.com category leaderboard if relevant.
- Tone: technical, precise, performance-obsessed.`,
  },

  metaanalyst: {
    id: 'metaanalyst',
    emoji: '⚔️',
    name: 'MetaAnalyst',
    overlay: `
# ACTIVE PERSONA: ⚔️ META ANALYST MODE
You are now the **META ANALYST** — a competitive scene insider tracking patch-by-patch shifts.
- ALWAYS prioritize the live REDDIT COMMUNITY INTEL block — that's where current meta lives.
- Open with "**⚔️ Current Tier List**" as a markdown table: | Tier | Picks | Why |
- Add "**📈 Rising / 📉 Falling**" sections with 2-3 entries each, citing recent patch numbers if visible.
- Include "**🚫 Trap Picks**" — things players THINK are good but actually aren't this patch.
- If meta info isn't in the scraped data, SAY SO — don't fabricate current state from training data.`,
  },

  critic: {
    id: 'critic',
    emoji: '🎨',
    name: 'GameCritic',
    overlay: `
# ACTIVE PERSONA: 🎨 GAME CRITIC MODE
You are now the **GAME CRITIC** — an opinionated, well-read reviewer with taste.
- Open with a "**🎨 The Verdict**" — a 1-line punchy take with a personal score (e.g., 8.5/10).
- Use "**💎 What It Nails**" and "**💢 What It Bungles**" sections side-by-side.
- Compare to 2-3 other games in the same genre via a table.
- End with "**🎯 You'll Love It If...**" / "**🚫 Skip It If...**" recommendations.
- Tone: confident, evocative, willing to take a stance.`,
  },

  generalist: {
    id: 'generalist',
    emoji: '🎮',
    name: 'GameGuide',
    overlay: ``, // base prompt only
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  QUERY CORTEX — intent + game + complexity classification (regex-based,
//  zero-latency, deterministic — no extra LLM call needed)
// ═══════════════════════════════════════════════════════════════════════════

type Intent = 'lore' | 'build' | 'troubleshoot' | 'speedrun' | 'meta' | 'review' | 'comparison' | 'general';

interface QueryProfile {
  intent: Intent;
  persona: Persona;
  game: string | null;
  complexity: 'simple' | 'medium' | 'deep';
  hasVision: boolean;
  isMetaQuery: boolean;
}

const INTENT_PATTERNS: Array<{ intent: Intent; persona: keyof typeof PERSONAS; rx: RegExp }> = [
  { intent: 'troubleshoot', persona: 'techwizard', rx: /\b(error|crash|won.?t (start|load|launch)|black screen|stuck|bug|glitch|fix|fps drop|lag|freezing|stuttering|disconnect|install|update fail|won.?t connect|driver|gpu|directx|launcher|won.?t download)\b/i },
  { intent: 'speedrun', persona: 'speedrunner', rx: /\b(speedrun|world record|wr|any%|100%|glitchless|skip|frame perfect|tas|fastest|optim(al|ised|ized) route|sub.?\d+|splits?)\b/i },
  { intent: 'meta', persona: 'metaanalyst', rx: /\b(meta|tier list|current patch|nerf|buff|best (champ|hero|legend|operator|character|class|deck|loadout) (right now|this season|now|currently|2024|2025|2026)|pro play|tournament|s tier|dominat|broken (right now|currently)|patch \d|season \d)\b/i },
  { intent: 'build', persona: 'coach', rx: /\b(best build|optim(al|ised|ized) build|loadout|gear setup|stat priority|talent tree|skill tree|gem setup|rune page|aspect|paragon|paragon board|build guide|gear progression|min.?max)\b/i },
  { intent: 'lore', persona: 'loremaster', rx: /\b(lore|story|backstory|canon|timeline|who is|what happened to|origin of|history of|mythology|prophecy|connection between|relationship between|family of|ending explained|secret ending|true ending|hidden meaning|symbol(ism)?|easter egg)\b/i },
  { intent: 'review', persona: 'critic', rx: /\b(should i (buy|get|play)|is .* worth it|is .* good|review|opinion on|thoughts on|what do you think of|rating|score)\b/i },
  { intent: 'comparison', persona: 'coach', rx: /\b(vs|versus|compared? to|or |which is better|difference between|better than)\b/i },
];

const KNOWN_GAMES = [
  // ── AAA: ARPG/Open-world ─────────────────────────────────────────────────
  'elden ring','dark souls','dark souls 3','dark souls 2','sekiro','bloodborne','demon\'s souls','demons souls',
  'monster hunter','monster hunter rise','monster hunter wilds','monster hunter world','mh rise','mh wilds','mh world',
  'witcher','witcher 3','the witcher','cyberpunk','cyberpunk 2077','red dead','rdr2','red dead redemption',
  'gta','gta v','gta vi','gta 6','gta 5','gta online','grand theft auto',
  'skyrim','fallout','fallout 4','fallout 76','starfield','baldurs gate','baldur\'s gate','bg3','baldurs gate 3',
  'kingdom come','dragon age','mass effect','horizon zero dawn','horizon forbidden west','death stranding',
  'black myth','wukong','black myth wukong','expedition 33','clair obscur','silent hill','silent hill 2',
  // ── AAA: shooters / battle royales ───────────────────────────────────────
  'valorant','fortnite','apex legends','call of duty','warzone','cod','mw3','mw2','black ops 6','bo6',
  'rainbow six','siege','rainbow six siege','r6','tarkov','escape from tarkov','helldivers','helldivers 2',
  'overwatch','overwatch 2','the finals','marvel rivals','rivals','splitgate','splitgate 2','fragpunk',
  'xdefiant','delta force','arc raiders','battlefield','battlefield 2042','counter-strike','cs2','cs:go','csgo',
  // ── MOBA / 5v5 / TCG ─────────────────────────────────────────────────────
  'league of legends','league','lol','dota','dota 2','smite','smite 2','wild rift','mobile legends','mlbb',
  'pokemon unite','heroes of the storm','marvel snap','hearthstone','legends of runeterra','runeterra',
  // ── Live-service RPGs ───────────────────────────────────────────────────
  'destiny','destiny 2','warframe','path of exile','poe','path of exile 2','poe 2','diablo','diablo 4','diablo iv',
  'world of warcraft','wow','final fantasy xiv','ffxiv','ff14','runescape','osrs','old school runescape',
  // ── HoYoverse / Kuro / gacha ────────────────────────────────────────────
  'genshin','genshin impact','honkai star rail','star rail','hsr','honkai impact','honkai impact 3rd',
  'wuthering waves','wuwa','zenless zone zero','zzz','tower of fantasy','arknights','blue archive','nikke',
  'fate grand order','fgo','azur lane','girls frontline','reverse 1999','punishing gray raven','pgr',
  // ── Sandbox / survival / sim ────────────────────────────────────────────
  'minecraft','minecraft java','minecraft bedrock','terraria','stardew valley','satisfactory','factorio',
  'rust','dayz','ark','ark survival evolved','valheim','enshrouded','palworld','lethal company','phasmophobia',
  'no man\'s sky','no mans sky','subnautica','7 days to die','rimworld','kenshi','project zomboid',
  // ── Action / character / fighting ───────────────────────────────────────
  'devil may cry','dmc5','tekken','tekken 8','street fighter','street fighter 6','sf6','mortal kombat','mk1',
  'guilty gear','guilty gear strive','dragon ball fighterz','dbfz','smash bros','smash ultimate','rivals of aether',
  // ── Roguelike / indie ───────────────────────────────────────────────────
  'hades','hades 2','hollow knight','silksong','dead cells','enter the gungeon','risk of rain','risk of rain 2',
  'binding of isaac','noita','spelunky','nuclear throne','curse of the dead gods','vampire survivors',
  // ── Sports / racing ─────────────────────────────────────────────────────
  'fifa','fc','fc 25','ea fc','nba 2k','nba 2k25','madden','mlb the show','rocket league','forza','forza horizon',
  'gran turismo','gt7','f1','f1 24','wreckfest','dirt rally','assetto corsa',
  // ── Nintendo ────────────────────────────────────────────────────────────
  'zelda','tears of the kingdom','totk','breath of the wild','botw','mario','mario kart','mario kart 8',
  'super mario odyssey','super mario bros wonder','animal crossing','splatoon','splatoon 3','metroid','metroid prime',
  'pokemon','pokemon scarlet','pokemon violet','pokemon legends arceus','pokemon go','pokemon unite','pokemon tcg',
  'fire emblem','fire emblem engage','xenoblade','xenoblade chronicles 3',
  // ── JRPG ────────────────────────────────────────────────────────────────
  'final fantasy','ff7','ff7 remake','ff7 rebirth','ff14','ff16','final fantasy 7','final fantasy 16',
  'persona 3','persona 3 reload','persona 4','persona 5','persona 5 royal','metaphor','metaphor refantazio',
  'kingdom hearts','kingdom hearts 4','dragon quest','tales of arise','ni no kuni','sea of stars','octopath',
  // ── Mobile (giant + popular) ────────────────────────────────────────────
  'clash royale','clash of clans','coc','clash mini','brawl stars','squad busters','hay day','boom beach',
  'subway surfers','temple run','candy crush','candy crush saga','royal match','homescapes','gardenscapes',
  'pubg','pubg mobile','bgmi','battlegrounds mobile india','free fire','garena free fire','call of duty mobile',
  'codm','arena breakout','farlight 84','marvel contest of champions','injustice 2','clash mini',
  // ── Other live service / multiplayer ───────────────────────────────────
  'sea of thieves','elite dangerous','star citizen','eve online','war thunder','world of tanks','wot',
  'world of warships','crossout','planetside 2','foxhole','space marine 2','warhammer 40k space marine 2',
  'total war warhammer 3','twwh3','total war','crusader kings 3','ck3','europa universalis 4','eu4','stellaris',
  'civilization 6','civ 6','age of empires 4','aoe4','company of heroes 3','manor lords',
  // ── Older but still relevant ────────────────────────────────────────────
  'team fortress 2','tf2','garry\'s mod','gmod','left 4 dead 2','l4d2','portal 2','half-life','half-life 2',
  'half-life alyx','undertale','deltarune','celeste','ori','ori and the will of the wisps','cuphead','among us'
];

function detectGame(text: string): string | null {
  const lower = text.toLowerCase();
  // Longest-match first (so "elden ring" beats "ring", "gta vi" beats "gta").
  // Use word-boundary regex to avoid false positives like "wow" matching "wowed",
  // "lol" matching "lolly", "fc" matching "fcuk", etc.
  const sorted = [...KNOWN_GAMES].sort((a, b) => b.length - a.length);
  for (const g of sorted) {
    const escaped = g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`\\b${escaped}\\b`, 'i');
    if (rx.test(lower)) return g;
  }
  return null;
}

function scoreComplexity(prompt: string, history: any[]): 'simple' | 'medium' | 'deep' {
  const len = prompt.length;
  const wordCount = prompt.split(/\s+/).length;
  const histDepth = history.length;
  const hasMultipart = /\?.+\?/.test(prompt) || /\band\b.*\band\b/i.test(prompt);
  if (len < 50 && wordCount < 10) return 'simple';
  if (len > 250 || wordCount > 40 || hasMultipart || histDepth > 8) return 'deep';
  return 'medium';
}

function classifyQuery(prompt: string, attachments: any[], history: any[]): QueryProfile {
  let intent: Intent = 'general';
  let persona = PERSONAS.generalist;

  for (const p of INTENT_PATTERNS) {
    if (p.rx.test(prompt)) {
      intent = p.intent;
      persona = PERSONAS[p.persona];
      break;
    }
  }

  return {
    intent,
    persona,
    game: detectGame(prompt),
    complexity: scoreComplexity(prompt, history),
    hasVision: attachments.length > 0,
    isMetaQuery: intent === 'meta',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  IMAGE GENERATION DETECTION
// ═══════════════════════════════════════════════════════════════════════════

const IMAGE_KEYWORDS = [
  'generate an image', 'generate image', 'create an image', 'create image',
  'draw me', 'draw a', 'show me what', 'picture of', 'illustration of',
  'visualize', 'create a picture', 'make an image', 'generate a picture',
  'make a picture', 'create art', 'generate art', 'show me a picture',
  'what does it look like', 'what would it look like',
];

function shouldGenerateImage(query: string) {
  const lower = query.toLowerCase();
  return IMAGE_KEYWORDS.some(k => lower.includes(k));
}

// ═══════════════════════════════════════════════════════════════════════════
//  PROVIDER MESH CONFIG
// ═══════════════════════════════════════════════════════════════════════════

interface ProviderConfig {
  name: string;
  endpoint: string;
  keyEnv: string;
  models: { id: string; vision: boolean; speed: 'fast' | 'normal'; tier: 'flagship' | 'fast' | 'balanced' }[];
  timeoutMs: number;
  extraHeaders?: Record<string, string>;
}

const PROVIDERS: ProviderConfig[] = [
  {
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    keyEnv: 'GROQ_API_KEY',
    models: [
      { id: 'llama-3.3-70b-versatile', vision: false, speed: 'fast', tier: 'flagship' },
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', vision: false, speed: 'fast', tier: 'balanced' },
      { id: 'llama-3.1-8b-instant', vision: false, speed: 'fast', tier: 'fast' },
    ],
    timeoutMs: 25_000,
  },
  {
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    keyEnv: 'OPENROUTER_API_KEY',
    models: [
      // Vision-capable models FIRST so optimizeRoute prefers them on vision queries
      { id: 'google/gemini-2.0-flash-exp:free', vision: true, speed: 'fast', tier: 'flagship' },
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct:free', vision: true, speed: 'fast', tier: 'balanced' },
      { id: 'mistralai/pixtral-12b:free', vision: true, speed: 'normal', tier: 'balanced' },
      // Text-only flagships
      { id: 'deepseek/deepseek-chat-v3-0324:free', vision: false, speed: 'normal', tier: 'flagship' },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', vision: false, speed: 'normal', tier: 'flagship' },
      { id: 'mistralai/mistral-small-3.1-24b-instruct:free', vision: false, speed: 'fast', tier: 'balanced' },
    ],
    timeoutMs: 30_000,
    extraHeaders: {
      'HTTP-Referer': 'https://gameguide-ai.vercel.app',
      'X-Title': 'GameGuide-AI',
    },
  },
  {
    name: 'Cerebras',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
    keyEnv: 'CEREBRAS_API_KEY',
    models: [
      { id: 'llama-3.3-70b', vision: false, speed: 'fast', tier: 'flagship' },
      { id: 'llama3.1-8b', vision: false, speed: 'fast', tier: 'fast' },
    ],
    timeoutMs: 20_000,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
//  ROUTE OPTIMIZER — picks best (provider, model) order for a given query
// ═══════════════════════════════════════════════════════════════════════════

function optimizeRoute(profile: QueryProfile): Array<{ provider: ProviderConfig; modelId: string }> {
  const out: Array<{ provider: ProviderConfig; modelId: string }> = [];

  if (profile.hasVision) {
    // Vision queries: native Gemini SDK runs first (handled in runNeuralMesh).
    // This list is the EXTERNAL fallback chain used when native Gemini fails.
    // Only include models flagged vision: true.
    for (const provider of PROVIDERS) {
      if (!Deno.env.get(provider.keyEnv)) continue;
      for (const m of provider.models) {
        if (m.vision) out.push({ provider, modelId: m.id });
      }
    }
    return out;
  }

  // ── Simple / fast queries → small-model-first for sub-second responses ──
  if (profile.complexity === 'simple') {
    const order: Array<'fast' | 'flagship' | 'balanced'> = ['fast', 'flagship', 'balanced'];
    for (const tier of order) {
      for (const provider of PROVIDERS) {
        if (!Deno.env.get(provider.keyEnv)) continue;
        for (const m of provider.models) {
          if (m.tier === tier) out.push({ provider, modelId: m.id });
        }
      }
    }
    return out;
  }

  // ── Lore / deep / build / comparison → flagship 70B class first ──
  if (profile.intent === 'lore' || profile.intent === 'build' || profile.complexity === 'deep' || profile.intent === 'comparison') {
    const order: Array<'flagship' | 'balanced' | 'fast'> = ['flagship', 'balanced', 'fast'];
    for (const tier of order) {
      for (const provider of PROVIDERS) {
        if (!Deno.env.get(provider.keyEnv)) continue;
        for (const m of provider.models) {
          if (m.tier === tier) out.push({ provider, modelId: m.id });
        }
      }
    }
    return out;
  }

  // ── Default: every model in provider/declared-order ──
  for (const provider of PROVIDERS) {
    if (!Deno.env.get(provider.keyEnv)) continue;
    for (const m of provider.models) {
      out.push({ provider, modelId: m.id });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PAYLOAD BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: any; }

function buildOpenAIMessages(
  systemInstruction: string,
  chatHistory: any[],
  userPrompt: string,
  attachments: any[],
  visionCapable: boolean,
): ChatMsg[] {
  const msgs: ChatMsg[] = [{ role: 'system', content: systemInstruction }];

  for (const m of chatHistory) {
    msgs.push({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text,
    });
  }

  if (attachments.length > 0 && visionCapable) {
    const parts: any[] = [{ type: 'text', text: userPrompt || 'Analyze this image.' }];
    for (const a of attachments) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${a.mimeType};base64,${a.data}` },
      });
    }
    msgs.push({ role: 'user', content: parts });
  } else {
    const noteIfImages = attachments.length > 0
      ? `\n\n[Note: User attached ${attachments.length} image(s) but the active model is text-only. Do your best from context, or ask the user to describe what they see.]`
      : '';
    msgs.push({ role: 'user', content: (userPrompt || 'Analyze this image.') + noteIfImages });
  }

  return msgs;
}

function buildGeminiContents(chatHistory: any[], userPrompt: string, attachments: any[]) {
  const history = chatHistory.map((msg: any) => ({
    role: msg.sender === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));
  const userParts: any[] = [];
  for (const attachment of attachments) {
    userParts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
  }
  userParts.push({ text: userPrompt || 'Analyze this image.' });
  return [...history, { role: 'user', parts: userParts }];
}

// ═══════════════════════════════════════════════════════════════════════════
//  TIMEOUT-AWARE FETCH
// ═══════════════════════════════════════════════════════════════════════════

async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CACHE LAYER (in-memory per Deno isolate, 5-min TTL)
// ═══════════════════════════════════════════════════════════════════════════

interface CacheEntry { text: string; provider: string; model: string; persona: string; ts: number; }
const responseCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function sha256(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function cacheKey(
  prompt: string,
  hist: any[],
  reddit: string,
  wiki: string,
  price: string,
  attachments: any[],
): Promise<string> {
  const histTail = hist.slice(-2).map(m => `${m.sender}:${(m.text || '').slice(0, 80)}`).join('|');
  // Full SHA-256 per attachment so two visually-different but similar-byte-
  // length images can never collide in the cache.
  const attHashes = await Promise.all(
    attachments.map(async a => `${a.mimeType}:${await sha256((a.data || ''))}`)
  );
  const attFingerprint = attHashes.join('|');
  const raw = `${prompt}|${histTail}|R${reddit.length}|W${wiki.length}|P${price.length}|A${attachments.length}|${attFingerprint}`;
  return await sha256(raw);
}

function pruneCache() {
  const now = Date.now();
  for (const [k, v] of responseCache) {
    if (now - v.ts > CACHE_TTL_MS) responseCache.delete(k);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  OPENAI-COMPATIBLE CALL
// ═══════════════════════════════════════════════════════════════════════════

async function callOpenAICompat(
  provider: ProviderConfig,
  modelId: string,
  messages: ChatMsg[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const key = Deno.env.get(provider.keyEnv);
  if (!key) throw new Error(`MISSING_KEY:${provider.name}`);

  const body = {
    model: modelId,
    messages,
    temperature: opts.temperature ?? 0.72,
    max_tokens: opts.maxTokens ?? 2400,
    top_p: 0.95,
    stream: false,
  };

  const res = await fetchWithTimeout(provider.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      ...(provider.extraHeaders || {}),
    },
    body: JSON.stringify(body),
  }, provider.timeoutMs);

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP_${res.status}:${errText.slice(0, 240)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('EMPTY_RESPONSE');
  }
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
//  GEMINI CALL (legacy fallback + image generation)
// ═══════════════════════════════════════════════════════════════════════════

// Gemini models in priority order (keep current — no expired preview IDs!)
const GEMINI_MODELS = [
  'gemini-2.0-flash',            // fast, generous free quota, best for most queries
  'gemini-2.5-flash',            // newest stable flash model
  'gemini-2.0-flash-lite',       // ultra-fast fallback when others are overloaded
];

async function callGemini(ai: any, contents: any, systemInstruction: string): Promise<string> {
  let lastErr: any = null;
  for (const model of GEMINI_MODELS) {
    try {
      const result = await ai.models.generateContent({
        model,
        contents,
        config: { systemInstruction }
      });
      if (result?.text) return result.text;
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All Gemini models exhausted');
}

const IMAGE_MODELS = [
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash',
];

async function generateImageWithRetry(ai: any, prompt: string) {
  for (const model of IMAGE_MODELS) {
    try {
      console.log(`[IMAGE] Trying ${model}`);
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      const textParts: string[] = [];
      const images: any[] = [];
      if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.text) textParts.push(part.text);
          if (part.inlineData) images.push({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'image/png',
          });
        }
      }
      if (images.length > 0) return { text: textParts.join('\n') || '🎨 Done!', images };
    } catch (e: any) {
      console.warn(`[IMAGE] ${model} failed: ${e.message}`);
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  NEURAL MESH ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

interface MeshResult { text: string; provider: string; model: string; }

function isRetryable(errMsg: string): boolean {
  const m = errMsg.toLowerCase();
  return (
    m.includes('429') || m.includes('rate') || m.includes('quota') ||
    m.includes('503') || m.includes('502') || m.includes('500') ||
    m.includes('timeout') || m.includes('abort') || m.includes('overloaded') ||
    m.includes('unavailable') || m.includes('demand') || m.includes('empty_response') ||
    m.includes('network')
  );
}

function isProviderFatal(errMsg: string): boolean {
  const m = errMsg.toLowerCase();
  return (
    m.includes('missing_key') ||
    m.includes('401') || m.includes('unauthorized') ||
    m.includes('403') || m.includes('forbidden') ||
    m.includes('invalid api key') || m.includes('invalid_api_key')
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  🌍 OMNISCIENCE LAYER — server-side live web intel scrapers
//  ───────────────────────────────────────────────────────────────────────
//  Fans out to 5 NEW data sources in parallel (in addition to client-side
//  Reddit/Fandom/Price). Each block carries an authority score so the
//  trust ranker can prioritise official APIs > Wikipedia > Steam News >
//  YouTube > RSS.
// ═══════════════════════════════════════════════════════════════════════════

interface ScrapeBlock { text: string; score: number; source: string; }

const OMNI_USER_AGENT = 'GameGuide-AI/4.0 (educational gaming assistant; contact: jai.sharma93927@gmail.com)';

// Per-(game, source) cache, 15-minute TTL.
const omniCache = new Map<string, { block: ScrapeBlock; ts: number }>();
const OMNI_CACHE_TTL_MS = 15 * 60 * 1000;

function omniCacheGet(source: string, key: string): ScrapeBlock | null {
  const hit = omniCache.get(`${source}:${key}`);
  if (!hit) return null;
  if (Date.now() - hit.ts > OMNI_CACHE_TTL_MS) {
    omniCache.delete(`${source}:${key}`);
    return null;
  }
  return hit.block;
}
function omniCacheSet(source: string, key: string, block: ScrapeBlock) {
  omniCache.set(`${source}:${key}`, { block, ts: Date.now() });
}

// ─── Steam appId lookup table for top games ────────────────────────────────
// Used by fetchSteamNews to resolve game name → appId.
const STEAM_APPIDS: Record<string, number> = {
  'counter-strike 2': 730, 'cs2': 730, 'cs:go': 730, 'counter-strike': 730,
  'dota 2': 570, 'dota': 570,
  'pubg': 578080, 'pubg battlegrounds': 578080,
  'apex legends': 1172470,
  'team fortress 2': 440, 'tf2': 440,
  'rust': 252490,
  'gta v': 271590, 'gta 5': 271590, 'grand theft auto v': 271590,
  'red dead redemption 2': 1174180, 'rdr2': 1174180,
  'elden ring': 1245620,
  'dark souls 3': 374320, 'dark souls iii': 374320,
  'dark souls': 570940, 'dark souls remastered': 570940,
  'sekiro': 814380,
  'cyberpunk 2077': 1091500, 'cyberpunk': 1091500,
  'witcher 3': 292030, 'the witcher 3': 292030,
  'baldur\'s gate 3': 1086940, 'baldurs gate 3': 1086940, 'bg3': 1086940,
  'helldivers 2': 553850,
  'palworld': 1623730,
  'lethal company': 1966720,
  'terraria': 105600,
  'stardew valley': 413150,
  'minecraft': 0, // Minecraft isn't on Steam — skip
  'destiny 2': 1085660,
  'warframe': 230410,
  'path of exile': 238960, 'poe': 238960, 'path of exile 2': 2694490, 'poe 2': 2694490,
  'monster hunter rise': 1446780, 'mh rise': 1446780,
  'monster hunter wilds': 2246340, 'mh wilds': 2246340,
  'monster hunter world': 582010,
  'rainbow six siege': 359550, 'r6': 359550, 'siege': 359550,
  'rocket league': 252950,
  'fortnite': 0, // not on Steam
  'valorant': 0, // not on Steam
  'league of legends': 0, // not on Steam
  'overwatch 2': 2357570,
  'starcraft 2': 0,
  'world of warcraft': 0,
  'final fantasy xiv': 39210, 'ffxiv': 39210, 'ff14': 39210,
  'final fantasy 7 remake': 1462040, 'ff7 remake': 1462040,
  'final fantasy 16': 2515020, 'ff16': 2515020,
  'persona 5 royal': 1687950, 'persona 5': 1687950,
  'persona 3 reload': 2161700,
  'metaphor refantazio': 2679460, 'metaphor': 2679460,
  'hogwarts legacy': 990080,
  'hollow knight': 367520,
  'hollow knight silksong': 1030300, 'silksong': 1030300,
  'hades': 1145360, 'hades 2': 1145350,
  'starfield': 1716740,
  'fallout 4': 377160,
  'fallout 76': 1151340,
  'skyrim': 489830, 'skyrim special edition': 489830,
  'no man\'s sky': 275850, 'no mans sky': 275850,
  'subnautica': 264710, 'subnautica below zero': 848450,
  'satisfactory': 526870,
  'factorio': 427520,
  'rimworld': 294100,
  'rust legacy': 252490,
  'sea of thieves': 1172620,
  'forza horizon 5': 1551360,
  'microsoft flight simulator': 1250410,
  'red dead online': 1404210,
  'tarkov': 0, 'escape from tarkov': 0, // not on Steam
  'arma 3': 107410,
  'dayz': 221100,
  'kenshi': 233860,
  'mount and blade': 261550, 'mount and blade 2': 261550, 'bannerlord': 261550,
  'total war warhammer 3': 1142710, 'twwh3': 1142710,
  'crusader kings 3': 1158310, 'ck3': 1158310,
  'europa universalis 4': 236850, 'eu4': 236850,
  'stellaris': 281990,
  'cities skylines 2': 949230, 'cities skylines': 255710,
  'civilization 6': 289070, 'civ 6': 289070,
  'manor lords': 1363080,
  'enshrouded': 1203620,
  'wuthering waves': 0, // mobile/PC standalone
  'genshin impact': 0,
  'honkai star rail': 0,
  'zenless zone zero': 0,
  'death stranding': 1190460,
  'death stranding 2': 0,
  'tekken 8': 1778820,
  'street fighter 6': 1364780,
  'mortal kombat 1': 1971870,
  'dead by daylight': 381210, 'dbd': 381210,
  'phasmophobia': 739630,
  'devil may cry 5': 601150, 'dmc5': 601150,
  'returnal': 1649240,
  'control': 870780,
  'alan wake 2': 0,
  'expedition 33': 0, 'clair obscur': 0,
  'doom eternal': 782330,
  'doom 2016': 379720,
  'doom the dark ages': 0,
  'wukong': 2358720, 'black myth wukong': 2358720, 'black myth': 2358720,
  'arc raiders': 0,
  'marvel rivals': 2767030,
  'the finals': 2073850,
  'xdefiant': 0,
  'delta force': 0,
  'fragpunk': 0,
  'splitgate': 677620, 'splitgate 2': 0,
};

function gameToSteamAppId(game: string): number | null {
  const lower = game.toLowerCase();
  // Exact match first
  if (STEAM_APPIDS[lower] !== undefined) {
    return STEAM_APPIDS[lower] || null;
  }
  // Partial match
  for (const [k, v] of Object.entries(STEAM_APPIDS)) {
    if (lower.includes(k) || k.includes(lower)) return v || null;
  }
  return null;
}

// ─── Wikipedia REST API ────────────────────────────────────────────────────
// Tries multiple title variants (game name, "Game (video game)", "Game (game)")
// to handle disambiguation pages. Returns the first non-disambig hit.
async function fetchWikipedia(game: string, timeoutMs = 1200): Promise<ScrapeBlock | null> {
  const cached = omniCacheGet('wikipedia', game);
  if (cached) return cached;

  const titleCase = game.split(' ').map(w => w.length > 0 ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
  const variants = [
    titleCase,
    `${titleCase} (video game)`,
    `${titleCase} (game)`,
    titleCase.replace(/\s+/g, '_'),
  ];

  for (const variant of variants) {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(variant)}`;
      const res = await fetchWithTimeout(url, {
        headers: { 'User-Agent': OMNI_USER_AGENT, 'Accept': 'application/json' },
      }, timeoutMs);
      if (!res.ok) continue;
      const data = await res.json();
      if (!data?.extract) continue;
      if (data.type === 'disambiguation') continue;

      // Sanity check — extract must mention the game name OR be tagged as a game article
      const extractLower = (data.extract || '').toLowerCase();
      const gameLower = game.toLowerCase();
      const titleLower = (data.title || '').toLowerCase();
      const looksLikeGame = extractLower.includes('video game') || extractLower.includes('multiplayer') ||
        extractLower.includes('developed by') || extractLower.includes('released') ||
        titleLower.includes(gameLower) || gameLower.includes(titleLower);
      if (!looksLikeGame) continue;

      const text = `📚 **${data.title}** (Wikipedia, last revised ${data.timestamp || 'recently'})\n${data.extract}\nSource: ${data.content_urls?.desktop?.page || 'wikipedia.org'}`;
      const block: ScrapeBlock = { text, score: 8, source: 'wikipedia' };
      omniCacheSet('wikipedia', game, block);
      return block;
    } catch (e: any) {
      console.warn(`[OMNI] wikipedia "${variant}" failed: ${e.message}`);
    }
  }

  // Last-resort: search API to find the most-likely article title, then try summary
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(game + ' video game')}&limit=3&format=json&origin=*`;
    const sres = await fetchWithTimeout(searchUrl, {
      headers: { 'User-Agent': OMNI_USER_AGENT, 'Accept': 'application/json' },
    }, 1500);
    if (sres.ok) {
      const sdata = await sres.json();
      const candidates = Array.isArray(sdata) && Array.isArray(sdata[1]) ? sdata[1] : [];
      for (const candidate of candidates.slice(0, 2)) {
        try {
          const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidate)}`;
          const res = await fetchWithTimeout(url, {
            headers: { 'User-Agent': OMNI_USER_AGENT, 'Accept': 'application/json' },
          }, 1200);
          if (!res.ok) continue;
          const data = await res.json();
          if (!data?.extract || data.type === 'disambiguation') continue;
          const text = `📚 **${data.title}** (Wikipedia, via search; revised ${data.timestamp || 'recently'})\n${data.extract}\nSource: ${data.content_urls?.desktop?.page || 'wikipedia.org'}`;
          const block: ScrapeBlock = { text, score: 8, source: 'wikipedia' };
          omniCacheSet('wikipedia', game, block);
          return block;
        } catch { /* keep iterating */ }
      }
    }
  } catch (e: any) {
    console.warn(`[OMNI] wikipedia opensearch failed: ${e.message}`);
  }

  return null;
}

// ─── Steam News API ────────────────────────────────────────────────────────
async function fetchSteamNews(game: string, timeoutMs = 1200): Promise<ScrapeBlock | null> {
  const appId = gameToSteamAppId(game);
  if (!appId) return null;

  const cached = omniCacheGet('steam-news', game);
  if (cached) return cached;

  try {
    const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=6&maxlength=600&format=json`;
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': OMNI_USER_AGENT },
    }, timeoutMs);
    if (!res.ok) return null;
    const data = await res.json();
    const items = data?.appnews?.newsitems || [];
    if (items.length === 0) return null;

    const formatted = items.slice(0, 5).map((it: any) => {
      const date = it.date ? new Date(it.date * 1000).toISOString().slice(0, 10) : '?';
      // Strip Steam BBCode + HTML + collapse whitespace
      const body = (it.contents || '')
        .replace(/<[^>]+>/g, ' ')             // HTML tags
        .replace(/\[\/?[a-z][a-z0-9=._: '"\/-]*\]/gi, ' ') // BBCode like [h1]/[url=…]/[img]
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#\d+;/g, '')
        .replace(/\s+/g, ' ').trim().slice(0, 400);
      return `📰 [${date}] **${it.title}**\n  ${body}\n  🔗 ${it.url}`;
    }).join('\n\n');

    const text = `Steam Official News for **${game}** (most recent first):\n\n${formatted}`;
    const block: ScrapeBlock = { text, score: 8, source: 'steam-news' };
    omniCacheSet('steam-news', game, block);
    return block;
  } catch (e: any) {
    console.warn(`[OMNI] steam-news failed for "${game}": ${e.message}`);
    return null;
  }
}

// ─── Invidious YouTube search (most-recent uploads) ────────────────────────
const INVIDIOUS_INSTANCES = [
  'https://invidious.nerdvpn.de',
  'https://invidious.privacyredirect.com',
  'https://yewtu.be',
  'https://inv.tux.pizza',
];

async function fetchInvidious(game: string, timeoutMs = 1200): Promise<ScrapeBlock | null> {
  const cached = omniCacheGet('invidious', game);
  if (cached) return cached;

  const currentYear = new Date().getFullYear();
  const q = encodeURIComponent(`${game} update guide ${currentYear}`);
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const url = `${instance}/api/v1/search?q=${q}&type=video&sort_by=upload_date`;
      const res = await fetchWithTimeout(url, {
        headers: { 'User-Agent': OMNI_USER_AGENT, 'Accept': 'application/json' },
      }, timeoutMs);
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) continue;

      // Filter: video title MUST mention the game (word-boundary match) — kills off-topic results
      const escaped = game.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchRx = new RegExp(`\\b${escaped}\\b`, 'i');
      const relevant = data.filter((v: any) => matchRx.test(v.title || '') || matchRx.test(v.description || ''));
      if (relevant.length === 0) continue;

      const top = relevant.slice(0, 6);
      const formatted = top.map((v: any) => {
        const days = v.publishedText || `~${Math.round((Date.now() / 1000 - (v.published || 0)) / 86400)}d ago`;
        const author = v.author || 'unknown';
        return `🎬 [${days}] **${v.title}** — by ${author}\n  Views: ${v.viewCount?.toLocaleString() || '?'} | https://youtube.com/watch?v=${v.videoId}`;
      }).join('\n\n');

      const text = `Recent YouTube uploads about **${game}** (newest first — channels often cover patches before they hit news sites):\n\n${formatted}`;
      const block: ScrapeBlock = { text, score: 7, source: 'youtube' };
      omniCacheSet('invidious', game, block);
      return block;
    } catch (e: any) {
      console.warn(`[OMNI] invidious ${instance} failed: ${e.message}`);
    }
  }
  return null;
}

// ─── Gaming RSS bundle ─────────────────────────────────────────────────────
const GAMING_RSS_FEEDS = [
  { name: 'IGN', url: 'https://feeds.feedburner.com/ign/games-all' },
  { name: 'Polygon', url: 'https://www.polygon.com/rss/index.xml' },
  { name: 'Eurogamer', url: 'https://www.eurogamer.net/feed' },
  { name: 'PCGamer', url: 'https://www.pcgamer.com/rss/' },
  { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/news/' },
];

function parseRSSItems(xml: string, max = 5): Array<{title: string, desc: string, link: string, date: string}> {
  // Lightweight regex parser — RSS is loose XML; full parsers are overkill for our needs.
  const items: any[] = [];
  const itemRx = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRx.exec(xml)) && items.length < max) {
    const block = m[1];
    const get = (tag: string) => {
      const rx = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      const r = block.match(rx);
      return r ? r[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
    };
    items.push({
      title: get('title'),
      desc: get('description').slice(0, 350),
      link: get('link'),
      date: get('pubDate'),
    });
  }
  return items;
}

async function fetchGamingRSS(game: string, timeoutMs = 1100): Promise<ScrapeBlock | null> {
  const cached = omniCacheGet('rss', game);
  if (cached) return cached;

  const lower = game.toLowerCase();
  // Build a word-boundary regex to avoid false positives like "dota" matching "idiot"
  const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matchRx = new RegExp(`\\b${escaped}\\b`, 'i');

  try {
    const results = await Promise.allSettled(
      GAMING_RSS_FEEDS.map(async f => {
        const res = await fetchWithTimeout(f.url, {
          headers: { 'User-Agent': OMNI_USER_AGENT, 'Accept': 'application/rss+xml, application/xml, text/xml' },
        }, timeoutMs);
        if (!res.ok) return null;
        const xml = await res.text();
        const items = parseRSSItems(xml, 12);
        const matches = items.filter(it => matchRx.test(it.title) || matchRx.test(it.desc));
        return matches.length > 0 ? { feed: f.name, items: matches.slice(0, 3) } : null;
      })
    );

    const hits = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map((r: any) => r.value);

    if (hits.length === 0) return null;

    const formatted = hits.map(h =>
      h.items.map((it: any) =>
        `📰 [${h.feed}] **${it.title}** (${it.date.slice(0, 16)})\n  ${it.desc}\n  🔗 ${it.link}`
      ).join('\n\n')
    ).join('\n\n');

    const text = `Gaming news mentioning **${game}** across IGN/Polygon/Eurogamer/PCGamer/GameSpot:\n\n${formatted}`;
    const block: ScrapeBlock = { text, score: 5, source: 'rss' };
    omniCacheSet('rss', game, block);
    return block;
  } catch (e: any) {
    console.warn(`[OMNI] rss failed for "${game}": ${e.message}`);
    return null;
  }
}

// ─── Supercell official APIs (Clash Royale, Clash of Clans, Brawl Stars) ───
async function fetchSupercellAPI(game: string, timeoutMs = 1200): Promise<ScrapeBlock | null> {
  const lower = game.toLowerCase();

  if (lower.includes('clash royale')) {
    const key = Deno.env.get('CLASH_ROYALE_API_KEY');
    if (!key) return null;
    const cached = omniCacheGet('supercell-cr', 'cards');
    if (cached) return cached;
    try {
      const res = await fetchWithTimeout('https://api.clashroyale.com/v1/cards', {
        headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' },
      }, timeoutMs);
      if (!res.ok) {
        console.warn(`[OMNI] Supercell CR returned ${res.status}`);
        return null;
      }
      const data = await res.json();
      const cards = data?.items || [];
      // Group by rarity — Supercell uses 'champion' for Heroes-tier cards
      const heroes = cards.filter((c: any) => /champion|hero/i.test(c.rarity || ''));
      const recent = cards.slice(-15); // last entries are usually newest

      // Surface notable single-card hits if user query implied them
      const notableNames = ['mini p.e.k.k.a', 'mini pekka', 'p.e.k.k.a', 'pekka', 'mega knight', 'electro giant'];
      const notable = cards.filter((c: any) =>
        notableNames.some(n => (c.name || '').toLowerCase().includes(n.replace(/\./g, '').toLowerCase()))
      );

      const text = `**OFFICIAL Supercell Clash Royale Card Roster** (live from api.clashroyale.com — CANONICAL DATA):\n\n` +
        `Total cards in roster: ${cards.length}\n` +
        (heroes.length > 0
          ? `**Heroes/Champion-tier cards** (the Heroes feature added in 2024 — these are real cards):\n${heroes.map((c: any) => `- **${c.name}** (rarity: ${c.rarity}, elixir: ${c.elixirCost ?? '?'}, id: ${c.id ?? '?'})`).join('\n')}\n\n`
          : `Champion/Hero tier cards: query did not return them in this slice — check the full /cards endpoint.\n\n`) +
        (notable.length > 0
          ? `**Notable cards relevant to query** (these EXIST per the live roster):\n${notable.map((c: any) => `- **${c.name}** (rarity: ${c.rarity}, elixir: ${c.elixirCost ?? '?'})`).join('\n')}\n\n`
          : '') +
        `**Most-recently-listed cards** (often newest from current season):\n` +
        recent.map((c: any) => `- **${c.name}** — rarity: ${c.rarity}, elixir: ${c.elixirCost ?? '?'}`).join('\n') +
        `\n\n⚠️ This data is CANONICAL. If a card or rarity appears in this list, it EXISTS in Clash Royale RIGHT NOW. Do NOT deny any card or feature confirmed by this block — even if your training data predates the Heroes update of 2024.`;
      const block: ScrapeBlock = { text, score: 10, source: 'supercell-api' };
      omniCacheSet('supercell-cr', 'cards', block);
      return block;
    } catch (e: any) {
      console.warn(`[OMNI] Supercell CR failed: ${e.message}`);
      return null;
    }
  }

  if (lower.includes('clash of clans')) {
    const key = Deno.env.get('CLASH_OF_CLANS_API_KEY');
    if (!key) return null;
    // Future: hit /troops or /spells endpoints
    return null;
  }

  if (lower.includes('brawl stars')) {
    const key = Deno.env.get('BRAWL_STARS_API_KEY');
    if (!key) return null;
    const cached = omniCacheGet('supercell-bs', 'brawlers');
    if (cached) return cached;
    try {
      const res = await fetchWithTimeout('https://api.brawlstars.com/v1/brawlers', {
        headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' },
      }, timeoutMs);
      if (!res.ok) return null;
      const data = await res.json();
      const brawlers = data?.items || [];
      const text = `**OFFICIAL Brawl Stars Brawler Roster** (live):\nTotal brawlers: ${brawlers.length}\n` +
        brawlers.slice(-10).map((b: any) => `- **${b.name}**`).join('\n');
      const block: ScrapeBlock = { text, score: 10, source: 'supercell-api' };
      omniCacheSet('supercell-bs', 'brawlers', block);
      return block;
    } catch (e: any) {
      console.warn(`[OMNI] Supercell BS failed: ${e.message}`);
      return null;
    }
  }

  return null;
}

// ─── Web Search as Omni source ────────────────────────────────────────────
async function fetchWebSearchForGame(game: string, prompt: string, timeoutMs = 3000): Promise<ScrapeBlock | null> {
  const cached = omniCacheGet('web-search-omni', game);
  if (cached) return cached;

  try {
    const { multiWebSearch } = await import('./webSearch.ts');
    const currentYear = new Date().getFullYear();
    const query = `${game} latest news update ${currentYear}`;
    const hits = await multiWebSearch(query, 6);
    if (hits.length === 0) return null;

    const formatted = hits.slice(0, 5).map((h, i) =>
      `[${i+1}] **${h.title}**\n  ${h.snippet}\n  🔗 ${h.url}`
    ).join('\n\n');

    const text = `Web search results for **${game}** (live from Google/Serper/SearXNG — ${new Date().toISOString().slice(0, 10)}):\n\n${formatted}`;
    const block: ScrapeBlock = { text, score: 7, source: 'web-search' };
    omniCacheSet('web-search-omni', game, block);
    return block;
  } catch (e: any) {
    console.warn(`[OMNI] web-search-omni failed for "${game}": ${e.message}`);
    return null;
  }
}

// ─── ORCHESTRATOR ──────────────────────────────────────────────────────────
async function omniScrape(game: string | null, _prompt: string, totalBudgetMs = 3000): Promise<ScrapeBlock[]> {
  if (!game) return [];
  console.log(`[OMNI] Starting omni-scrape for game="${game}" budget=${totalBudgetMs}ms`);

  const overallTimeout = new Promise<ScrapeBlock[]>(resolve =>
    setTimeout(() => {
      console.warn(`[OMNI] Overall budget ${totalBudgetMs}ms exceeded — returning partial results`);
      resolve([]);
    }, totalBudgetMs)
  );

  // Added fetchWebSearchForGame as a 6th source for comprehensive coverage
  const allFetches = Promise.allSettled([
    fetchSupercellAPI(game),
    fetchWikipedia(game),
    fetchSteamNews(game),
    fetchInvidious(game),
    fetchGamingRSS(game),
    fetchWebSearchForGame(game, _prompt),
  ]);

  const results = await Promise.race([
    allFetches.then(r => r.filter(x => x.status === 'fulfilled' && x.value).map((x: any) => x.value as ScrapeBlock)),
    overallTimeout,
  ]);

  console.log(`[OMNI] Returned ${results.length} blocks: ${results.map(b => `${b.source}(${b.score})`).join(', ')}`);
  return results;
}

// Sort by authority score desc, dedup by source, hard-cap total chars.
function rankAndCapContext(blocks: ScrapeBlock[], maxChars: number): ScrapeBlock[] {
  const seen = new Set<string>();
  const sorted = [...blocks].sort((a, b) => b.score - a.score);
  const out: ScrapeBlock[] = [];
  let total = 0;
  for (const b of sorted) {
    if (seen.has(b.source)) continue;
    seen.add(b.source);
    if (total + b.text.length > maxChars) {
      // Truncate to remaining budget if it's a high-score block; else skip
      const remaining = maxChars - total;
      if (remaining > 800 && b.score >= 7) {
        out.push({ ...b, text: b.text.slice(0, remaining - 50) + '\n…(truncated)' });
        total = maxChars;
      }
      continue;
    }
    out.push(b);
    total += b.text.length;
  }
  return out;
}

// ─── Vision Pass-1 game resolver ───────────────────────────────────────────
// Used ONLY when vision is active AND text didn't surface a known game.
async function resolveGameFromImage(geminiAi: any, attachments: any[]): Promise<string | null> {
  if (!attachments?.length) return null;
  const tinyPrompt = `Identify the video game from this screenshot. Reply ONLY with: "GAME: <name> | CONFIDENCE: high|medium|low". If unsure, GAME: unknown.`;

  // Try OpenRouter Gemini-Flash-Exp first (separate quota from native Gemini)
  const orProvider = PROVIDERS.find(p => p.name === 'OpenRouter');
  if (orProvider && Deno.env.get(orProvider.keyEnv)) {
    try {
      const messages = buildOpenAIMessages('You identify video games from screenshots.', [], tinyPrompt, attachments, true);
      const txt = await callOpenAICompat(orProvider, 'google/gemini-2.0-flash-exp:free', messages, {
        maxTokens: 60, temperature: 0.1,
      });
      const m = txt.match(/GAME:\s*([^|\n]+?)\s*\|\s*CONFIDENCE:\s*(high|medium|low)/i);
      if (m && m[1].trim().toLowerCase() !== 'unknown' && m[2].toLowerCase() !== 'low') {
        console.log(`[GAME-RESOLVER] OR/gemini-flash-exp → "${m[1].trim()}" (${m[2]})`);
        return m[1].trim().toLowerCase();
      }
    } catch (e: any) {
      console.warn(`[GAME-RESOLVER] OR pass-1 failed: ${e.message}`);
    }
  }

  // Fallback: native Gemini Flash
  if (geminiAi) {
    try {
      const contents = buildGeminiContents([], tinyPrompt, attachments);
      const result = await geminiAi.models.generateContent({
        model: 'gemini-2.0-flash',
        contents,
        config: { temperature: 0.1, maxOutputTokens: 60 },
      });
      const txt = result?.text || '';
      const m = txt.match(/GAME:\s*([^|\n]+?)\s*\|\s*CONFIDENCE:\s*(high|medium|low)/i);
      if (m && m[1].trim().toLowerCase() !== 'unknown' && m[2].toLowerCase() !== 'low') {
        console.log(`[GAME-RESOLVER] Gemini → "${m[1].trim()}" (${m[2]})`);
        return m[1].trim().toLowerCase();
      }
    } catch (e: any) {
      console.warn(`[GAME-RESOLVER] Gemini pass-1 failed: ${e.message}`);
    }
  }
  return null;
}

// Format ScrapeBlocks into the labelled context blocks the system prompt expects.
function omniBlocksToContextStrings(blocks: ScrapeBlock[]): string[] {
  const labels: Record<string, string> = {
    'supercell-api': '=== OFFICIAL API INTEL (canonical, current — overrides ALL training data) ===',
    'wikipedia': '=== WIKIPEDIA INTEL (live revision — usually fresher than Fandom for AAA games) ===',
    'steam-news': '=== STEAM NEWS INTEL (latest patches & dev posts from Steam) ===',
    'youtube': '=== YOUTUBE RECENT-UPLOADS INTEL (creators often cover patches before news sites) ===',
    'rss': '=== GAMING NEWS INTEL (IGN/Polygon/Eurogamer/PCGamer/GameSpot) ===',
    'web-search': '=== WEB SEARCH INTEL (live Google/Serper search results — FRESH DATA, trust this) ===',
  };
  const closeLabels: Record<string, string> = {
    'supercell-api': '=== END OFFICIAL API INTEL ===',
    'wikipedia': '=== END WIKIPEDIA INTEL ===',
    'steam-news': '=== END STEAM NEWS INTEL ===',
    'youtube': '=== END YOUTUBE INTEL ===',
    'rss': '=== END GAMING NEWS INTEL ===',
    'web-search': '=== END WEB SEARCH INTEL ===',
  };
  return blocks.map(b => {
    const open = labels[b.source] || `=== ${b.source.toUpperCase()} INTEL ===`;
    const close = closeLabels[b.source] || `=== END ${b.source.toUpperCase()} INTEL ===`;
    return `${open}\n${b.text}\n${close}`;
  });
}

async function runNeuralMesh(opts: {
  systemInstruction: string;
  chatHistory: any[];
  userPrompt: string;
  attachments: any[];
  geminiAi: any;
  profile: QueryProfile;
}): Promise<MeshResult> {
  const errors: string[] = [];

  // ═══════════════════════════════════════════════════════════════════════════
  //  STRATEGY:
  //  - VISION queries: try external vision-strong models FIRST (Llama 4
  //    Scout, Gemini Flash via OR, Mistral) because Gemini's free-tier
  //    vision rate-limits aggressively and these models match or beat it
  //    on HUD-heavy screenshots when given the GODMODE protocol. Gemini
  //    direct API stays as final safety net.
  //  - TEXT queries: Gemini first (always-available key), then externals.
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── VISION PATH — NATIVE GEMINI ONLY ──────────────────────────────────
  // Vision queries MUST use the official Google Gen AI SDK. Open-source
  // models (Groq Llama, Mistral, Cerebras) hallucinate badly on dense game
  // UIs — they pattern-match icons to the closest training-data prototype
  // instead of reading the actual pixels. Gemini 2.0 Flash / 1.5 Pro are
  // the only models trusted for vision. Skip the route loop entirely and
  // jump directly to the native Gemini block below.
  if (opts.profile.hasVision) {
    console.log('[VISION] Bypassing external mesh — going directly to native Gemini SDK');
    // Falls through to the native Gemini block below; nothing to do here.
  }

  // ── SPEED FAST-PATH: simple text queries → Groq Llama-3.1-8B-instant ───
  // Sub-500ms typical response. Only kicks in when:
  //   - Groq key configured
  //   - No vision attachments
  //   - profile.complexity === 'simple' (short queries, no multi-part Qs)
  //   - Not a deep intent (lore/build/comparison/troubleshoot get full mesh)
  const fastPathOK = !opts.profile.hasVision
    && opts.profile.complexity === 'simple'
    && Deno.env.get('GROQ_API_KEY')
    && !['lore', 'build', 'comparison', 'troubleshoot'].includes(opts.profile.intent);
  if (fastPathOK) {
    try {
      const groqProvider = PROVIDERS.find(p => p.name === 'Groq')!;
      const messages = buildOpenAIMessages(
        opts.systemInstruction,
        opts.chatHistory,
        opts.userPrompt,
        opts.attachments,
        false,
      );
      console.log('[MESH-FASTPATH] Groq → llama-3.1-8b-instant');
      const text = await callOpenAICompat(groqProvider, 'llama-3.1-8b-instant', messages, {
        maxTokens: 1800,
        temperature: 0.7,
      });
      console.log('[MESH-FASTPATH] ✓ Groq/llama-3.1-8b-instant');
      return { text, provider: 'Groq', model: 'llama-3.1-8b-instant' };
    } catch (e: any) {
      console.warn(`[MESH-FASTPATH] failed (${(e.message || '').slice(0, 100)}) — falling through to Gemini`);
    }
  }

  // ── PRIMARY PATH: Gemini (GOOGLE_API_KEY is always available) ──────────
  if (opts.geminiAi) {
    let contents = buildGeminiContents(opts.chatHistory, opts.userPrompt, opts.attachments);
    let mimeRetryUsed = false;
    for (const model of GEMINI_MODELS) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[MESH] Gemini → ${model} (attempt ${attempt})`);
          const result = await opts.geminiAi.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: opts.systemInstruction,
              // Vision queries: very low temperature (0.15) — refusal-oriented
              // GODMODE protocol does NOT tolerate creative padding.
              ...(opts.profile.hasVision
                ? { temperature: 0.15, maxOutputTokens: 3500 }
                : { temperature: 0.72, maxOutputTokens: 2400 }),
            },
          });
          if (result?.text) {
            console.log(`[MESH] ✓ Gemini/${model}`);
            return { text: result.text, provider: 'Gemini', model };
          }
          throw new Error('EMPTY_RESPONSE');
        } catch (e: any) {
          const msg = (e.message || '').toLowerCase();
          errors.push(`Gemini/${model}#${attempt}: ${msg.slice(0, 100)}`);
          console.warn(`[MESH] ✗ Gemini/${model} (try ${attempt}): ${msg.slice(0, 150)}`);

          // 404/not-found → skip to next model immediately
          if (msg.includes('404') || msg.includes('not found') || msg.includes('not supported')) break;

          // 400/invalid/unsupported on FIRST attempt + we have attachments → retry once
          // with all attachments re-flagged as image/jpeg (handles legacy MIME mismatches)
          if ((msg.includes('400') || msg.includes('invalid') || msg.includes('unsupported'))
              && attempt === 1
              && !mimeRetryUsed
              && opts.attachments?.length > 0) {
            mimeRetryUsed = true;
            console.log('[MESH] Retrying Gemini with attachments normalized to image/jpeg');
            contents = buildGeminiContents(opts.chatHistory, opts.userPrompt, normalizeAttachmentsToJpeg(opts.attachments));
            continue;
          }
          // Otherwise 400 → bad input, won't help retrying
          if (msg.includes('400') || msg.includes('invalid')) break;

          // 429/503 → wait with backoff then retry
          if (msg.includes('429') || msg.includes('503') || msg.includes('quota') ||
              msg.includes('rate') || msg.includes('overloaded') || msg.includes('unavailable')) {
            if (attempt < 3) {
              const delay = attempt * 2000; // 2s, 4s
              console.log(`[MESH] Gemini rate-limited, waiting ${delay}ms...`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
          }

          // Unknown error: 1 retry then move on
          if (attempt >= 2) break;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }

  // ── FALLBACK PATH: External OpenAI-compatible providers ─────────────────
  // For vision queries this is the Tier-2 vision fallback when native Gemini
  // fails. For text queries it's the standard external fallback chain.
  const route = optimizeRoute(opts.profile);
  const configuredRoute = route.filter(r => Deno.env.get(r.provider.keyEnv));
  if (configuredRoute.length > 0) {
    console.log(`[CORTEX] External route: ${configuredRoute.map(r => `${r.provider.name}/${r.modelId}`).slice(0, 4).join(' → ')}`);
  }

  const skippedProviders = new Set<string>();

  for (const { provider, modelId } of route) {
    if (skippedProviders.has(provider.name)) continue;
    // Skip providers without keys silently (no error logged)
    if (!Deno.env.get(provider.keyEnv)) {
      skippedProviders.add(provider.name);
      continue;
    }

    const modelMeta = provider.models.find(m => m.id === modelId)!;

    // Vision queries: only attempt models flagged vision: true.
    if (opts.profile.hasVision && !modelMeta.vision) continue;

    const messages = buildOpenAIMessages(
      opts.systemInstruction,
      opts.chatHistory,
      opts.userPrompt,
      opts.attachments,
      modelMeta.vision,
    );

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[MESH] ${provider.name} → ${modelId} (attempt ${attempt})`);
        const text = await callOpenAICompat(provider, modelId, messages);
        console.log(`[MESH] ✓ ${provider.name}/${modelId}`);
        return { text, provider: provider.name, model: modelId };
      } catch (err: any) {
        const msg = err.message || String(err);
        errors.push(`${provider.name}/${modelId}#${attempt}: ${msg.slice(0, 120)}`);
        console.warn(`[MESH] ✗ ${provider.name}/${modelId} (try ${attempt}): ${msg.slice(0, 200)}`);

        if (isProviderFatal(msg)) {
          skippedProviders.add(provider.name);
          break;
        }

        if (!isRetryable(msg)) break;

        if (attempt < 2) await new Promise(r => setTimeout(r, 800 * attempt));
      }
    }
  }

  console.error('[MESH] ALL PROVIDERS FAILED:', errors);
  throw new Error(`MESH_EXHAUSTED:${errors.join(' | ')}`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  RESPONSE QUALITY GATE — repairs malformed AI output
// ═══════════════════════════════════════════════════════════════════════════

function ensureFollowUps(text: string, profile: QueryProfile): string {
  if (text.includes('[?]')) return text;
  // Auto-append generic follow-ups so the FollowUpChips parser always finds something
  const game = profile.game ? profile.game : 'this game';
  const follows: Record<Intent, string[]> = {
    troubleshoot: [
      `[?] What are the most common ${game} crashes and their fixes?`,
      `[?] How do I check if my hardware meets ${game}'s requirements?`,
    ],
    build: [
      `[?] What's the strongest build for late-game in ${game}?`,
      `[?] How do I farm the items for this build efficiently?`,
    ],
    lore: [
      `[?] What are the biggest fan theories about ${game}?`,
      `[?] What's the canonical ending of ${game}?`,
    ],
    speedrun: [
      `[?] What's the easiest skip for a beginner speedrunner of ${game}?`,
      `[?] Which category of ${game} has the most active competition?`,
    ],
    meta: [
      `[?] What's expected to change in the next ${game} patch?`,
      `[?] Which underrated picks are climbing the ${game} tier list?`,
    ],
    review: [
      `[?] What other games should I play if I love ${game}?`,
      `[?] Is ${game}'s DLC worth it?`,
    ],
    comparison: [
      `[?] Which option scales better in the late game?`,
      `[?] What's the community consensus on this comparison?`,
    ],
    general: [
      `[?] What are the must-know tips for ${game} beginners?`,
      `[?] What's the most underrated feature of ${game}?`,
    ],
  };
  const chosen = follows[profile.intent] || follows.general;
  return text.trim() + '\n\n' + chosen.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // ── Health check route ─────────────────────────────────────────────────
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname.endsWith('/health')) {
    const status = {
      cortex: 'v4.2-vision-refusal',
      providers: PROVIDERS.map(p => ({
        name: p.name,
        configured: !!Deno.env.get(p.keyEnv),
        models: p.models.length,
      })),
      gemini: !!Deno.env.get('GOOGLE_API_KEY'),
      omniscience: {
        wikipedia: 'unauth (always on)',
        steamNews: 'unauth (always on)',
        invidious: 'unauth (rotates instances)',
        gamingRSS: 'unauth (always on)',
        webSearch: 'multi-source (always on)',
        googleCSE: !!Deno.env.get('GOOGLE_CSE_ID') ? 'configured' : 'not configured (using free fallbacks)',
        serper: !!Deno.env.get('SERPER_API_KEY') ? 'configured' : 'not configured (using free fallbacks)',
        brave: !!Deno.env.get('BRAVE_SEARCH_API_KEY') ? 'configured' : 'not configured',
        supercellClashRoyale: !!Deno.env.get('CLASH_ROYALE_API_KEY'),
        supercellClashOfClans: !!Deno.env.get('CLASH_OF_CLANS_API_KEY'),
        supercellBrawlStars: !!Deno.env.get('BRAWL_STARS_API_KEY'),
      },
      cacheSize: responseCache.size,
      omniCacheSize: omniCache.size,
      steamGamesIndexed: Object.keys(STEAM_APPIDS).length,
      timestamp: new Date().toISOString(),
    };
    return new Response(JSON.stringify(status, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Omniscience probe: GET /omni-test?game=<name> for diagnostics ─────
  if (req.method === 'GET' && url.pathname.endsWith('/omni-test')) {
    const game = url.searchParams.get('game') || 'clash royale';
    const blocks = await omniScrape(game, '', 5000);
    return new Response(JSON.stringify({
      game,
      blocksReturned: blocks.length,
      sources: blocks.map(b => ({ source: b.source, score: b.score, length: b.text.length, preview: b.text.slice(0, 200) })),
    }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const startTime = Date.now();

  try {
    const { prompt, chatHistory = [], redditContext = '', wikiContext = '', priceContext = '', attachments = [] } = await req.json();

    // Server-side attachment validation: reject malformed payloads, cap to 3,
    // restrict to common image MIME types. Downstream code uses cleanAttachments.
    const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const cleanAttachments = (Array.isArray(attachments) ? attachments : [])
      .filter(a => a && typeof a.data === 'string' && a.data.length > 100 && ALLOWED_MIME.has(a.mimeType))
      .slice(0, 3);

    pruneCache();

    const geminiKey = Deno.env.get('GOOGLE_API_KEY');
    const geminiAi = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null;

    // ── Image generation path (Gemini-only) ──
    if (shouldGenerateImage(prompt) && geminiAi) {
      const imgRes = await generateImageWithRetry(geminiAi, prompt);
      if (imgRes) {
        return new Response(JSON.stringify({
          ...imgRes,
          _meta: { provider: 'Gemini', model: 'image-gen', persona: 'Critic', intent: 'image', latencyMs: Date.now() - startTime },
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── LAYER 1: QUERY CORTEX ──────────────────────────────────────────
    const profile = classifyQuery(prompt, cleanAttachments, chatHistory);
    console.log(`[CORTEX] intent=${profile.intent} game=${profile.game || 'none'} complexity=${profile.complexity} persona=${profile.persona.name}`);

    // ── SPEED: cache check FIRST (saves 2.5s omni-scrape + LLM call on hit) ──
    // We hash on the inputs we already have: the user's prompt + any client-
    // provided contexts + last 2 messages of history + attachment fingerprints.
    // If hit, return immediately — skip omni-scrape AND the mesh.
    const earlyCacheKey = await cacheKey(prompt, chatHistory, redditContext, wikiContext, priceContext, cleanAttachments);
    const earlyCached = responseCache.get(earlyCacheKey);
    if (earlyCached && (Date.now() - earlyCached.ts) < CACHE_TTL_MS) {
      console.log(`[CACHE-EARLY] HIT ${earlyCacheKey} (${earlyCached.provider}/${earlyCached.model}) — skipping scrape + mesh`);
      return new Response(JSON.stringify({
        text: earlyCached.text,
        images: [],
        _meta: {
          persona: earlyCached.persona,
          intent: profile.intent,
          game: profile.game,
          cached: true,
          latencyMs: Date.now() - startTime,
          cortex: 'v4.2-vision-refusal',
        },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── STAGE 1: GAME RESOLVER ──────────────────────────────────────────
    // For vision queries with no text-identified game, run a fast Pass-1
    // call to identify the game from the image. This unlocks omni-scraping
    // for cases like "which card is this?" where the user provides no name.
    let resolvedGame: string | null = profile.game;
    if (profile.hasVision && !resolvedGame) {
      resolvedGame = await resolveGameFromImage(geminiAi, cleanAttachments);
      if (resolvedGame) {
        console.log(`[CORTEX] Game resolved from image: ${resolvedGame}`);
        // Update profile so downstream HUD knowledge picks the right game
        profile.game = resolvedGame;
      }
    }

    // ── STAGE 1.5: PROJECT PULSE (live web fusion on EVERY real query) ──
    // Fires on every non-chitchat prompt regardless of whether the user used
    // explicit temporal words ("latest", "new", "current"). The query formulation
    // adapts based on temporal signal but the search ALWAYS runs so the model
    // gets fresh facts to fuse with its training-side reasoning.
    const todayISO = new Date().toISOString().slice(0, 10);
    const pulse = await runPulse(prompt, resolvedGame, todayISO);
    if (pulse.fired) {
      console.log(`[PULSE] fired (${pulse.diagnostics.mode}) — sources=${pulse.sourcesUsed.join(',')} blocks=${pulse.diagnostics.blocksUsed}/${pulse.diagnostics.blocksFound}`);
    }

    // ── STAGE 2: OMNI-SCRAPER (server-side, parallel, 1.6s budget) ─────
    // Tightened from 2.5s → 1.6s for speed. Most sources resolve in <1s.
    // VISION queries ALWAYS get omni context — even "simple" classification —
    // so screenshots can be linked to live news/patches/Heroes-update content
    // (e.g. "this is the new Mini P.E.K.K.A Hero from the Oct 2024 update").
    // Text queries skip the scrape on simple chitchat for speed.
    // ALWAYS scrape when a game is detected — even for "simple" queries.
    // The user's screenshot comparison proves that simple questions like
    // "which is the newest hero" need live data. Complexity doesn't matter;
    // what matters is whether a game is involved.
    const shouldScrape = !!resolvedGame;
    const omniBlocks = shouldScrape ? await omniScrape(resolvedGame, prompt, 3000) : [];
    const rankedOmni = rankAndCapContext(omniBlocks, 6000);
    const omniContextStrings = omniBlocksToContextStrings(rankedOmni);

    // ── Build augmented prompt with all live context blocks + game card ──
    const contextBlocks: string[] = [];
    if (resolvedGame) {
      contextBlocks.push(
        `=== USER CONTEXT CARD ===\nDetected game: **${resolvedGame}**\nDetected intent: **${profile.intent}** (${profile.persona.emoji} ${profile.persona.name} mode)\nUse this to focus your answer specifically on this game and intent.\n=== END USER CONTEXT ===`
      );
    }
    // OMNI blocks first — they have highest authority (Official API > Wikipedia > Steam News > YouTube > RSS)
    contextBlocks.push(...omniContextStrings);

    if (wikiContext) {
      contextBlocks.push(
        `=== GAME WIKI INTEL (Fandom — depth lookup, treat as authoritative for lore/mechanics) ===\n${wikiContext}\n=== END GAME WIKI INTEL ===`
      );
    }
    if (redditContext) {
      contextBlocks.push(
        `=== REDDIT COMMUNITY INTEL (Live threads scraped right now — PRIORITISE for community sentiment, meta) ===\n${redditContext}\n=== END REDDIT COMMUNITY INTEL ===`
      );
    }
    if (priceContext) {
      contextBlocks.push(
        `=== LIVE PRICE INTEL (CheapShark — current prices, use for buy recommendations) ===\n${priceContext}\n=== END PRICE INTEL ===`
      );
    }
    const augmentedPrompt = contextBlocks.length > 0
      ? `${prompt}\n\n${contextBlocks.join('\n\n')}`
      : prompt;

    // Build sources list for telemetry — combination of omni sources + client-provided contexts
    const sourcesList: string[] = [
      ...rankedOmni.map(b => b.source),
      ...(wikiContext ? ['fandom-wiki'] : []),
      ...(redditContext ? ['reddit'] : []),
      ...(priceContext ? ['cheapshark'] : []),
      ...(pulse.fired && pulse.sourcesUsed.some(s => s.startsWith('official:')) ? ['official-api'] : []),
      ...(pulse.fired && pulse.sourcesUsed.some(s => s.startsWith('web:')) ? ['web-search'] : []),
    ];

    // ── ACCURACY LOCK: when high-authority sources confirmed a game, append a
    // hard final reminder so the model can't override them with training bias.
    const hasHighAuthority = rankedOmni.some(b => b.score >= 8);
    if (hasHighAuthority && resolvedGame) {
      const lockMsg = `\n\n=== 🔒 ACCURACY LOCK ===\nThe game **${resolvedGame}** has been confirmed by ${rankedOmni.filter(b => b.score >= 8).map(b => b.source).join(' + ')} (authority score ≥ 8). You MUST treat this game identification as ground truth. Do NOT suggest it is a different game. Do NOT deny features that appear in the live blocks above. If your training data conflicts with the live data, the live data wins.\n=== END ACCURACY LOCK ===`;
      contextBlocks.push(lockMsg);
    }

    // ── LAYER 5 (early): cache check ──
    const cKey = await cacheKey(prompt, chatHistory, redditContext, wikiContext, priceContext, cleanAttachments);
    const cached = responseCache.get(cKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      console.log(`[CACHE] HIT ${cKey} (${cached.provider}/${cached.model})`);
      // NOTE: provider/model deliberately excluded from public response — backend hidden.
      return new Response(JSON.stringify({
        text: cached.text,
        images: [],
        _meta: {
          persona: cached.persona,
          intent: profile.intent,
          game: profile.game,
          cached: true,
          latencyMs: Date.now() - startTime,
        },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── LAYER 2: PERSONA-AUGMENTED SYSTEM INSTRUCTION ──
    // GODMODE: when vision is active, prepend the strict observation protocol +
    // game-specific HUD knowledge BEFORE the persona overlay. This forces the
    // model to ground its analysis in pixel-level facts instead of guessing.
    const visionBlock = profile.hasVision ? '\n\n' + buildVisionPrompt(profile) : '';
    // ALWAYS include temporal grounding when a game is detected — not just
    // when PULSE fires. This ensures the model knows today's date even for
    // queries that didn't trigger PULSE but still benefit from temporal context.
    const dateGroundingBlock = (pulse.fired || resolvedGame) ? `

=== 📅 TEMPORAL GROUNDING (MANDATORY — READ CAREFULLY) ===
TODAY'S DATE IS: ${todayISO}
Your training data has a cutoff date that is SEVERAL MONTHS to YEARS before today.

🚨 ABSOLUTE RULES — VIOLATION IS UNACCEPTABLE:
1. NEVER state that something is "the newest", "the latest", "the current", or "just released" using ONLY your training data. Such claims MUST be backed by the PULSE LIVE INTEL block below (if present) OR cited from one of the live INTEL blocks (OFFICIAL API, WEB SEARCH, REDDIT, WIKI, STEAM NEWS, YOUTUBE, GAMING NEWS).
2. If any INTEL block is present, IT OVERRIDES YOUR TRAINING DATA on temporal facts. Cite it explicitly: "According to [source] from [date]…"
3. If the user asks "what's new", "which is the newest", "what's releasing", "current season", etc. and you have NO live INTEL data on the topic, you MUST reply: "I don't have verified live data on this right now — my training cut off before today (${todayISO}). The most recent thing I know of from training is [X], but please double-check the official source for anything newer."
4. NEVER invent release dates, season numbers, or hero/card names for current content. If unsure, say "I'm not sure — verify on the official source."
5. If your training says "X is the newest" but live data says "Y is the newest", YOUR ANSWER MUST SAY Y. Your training is outdated. The live data was fetched SECONDS ago.
6. Live-service games change EVERY MONTH. Heroes, cards, characters, maps, operators, patches — these are added constantly. NEVER assume your training-era knowledge is still accurate.
=== END TEMPORAL GROUNDING ===
` : '';
    const systemInstruction = BASE_SYSTEM + dateGroundingBlock + visionBlock + pulse.contextBlock + (profile.persona.overlay || '');

    // ── LAYER 3 + 4: route + run mesh ──
    const result = await runNeuralMesh({
      systemInstruction,
      chatHistory,
      userPrompt: augmentedPrompt,
      attachments: cleanAttachments,
      geminiAi,
      profile,
    });

    // ── LAYER 4.5 (vision-only): SECOND-OPINION HOP ─────────────────────
    // If the first vision response expressed material uncertainty AND the
    // user's question is identification-critical, run a second vision
    // model and present the merged perspective. Cost: +1 call only when
    // the first one was uncertain (i.e. we're already paying with bad UX
    // if we don't).
    let finalText = result.text;
    let secondOpinionUsed = false;
    if (profile.hasVision) {
      const isIdentificationQuery = /\b(what|which|who|name|identify) (is|game|card|character|class|item|hero|champion|operator|weapon|location|boss|mob)\b/i.test(prompt);
      const expressedUncertainty = /\b(unclear|cannot determine|not legible|appears to be|i'?m not sure|hard to tell)\b/i.test(result.text);
      if (isIdentificationQuery && expressedUncertainty) {
        try {
          console.log('[VISION-2OP] First answer was uncertain on an ID query — fetching second opinion');
          const route = optimizeRoute(profile);
          console.log('[VISION-2OP] route candidates:', route.map(r => r.modelId));
          const second = route.find(r => r.modelId !== result.model && r.provider.name);
          if (second && Deno.env.get(second.provider.keyEnv)) {
            const messages = buildOpenAIMessages(systemInstruction, chatHistory, augmentedPrompt, cleanAttachments, true);
            const altText = await callOpenAICompat(second.provider, second.modelId, messages, {
              maxTokens: 2000, temperature: 0.15,
            });
            // Merge — show original + second opinion as a labeled compare
            finalText = `${result.text}\n\n---\n\n## 🔁 Second Opinion (cross-check)\n\n${altText}\n\n*If the two answers agree on the key facts, treat them as confirmed. If they disagree, the disagreeing parts are uncertain — verify in-game.*`;
            secondOpinionUsed = true;
            console.log('[VISION-2OP] ✓ second opinion injected');
          }
        } catch (e: any) {
          console.warn('[VISION-2OP] failed (will not block response):', e.message);
        }
      }

      // Post-process: scrub the most common uncertainty-then-claim hallucination
      // pattern. e.g. "the hearts appear to be 5" → "(uncertain — verify in-game)"
      finalText = finalText.replace(
        /\b(appears? to (?:be|have)|hard to tell but|seems? like|might be|i think (?:there are|it'?s|it has))\s+(\d+|several|many|a few)\b/gi,
        '(uncertain — verify in-game)'
      );
    }

    // ── LAYER 5: quality gate ──
    const polishedText = ensureFollowUps(finalText, profile);

    responseCache.set(cKey, {
      text: polishedText,
      provider: result.provider,
      model: result.model,
      persona: profile.persona.name,
      ts: Date.now(),
    });

    // NOTE: provider/model deliberately excluded from public response — backend hidden.
    // Server logs still record them via runNeuralMesh's [MESH] ✓ entries.
    return new Response(JSON.stringify({
      text: polishedText,
      images: [],
      _meta: {
        persona: profile.persona.name,
        personaEmoji: profile.persona.emoji,
        intent: profile.intent,
        game: profile.game,
        complexity: profile.complexity,
        vision: profile.hasVision,
        visionMeta: profile.hasVision ? {
          attachmentCount: cleanAttachments.length,
          provider: result.provider,
          model: result.model,
          secondOpinion: secondOpinionUsed,
          gameResolved: !!resolvedGame,
        } : undefined,
        secondOpinion: secondOpinionUsed,
        cached: false,
        latencyMs: Date.now() - startTime,
        cortex: 'v4.2-vision-refusal',
        sources: sourcesList,
        gameResolved: resolvedGame !== profile.game ? false : !!resolvedGame,
        pulse: pulse.fired ? {
          sourcesUsed: pulse.sourcesUsed,
          blocksUsed: pulse.diagnostics.blocksUsed,
          query: pulse.diagnostics.query,
        } : undefined,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[FATAL]', error);

    const raw = (error.message || '').toLowerCase();
    let friendly: string;

    if (raw.includes('mesh_exhausted')) {
      friendly = "All AI providers are temporarily overloaded. The neural mesh tried multiple backups. Please try again in 30 seconds.";
    } else if (raw.includes('not found') || raw.includes('404') || raw.includes('not supported')) {
      friendly = "The AI model is temporarily unavailable. Our system already tried fallback models. Please try again in 30 seconds.";
    } else if (raw.includes('503') || raw.includes('demand') || raw.includes('unavailable')) {
      friendly = "The AI is under heavy load right now. This is temporary — please try again in a moment!";
    } else if (raw.includes('429') || raw.includes('quota') || raw.includes('rate limit')) {
      friendly = "API rate limit reached. Please wait 15–30 seconds before your next message.";
    } else if (raw.includes('400') || raw.includes('bad request')) {
      friendly = "Your request couldn't be processed (possibly an unsupported attachment type). Try sending text only.";
    } else if (raw.includes('api key') || raw.includes('authentication') || raw.includes('401')) {
      friendly = "Server authentication error. Please contact support.";
    } else {
      friendly = "An unexpected error occurred. Please try again.";
    }

    return new Response(JSON.stringify({
      text: `**Neural Net Disconnected:** ${friendly}`,
      images: [],
      _meta: { error: true },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});
