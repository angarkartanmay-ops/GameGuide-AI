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
  'horizon': 'Horizon Zero Dawn',
  'resident evil': 'Resident Evil Village',
  'monster hunter': 'Monster Hunter World',
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
 * Fetch price data from CheapShark for a specific game title.
 */
async function fetchGamePrice(gameTitle) {
  // Step 1: Search for the game by name
  const searchRes = await fetch(
    `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(gameTitle)}&limit=3&exact=0`,
    { headers: { 'Accept': 'application/json' } }
  );
  if (!searchRes.ok) return null;

  const games = await searchRes.json();
  if (!games || games.length === 0) return null;

  const topGame = games[0];

  // Step 2: Get detailed pricing for the top match (includes cheapest ever)
  const detailRes = await fetch(
    `https://www.cheapshark.com/api/1.0/games?id=${topGame.gameID}`,
    { headers: { 'Accept': 'application/json' } }
  );
  if (!detailRes.ok) {
    // Fallback: return just basic cheapest price
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
