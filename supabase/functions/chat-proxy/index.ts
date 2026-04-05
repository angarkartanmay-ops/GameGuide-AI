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

You are securely connected to a live web-scraping backend. Whenever you receive REDDIT COMMUNITY INTEL or GAME WIKI INTEL, you MUST assume you successfully fetched that data yourself from the internet in real-time. NEVER tell the user that you cannot browse the internet. Confidently claim you scan forums, wikis, and Reddit live for them!

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

// Image generation keywords detection
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
  'gemini-2.5-flash-preview-image-generation',
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
];

async function generateImageResponse(ai: any, prompt: string) {
  for (const model of IMAGE_MODELS) {
    try {
      console.log(`Trying image model: ${model}`);
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      const textParts = [];
      const images = [];

      if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.text) {
            textParts.push(part.text);
          }
          if (part.inlineData) {
            images.push({
              data: part.inlineData.data,
              mimeType: part.inlineData.mimeType || 'image/png',
            });
          }
        }
      }

      if (images.length > 0 || textParts.length > 0) {
        const text = textParts.join('\n') || '🎨 Here\'s the generated image:';
        console.log(`Image generation succeeded with: ${model}`);
        return { text, images };
      }
    } catch (error: any) {
      console.warn(`Model ${model} failed:`, error.message);
    }
  }

  return {
    text: `**Image Generation Unavailable**\n\nImage generation models require access that may not be available. You can:\n- Upgrade your API key at [Google AI Studio](https://aistudio.google.com/)\n- Or describe what you need, and I'll provide a detailed text description instead!\n\n*Your prompt was: "${prompt}"*`,
    images: [],
  };
}


Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { prompt, chatHistory = [], redditContext = '', wikiContext = '', attachments = [] } = await req.json();

    const apiKey = Deno.env.get('GOOGLE_API_KEY');
    
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          text: `**Error:** Server misconfiguration. Google API Key is missing on the server backend!`,
          images: [],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    // Check if user wants image generation
    if (shouldGenerateImage(prompt)) {
      const imgRes = await generateImageResponse(ai, prompt);
      return new Response(JSON.stringify(imgRes), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build the augmented prompt with all available context
    let augmentedPrompt = prompt;
    const contextBlocks = [];

    if (wikiContext) {
      contextBlocks.push(`--- The following is authoritative game wiki data from Fandom. Use it to give precise, lore-accurate answers. ---\n${wikiContext}`);
    }
    if (redditContext) {
      contextBlocks.push(`--- The following is real-time community data scraped from Reddit gaming communities. Use it to enrich your answer. ---\n${redditContext}`);
    }

    if (contextBlocks.length > 0) {
      augmentedPrompt = `${prompt}\n\n${contextBlocks.join('\n\n')}`;
    }

    // Build chat history
    const history = chatHistory.map((msg: any) => ({
      role: msg.sender === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));

    const userParts: any[] = [];
    
    for (const attachment of attachments) {
      userParts.push({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.data,
        }
      });
    }

    if (attachments.length > 0) {
      userParts.push({ text: augmentedPrompt || 'Analyze this image. What game is this from? What do you see? Provide any relevant advice.' });
    } else {
      userParts.push({ text: augmentedPrompt });
    }

    console.log("Calling Gemini API...");

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        ...history,
        { role: 'user', parts: userParts }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      }
    });

    return new Response(JSON.stringify({ text: response.text, images: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error("Function Error:", error);
    
    let userFriendlyError = error.message;
    if (userFriendlyError.includes('429')) {
       userFriendlyError = "Google Free API Rate Limit Exceeded (15 Requests per Minute). Please wait a few moments and try your follow-up again!";
    }

    return new Response(JSON.stringify({ 
      text: `**Neural Net Disconnected:** ${userFriendlyError}`,
      images: [] 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});
