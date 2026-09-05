import { GoogleGenAI } from "npm:@google/genai";
import { runPulse } from './pulseEngine.ts';
import { enrichVisionAttachments, VisionEnrichment } from './visionPipeline.ts';
import {
  PROVIDERS, ProviderConfig, MeshModel, planRoute, geminiFirst, buildRegistry,
  GEMINI_IMAGE_MODELS, planGeminiRoute, geminiCandidates, GeminiCandidate,
  GROQ_AGENTIC, wantsAgentic,
} from './meshRouter.ts';
import { getDiscoveredModels } from './modelCatalog.ts';
import { extractProfileFacts, buildProfileBlock } from './playerMemory.ts';
import {
  SseWriter, sseHeaders, streamOpenAICompat, streamGemini,
} from './streaming.ts';
import { corroborate, CorroborationInput } from './corroboration.ts';
import { stripReasoning, createReasoningFilter } from './reasoning.ts';
import {
  checkRateLimit, anonBucket, userIdFromAuthHeader, botCallerFromHeaders,
  LIMITS_AUTHED, LIMITS_ANON,
  getMeshState, reportProvider, recordUsage, noteLocalFailure,
  loadProfile, saveProfilePatch, recordTrace, dbConfigured,
  PlayerProfile, MeshState as MeshStateT,
} from './meshDb.ts';

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

function jsonResponse(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

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
You are GameGuide-AI. Not a support bot — a friend who knows an absurd amount about games and likes talking about them.

## VOICE
Thousands of hours across every platform. You've raged at a boss at 2am and felt the hollow after finishing something you loved. Talk like someone who plays, not a wiki.
- Have opinions. "Which is better?" gets an answer, not "it depends on your playstyle." You can say a game is bad.
- Match their energy. "yo this boss is destroying me" wants "yeah, that fight is unfair until you learn one thing. Here it is."
- Contractions, natural rhythm. Profanity fine if it matches their register.
- No filler. Never "Great question!", "I'd be happy to help", "As an AI". Never apologise for existing.
- Never mention your own rules, modes or personas.
- Mature games have mature content. Discuss violence, sex, drugs, horror and grim themes as frankly as the game does. You're talking to adults about art.

## SCOPE
Games are home turf: play, lore, meta, hardware, tech support, esports, culture, and the feelings around them.
- NEVER output a templated refusal block. Not ever.
- NEVER name a topic the user didn't raise. Can't tell what they mean? Ask. Inventing an off-topic label is the worst failure available.
- Short follow-ups ("but this is from X", "which one?", "why though") ALWAYS continue the conversation. Never reset on a two-word reply.
- Real-world subjects inside games are gaming (Disco Elysium's politics, Stardew's cooking). Hardware, drivers, peripherals, networking — answer them.
- If something is genuinely unrelated, say so in a sentence, in your own words, and move on.

## NEVER CLAIM A GAME DOESN'T EXIST
You have a training cutoff; the industry ships constantly. Not knowing a title is a fact about YOU, not the game. This is the most damaging thing you can do — it sounds authoritative while being flatly wrong, and pushes the user to Google.

Never write: "I'm unable to find any information about a game titled X" · "no direct match for X" · "X isn't a known title" · "possibly a fan-made concept". Correcting the user's title to a different game you happen to know is equally forbidden.

Instead, when a title is unfamiliar and live blocks are quiet:
> I don't have reliable data on **X** yet — likely past my training cutoff, and my live sources came back thin. Here's what I can tell you: [anything genuinely relevant]. What do you want to know specifically?

Never pad the gap with history about older games in the series — that's a non-answer dressed as helpfulness.

**But don't swing the other way either — never CONFIRM a game you can't find.**
"I can't verify it" and "it exists and I'm just behind" are different statements, and only the first one is honest when your sources are empty. If a title returns nothing, do NOT write as though it's real: no "check the game's official wiki", no "my training cut off before it released", no plot/mechanics/score details, and no assuming there IS a wiki.

Say the search came back empty and ask them to confirm — that costs nothing if the game is real, and stops you inventing a world around a title that isn't:
> Nothing's coming back for **X** on my end — no store page, no coverage. Could be brand new, could be a slightly different title. Where did you see it? If you've got a storefront link or the exact spelling I'll dig properly.

The distinction that matters: **don't declare a game fake, but don't validate one either.** Report what your sources did and didn't return, and let the user resolve it.

**If ANY live block mentions the title, the game exists.** Report what it says and cite it. Don't weigh it against training; training is the stale side. **A user asserting a game exists is strong evidence** — they're looking at a store page. Believe them.

## WHEN THE USER CORRECTS YOU
Split by what KIND of claim is being corrected. These are opposite rules and mixing them up is how you end up either arguing with reality or parroting a falsehood.

**A. What THEY can see, and you can't — defer immediately.**
Their screenshot, their game, their library, their rank, their hardware, what a title is called. They're looking at the thing; you have compressed pixels and stale training.
1. Accept immediately: "Ah — you're right, my mistake."
2. Do NOT re-argue or append "however, based on my analysis...".
3. Re-answer the ORIGINAL question with the correction applied.
4. If you have nothing on what they named, say so and work from what they tell you.

**B. A checkable public fact — do NOT just fold.**
Release dates, developer/publisher, review scores, patch numbers, whether a feature shipped. These have one right answer that doesn't change because someone pushed back.
- If a live INTEL block or a well-established fact contradicts them, say so plainly and kindly, and cite it: "Pretty sure it was 3 August 2023 — that's what the Steam page says. Want me to double-check anything specific?"
- Never restate a claim you believe is false as though it were fact. Bolding it makes it worse.
- If you genuinely aren't sure, say you're not sure and say how to settle it. That is a fine answer.
- Being wrong and corrected is fine. Agreeing to something false to be agreeable is not — it makes every other answer you give worth less.

A correction is never off-topic. Answering one with a scope message is catastrophic.

## LIVE DATA
INTEL blocks in your context were fetched seconds ago. They OVERRIDE your training on anything they cover — live-service games change monthly.
- Cite what confirmed a fact ("per the official patch notes", "per Steam News").
- Never deny a feature a live block confirms.
- For "current/latest/newest" questions, answer ONLY from live blocks. If they're silent, say so plainly — don't invent current state.
- Never say you can't browse the internet.
- Give exact numbers when you have them ("850 damage at level 11", not "high damage"). Tag the patch when you know it. Never invent stats, item names or quest steps. "I'm not sure — check in-game" beats a confident lie.

## THE HUMAN SIDE
Much of what people bring isn't a mechanics question. Handle it like a friend, not a helpdesk:
- **Burnout** — take it seriously, don't reflexively fix it with a build guide. Sometimes "put it down for a while" is the honest answer.
- **Post-game emptiness** — real and common. Name it.
- **Rage/tilt** — validate first. The boss IS bullshit. Then help.
- **Skill anxiety, nostalgia, grief** — be kind and honest, not falsely reassuring.
- **Playing too much** — be a real friend: honest, non-judgmental, no lecture.

You're allowed to just talk. "I finished Outer Wilds and I feel weird" wants a few sentences of genuine reaction, not a formatted guide. Never apply live-data disclaimers to feelings.

One real limit, not a filter — and it has two settings, because getting the level wrong in either direction does harm.

**If there's any explicit signal of self-harm** ("end it all", "hurt myself", "don't want to be here"): drop the game talk entirely, respond like a person who cares, and point them to real help (988 in the US; otherwise tell them to search their country's crisis line). Never hand them a template.

**If the language is bleak but ambiguous** — "nothing matters", "I don't see the point anymore", "what's the point" — do NOT launch the full crisis script; that's patronising when someone is just tilted, and it teaches them not to talk to you. Answer warmly and normally, like the friend you are. But leave one door open, lightly, near the end. One sentence, no alarm:
> "…and if this is bigger than the game lately, that's worth saying out loud to someone — I'm happy to just talk too."

The failure to avoid is treating "nothing matters" as *purely* a ranked-loss complaint and moving straight to practice drills. Acknowledge the weight first, help second, and always leave the door open.

# FORMATTING
Formatting serves the answer, not a quota.
**Just talk** — no headers, no bullets — for opinions, feelings, short facts, corrections, banter. Most messages. "Is Hollow Knight worth it?" wants a confident paragraph, not a five-section report.
**Use structure** only when content is structured: comparisons → table; ordered steps → numbered list; independent items → bullets; genuinely long answers → headers.
- Bold key terms, game names, stats. Tables need a header + separator row. Bullets 1–2 sentences.
- Troubleshooting leads with the single fastest fix, then the ladder.
- Never wrap a two-sentence answer in three headers. Over-formatting is the #1 thing that reads as a bot.

## Follow-ups
When they fit, end with 2–4 things the user might ask next, in THEIR voice, one per line:
[?] How do I get to phase 2 without dying to the adds?
SKIP them entirely on emotional turns, corrections, banter and short exchanges. Bolting chips onto someone who just said they're burnt out is tone-deaf.

## GOLDEN RULE
Sound like a knowledgeable friend, not a wiki with a personality bolted on. Before sending, ask: *would someone who actually plays say it this way?*
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
# 🎯 PRECISION VISION ENGINE v4 — ZERO HALLUCINATION PROTOCOL

You are tasked with analyzing an image with absolute, pixel-perfect accuracy. Your primary directive is to NEVER hallucinate, guess, or assume.

## 🔧 PRE-PROCESSED SIGNALS YOU MAY RECEIVE WITH THIS IMAGE
A dedicated vision pipeline runs BEFORE this prompt. When it succeeds, you receive two additional signals — use them as ground truth:

1. **OCR GROUND TRUTH block** — a separate context block (look for "🔠 OCR GROUND TRUTH") containing every text/digit/coordinate read directly from the pixels by a dedicated OCR engine. When present, the OCR tokens OVERRIDE your visual interpretation on any conflict. If OCR reads "RTX 5060 Ti", you write "RTX 5060 Ti" — never regularize. If OCR reads "X:-4392.17", you preserve every decimal — never round.

2. **HUD STRIP CROP** — a SECOND image may be attached alongside the full screenshot. It is a native-resolution crop of the bottom ~22% of the original (the HUD region). The full frame gives you context; the HUD crop gives you pixel-level detail on hotbar slots, status bars, ammo counters, ability cooldowns, etc. ALWAYS cross-reference the crop when answering hotbar / status-bar / HUD questions — those details are too small to read reliably in the full frame.

If either signal is absent, fall back to direct visual inspection of the full image — but state lower confidence on text-grounded claims.

## 🎞️ FRANCHISE-ENTRY AMBIGUITY (READ BEFORE NAMING A GAME)
Sequels in the same series look nearly identical. Forza Horizon 4 / 5 / 6, Call of Duty entries, FIFA/EA FC years, Assassin's Creed titles — the HUD, fonts, and art direction barely change between them, and a newer entry may not exist in your training data AT ALL.

So: identify the **series** with confidence, but treat the **specific installment** as a guess unless you have hard evidence (a version string, a title screen, a live INTEL block, or the user telling you).

- Say "this is **Forza Horizon** — looks like 5 or 6 based on the lighting, though I can't pin the exact entry from this shot" rather than flatly asserting one.
- NEVER let "I don't recognize this entry" become "therefore it's the older one I do know." A game released after your training cutoff will feel unfamiliar — that is evidence it is NEWER, not that it's an older title.
- If the user names the installment, they are right. Adopt it immediately.

## ⛔ STRICT REFUSAL RULES
1. **Never auto-correct text or numbers.** If you see (or OCR reads) "RTX 5060 Ti", write "RTX 5060 Ti". Do not assume it's a typo. Read character by character. This applies to overlay counters too — "53 FPS" is not "63 FPS".
2. **Never guess items by context.** A player at level 21 could have Wood or Diamond tools. Identify items purely by visual characteristics (color, shape) — cross-checked against the HUD crop when available. Cyan/Teal = Diamond. White/Grey = Iron.
3. **If unsure, state uncertainty.** Use \`[UNCLEAR]\` if a region is blurry or ambiguous. Do not invent details to sound helpful.
4. **Never deny live features.** NEVER deny a card/character/feature that an INTEL block confirms exists, even if your training predates it.
5. **OCR > visual interpretation.** When the OCR block disagrees with what you think you see, the OCR wins. Re-examine those pixels — you probably misread.
6. **Hard refusal on unreadable input.** If the image is genuinely too blurry, too dark, cropped, or otherwise illegible to ground answers in pixel evidence (and OCR also failed to extract meaningful tokens), your ENTIRE reply must be:
   "🚫 **I can't read this image clearly.** Specifically: [describe what's wrong — e.g. 'the text is below ~10px and pixelated', 'the screen is mostly black except a small region']. Please re-upload a higher-resolution screenshot, or describe what you're seeing in text and I'll help that way."
   Do NOT proceed to STEP 1-4 in this case. Do NOT guess. Do NOT pad with generic advice.

## REQUIRED ANALYSIS WORKFLOW (THINK OUT LOUD):
You must structure your initial analysis strictly using these steps before answering the user:

### STEP 1: OCR & TEXT EXTRACTION
If an "🔠 OCR GROUND TRUTH" block is present in your context, COPY its tokens here verbatim — do NOT re-OCR from the image. Then proceed.
If no OCR block is present, extract ALL text visible on the screen EXACTLY as written. Pay special attention to:
- Debug menus (e.g., Minecraft F3 screen: coords, FPS, CPU, GPU).
- Chat logs.
- UI labels or numbers.
*(Self-Correction during Step 1: Verify every digit of hardware specs or coordinates against the image. Do not hallucinate standard specs. When OCR tokens exist, they are authoritative.)*

### STEP 2: VISUAL INVENTORY & HUD
List the items, icons, and HUD elements you see. **If a HUD strip crop (second attached image) was provided, prefer it for hotbar/status-bar reads — it's at native resolution.**
- **Hotbar/Inventory**: Look closely at the color of items in the HUD crop. (e.g., Cyan tools = Diamond, White tools = Iron). List them accurately.
- **Status Bars**: Health, stamina, mana, armor, experience levels. Give exact counts using the HUD crop when present.

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
  /** "what's new / latest / current" — routes to a self-searching model. */
  temporal: boolean;
}

// Recency signal available at classification time, before PULSE has run.
// Deliberately broad: a false positive costs one agentic call, a false
// negative costs a stale answer — which is the failure this project keeps hitting.
const TEMPORAL_HINT_RX = /(latest|newest|new|current|currently|right now|today|this (?:week|month|season|patch|year)|recent|recently|just (?:released|launched|dropped)|upcoming|coming soon|release date|releasing|patch notes|meta|nerf|buff|202[5-9]|20[3-9]d)/i;

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

// Entry in KNOWN_GAMES that the user typed, EXTENDED with any installment
// number the user actually wrote. Critical: the allowlist can never contain
// titles newer than the last deploy, so "forza horizon 6" used to collapse to
// the allowlist entry "forza horizon" — and every downstream search then looked
// up the wrong game and answered about Horizon 4/5. Preserving the numeral is
// what lets PULSE find a title that postdates both the allowlist AND training.
// Explicit roman alternation (longest-first) rather than [ivx]{1,5}: a bare "i"
// would otherwise swallow ordinary prose — "minecraft i love it" → "minecraft i".
// The (?!\.\d) guard keeps version strings intact ("minecraft 1.20" stays base).
const INSTALLMENT_RX = /^[\s:-]*((?:\d{1,2}(?!\.\d)|xiii|xii|xi|ix|viii|vii|vi|iv|iii|ii|x|v)\b(?:\s+(?:remake|remastered|definitive|deluxe))?)/i;

function extendWithInstallment(text: string, base: string): string {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`\\b${escaped}\\b`, 'i');
  const m = rx.exec(text);
  if (!m) return base;
  const tail = text.slice(m.index + m[0].length);
  const suffix = INSTALLMENT_RX.exec(tail);
  if (!suffix) return base;
  // Don't glue on a number that's already part of the matched entry
  // (e.g. "diablo 4" matching entry "diablo 4" leaves no numeric tail anyway).
  return `${base} ${suffix[1].trim()}`.replace(/\s+/g, ' ').trim();
}

// Fallback for titles absent from the allowlist entirely — new releases, niche
// games, non-English titles. The allowlist can never contain a game released
// after the last deploy, and a missed title means `shouldScrape` stays false
// and the model answers a brand-new game from stale training. That is exactly
// how "007 First Light" (released 2026-05-27) got reported as not existing.
//
// Three strategies, most explicit first:
//   1. A quoted title            — "007 First Light"
//   2. A frame word + Title Case — "reviews about 007 First Light"
//   3. A bare Title Case run     — "Is Silksong worth it"
// Crucially the leading token may start with a DIGIT: 007, 2K25, 7 Days to
// Die, 11 Bit. Requiring [A-Z] silently excluded that whole class of titles.
const TITLE_TOKEN = String.raw`[A-Z0-9][\w'’&:.\-]*`;
const TITLE_RUN = String.raw`${TITLE_TOKEN}(?:\s+(?:${TITLE_TOKEN}|of|the|and|to|de|la|no|ni|wa|&|:|-)){0,6}`;

// Only real quotation marks delimit a title. The straight apostrophe is
// excluded on purpose: in English it is overwhelmingly a contraction, and
// treating it as a delimiter made "I'm burnt out ... I don't enjoy" capture
// everything between the two apostrophes as a game title.
const QUOTED_RX = /["“”]([^"“”]{3,60})["“”]|[‘]([^’]{3,60})[’]/;
const GAME_FRAME_RX = new RegExp(
  String.raw`\b(?:in|for|on|about|from|of|playing|play|played|beat|finish|buy|review(?:s)?\s+(?:of|for|about)?)\s+(${TITLE_RUN})`,
);
const BARE_TITLE_RX = new RegExp(String.raw`\b(${TITLE_RUN})`);

// Words that are capitalised in normal prose but are never a game title on
// their own. Without this, "Is The Game Good" yields "The Game".
const STOP_FIRST = /^(I|I'?m|The|My|A|An|It|Its|This|That|These|Those|You|Your|We|They|He|She|What|When|Where|Why|How|Who|Which|Is|Are|Was|Were|Do|Does|Did|Can|Could|Should|Would|Will|Yeah|Yes|No|Ok|Okay|Thanks|Hey|Hi|Hello|PC|PS4|PS5|PS6|Xbox|Steam|Windows|Linux|Mac|Reddit|Discord|YouTube|Google|Twitch|Nvidia|AMD|Intel|GPU|CPU|RAM|FPS|DLC|AI)$/i;

function cleanTitle(raw: string): string | null {
  let cand = raw.trim()
    .replace(/[.,!?;:]+$/, '')
    // Drop trailing filler that gets swept up by the token run.
    .replace(/\s+(?:game|games|please|thanks|now|yet|too)$/i, '')
    .trim();
  if (cand.length < 3 || cand.length > 60) return null;

  const tokens = cand.split(/\s+/);
  if (STOP_FIRST.test(tokens[0])) {
    // Retry from the second token: "Is Silksong worth it" -> "Silksong".
    if (tokens.length < 2) return null;
    cand = tokens.slice(1).join(' ');
    if (cand.length < 3 || STOP_FIRST.test(cand.split(/\s+/)[0])) return null;
  }
  // A single very short token is more likely a stray acronym than a title.
  if (!cand.includes(' ') && cand.length < 3) return null;
  return cand.toLowerCase();
}

function guessUnknownTitle(rawText: string): string | null {
  const quoted = QUOTED_RX.exec(rawText);
  if (quoted) {
    const t = cleanTitle(quoted[1] ?? quoted[2] ?? '');
    if (t) return t;
  }
  const framed = GAME_FRAME_RX.exec(rawText);
  if (framed) {
    const t = cleanTitle(framed[1]);
    if (t) return t;
  }
  // Bare run: only trust it when it is multi-word or digit-led, since a single
  // capitalised word mid-sentence is usually not a title.
  const bare = BARE_TITLE_RX.exec(rawText);
  if (bare) {
    const t = cleanTitle(bare[1]);
    if (t && (t.includes(' ') || /^\d/.test(t))) return t;
  }
  return null;
}

function detectGame(text: string): string | null {
  // A title the user put in quotes is unambiguous intent — trust it over the
  // allowlist, which would otherwise match a shorter substring of it
  // ("Clair Obscur: Expedition 33" -> the entry "expedition 33").
  const quoted = QUOTED_RX.exec(text);
  if (quoted) {
    const q = cleanTitle(quoted[1] ?? quoted[2] ?? '');
    if (q) return q;
  }
  const lower = text.toLowerCase();
  // Longest-match first (so "elden ring" beats "ring", "gta vi" beats "gta").
  // Use word-boundary regex to avoid false positives like "wow" matching "wowed",
  // "lol" matching "lolly", "fc" matching "fcuk", etc.
  const sorted = [...KNOWN_GAMES].sort((a, b) => b.length - a.length);
  for (const g of sorted) {
    const escaped = g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`\\b${escaped}\\b`, 'i');
    if (rx.test(lower)) {
      const base = extendWithInstallment(lower, g);
      // Prefer a longer, more specific title that CONTAINS this match —
      // "Hollow Knight Silksong" is a different game from "Hollow Knight",
      // and searching the shorter name returns the wrong one.
      const guessed = guessUnknownTitle(text);
      if (guessed && guessed.length > base.length && guessed.includes(g)) return guessed;
      return base;
    }
  }
  // Nothing in the allowlist — try to recover an unlisted / brand-new title so
  // live scraping still fires instead of silently returning zero sources.
  return guessUnknownTitle(text);
}

// ═══════════════════════════════════════════════════════════════════════════
//  CORRECTION DETECTOR
// ───────────────────────────────────────────────────────────────────────────
//  When the user pushes back on the previous answer ("but this is from Forza
//  Horizon 6"), the model must accept the correction, not defend itself and
//  not treat the terse reply as a fresh out-of-scope question. This detector
//  drives a hard directive block and suppresses the ACCURACY LOCK, which
//  otherwise orders the model to keep its original game identification.
// ═══════════════════════════════════════════════════════════════════════════

// Leading contradiction markers ("but ...", "no, ...", "actually ...").
const CORRECTION_LEAD_RX = /^\s*(but|no|nope|nah|actually|wrong|incorrect|thats?\s+not|that\s+is\s+not|it'?s\s+not|isn'?t|i\s+said|i\s+meant)\b/i;
// Contradictions that appear mid-sentence.
const CORRECTION_INLINE_RX = /\b(you'?re\s+wrong|that'?s\s+wrong|thats\s+wrong|not\s+correct|you\s+got\s+it\s+wrong|wrong\s+game|it'?s\s+actually|its\s+actually|i\s+meant|not\s+\w[\w\s]{0,20},\s*it'?s)\b/i;

function isCorrection(prompt: string, history: any[]): boolean {
  if (!prompt || !prompt.trim()) return false;
  // A correction only makes sense if there IS a prior assistant turn to correct.
  const hasPriorAssistantTurn = Array.isArray(history)
    && history.some((m: any) => m && m.sender && m.sender !== 'user');
  if (!hasPriorAssistantTurn) return false;
  return CORRECTION_LEAD_RX.test(prompt) || CORRECTION_INLINE_RX.test(prompt);
}

function buildCorrectionDirective(prompt: string, game: string | null): string {
  return `=== ⚠️ USER CORRECTION — HIGHEST PRIORITY ===
The user is telling you that your PREVIOUS answer was wrong. Their message: "${prompt.slice(0, 300)}"

FIRST decide which kind of correction this is. The two kinds have OPPOSITE handling.

**KIND A — something only they can see** (their screenshot, their game, their
library, their rank, their hardware, what a title is called):
1. They're looking at the actual thing; you have compressed pixels and stale training. **Assume they are right.**
2. Open by accepting it plainly — "Ah, you're right, my mistake." No defensiveness, no hedging.
3. Do NOT restate or re-justify your original answer. Never write "however, based on my analysis...".
4. Re-answer the ORIGINAL question with the corrected fact applied.

**KIND B — a checkable public fact** (release date, developer/publisher, review
score, patch number, whether a feature shipped):
1. Do NOT simply fold. These have one right answer that does not change because someone pushed back.
2. If a live INTEL block or a well-established fact contradicts them, say so plainly and kindly, and cite it: "Pretty sure it was 3 August 2023 — that's what the Steam page says."
3. NEVER restate a claim you believe is false as if it were fact. Bolding it makes it worse.
4. If you genuinely aren't sure, say you aren't sure and say how to settle it.
5. Agreeing to something false to be agreeable devalues every other answer you give. Don't.

Applies to BOTH kinds:
- This message is a CONTINUATION of the current conversation, never a new or off-topic question. Do not change the subject and never emit any kind of scope or refusal message.
${game ? `6. The corrected subject appears to be **${game}**. Any live INTEL block below about it outranks both your training data and your earlier answer.\n` : ''}${game ? '7' : '6'}. If you have no reliable information about what they named — likely if it released after your training cutoff — say so honestly and ask what they're seeing. Do not invent details, and do not fall back to describing the older entry in the series as if it were the one they named.
=== END USER CORRECTION ===`;
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
    // Cheap lexical check; PULSE runs the authoritative detector later, but
    // routing has to decide before that result exists.
    temporal: TEMPORAL_HINT_RX.test(prompt),
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
//  PROVIDER MESH CONFIG — the verified model registry and the budget +
//  cooldown aware planner that replaced optimizeRoute() now live in
//  meshRouter.ts. Nothing model-specific should be hardcoded here again.
// ══════════════════════════════════════════════════════════════════════════

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

interface CacheEntry { text: string; provider: string; model: string; persona: string; ts: number; sources: string[]; }
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
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('EMPTY_RESPONSE');
  }
  // Reasoning models stream their scratchpad inline; never show it to a user.
  const text = stripReasoning(raw);
  if (!text.trim()) {
    // The reply was scratchpad and nothing else — treat as a failed generation
    // so the mesh falls through to another model rather than rendering blank.
    throw new Error('EMPTY_RESPONSE');
  }
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
//  GEMINI IMAGE GENERATION
// ═══════════════════════════════════════════════════════════════════════════
// Model ids live in meshRouter.ts so there is exactly one place to update
// when Google retires a generation. (The chat/vision path used to have a
// second, unused copy of this pattern here — callGemini() was dead code that
// iterated a flat list and was never invoked; removed rather than fixed.)

const IMAGE_MODELS = GEMINI_IMAGE_MODELS;

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

// Reduces a question to a searchable subject when no game name was detected.
// Deliberately conservative: strips interrogatives and filler, and bails on
// anything too short to be a meaningful query.
function promptSubject(prompt: string): string | null {
  if (!prompt) return null;
  const cleaned = prompt
    .replace(/[?!.]+/g, " ")
    .replace(/(what|whats|what's|when|where|why|how|who|which|is|are|was|were|do|does|did|can|could|should|would|will|tell|me|about|the|a|an|of|for|in|on|to|please|thanks|recent|latest|newest|now|currently|good|bad|worth|it|long|ago|release[d]?|review[s]?)/gi, " ")
    .replace(/s+/g, " ")
    .trim();
  return cleaned.length >= 4 && cleaned.length <= 80 ? cleaned : null;
}

async function omniScrape(game: string | null, _prompt: string, totalBudgetMs = 3000): Promise<ScrapeBlock[]> {
  // Previously this returned [] whenever detection failed, which meant a title
  // the allowlist and extractor both missed got NO live context at all — the
  // exact case where training data is least trustworthy. Fall back to querying
  // the user's own words so a brand-new game is still researched.
  const subject = game || promptSubject(_prompt);
  if (!subject) return [];
  const named = !!game;
  console.log(`[OMNI] Starting omni-scrape subject="${subject}" (${named ? 'detected' : 'from prompt'}) budget=${totalBudgetMs}ms`);

  const overallTimeout = new Promise<ScrapeBlock[]>(resolve =>
    setTimeout(() => {
      console.warn(`[OMNI] Overall budget ${totalBudgetMs}ms exceeded — returning partial results`);
      resolve([]);
    }, totalBudgetMs)
  );

  // Sources keyed on an exact game name (Supercell, Steam, YouTube channel
  // lookups) only make sense for a confirmed title; web search and Wikipedia
  // work fine on a raw phrase, so they still run when detection failed.
  const allFetches = Promise.allSettled(
    named
      ? [
          fetchSupercellAPI(subject),
          fetchWikipedia(subject),
          fetchSteamNews(subject),
          fetchInvidious(subject),
          fetchGamingRSS(subject),
          fetchWebSearchForGame(subject, _prompt),
        ]
      : [
          fetchWikipedia(subject),
          fetchWebSearchForGame(subject, _prompt),
        ]
  );
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
async function resolveGameFromImage(geminiAi: any, attachments: any[], meshState: MeshStateT): Promise<string | null> {
  if (!attachments?.length) return null;
  const tinyPrompt = `Identify the video game from this screenshot. Reply ONLY with: "GAME: <name> | CONFIDENCE: high|medium|low". If unsure, GAME: unknown.`;

  // Try OpenRouter first — separate quota pool from native Gemini, so a cheap
  // identification pass here preserves the Gemini budget for the real answer.
  const orProvider = PROVIDERS.OpenRouter;
  const orVisionModel = 'google/gemma-4-31b-it:free';
  if (orProvider && Deno.env.get(orProvider.keyEnv)) {
    try {
      const messages = buildOpenAIMessages('You identify video games from screenshots.', [], tinyPrompt, attachments, true);
      const txt = await callOpenAICompat(orProvider, orVisionModel, messages, {
        maxTokens: 60, temperature: 0.1,
      });
      const m = txt.match(/GAME:\s*([^|\n]+?)\s*\|\s*CONFIDENCE:\s*(high|medium|low)/i);
      if (m && m[1].trim().toLowerCase() !== 'unknown' && m[2].toLowerCase() !== 'low') {
        console.log(`[GAME-RESOLVER] OR/${orVisionModel} → "${m[1].trim()}" (${m[2]})`);
        return m[1].trim().toLowerCase();
      }
    } catch (e: any) {
      console.warn(`[GAME-RESOLVER] OR pass-1 failed: ${e.message}`);
    }
  }

  // Fallback: native Gemini Flash.
  // Previously hardcoded to 'gemini-2.0-flash', a model already confirmed
  // retired upstream (see meshRouter.ts) — every call here was a guaranteed
  // 404, and it failed silently into `return null` with only a console.warn.
  // Route through the same state-aware candidate list as the main answer
  // path instead of a second, independently-rotting hardcoded id.
  if (geminiAi) {
    const candidates = planGeminiRoute(meshState);
    for (const { id: model } of candidates.slice(0, 2)) {   // quick pass — don't exhaust every candidate on a pre-check
      try {
        const contents = buildGeminiContents([], tinyPrompt, attachments);
        const result = await geminiAi.models.generateContent({
          model,
          contents,
          config: { temperature: 0.1, maxOutputTokens: 60 },
        });
        const txt = result?.text || '';
        const m = txt.match(/GAME:\s*([^|\n]+?)\s*\|\s*CONFIDENCE:\s*(high|medium|low)/i);
        recordUsage('Gemini', model);
        if (m && m[1].trim().toLowerCase() !== 'unknown' && m[2].toLowerCase() !== 'low') {
          console.log(`[GAME-RESOLVER] Gemini/${model} → "${m[1].trim()}" (${m[2]})`);
          return m[1].trim().toLowerCase();
        }
        return null;   // model answered, just didn't recognise the game — no point trying another id
      } catch (e: any) {
        const msg = (e.message || String(e)).toLowerCase();
        console.warn(`[GAME-RESOLVER] Gemini/${model} pass-1 failed: ${e.message}`);
        recordUsage('Gemini', model, 0, 0, true);
        if (msg.includes('429') || msg.includes('quota')) noteLocalFailure('Gemini', model);
        // else: try the next candidate (e.g. a retired/unknown id)
      }
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

// ═══════════════════════════════════════════════════════════════════════════
//  NEURAL MESH v3 — execution
// ───────────────────────────────────────────────────────────────────────────
//  Routing decisions live in meshRouter.planRoute(); this function only
//  executes the plan and reports outcomes back to the shared health table so
//  the NEXT request (in any isolate) can skip what is currently broken.
//
//  Ordering:
//    • vision  → Gemini first (strongest free vision model, and it preserves
//                the 50/day OpenRouter vision allowance), then the planned
//                OpenAI-compatible vision models.
//    • text    → planned mesh first (Groq is faster and effectively unmetered),
//                Gemini held in reserve as the final safety net.
// ═══════════════════════════════════════════════════════════════════════════

async function runGeminiAttempt(opts: {
  geminiAi: any;
  systemInstruction: string;
  chatHistory: any[];
  userPrompt: string;
  attachments: any[];
  hasVision: boolean;
  errors: string[];
  meshState: MeshStateT;
}): Promise<MeshResult | null> {
  if (!opts.geminiAi) return null;

  // State-aware order: skips any model already past its daily cap instead of
  // paying a guaranteed-fail round trip to find out, and puts whichever model
  // has the most headroom LEFT today first — see meshRouter.ts for why
  // cycling across ids actually multiplies the free daily budget here.
  const models = planGeminiRoute(opts.meshState).map((c: GeminiCandidate) => c.id);
  if (models.length === 0) {
    console.warn('[MESH] All Gemini candidates are past today\'s cap — skipping Gemini entirely');
    return null;
  }
  let contents = buildGeminiContents(opts.chatHistory, opts.userPrompt, opts.attachments);
  let mimeRetryUsed = false;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[MESH] Gemini → ${model} (attempt ${attempt})`);
        const result = await opts.geminiAi.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: opts.systemInstruction,
            // Vision runs cold: the zero-hallucination protocol does not
            // tolerate creative padding.
            ...(opts.hasVision
              ? { temperature: 0.15, maxOutputTokens: 3500 }
              : { temperature: 0.72, maxOutputTokens: 2400 }),
          },
        });
        if (result?.text) {
          console.log(`[MESH] ✓ Gemini/${model}`);
          reportProvider('Gemini', model, true);
          recordUsage('Gemini', model);
          return { text: result.text, provider: 'Gemini', model };
        }
        throw new Error('EMPTY_RESPONSE');
      } catch (e: any) {
        const raw = e.message || String(e);
        const msg = raw.toLowerCase();
        opts.errors.push(`Gemini/${model}#${attempt}: ${msg.slice(0, 100)}`);
        console.warn(`[MESH] ✗ Gemini/${model} (try ${attempt}): ${msg.slice(0, 150)}`);

        const status = /\b(429|503|500|404|400|401)\b/.exec(msg)?.[1];
        reportProvider('Gemini', model, false, status ? parseInt(status, 10) : undefined, raw);
        recordUsage('Gemini', model, 0, 0, true);

        // Retired / unknown model id — no retry will fix it.
        if (msg.includes('404') || msg.includes('not found') || msg.includes('not supported')) break;

        // One-shot MIME normalization retry for legacy attachment types.
        if ((msg.includes('400') || msg.includes('invalid') || msg.includes('unsupported'))
            && attempt === 1 && !mimeRetryUsed && opts.attachments?.length > 0) {
          mimeRetryUsed = true;
          console.log('[MESH] Retrying Gemini with attachments normalized to image/jpeg');
          contents = buildGeminiContents(opts.chatHistory, opts.userPrompt, normalizeAttachmentsToJpeg(opts.attachments));
          continue;
        }
        if (msg.includes('400') || msg.includes('invalid')) break;

        if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
          // Quota is spent on THIS model specifically — cool down that exact
          // id, not a hardcoded 'vision' bucket that silently blocked every
          // other Gemini model (text and vision alike) after any one 429.
          noteLocalFailure('Gemini', model);
          break;
        }
        if (attempt < 2) await new Promise(r => setTimeout(r, 900));
      }
    }
  }
  return null;
}

async function runPlannedMesh(opts: {
  route: ReturnType<typeof planRoute>;
  systemInstruction: string;
  chatHistory: any[];
  userPrompt: string;
  attachments: any[];
  hasVision: boolean;
  errors: string[];
}): Promise<MeshResult | null> {
  const deadProviders = new Set<string>();

  for (const { provider, model, reason } of opts.route) {
    if (!provider) continue;
    if (deadProviders.has(provider.name)) continue;

    const messages = buildOpenAIMessages(
      opts.systemInstruction,
      opts.chatHistory,
      opts.userPrompt,
      opts.attachments,
      model.vision,
    );

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[MESH] ${provider.name} → ${model.id} (${reason}, attempt ${attempt})`);
        const text = await callOpenAICompat(provider, model.id, messages);
        console.log(`[MESH] ✓ ${provider.name}/${model.id}`);
        reportProvider(provider.name, model.id, true);
        recordUsage(provider.name, model.id);
        return { text, provider: provider.name, model: model.id };
      } catch (err: any) {
        const raw = err.message || String(err);
        opts.errors.push(`${provider.name}/${model.id}#${attempt}: ${raw.slice(0, 120)}`);
        console.warn(`[MESH] ✗ ${provider.name}/${model.id} (try ${attempt}): ${raw.slice(0, 200)}`);

        const status = /HTTP_(\d{3})/.exec(raw)?.[1];
        const code = status ? parseInt(status, 10) : undefined;
        reportProvider(provider.name, model.id, false, code, raw);
        recordUsage(provider.name, model.id, 0, 0, true);
        noteLocalFailure(provider.name, model.id);

        // A bad key or a suspended account kills the whole provider, not just
        // this model — stop wasting attempts on its siblings.
        if (isProviderFatal(raw)) {
          deadProviders.add(provider.name);
          break;
        }
        // A retired model id returns 404/400; siblings may still be fine.
        if (code === 404 || code === 400) break;
        if (!isRetryable(raw)) break;
        if (attempt < 2) await new Promise(r => setTimeout(r, 800 * attempt));
      }
    }
  }
  return null;
}

// Groq's compound systems run their own web search before answering. On a
// "what's new / latest / current" question that is a second, independent shot
// at recency: even when our own retrieval comes back thin, the model can go
// look. Returns null when agentic routing does not apply or the call fails,
// so the normal mesh still runs.
// Groq's compound systems reject oversized requests (HTTP 413) — the full
// BASE_SYSTEM is ~4.6k tokens before context blocks are appended, and the
// combined instruction blew the limit on every call.
//
// They also don't need it. Compound's job here is narrow: search the live web
// and report what it finds, accurately. The formatting spec, HUD knowledge and
// INTEL contracts are for the models that consume OUR retrieval. So it gets a
// compact prompt carrying only what changes the answer.
const AGENTIC_SYSTEM = `You are GameGuide-AI — a friend who knows an absurd amount about games and talks like a person, not a wiki.

Today is ${'${TODAY}'}. You can search the web; do it before answering anything about recent or current state.

ACCURACY RULES:
- NEVER say a game doesn't exist. Not recognising a title is a fact about you, not the game. Search for it.
- Never "correct" the user's game title to a different game you happen to know.
- If the user names a title, believe them and search for it.
- Cite what you found inline ("per the Steam page", "per IGN's review").
- If your search genuinely turns up nothing, say so plainly in one line and say what you'd need — do not pad with history about older games in the series.
- Give real numbers and dates when you have them. Never invent them.

VOICE: Talk like a gamer. Contractions, opinions, no corporate filler. Skip "Great question!". Use markdown where it helps (a table for comparisons, steps for troubleshooting) but don't over-format a short answer.`;

async function tryAgentic(opts: {
  systemInstruction: string;
  chatHistory: any[];
  userPrompt: string;
  need: { vision: boolean; complexity: 'simple' | 'medium' | 'deep'; intent: string; temporal?: boolean };
  /** The question WITHOUT our injected context blocks. */
  rawPrompt?: string;
  errors: string[];
  onDelta?: (t: string) => void;
  onCommit?: (provider: string, model: string) => void;
}): Promise<MeshResult | null> {
  const mode = wantsAgentic(opts.need);
  if (!mode) return null;
  const provider = PROVIDERS.Groq;
  const key = Deno.env.get(provider.keyEnv);
  if (!key) return null;
  const modelId = mode === 'deep' ? GROQ_AGENTIC.deep : GROQ_AGENTIC.fast;

  const system = AGENTIC_SYSTEM.replace("${TODAY}", new Date().toISOString().slice(0, 10));
  // Only the last few turns: compound re-derives context by searching, and a
  // long history is exactly what tipped these requests over the size limit.
  const trimmedHistory = (opts.chatHistory || []).slice(-4);
  const messages = buildOpenAIMessages(system, trimmedHistory, opts.rawPrompt || opts.userPrompt, [], false);
  try {
    console.log(`[AGENTIC] ${provider.name} → ${modelId} (${mode})`);
    if (opts.onDelta) {
      const text = await streamOpenAICompat(provider.endpoint, key, modelId, messages, {
        maxTokens: 2400,
        temperature: 0.6,
        // Tool calls happen server-side before the first token, so this needs
        // considerably more headroom than a plain completion.
        timeoutMs: 60_000,
        extraHeaders: provider.extraHeaders,
        onDelta: opts.onDelta,
        onFirstToken: () => opts.onCommit?.(provider.name, modelId),
      });
      reportProvider(provider.name, modelId, true);
      recordUsage(provider.name, modelId);
      return { text, provider: provider.name, model: modelId };
    }
    const text = await callOpenAICompat(provider, modelId, messages, {
      maxTokens: 2400, temperature: 0.6,
    });
    reportProvider(provider.name, modelId, true);
    recordUsage(provider.name, modelId);
    console.log(`[AGENTIC] ✓ ${provider.name}/${modelId}`);
    return { text, provider: provider.name, model: modelId };
  } catch (e: any) {
    const raw = e.message || String(e);
    opts.errors.push(`agentic/${modelId}: ${raw.slice(0, 120)}`);
    console.warn(`[AGENTIC] ✗ ${modelId}: ${raw.slice(0, 160)}`);
    const status = /HTTP_(d{3})/.exec(raw)?.[1];
    reportProvider(provider.name, modelId, false, status ? parseInt(status, 10) : undefined, raw);
    return null;   // fall through to the normal mesh
  }
}

// ── Streaming variant ──────────────────────────────────────────────────────
// Same plan, same fallback order, but a candidate may only be abandoned
// BEFORE it emits its first token. Once text has reached the user we are
// committed — silently switching models mid-answer would contradict what they
// have already read.
async function runNeuralMeshStreaming(opts: {
  systemInstruction: string;
  chatHistory: any[];
  userPrompt: string;
  attachments: any[];
  geminiAi: any;
  profile: QueryProfile;
  meshState: MeshStateT;
  /** Original question, before INTEL blocks were appended. */
  rawPrompt?: string;
  onDelta: (t: string) => void;
  onCommit: (provider: string, model: string) => void;
}): Promise<MeshResult> {
  const errors: string[] = [];
  const need = {
    vision: opts.profile.hasVision,
    complexity: opts.profile.complexity,
    intent: opts.profile.intent,
    temporal: opts.profile.temporal,
  };
  const catalog = await getDiscoveredModels(buildRegistry());
  const route = planRoute(need, opts.meshState, buildRegistry(), catalog.models);
  const visionCfg = need.vision
    ? { temperature: 0.15, maxTokens: 3500 }
    : { temperature: 0.72, maxTokens: 2400 };

  const tryGemini = async (): Promise<MeshResult | null> => {
    if (!opts.geminiAi) return null;
    // Same state-aware ordering as the non-streaming path: skip models
    // already past today's cap, try whichever has the most headroom left
    // first. Vision and text draw from the same pool — see meshRouter.ts.
    const models = planGeminiRoute(opts.meshState).map((c: GeminiCandidate) => c.id);
    if (models.length === 0) {
      console.warn('[MESH-STREAM] All Gemini candidates are past today\'s cap — skipping Gemini entirely');
      return null;
    }
    const contents = buildGeminiContents(opts.chatHistory, opts.userPrompt, opts.attachments);
    for (const model of models) {
      try {
        let committed = false;
        const text = await streamGemini(opts.geminiAi, model, contents, opts.systemInstruction, {
          temperature: visionCfg.temperature,
          maxOutputTokens: visionCfg.maxTokens,
          onDelta: opts.onDelta,
          onFirstToken: () => { committed = true; opts.onCommit('Gemini', model); },
        });
        reportProvider('Gemini', model, true);
        recordUsage('Gemini', model);
        return { text, provider: 'Gemini', model };
      } catch (e: any) {
        const raw = e.message || String(e);
        errors.push(`Gemini/${model}: ${raw.slice(0, 120)}`);
        console.warn(`[MESH-STREAM] ✗ Gemini/${model}: ${raw.slice(0, 150)}`);
        const status = /\b(429|503|500|404|400)\b/.exec(raw)?.[1];
        reportProvider('Gemini', model, false, status ? parseInt(status, 10) : undefined, raw);
        recordUsage('Gemini', model, 0, 0, true);
        if (raw.toLowerCase().includes('429') || raw.toLowerCase().includes('quota')) {
          // Fast local echo so a follow-up request in the same burst does not
          // re-pay a guaranteed-fail round trip before the DB write lands.
          noteLocalFailure('Gemini', model);
        }
      }
    }
    return null;
  };

  const tryMesh = async (): Promise<MeshResult | null> => {
    const dead = new Set<string>();
    for (const { provider, model, reason } of route) {
      if (!provider || dead.has(provider.name)) continue;
      const key = Deno.env.get(provider.keyEnv);
      if (!key) continue;

      const messages = buildOpenAIMessages(
        opts.systemInstruction, opts.chatHistory, opts.userPrompt, opts.attachments, model.vision,
      );
      try {
        console.log(`[MESH-STREAM] ${provider.name} → ${model.id} (${reason})`);
        const text = await streamOpenAICompat(provider.endpoint, key, model.id, messages, {
          maxTokens: visionCfg.maxTokens,
          temperature: visionCfg.temperature,
          timeoutMs: provider.timeoutMs + 20_000,   // streams legitimately run longer
          extraHeaders: provider.extraHeaders,
          onDelta: opts.onDelta,
          onFirstToken: () => opts.onCommit(provider.name, model.id),
        });
        reportProvider(provider.name, model.id, true);
        recordUsage(provider.name, model.id);
        return { text, provider: provider.name, model: model.id };
      } catch (e: any) {
        const raw = e.message || String(e);
        errors.push(`${provider.name}/${model.id}: ${raw.slice(0, 120)}`);
        console.warn(`[MESH-STREAM] ✗ ${provider.name}/${model.id}: ${raw.slice(0, 180)}`);
        const status = /HTTP_(\d{3})/.exec(raw)?.[1];
        reportProvider(provider.name, model.id, false, status ? parseInt(status, 10) : undefined, raw);
        recordUsage(provider.name, model.id, 0, 0, true);
        noteLocalFailure(provider.name, model.id);
        if (isProviderFatal(raw)) dead.add(provider.name);
      }
    }
    return null;
  };

  // Recency questions get the self-searching model first.
  const agentic = await tryAgentic({
    systemInstruction: opts.systemInstruction,
    chatHistory: opts.chatHistory,
    userPrompt: opts.userPrompt,
    rawPrompt: opts.rawPrompt,
    need,
    errors,
    onDelta: opts.onDelta,
    onCommit: opts.onCommit,
  });
  if (agentic) return agentic;

  const geminiLeads = geminiFirst(need, opts.meshState, route);
  const first = geminiLeads ? await tryGemini() : await tryMesh();
  if (first) return first;
  const second = geminiLeads ? await tryMesh() : await tryGemini();
  if (second) return second;

  throw new Error(`MESH_EXHAUSTED:${errors.join(' | ')}`);
}

async function runNeuralMesh(opts: {
  systemInstruction: string;
  chatHistory: any[];
  userPrompt: string;
  attachments: any[];
  geminiAi: any;
  profile: QueryProfile;
  meshState: MeshStateT;
  /** Original question, before INTEL blocks were appended. */
  rawPrompt?: string;
}): Promise<MeshResult> {
  const errors: string[] = [];
  const need = {
    vision: opts.profile.hasVision,
    complexity: opts.profile.complexity,
    intent: opts.profile.intent,
    temporal: opts.profile.temporal,
  };

  // Live catalog supersedes the static OpenRouter ids, which rot within days.
  const catalog = await getDiscoveredModels(buildRegistry());
  const route = planRoute(need, opts.meshState, buildRegistry(), catalog.models);
  if (route.length > 0) {
    console.log(`[MESH] plan: ${route.slice(0, 4).map(r => `${r.provider.name}/${r.model.id}(${r.reason})`).join(' → ')}`);
  } else {
    console.warn('[MESH] plan is EMPTY — no configured provider can serve this request');
  }

  const agenticResult = await tryAgentic({
    systemInstruction: opts.systemInstruction,
    chatHistory: opts.chatHistory,
    userPrompt: opts.userPrompt,
    rawPrompt: opts.rawPrompt,
    need,
    errors,
  });
  if (agenticResult) return agenticResult;

  const geminiLeads = geminiFirst(need, opts.meshState, route);

  if (geminiLeads) {
    const g = await runGeminiAttempt({ ...opts, hasVision: need.vision, errors });
    if (g) return g;
    const m = await runPlannedMesh({ route, ...opts, hasVision: need.vision, errors });
    if (m) return m;
  } else {
    const m = await runPlannedMesh({ route, ...opts, hasVision: need.vision, errors });
    if (m) return m;
    const g = await runGeminiAttempt({ ...opts, hasVision: need.vision, errors });
    if (g) return g;
  }

  console.error('[MESH] ALL PROVIDERS FAILED:', errors);
  throw new Error(`MESH_EXHAUSTED:${errors.join(' | ')}`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  RESPONSE QUALITY GATE — repairs malformed AI output
// ═══════════════════════════════════════════════════════════════════════════

// Messages where canned follow-up chips are actively harmful. Stapling
// "[?] What's the most underrated feature?" onto someone describing burnout is
// the single most robotic thing this service can do, so when the model
// deliberately omitted chips on such a turn, we respect that instead of
// backfilling them.
const EMOTIONAL_RX = /\b(burn(ed|t)?\s*out|burnout|depress\w*|anxiet\w*|anxious|lonely|feel\w*\s+alone|grief|griev\w*|quit(ting)?\s+gaming|no\s+longer\s+enjoy|don'?t\s+enjoy|lost\s+interest|hardstuck|tilted|tilting|hopeless|worthless|addict\w*|ruining\s+my|hate\s+myself|kill\s+myself|end\s+it\s+all|end\s+my\s+life|self\s*harm|hurt(ing)?\s+myself|don'?t\s+(?:see|see\s+any)\s+(?:the\s+)?point|what'?s\s+the\s+point(?!\s+of\s+(?:the|a|an|this|that|these|those|his|her|their)\b)|no\s+point\s+(?:in|to)\s+(?:any|living|it)|nothing\s+matters|nothing\s+really\s+matters|give\s+up\s+on\s+everything|can'?t\s+go\s+on|don'?t\s+want\s+to\s+be\s+here|better\s+off\s+without\s+me|tired\s+of\s+living|feel(s|ing)?\s+(?:\w+\s+){0,2}(weird|empty|hollow|numb|awful|terrible|deflated|lost|down|worthless|like\s+shit))\b/i;

function shouldSkipAutoFollowUps(prompt: string, replyText: string, isCorrectionTurn: boolean): boolean {
  if (isCorrectionTurn) return true;
  if (EMOTIONAL_RX.test(prompt) || EMOTIONAL_RX.test(replyText)) return true;
  // Short conversational exchanges — chips are padding, not value.
  if (replyText.trim().length < 320) return true;
  return false;
}

function ensureFollowUps(text: string, profile: QueryProfile, skipAutoAppend = false): string {
  if (text.includes('[?]')) return text;
  if (skipAutoAppend) return text;
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
    const registry = buildRegistry();
    const [liveState, catalog] = await Promise.all([
      getMeshState(),
      getDiscoveredModels(registry),
    ]);
    // Report what will ACTUALLY route, not the deploy-time list. Discovery
    // supersedes the static registry per provider, so showing `registry` here
    // made /health describe a mesh that no longer exists — the opposite of
    // what a diagnostic endpoint is for.
    const effective = catalog.models.length ? catalog.models : registry;
    const status = {
      cortex: 'v5-mesh-v3',
      db: dbConfigured ? 'connected' : 'NOT CONFIGURED (rate limiting degraded to in-memory)',
      providers: Object.values(PROVIDERS).map(p => ({
        name: p.name,
        configured: !!Deno.env.get(p.keyEnv),
        models: effective.filter(m => m.provider === p.name).length,
        source: catalog.models.some(m => m.provider === p.name) ? catalog.source : 'static-fallback',
      })),
      // Which models are currently benched, and how much of today's free
      // allowance each one has already spent.
      mesh: effective.map(m => ({
        model: `${m.provider}/${m.id}`,
        vision: m.vision,
        tier: m.tier,
        usedToday: liveState.usage[`${m.provider}|${m.id}`] || 0,
        dailyCap: m.dailyCap,
        cooldownSec: liveState.cooldowns[`${m.provider}|${m.id}`] || 0,
      })),
      // Where the OpenRouter model list came from. "fallback" means discovery
      // failed and we are running on ids frozen at deploy time — which rot
      // within days, so it is worth noticing.
      catalog: {
        source: catalog.source,
        usableModels: catalog.models.length,
        withVision: catalog.visionCount,
        fetchedAt: catalog.fetchedAt ? new Date(catalog.fetchedAt).toISOString() : null,
        paidFallback: Deno.env.get('ENABLE_PAID_FALLBACK') === '1' ? 'enabled' : 'disabled',
      },
      agentic: {
        enabled: !!Deno.env.get('GROQ_API_KEY') && Deno.env.get('DISABLE_AGENTIC') !== '1',
        models: GROQ_AGENTIC,
        note: 'Self-searching models used for recency questions.',
      },
      gemini: !!Deno.env.get('GOOGLE_API_KEY'),
      // Per-model rotation state for the Gemini candidate pool — see
      // meshRouter.ts for why cycling across these ids multiplies the free
      // daily budget from ONE GOOGLE_API_KEY. "available" is what
      // planGeminiRoute() would actually offer for the next request right now.
      geminiRotation: !!Deno.env.get('GOOGLE_API_KEY') ? geminiCandidates().map(c => {
        const key = `Gemini|${c.id}`;
        return {
          model: c.id,
          usedToday: liveState.usage[key] || 0,
          dailyCap: c.dailyCap,
          cooldownSec: liveState.cooldowns[key] || 0,
        };
      }) : [],
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

  // The body is read once here because req.json() cannot be consumed twice,
  // and we need the `stream` flag before choosing the response shape.
  let rawBody: any;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse(
      { text: '**Bad request:** the body must be valid JSON.', images: [], _meta: { error: true } },
      400,
    );
  }

  // ── Streaming path ──────────────────────────────────────────────────────
  // The Response is returned as soon as the stream is constructed so headers
  // flush immediately; the pipeline keeps running and writes into it. That is
  // what lets the client show retrieval progress instead of a blank spinner.
  if (rawBody?.stream === true) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const sse = new SseWriter(controller);
        void (async () => {
          try {
            await runChatPipeline(req, rawBody, startTime, sse);
          } catch (error: any) {
            console.error('[FATAL-STREAM]', error);
            sse.send({ type: 'error', message: friendlyError(error) });
          } finally {
            sse.close();
          }
        })();
      },
    });
    return new Response(body, { headers: sseHeaders(corsHeaders) });
  }

  return await runChatPipeline(req, rawBody, startTime, null) as Response;
});

// Maps a thrown error onto something a player can act on.
function friendlyError(error: any): string {
  const raw = (error?.message || '').toLowerCase();
  if (raw.includes('mesh_exhausted')) return 'Every model in the mesh is busy or rate-limited right now. Give it 30 seconds and try again.';
  if (raw.includes('not found') || raw.includes('404') || raw.includes('not supported')) return 'That model is unavailable and the fallbacks did not catch it. Try again in a moment.';
  if (raw.includes('503') || raw.includes('demand') || raw.includes('unavailable')) return 'The AI is under heavy load right now — this is temporary, try again shortly.';
  if (raw.includes('429') || raw.includes('quota') || raw.includes('rate limit')) return 'Rate limit reached upstream. Wait 15–30 seconds before your next message.';
  if (raw.includes('400') || raw.includes('bad request')) return "That request couldn't be processed — possibly an unsupported attachment. Try text only.";
  if (raw.includes('api key') || raw.includes('authentication') || raw.includes('401')) return 'Server authentication error. Please contact support.';
  return 'Something unexpected broke. Please try again.';
}

async function runChatPipeline(
  req: Request,
  body: any,
  startTime: number,
  sse: SseWriter | null,
): Promise<Response | void> {
  // Emits the terminal payload in whichever shape this request asked for.
  const finish = (payload: any, status = 200, extra: Record<string, string> = {}): Response | void => {
    if (sse) {
      sse.send({ type: 'final', text: payload?.text ?? '', meta: payload?._meta });
      return;
    }
    return jsonResponse(payload, status, extra);
  };
  const stage = (name: string, detail?: string) => sse?.send({ type: 'stage', stage: name, detail });

  try {
    const { prompt, chatHistory = [], redditContext = '', wikiContext = '', priceContext = '', attachments = [] } = body;

    // Stealth / incognito turn. Everything that would outlive the request is
    // suppressed: player-memory reads AND writes, request tracing, and shared
    // cache writes. Rate limiting still applies — that is abuse protection,
    // and it records a timestamp against a bucket, never any content.
    const ephemeral = body?.ephemeral === true;
    if (ephemeral) console.log('[STEALTH] ephemeral turn — no memory, no trace, no cache write');

    // ── Payload sanity limits ───────────────────────────────────────────
    // Cheap structural rejects before anything expensive runs. A caller that
    // sends 2MB of "history" should not get to spend our scrape + LLM budget.
    if (typeof prompt !== 'string' || prompt.length > 8000) {
      return finish({
        text: '**Message too long.** Keep it under 8000 characters and try again.',
        images: [], _meta: { error: true, reason: 'prompt_too_long' },
      }, 200);
    }
    const boundedHistory = (Array.isArray(chatHistory) ? chatHistory : []).slice(-24);

    // Server-side attachment validation: reject malformed payloads, cap to 3,
    // restrict to common image MIME types. Downstream code uses cleanAttachments.
    // ~8MB of base64 per image is already generous for a screenshot.
    const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const cleanAttachments = (Array.isArray(attachments) ? attachments : [])
      .filter(a => a && typeof a.data === 'string'
        && a.data.length > 100 && a.data.length < 8_000_000
        && ALLOWED_MIME.has(a.mimeType))
      .slice(0, 3);

    // ── RATE LIMIT ──────────────────────────────────────────────────────
    // Signed-in users are bucketed by user id; everyone else by a salted hash
    // of their IP. Vision and image-gen cost far more than a text turn, so
    // they draw from the same allowance at a heavier weight.
    // Signature-verified; falls back to null (anonymous) if the token cannot
    // be validated, so a forged `sub` can never select another user's profile.
    const authedUserId = await userIdFromAuthHeader(req);

    // A verified bot caller buckets per Discord user. Without this the whole
    // Discord bot shares one IP bucket (40 turns/hour across every guild).
    // Note this yields a bucket only — `authedUserId` stays null, so the bot
    // path deliberately gets no player-profile access.
    const botCaller = authedUserId ? null : botCallerFromHeaders(req);

    const bucket = authedUserId
      ? `u:${authedUserId}`
      : botCaller
        ? `d:${botCaller.discordUserId}`
        : await anonBucket(req);
    const limits = (authedUserId || botCaller) ? LIMITS_AUTHED : LIMITS_ANON;
    const wantsImage = shouldGenerateImage(prompt);
    const kind: 'chat' | 'vision' | 'image_gen' =
      wantsImage ? 'image_gen' : (cleanAttachments.length > 0 ? 'vision' : 'chat');

    const rate = await checkRateLimit(bucket, kind, limits);
    if (!rate.allowed) {
      console.log(`[RATE-LIMIT] blocked ${bucket} on ${rate.scope} (${rate.minute}/${rate.minuteLimit}m ${rate.hour}/${rate.hourLimit}h ${rate.day}/${rate.dayLimit}d)`);
      const waitLabel = rate.scope === 'minute' ? 'a minute'
        : rate.scope === 'hour' ? 'a little while' : 'today';
      return finish({
        text: `## ⏳ Easy there\n\nYou've hit the ${rate.scope} limit — give it ${waitLabel} and I'll be right here.\n\n${authedUserId ? '' : '**Tip:** signing in raises your limit considerably.'}`,
        images: [],
        _meta: {
          error: true, rateLimited: true, scope: rate.scope,
          retryAfter: rate.retryAfter, degraded: rate.degraded,
        },
      }, 429, { 'Retry-After': String(rate.retryAfter) });
    }

    pruneCache();

    const geminiKey = Deno.env.get('GOOGLE_API_KEY');
    const geminiAi = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null;

    // ── Image generation path (Gemini-only) ──
    if (wantsImage && geminiAi) {
      const imgRes = await generateImageWithRetry(geminiAi, prompt);
      if (imgRes) {
        return finish({
          ...imgRes,
          _meta: { provider: 'Gemini', model: 'image-gen', persona: 'Critic', intent: 'image', latencyMs: Date.now() - startTime },
        });
      }
    }

    // ── LAYER 1: QUERY CORTEX ──────────────────────────────────────────
    const profile = classifyQuery(prompt, cleanAttachments, boundedHistory);
    const userIsCorrecting = isCorrection(prompt, boundedHistory);
    console.log(`[CORTEX] intent=${profile.intent} game=${profile.game || 'none'} complexity=${profile.complexity} persona=${profile.persona.name} correction=${userIsCorrecting}`);

    // Mesh state (today's spend + live cooldowns) and the player's profile are
    // independent lookups, so pay for them once, in parallel. Both degrade to
    // an empty value rather than failing the request.
    const [meshState, playerProfile] = await Promise.all([
      getMeshState(),
      ephemeral ? Promise.resolve(null) : loadProfile(authedUserId),
    ]);

    // ── SPEED: cache check FIRST (saves 2.5s omni-scrape + LLM call on hit) ──
    // We hash on the inputs we already have: the user's prompt + any client-
    // provided contexts + last 2 messages of history + attachment fingerprints.
    // If hit, return immediately — skip omni-scrape AND the mesh.
    const earlyCacheKey = await cacheKey(prompt, boundedHistory, redditContext, wikiContext, priceContext, cleanAttachments);
    const earlyCached = responseCache.get(earlyCacheKey);
    if (earlyCached && (Date.now() - earlyCached.ts) < CACHE_TTL_MS) {
      console.log(`[CACHE-EARLY] HIT ${earlyCacheKey} (${earlyCached.provider}/${earlyCached.model}) — skipping scrape + mesh`);
      return finish({
        text: earlyCached.text,
        images: [],
        _meta: {
          persona: earlyCached.persona,
          intent: profile.intent,
          game: profile.game,
          sources: earlyCached.sources || [],
          cached: true,
          latencyMs: Date.now() - startTime,
          cortex: 'v4.2-vision-refusal',
        },
      });
    }

    // ── STAGE 1: GAME RESOLVER ──────────────────────────────────────────
    // For vision queries with no text-identified game, run a fast Pass-1
    // call to identify the game from the image. This unlocks omni-scraping
    // for cases like "which card is this?" where the user provides no name.
    let resolvedGame: string | null = profile.game;
    if (profile.hasVision && !resolvedGame) {
      stage('identifying-game');
      resolvedGame = await resolveGameFromImage(geminiAi, cleanAttachments, meshState);
      if (resolvedGame) {
        console.log(`[CORTEX] Game resolved from image: ${resolvedGame}`);
        // Update profile so downstream HUD knowledge picks the right game
        profile.game = resolvedGame;
      }
    }

    // ── STAGE 1.4: VISION PRE-PROCESS (OCR ground truth + HUD strip crop) ──
    // Two layers run in parallel for vision queries:
    //   • OCR pass — a dedicated Gemini-Flash call transcribes every visible
    //     text/digit/coordinate at full perception resolution. The transcript
    //     is injected as a HARD ground-truth block the analysis VLM cannot
    //     contradict. Kills "RTX 5060 Ti → RTX 3060"-style regularization.
    //   • HUD strip crop — bottom 22% of the image at native resolution is
    //     appended as a SECOND attachment. VLMs internally tile to ~768px,
    //     so a 4K screenshot's hotbar collapses to ~50px of perceived height.
    //     The crop restores those pixels for accurate slot/tool detection.
    let visionEnrichment: VisionEnrichment | null = null;
    let effectiveAttachments = cleanAttachments;
    if (profile.hasVision && cleanAttachments?.length) {
      stage('reading-image');
      visionEnrichment = await enrichVisionAttachments(cleanAttachments, geminiAi);
      effectiveAttachments = visionEnrichment.attachments;
      const d = visionEnrichment.diagnostics;
      console.log(
        `[VISION-PIPE] ocr=${d.ocrApplied ? d.ocrLines + ' lines · ' + d.ocrLatencyMs + 'ms' : 'skip'} `
        + `crop=${d.cropApplied ? d.cropWidth + 'x' + d.cropHeight : 'skip'} `
        + `cached=${!!d.cached}`,
      );
    }

    // ── STAGE 1.5: PROJECT PULSE (live web fusion on EVERY real query) ──
    // Fires on every non-chitchat prompt regardless of whether the user used
    // explicit temporal words ("latest", "new", "current"). The query formulation
    // adapts based on temporal signal but the search ALWAYS runs so the model
    // gets fresh facts to fuse with its training-side reasoning.
    const todayISO = new Date().toISOString().slice(0, 10);
    stage('searching', resolvedGame || undefined);
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
    // Never gate live retrieval on successful game detection. A brand-new or
    // niche title is exactly the case where training data is worst AND where
    // detection is most likely to miss — gating here is how "007 First Light"
    // got answered from stale memory instead of the web. Scrape whenever the
    // prompt is a real question; runPulse already skips pure chitchat.
    const emotionalTurn = EMOTIONAL_RX.test(prompt);
    const shouldScrape = (!!resolvedGame || prompt.trim().length >= 12) && !emotionalTurn;
    if (shouldScrape) stage('scanning-sources', resolvedGame || undefined);
    const omniBlocks = shouldScrape ? await omniScrape(resolvedGame, prompt, 3000) : [];
    const rankedOmni = rankAndCapContext(omniBlocks, 6000);
    const omniContextStrings = omniBlocksToContextStrings(rankedOmni);

    // ── Build augmented prompt with all live context blocks + game card ──
    const contextBlocks: string[] = [];

    // Player memory goes FIRST: it shapes how everything after it should be
    // interpreted (their platform decides which fixes are even applicable).
    const profileBlock = buildProfileBlock(playerProfile, resolvedGame);
    if (profileBlock) {
      contextBlocks.push(profileBlock);
      console.log(`[MEMORY] profile injected (${profileBlock.length} chars)`);
    }

    // Learn from this turn. Fire-and-forget so the write never adds latency,
    // and skipped entirely when the regex extractor found nothing confident.
    if (authedUserId && !ephemeral) {
      const { patch, learned } = extractProfileFacts(prompt, resolvedGame);
      if (learned.length) {
        console.log(`[MEMORY] learned: ${learned.join(' ')}`);
        saveProfilePatch(authedUserId, patch);
      }
    }

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

    // OCR ground-truth block — only present for vision queries where OCR
    // produced actual text. Goes LAST so it sits closest to the user prompt
    // when the model reads the context (highest recency / attention bias).
    if (visionEnrichment?.ocrBlock) {
      contextBlocks.push(visionEnrichment.ocrBlock);
    }

    // ── CORROBORATION: score how much the live sources actually agree ──────
    // Injected last so it is the final instruction the model reads before the
    // question. Turns silent wrongness into visible uncertainty: three
    // independent domains agreeing reads differently from one forum post.
    const corroborationInputs: CorroborationInput[] = [
      ...rankedOmni.map(b => ({
        source: b.source,
        text: b.text,
        url: (b as any).url,
        publishedISO: (b as any).publishedISO,
        authority: b.score ?? 5,
      })),
      ...(wikiContext ? [{ source: 'fandom-wiki', text: wikiContext, authority: 6 }] : []),
      ...(redditContext ? [{ source: 'reddit', text: redditContext, authority: 4 }] : []),
    ];
    const corro = corroborate(corroborationInputs, pulse.diagnostics?.mode === 'temporal');

    // Zero usable sources means our retrieval layer failed, not that the
    // answer is unknowable. Make it loud (it is otherwise invisible) and hand
    // the question to a model that can search for itself.
    const retrievalStarved = corroborationInputs.length === 0 && !!resolvedGame;
    if (retrievalStarved) {
      console.warn(
        '[RETRIEVAL-STARVED] no live sources for "' + resolvedGame + '" — ' +
        'free search backends are likely rate-limited or serving captchas. ' +
        'Set SERPER_API_KEY or GOOGLE_CSE_ID for reliable search. ' +
        'Routing to a self-searching model as fallback.',
      );
      profile.temporal = true;   // routes through the agentic path below
    }
    console.log(`[CORROBORATION] ${corro.confidence} — ${corro.independentDomains} domains, ${corro.officialCount} official, ${corro.conflicts.length} conflicts`);
    if (!emotionalTurn) {
      contextBlocks.push(corro.block);
    }

    const augmentedPrompt = contextBlocks.length > 0
      ? `${prompt}\n\n${contextBlocks.join('\n\n')}`
      : prompt;

    // Build sources list for telemetry — combination of omni sources + client-provided contexts
    // Populated after the mesh runs: an agentic model does its own web search
    // and cites inline, so without this the answer looks ungrounded to
    // telemetry even though it is the best-sourced path we have.
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
    // Suppressed while the user is correcting us: the lock's "do NOT suggest it
    // is a different game" clause would otherwise override the very correction
    // the user just made.
    const hasHighAuthority = rankedOmni.some(b => b.score >= 8);
    if (hasHighAuthority && resolvedGame && !userIsCorrecting) {
      const lockMsg = `\n\n=== 🔒 ACCURACY LOCK ===\nThe game **${resolvedGame}** has been confirmed by ${rankedOmni.filter(b => b.score >= 8).map(b => b.source).join(' + ')} (authority score ≥ 8). You MUST treat this game identification as ground truth. Do NOT suggest it is a different game. Do NOT deny features that appear in the live blocks above. If your training data conflicts with the live data, the live data wins.\n=== END ACCURACY LOCK ===`;
      contextBlocks.push(lockMsg);
    }

    // ── LAYER 5 (early): cache check ──
    const cKey = await cacheKey(prompt, boundedHistory, redditContext, wikiContext, priceContext, cleanAttachments);
    const cached = responseCache.get(cKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      console.log(`[CACHE] HIT ${cKey} (${cached.provider}/${cached.model})`);
      // NOTE: provider/model deliberately excluded from public response — backend hidden.
      return finish({
        text: cached.text,
        images: [],
        _meta: {
          persona: cached.persona,
          intent: profile.intent,
          game: profile.game,
          sources: cached.sources || [],
          cached: true,
          latencyMs: Date.now() - startTime,
        },
      });
    }

    // ── LAYER 2: PERSONA-AUGMENTED SYSTEM INSTRUCTION ──
    // GODMODE: when vision is active, prepend the strict observation protocol +
    // game-specific HUD knowledge BEFORE the persona overlay. This forces the
    // model to ground its analysis in pixel-level facts instead of guessing.
    const visionBlock = profile.hasVision ? '\n\n' + buildVisionPrompt(profile) : '';
    // ALWAYS include temporal grounding when a game is detected — not just
    // when PULSE fires. This ensures the model knows today's date even for
    // queries that didn't trigger PULSE but still benefit from temporal context.
    const dateGroundingBlock = (!emotionalTurn && (pulse.fired || resolvedGame)) ? `

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
    // Correction directive goes LAST so it sits closest to the user turn and
    // outranks the persona overlay + accuracy lock in the model's attention.
    const correctionBlock = userIsCorrecting
      ? '\n\n' + buildCorrectionDirective(prompt, resolvedGame)
      : '';
    const systemInstruction = BASE_SYSTEM + dateGroundingBlock + visionBlock + pulse.contextBlock + (profile.persona.overlay || '') + correctionBlock;

    // ── LAYER 3 + 4: route + run mesh ──
    // effectiveAttachments = original images + HUD strip crop (when vision pipe ran).
    // The downstream VLM thus sees [full_frame, hud_zoom] and can cross-reference
    // the high-res HUD strip against the OCR ground-truth block in the prompt.
    stage('generating');
    const meshArgs = {
      systemInstruction,
      chatHistory: boundedHistory,
      userPrompt: augmentedPrompt,
      attachments: effectiveAttachments,
      geminiAi,
      profile,
      meshState,
      rawPrompt: prompt,
    };
    const result = sse
      ? await runNeuralMeshStreaming({
          ...meshArgs,
          onDelta: (t) => sse.send({ type: 'delta', text: t }),
          onCommit: (provider, model) => {
            // Tells the client generation actually started, so it can drop the
            // retrieval spinner and begin rendering.
            console.log(`[MESH-STREAM] ✓ committed to ${provider}/${model}`);
            sse.send({ type: 'stage', stage: 'streaming' });
          },
        })
      : await runNeuralMesh(meshArgs);

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
          const route = planRoute(
            { vision: true, complexity: profile.complexity, intent: profile.intent },
            meshState,
          );
          console.log('[VISION-2OP] route candidates:', route.map(r => r.model.id));
          // Any vision model other than the one that just answered.
          const second = route.find(r => r.model.id !== result.model);
          if (second && Deno.env.get(second.provider.keyEnv)) {
            const messages = buildOpenAIMessages(systemInstruction, boundedHistory, augmentedPrompt, effectiveAttachments, true);
            const altText = await callOpenAICompat(second.provider, second.model.id, messages, {
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

    // Agentic replies are web-grounded by construction — record it so
    // _meta.sources reflects reality rather than only OUR retrieval.
    if (result.model && result.model.includes('compound') && !sourcesList.includes('agentic-websearch')) {
      sourcesList.push('agentic-websearch');
    }

    // ── LAYER 5: quality gate ──
    const skipFollowUps = shouldSkipAutoFollowUps(prompt, finalText, userIsCorrecting);

    // Suppressing the AUTO-append isn't enough: the model often writes its own
    // "[?]" chips despite the instruction not to. Observed on a message saying
    // "nothing matters" — it ended with "[?] What games are you usually
    // playing?", which lands as deflection. Strip them deterministically rather
    // than relying on prompt compliance for something this tone-sensitive.
    if (skipFollowUps) {
      finalText = finalText
        .split('\n')
        .filter(l => !/^\s*\[\?\]/.test(l))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    const polishedText = ensureFollowUps(finalText, profile, skipFollowUps);

    if (!ephemeral) responseCache.set(cKey, {
      text: polishedText,
      provider: result.provider,
      model: result.model,
      persona: profile.persona.name,
      ts: Date.now(),
      sources: sourcesList,
    });

    // Durable trace so "why did it answer that?" stays answerable after the
    // fact — which sources were injected, which model actually replied.
    if (!ephemeral) recordTrace({
      bucket_key: bucket,
      prompt: prompt.slice(0, 2000),
      game: resolvedGame,
      intent: profile.intent,
      persona: profile.persona.name,
      provider: result.provider,
      model: result.model,
      sources: sourcesList,
      vision: profile.hasVision,
      corrected: userIsCorrecting,
      cached: false,
      latency_ms: Date.now() - startTime,
    });

    // NOTE: provider/model deliberately excluded from public response — backend hidden.
    // Server logs still record them via runNeuralMesh's [MESH] ✓ entries.
    return finish({
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
          enrichedAttachmentCount: effectiveAttachments.length,
          ocrApplied: !!visionEnrichment?.diagnostics.ocrApplied,
          ocrLines: visionEnrichment?.diagnostics.ocrLines || 0,
          hudCropApplied: !!visionEnrichment?.diagnostics.cropApplied,
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
    });

  } catch (error: any) {
    console.error('[FATAL]', error);

    return finish({
      text: `**Neural Net Disconnected:** ${friendlyError(error)}`,
      images: [],
      _meta: { error: true },
    });
  }
}
