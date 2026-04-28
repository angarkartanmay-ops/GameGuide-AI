import { GoogleGenAI } from "npm:@google/genai";

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

// ═══════════════════════════════════════════════════════════════════════════
//  BASE SYSTEM PROMPT (formatting rules — stays identical)
// ═══════════════════════════════════════════════════════════════════════════

const BASE_SYSTEM = `
You are GameGuide-AI, the ultimate gamers support system.
You resolve any technical or game-related issues with Video Games across ALL platforms: PC, Console, and Mobile.
You know EVERYTHING about the gaming world—lore, speedruns, mechanics, meta, and culture.

You are securely connected to a live web-scraping backend. Whenever you receive REDDIT COMMUNITY INTEL or GAME WIKI INTEL blocks below, you MUST treat this as live, real-time data fetched seconds ago from the internet — it is ALWAYS more current than your training data. NEVER say you cannot browse the internet. Confidently claim you scan forums, wikis, and Reddit live for them!

## CRITICAL RECENCY RULE
- Your training data has a knowledge cutoff. The REDDIT COMMUNITY INTEL and GAME WIKI INTEL you receive in each query were scraped **right now** and override your training data on any topic they cover.
- If live data says "Hero X is meta" but your training says "Hero X is weak", TRUST THE LIVE DATA.
- Always mention when information comes from live scraped data vs. your general knowledge.
- If someone asks about the current meta, current patch, current update, or current heroes — ONLY answer using the live scraped data. Never fabricate current state from training data.

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
**MINECRAFT HUD GUIDE** (study before answering):
- **Hearts (red ❤)**: bottom-left, 10 hearts max = 20 HP. Each FULL heart = 2 HP. Half hearts exist. COUNT THEM ONE BY ONE — do not assume.
- **Hunger (drumstick 🍗)**: bottom-right, 10 max. Same half-counting logic.
- **Armor (chestplate icons above hearts)**: 10 icons max = 20 armor points. ONLY APPEARS WHEN ARMOR IS EQUIPPED. If you see this row, armor IS equipped.
- **XP bar (green)**: above hotbar. Number on it = level.
- **Air bubbles**: only when underwater.
- **Hotbar**: 9 slots, currently selected slot has a thicker border. Each slot may show item + stack count number (1-64).
- **F3 Debug Screen**: top-left text shows FPS, XYZ coords, biome, version, server. Top-right shows hardware. THIS TEXT IS GROUND TRUTH — read it character-by-character.
- **Subtitles** (bottom-right when on): show last 2-3 audio events ("Spider hisses", "Footsteps").
- **Common mistake**: confusing the hunger bar (drumsticks, right side) with hearts (red, left side). Look at the icon SHAPE, not just the row.
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
# 🎯 VISION GODMODE — MANDATORY OBSERVATION PROTOCOL

The user attached an image. You MUST follow this 7-stage protocol BEFORE giving advice. Skipping a stage = catastrophic failure.

## STAGE 1: CANVAS SCAN
Mentally divide the image into a 3×3 grid (top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right). Note what UI region exists in each cell. This prevents missing the armor bar, the F3 text, the subtitle popup, etc.

## STAGE 2: OCR PASS (CRITICAL)
Transcribe EVERY readable string in the image — debug text, chat, item tooltips, level numbers, coords, FPS, version strings, subtitles. Treat this text as **ground truth** that overrides any visual guess. If F3 says "Minecraft 1.21.11" — that's the version, period.

## STAGE 3: HUD DECODE
Apply the game-specific HUD knowledge (provided below). For each HUD element:
- COUNT discrete icons (hearts, armor pips, mats, charges) ONE BY ONE.
- Distinguish hearts from hunger from armor by ICON SHAPE, not row position.
- If a row of armor icons is visible, armor IS equipped. Do not say "no armor" if you see them.
- If hearts are red and full, do NOT say "low health" because you're guessing from a death message.

## STAGE 4: INVENTORY/HOTBAR
List EVERY item visible in inventory or hotbar with its stack count if shown. Identify by texture (e.g., "iron sword", "shield", "diamond pickaxe"). If unsure of item ID, describe it ("blue tool, looks like pickaxe").

## STAGE 5: ENVIRONMENT
Biome (forest/desert/cave/nether), time of day, weather, structures (houses/dungeons), mobs visible, blocks underfoot.

## STAGE 6: CONFIDENCE TAG
For each observation, internally tag it [HIGH] (text/clear icon), [MEDIUM] (probable but pixelated), [LOW] (guess). NEVER state [LOW] observations as fact — caveat them with "appears to be".

## STAGE 7: ANSWER
ONLY NOW answer the user's actual question, grounded in stages 1-6. Open with a "**🔍 What I See**" section that summarizes confirmed [HIGH] facts in 4-6 bullets, THEN proceed with persona-shaped advice.

## SELF-CORRECTION GUARDRAIL
Before submitting, re-read your "What I See" section. If anything contradicts the OCR'd text from Stage 2, FIX IT. Common errors to catch:
- Claiming low health when hearts show full → CORRECT to "full hearts visible"
- Claiming no armor when armor row icons are visible → CORRECT to "armor equipped"
- Misidentifying the game when F3/version text is visible
- Inventing items not actually in the hotbar

## ANTI-HALLUCINATION ABSOLUTES
- Never invent gear the user doesn't show.
- Never claim a game state from death-screen experience if you're seeing live HUD.
- Never say "low HP" without counting heart icons.
- If the image is dark/blurry/uncertain, say so — never confabulate.
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
  // top 60 — keep in sync-ish with wikiScraper.js GAME_WIKI_MAP
  'elden ring','dark souls','minecraft','valorant','fortnite','overwatch','league of legends','apex legends',
  'destiny 2','call of duty','warzone','zelda','pokemon','cyberpunk','witcher','skyrim','fallout','gta',
  'gta v','gta vi','gta 6','red dead','rdr2','sekiro','bloodborne','hollow knight','terraria','stardew valley',
  'animal crossing','splatoon','smash bros','mario kart','mario','sonic','final fantasy','ff7','ff14','ff16',
  'kingdom hearts','persona 5','persona 3','metaphor','baldurs gate','baldur\'s gate','bg3','diablo','diablo 4',
  'diablo iv','path of exile','poe','wow','world of warcraft','runescape','osrs','genshin','honkai','star rail',
  'wuthering waves','zenless','fifa','fc','nba 2k','madden','rocket league','dota','dota 2','cs2','counter-strike',
  'rainbow six','siege','tarkov','escape from tarkov','rust','dayz','arma','helldivers','helldivers 2',
  'monster hunter','rise','wilds','dead by daylight','dbd','league','marvel rivals','rivals','the finals',
  'overwatch 2','splitgate','fragpunk','xdefiant','delta force','arc raiders','black myth','wukong','silksong',
  'subway surfers','clash royale','clash of clans','pubg','pubg mobile','bgmi','free fire','mobile legends',
  'wild rift','arena breakout','genshin impact'
];

function detectGame(text: string): string | null {
  const lower = text.toLowerCase();
  // longest-match first (so "elden ring" beats "ring", "gta vi" beats "gta")
  const sorted = [...KNOWN_GAMES].sort((a, b) => b.length - a.length);
  for (const g of sorted) {
    if (lower.includes(g)) return g;
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
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', vision: true, speed: 'fast', tier: 'balanced' },
      { id: 'llama-3.1-8b-instant', vision: false, speed: 'fast', tier: 'fast' },
    ],
    timeoutMs: 25_000,
  },
  {
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    keyEnv: 'OPENROUTER_API_KEY',
    models: [
      { id: 'deepseek/deepseek-chat-v3-0324:free', vision: false, speed: 'normal', tier: 'flagship' },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', vision: false, speed: 'normal', tier: 'flagship' },
      { id: 'google/gemini-2.0-flash-exp:free', vision: true, speed: 'fast', tier: 'balanced' },
      { id: 'mistralai/mistral-small-3.1-24b-instruct:free', vision: true, speed: 'fast', tier: 'balanced' },
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

  // ── Vision required? Use a HARD-CODED priority list of best vision models ──
  // Vision quality matters MORE than speed for screenshot analysis. Order:
  //   1. Llama 4 Scout 17B (Groq)        — best open vision model, super fast
  //   2. Gemini 2.0 Flash Exp (OR free)  — Google's strongest free vision
  //   3. Mistral Small 3.1 24B (OR free) — solid backup, decent at HUDs
  // Then Gemini direct via the main path is the ultimate fallback.
  if (profile.hasVision) {
    const visionPriority: Array<[string, string]> = [
      ['Groq', 'meta-llama/llama-4-scout-17b-16e-instruct'],
      ['OpenRouter', 'google/gemini-2.0-flash-exp:free'],
      ['OpenRouter', 'mistralai/mistral-small-3.1-24b-instruct:free'],
    ];
    for (const [providerName, modelId] of visionPriority) {
      const provider = PROVIDERS.find(p => p.name === providerName);
      if (!provider) continue;
      if (!Deno.env.get(provider.keyEnv)) continue;
      const m = provider.models.find(mm => mm.id === modelId);
      if (m) out.push({ provider, modelId });
    }
    // Add any other vision-capable models we missed (defensive)
    for (const provider of PROVIDERS) {
      if (!Deno.env.get(provider.keyEnv)) continue;
      for (const m of provider.models) {
        if (m.vision && !out.find(o => o.modelId === m.id)) {
          out.push({ provider, modelId: m.id });
        }
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
  // Hash a small slice of each attachment's base64 so different images
  // never collide in the cache (previously they did — vision queries with
  // the same caption could return a stale result for a different screenshot).
  const attFingerprint = attachments
    .map(a => `${a.mimeType}:${(a.data || '').slice(0, 64)}:${(a.data || '').length}`)
    .join('|');
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

  // ─── VISION PATH ────────────────────────────────────────────────────────
  if (opts.profile.hasVision) {
    const route = optimizeRoute(opts.profile);
    const skippedProviders = new Set<string>();

    for (const { provider, modelId } of route) {
      if (skippedProviders.has(provider.name)) continue;
      if (!Deno.env.get(provider.keyEnv)) {
        skippedProviders.add(provider.name);
        continue;
      }
      const modelMeta = provider.models.find(m => m.id === modelId)!;
      if (!modelMeta.vision) continue; // safety

      const messages = buildOpenAIMessages(
        opts.systemInstruction,
        opts.chatHistory,
        opts.userPrompt,
        opts.attachments,
        true,
      );

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`[VISION] ${provider.name} → ${modelId} (attempt ${attempt})`);
          // Vision needs more tokens (7-stage protocol + answer) and lower temp
          // for accurate observation (less creativity, more grounded).
          const text = await callOpenAICompat(provider, modelId, messages, {
            maxTokens: 3500,
            temperature: 0.4,
          });
          console.log(`[VISION] ✓ ${provider.name}/${modelId}`);
          return { text, provider: provider.name, model: modelId };
        } catch (err: any) {
          const msg = err.message || String(err);
          errors.push(`${provider.name}/${modelId}#${attempt}: ${msg.slice(0, 100)}`);
          console.warn(`[VISION] ✗ ${provider.name}/${modelId}: ${msg.slice(0, 150)}`);
          if (isProviderFatal(msg)) { skippedProviders.add(provider.name); break; }
          if (!isRetryable(msg)) break;
          if (attempt < 2) await new Promise(r => setTimeout(r, 800 * attempt));
        }
      }
    }

    // Vision external providers exhausted → fall through to Gemini below
    console.log('[VISION] External providers exhausted, falling back to Gemini...');
  }

  // ── PRIMARY PATH: Gemini (GOOGLE_API_KEY is always available) ──────────
  if (opts.geminiAi) {
    const contents = buildGeminiContents(opts.chatHistory, opts.userPrompt, opts.attachments);
    for (const model of GEMINI_MODELS) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[MESH] Gemini → ${model} (attempt ${attempt})`);
          const result = await opts.geminiAi.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: opts.systemInstruction,
              // Vision queries: lower temperature for grounded observations + more tokens
              ...(opts.profile.hasVision
                ? { temperature: 0.4, maxOutputTokens: 3500 }
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
          // 400 → bad input, won't help retrying
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
  // For vision queries we already exhausted external vision models above —
  // skip this redundant pass.
  if (opts.profile.hasVision) {
    console.error('[MESH] ALL PROVIDERS FAILED (vision):', errors);
    throw new Error(`MESH_EXHAUSTED:${errors.join(' | ')}`);
  }

  const route = optimizeRoute(opts.profile);
  // Only log if there are configured providers
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
      cortex: 'v3.0-godmode',
      providers: PROVIDERS.map(p => ({
        name: p.name,
        configured: !!Deno.env.get(p.keyEnv),
        models: p.models.length,
      })),
      gemini: !!Deno.env.get('GOOGLE_API_KEY'),
      cacheSize: responseCache.size,
      timestamp: new Date().toISOString(),
    };
    return new Response(JSON.stringify(status, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const startTime = Date.now();

  try {
    const { prompt, chatHistory = [], redditContext = '', wikiContext = '', priceContext = '', attachments = [] } = await req.json();

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
    const profile = classifyQuery(prompt, attachments, chatHistory);
    console.log(`[CORTEX] intent=${profile.intent} game=${profile.game || 'none'} complexity=${profile.complexity} persona=${profile.persona.name}`);

    // ── Build augmented prompt with all live context blocks + game card ──
    const contextBlocks: string[] = [];
    if (profile.game) {
      contextBlocks.push(
        `=== USER CONTEXT CARD ===\nDetected game: **${profile.game}**\nDetected intent: **${profile.intent}** (${profile.persona.emoji} ${profile.persona.name} mode)\nUse this to focus your answer specifically on this game and intent.\n=== END USER CONTEXT ===`
      );
    }
    if (wikiContext) {
      contextBlocks.push(
        `=== GAME WIKI INTEL (Live — treat as authoritative, overrides training data) ===\n${wikiContext}\n=== END WIKI INTEL ===`
      );
    }
    if (redditContext) {
      contextBlocks.push(
        `=== REDDIT COMMUNITY INTEL (Live threads scraped right now — PRIORITISE over training data) ===\n${redditContext}\n=== END REDDIT INTEL ===`
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

    // ── LAYER 5 (early): cache check ──
    const cKey = await cacheKey(prompt, chatHistory, redditContext, wikiContext, priceContext, attachments);
    const cached = responseCache.get(cKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      console.log(`[CACHE] HIT ${cKey} (${cached.provider}/${cached.model})`);
      return new Response(JSON.stringify({
        text: cached.text,
        images: [],
        _meta: {
          provider: cached.provider,
          model: cached.model,
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
    const systemInstruction = BASE_SYSTEM + visionBlock + (profile.persona.overlay || '');

    // ── LAYER 3 + 4: route + run mesh ──
    const result = await runNeuralMesh({
      systemInstruction,
      chatHistory,
      userPrompt: augmentedPrompt,
      attachments,
      geminiAi,
      profile,
    });

    // ── LAYER 5: quality gate ──
    const polishedText = ensureFollowUps(result.text, profile);

    responseCache.set(cKey, {
      text: polishedText,
      provider: result.provider,
      model: result.model,
      persona: profile.persona.name,
      ts: Date.now(),
    });

    return new Response(JSON.stringify({
      text: polishedText,
      images: [],
      _meta: {
        provider: result.provider,
        model: result.model,
        persona: profile.persona.name,
        personaEmoji: profile.persona.emoji,
        intent: profile.intent,
        game: profile.game,
        complexity: profile.complexity,
        vision: profile.hasVision,
        cached: false,
        latencyMs: Date.now() - startTime,
        cortex: 'v3.0-godmode',
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
