import { GoogleGenAI } from "npm:@google/genai";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// System prompt specific to GameGuide-AI personality
const SYSTEM_INSTRUCTION = `
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

const IMAGE_MODELS = [
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

async function generateImageWithRetry(ai: any, prompt: string) {
  for (const model of IMAGE_MODELS) {
    try {
      console.log(`Trying image generation with: ${model}`);
      // Note: Image generation usually needs special access or specific model variations.
      // We will attempt with standard models first.
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      // ... image parsing logic
      const textParts = [];
      const images = [];
      if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.text) textParts.push(part.text);
          if (part.inlineData) images.push({ data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' });
        }
      }
      if (images.length > 0) return { text: textParts.join('\n') || '🎨 Done!', images };
    } catch (e) { console.warn(`Image model ${model} failed:`, e.message); }
  }
  return null;
}

const MODELS_TO_TRY = ['gemini-1.5-pro', 'gemini-1.5-flash'];

async function callAiWithRetry(ai: any, contents: any, systemInstruction: string) {
  let lastError = null;

  for (const model of MODELS_TO_TRY) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`Calling Gemini API (Model: ${model}, Attempt: ${attempt})...`);
        const result = await ai.models.generateContent({
          model,
          contents,
          config: { systemInstruction }
        });
        return result.text;
      } catch (error: any) {
        lastError = error;
        const status = error.status || "";
        const message = error.message.toLowerCase();
        
        console.warn(`Attempt ${attempt} on ${model} failed:`, message);

        // If it's a 503 (Unavailable/High Demand) or 429 (Rate Limit), wait and retry
        if (message.includes('503') || message.includes('429') || message.includes('unavailable') || message.includes('demand')) {
          if (attempt < 2) {
            const delay = attempt * 1500;
            console.log(`Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
        } else {
          // If it's a permanent error (like 400 Bad Request), don't retry this model
          break;
        }
      }
    }
  }
  throw lastError;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { prompt, chatHistory = [], redditContext = '', wikiContext = '', priceContext = '', attachments = [] } = await req.json();
    const apiKey = Deno.env.get('GOOGLE_API_KEY');
    
    if (!apiKey) {
      return new Response(JSON.stringify({ text: `**Error:** Server misconfiguration. API Key missing.` }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const ai = new GoogleGenAI({ apiKey });

    // Handle Image Generation
    if (shouldGenerateImage(prompt)) {
      const imgRes = await generateImageWithRetry(ai, prompt);
      if (imgRes) return new Response(JSON.stringify(imgRes), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Build Augmented Prompt — labels must match what SYSTEM_INSTRUCTION expects
    const contextBlocks = [];
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

    // Build Contents
    const history = chatHistory.map((msg: any) => ({
      role: msg.sender === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));

    const userParts: any[] = [];
    for (const attachment of attachments) {
      userParts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
    }
    userParts.push({ text: augmentedPrompt || 'Analyze this image.' });

    const responseText = await callAiWithRetry(ai, [...history, { role: 'user', parts: userParts }], SYSTEM_INSTRUCTION);

    return new Response(JSON.stringify({ text: responseText, images: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error("Critical Function Error:", error);
    
    let friendly = error.message;
    if (friendly.includes('503') || friendly.includes('demand')) {
      friendly = "The Neural Net is currently under heavy load (503 Service Unavailable). The high demand is temporary—please try again in a moment!";
    } else if (friendly.includes('429')) {
      friendly = "API Rate Limit Exceeded. We are optimizing our throughput—please wait 10 seconds and try again.";
    }

    return new Response(JSON.stringify({ 
      text: `**Neural Net Disconnected:** ${friendly}`,
      images: [] 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});
