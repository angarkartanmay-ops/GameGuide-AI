/**
 * CheapShark Price Intelligence Scraper
 * Queries CheapShark's public API (no key needed, CORS-enabled) to find
 * real-time PC game prices across Steam, GOG, Humble, and 20+ stores.
 *
 * API docs: https://apidocs.cheapshark.com/
 */

// In-memory cache: gameName -> { data, timestamp }
const priceCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Store ID → friendly name map (CheapShark store IDs)
const STORE_NAMES = {
  '1': 'Steam',
  '2': 'GamersGate',
  '3': 'GreenManGaming',
  '6': 'GamersGate',
  '7': 'GOG',
  '8': 'Origin',
  '11': 'Humble Store',
  '13': 'Fanatical',
  '15': 'Gamebillet',
  '21': 'WinGameStore',
  '23': 'GameBillet',
  '24': 'WinGameStore',
  '25': 'GamersGate',
  '27': 'Epic Games Store',
  '30': 'IndieGala',
  '31': 'Blizzard',
  '33': 'GamersGate',
  '35': 'Epic Games Store',
};

// Game keyword → search title for CheapShark
const GAME_PRICE_MAP = {
  'elden ring': 'Elden Ring',
  'dark souls': 'Dark Souls',
  'minecraft': 'Minecraft',
  'valorant': 'Valorant',
  'gta v': 'Grand Theft Auto V',
  'gta 5': 'Grand Theft Auto V',
  'gta vi': 'Grand Theft Auto VI',
  'gta 6': 'Grand Theft Auto VI',
  'fortnite': 'Fortnite',
  'overwatch 2': 'Overwatch 2',
  'league of legends': 'League of Legends',
  'apex legends': 'Apex Legends',
  'destiny 2': 'Destiny 2',
  'call of duty': 'Call of Duty',
  'warzone': 'Call of Duty Warzone',
  'cyberpunk 2077': 'Cyberpunk 2077',
  'cyberpunk': 'Cyberpunk 2077',
  'skyrim': 'The Elder Scrolls V Skyrim',
  'witcher 3': 'The Witcher 3',
  'witcher': 'The Witcher 3',
  'halo infinite': 'Halo Infinite',
  'halo': 'Halo Infinite',
  'fallout 4': 'Fallout 4',
  'fallout 76': 'Fallout 76',
  'fallout': 'Fallout 4',
  'red dead': 'Red Dead Redemption 2',
  'rdr2': 'Red Dead Redemption 2',
  'god of war': 'God of War',
  'horizon zero dawn': 'Horizon Zero Dawn',
  'horizon forbidden west': 'Horizon Forbidden West',
  'forza horizon 5': 'Forza Horizon 5',
  'forza horizon 4': 'Forza Horizon 4',
  'forza motorsport': 'Forza Motorsport',
  'resident evil': 'Resident Evil Village',
  'resident evil 4': 'Resident Evil 4',
  'resident evil 4 remake': 'Resident Evil 4',
  'monster hunter': 'Monster Hunter Wilds',
  'monster hunter wilds': 'Monster Hunter Wilds',
  'monster hunter rise': 'Monster Hunter Rise',
  'mh rise': 'Monster Hunter Rise',
  'mh wilds': 'Monster Hunter Wilds',
  'minecraft java edition': 'Minecraft Java',
  'minecraft bedrock': 'Minecraft Bedrock',
  'marvel rivals': 'Marvel Rivals',
  'the finals': 'THE FINALS',
  'delta force': 'Delta Force',
  'black myth wukong': 'Black Myth: Wukong',
  'black myth': 'Black Myth: Wukong',
  'wukong': 'Black Myth: Wukong',
  'helldivers 2': 'Helldivers 2',
  'wuthering waves': 'Wuthering Waves',
  'expedition 33': 'Clair Obscur: Expedition 33',
  'clair obscur': 'Clair Obscur: Expedition 33',
  'silksong': 'Hollow Knight: Silksong',
  'lethal company': 'Lethal Company',
  'phasmophobia': 'Phasmophobia',
  'tekken 8': 'TEKKEN 8',
  'street fighter 6': 'Street Fighter 6',
  'mortal kombat 1': 'Mortal Kombat 1',
  'persona 3 reload': 'Persona 3 Reload',
  'metaphor': 'Metaphor: ReFantazio',
  'metaphor refantazio': 'Metaphor: ReFantazio',
  'hogwarts legacy': 'Hogwarts Legacy',
  'death stranding': 'Death Stranding',
  'sea of thieves': 'Sea of Thieves',
  'manor lords': 'Manor Lords',
  'enshrouded': 'Enshrouded',
  'final fantasy': 'Final Fantasy XIV',
  'ff14': 'Final Fantasy XIV',
  'ffxiv': 'Final Fantasy XIV',
  'doom': 'DOOM Eternal',
  'sekiro': 'Sekiro Shadows Die Twice',
  'hollow knight': 'Hollow Knight',
  'celeste': 'Celeste',
  'baldur': "Baldur's Gate 3",
  'bg3': "Baldur's Gate 3",
  'palworld': 'Palworld',
  'helldivers': 'Helldivers 2',
  'starfield': 'Starfield',
  'diablo iv': 'Diablo IV',
  'diablo 4': 'Diablo IV',
  'borderlands': 'Borderlands 3',
  'mass effect': 'Mass Effect Legendary Edition',
  'dragon age': 'Dragon Age The Veilguard',
  'subnautica': 'Subnautica',
  'no man\'s sky': "No Man's Sky",
  'stardew valley': 'Stardew Valley',
  'terraria': 'Terraria',
  'persona 5': 'Persona 5 Royal',
  'genshin': 'Genshin Impact',
  'rocket league': 'Rocket League',
  'dota 2': 'Dota 2',
  'counter strike': 'Counter-Strike 2',
  'cs2': 'Counter-Strike 2',
  'csgo': 'Counter-Strike 2',
};

/**
 * Detect which game titles to price-check from the user query.
 */
function detectGames(query) {
  const lower = query.toLowerCase();
  const found = new Set();
  for (const [keyword, title] of Object.entries(GAME_PRICE_MAP)) {
    if (lower.includes(keyword)) {
      found.add(title);
    }
  }
  return [...found].slice(0, 2); // max 2 games
}

/**
 * Token-based similarity scoring. Higher = more relevant.
 * Used to pick the "right" game from CheapShark's fuzzy search results.
 */
function scoreTitleMatch(candidate, target) {
  const c = candidate.toLowerCase().trim();
  const t = target.toLowerCase().trim();
  if (c === t) return 1000;                            // exact match wins
  if (c === t + ' edition' || t === c + ' edition') return 800;

  const cTokens = new Set(c.split(/[^a-z0-9]+/).filter(Boolean));
  const tTokens = new Set(t.split(/[^a-z0-9]+/).filter(Boolean));
  let overlap = 0;
  for (const tok of tTokens) if (cTokens.has(tok)) overlap++;
  const tokenScore = (overlap / Math.max(tTokens.size, 1)) * 100;

  // Prefer the candidate that contains the WHOLE target as a phrase
  const containsScore = c.includes(t) ? 50 : 0;

  // Penalize length distance — "Minecraft Legends" (heavily padded) vs "Minecraft"
  const lengthPenalty = Math.abs(c.length - t.length) * 0.3;

  // Penalize spin-off subtitles when target lacks them
  const spinoffWords = ['legends', 'remake', 'remastered', 'definitive', 'enhanced', 'gold', 'deluxe', 'ultimate', 'collection', 'goty', 'season pass', 'dlc'];
  let spinoffPenalty = 0;
  if (!spinoffWords.some(w => t.includes(w))) {
    for (const w of spinoffWords) if (c.includes(w)) spinoffPenalty += 12;
  }

  return tokenScore + containsScore - lengthPenalty - spinoffPenalty;
}

function pickBestMatch(games, target) {
  if (!Array.isArray(games) || games.length === 0) return null;
  const scored = games.map(g => ({ g, score: scoreTitleMatch(g.title || '', target) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].g;
}

/**
 * Fetch price data from CheapShark.
 *
 * Strategy: try exact-match first (CheapShark's `exact=1`). If that returns
 * no results, fall back to fuzzy search and pick the best result by
 * token-similarity scoring instead of blindly taking games[0]. This fixes
 * cases like "minecraft" → "Minecraft Legends" (CheapShark's fuzzy ranking
 * preferred the spin-off).
 */
async function fetchGamePrice(gameTitle) {
  let games = null;

  // ── Step 1a: try exact match first ───────────────────────────────────────
  try {
    const exactRes = await fetch(
      `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(gameTitle)}&limit=5&exact=1`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (exactRes.ok) {
      const exactGames = await exactRes.json();
      if (Array.isArray(exactGames) && exactGames.length > 0) games = exactGames;
    }
  } catch { /* fall through to fuzzy */ }

  // ── Step 1b: fuzzy fallback with smart scoring ──────────────────────────
  if (!games) {
    const fuzzyRes = await fetch(
      `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(gameTitle)}&limit=8&exact=0`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!fuzzyRes.ok) return null;
    games = await fuzzyRes.json();
    if (!Array.isArray(games) || games.length === 0) return null;
  }

  const topGame = pickBestMatch(games, gameTitle);
  if (!topGame) return null;

  // ── Step 2: detailed pricing (includes cheapestPriceEver + deals) ───────
  const detailRes = await fetch(
    `https://www.cheapshark.com/api/1.0/games?id=${topGame.gameID}`,
    { headers: { 'Accept': 'application/json' } }
  );
  if (!detailRes.ok) {
    return {
      title: topGame.title || gameTitle,
      cheapest: topGame.cheapest,
      cheapestEver: null,
      deals: [],
      thumb: topGame.thumb,
    };
  }

  const detail = await detailRes.json();
  const deals = (detail.deals || [])
    .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
    .slice(0, 4);

  return {
    title: detail.info?.title || topGame.title || gameTitle,
    cheapest: topGame.cheapest,
    cheapestEver: detail.cheapestPriceEver || null,
    deals: deals.map(d => ({
      store: STORE_NAMES[d.storeID] || `Store #${d.storeID}`,
      price: d.price,
      retailPrice: d.retailPrice,
      savings: Math.round(parseFloat(d.savings || 0)),
    })),
    thumb: topGame.thumb,
  };
}

/**
 * Direct, single-game price lookup — used by the /price slash command.
 * Skips the noisy `detectGames()` heuristic entirely and uses the user's
 * literal input as the search title. Returns the same context-string
 * shape as fetchPrices() so the command can render it identically.
 */
export async function fetchPriceDirect(gameTitle) {
  if (!gameTitle || !gameTitle.trim()) return '';
  const cacheKey = `price-direct:${gameTitle.toLowerCase().trim()}`;
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

  try {
    const result = await fetchGamePrice(gameTitle.trim());
    if (!result) return '';
    const formatted = formatPriceContext([result]);
    priceCache.set(cacheKey, { data: formatted, timestamp: Date.now() });
    return formatted;
  } catch {
    return '';
  }
}

/**
 * Direct, summary-only variant — for the PriceBadge UI.
 */
export async function fetchPriceSummaryDirect(gameTitle) {
  if (!gameTitle || !gameTitle.trim()) return [];
  try {
    const result = await fetchGamePrice(gameTitle.trim());
    return result ? [result] : [];
  } catch {
    return [];
  }
}

/**
 * Main entry: fetch prices for games detected in the query.
 * Returns a formatted context string for the AI, or '' if nothing found.
 */
export async function fetchPrices(query) {
  const cacheKey = `price:${query.toLowerCase().trim()}`;
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const gameTitles = detectGames(query);
  if (gameTitles.length === 0) return '';

  try {
    const results = await Promise.allSettled(gameTitles.map(fetchGamePrice));

    const priceData = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    if (priceData.length === 0) return '';

    const formatted = formatPriceContext(priceData);
    priceCache.set(cacheKey, { data: formatted, timestamp: Date.now() });
    return formatted;
  } catch (err) {
    console.warn('Price scraper failed (graceful fallback):', err.message);
    return '';
  }
}

/**
 * Format price data into a clean AI context block.
 */
function formatPriceContext(priceData) {
  if (!priceData.length) return '';

  let context = '=== LIVE PRICE INTEL (CheapShark) ===\n';
  for (const game of priceData) {
    context += `\n💰 "${game.title}"\n`;
    context += `  Current Lowest Price: $${game.cheapest}\n`;

    if (game.cheapestEver) {
      const isAtLow = parseFloat(game.cheapest) <= parseFloat(game.cheapestEver.price);
      context += `  Historic Low: $${game.cheapestEver.price}`;
      context += isAtLow ? ' ← AT HISTORIC LOW RIGHT NOW!\n' : '\n';
    }

    if (game.deals.length > 0) {
      context += '  Store Deals:\n';
      for (const deal of game.deals.slice(0, 3)) {
        const badge = deal.savings >= 50 ? ' 🔥' : deal.savings >= 25 ? ' ⬇️' : '';
        context += `    • ${deal.store}: $${deal.price}`;
        if (deal.savings > 0) context += ` (${deal.savings}% off retail $${deal.retailPrice})${badge}`;
        context += '\n';
      }
    }
  }
  context += '\n=== END PRICE INTEL ===';
  return context;
}

/**
 * Lightweight version for UI badge display (separate from AI context).
 * Returns structured data for rendering PriceBadge component.
 */
export async function fetchPricesSummary(query) {
  const gameTitles = detectGames(query);
  if (gameTitles.length === 0) return [];

  try {
    const results = await Promise.allSettled(gameTitles.map(fetchGamePrice));
    return results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);
  } catch {
    return [];
  }
}
