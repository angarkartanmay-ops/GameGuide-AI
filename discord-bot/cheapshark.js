// ═══════════════════════════════════════════════════════════════════════════
//  CheapShark Price Intelligence — Discord bot port of src/services/priceScraper.js
//  ───────────────────────────────────────────────────────────────────────
//  Hits CheapShark's public API directly (no API key) to return real,
//  structured pricing data for the /price slash command. This mirrors the
//  web app's /price flow — which short-circuits the LLM entirely — so the
//  Discord bot stops falling back to web-search guesses.
//
//  API docs: https://apidocs.cheapshark.com/
// ═══════════════════════════════════════════════════════════════════════════

const priceCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min — matches web app

// CheapShark store-ID → friendly name
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

// Same scoring heuristic the web app uses so we pick "Minecraft" over
// "Minecraft Legends" when both match a fuzzy search.
function scoreTitleMatch(candidate, target) {
  const c = candidate.toLowerCase().trim();
  const t = target.toLowerCase().trim();
  if (c === t) return 1000;
  if (c === t + ' edition' || t === c + ' edition') return 800;

  const cTokens = new Set(c.split(/[^a-z0-9]+/).filter(Boolean));
  const tTokens = new Set(t.split(/[^a-z0-9]+/).filter(Boolean));
  let overlap = 0;
  for (const tok of tTokens) if (cTokens.has(tok)) overlap++;
  const tokenScore = (overlap / Math.max(tTokens.size, 1)) * 100;

  const containsScore = c.includes(t) ? 50 : 0;
  const lengthPenalty = Math.abs(c.length - t.length) * 0.3;

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

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'GameGuide-Discord-Bot/2.0' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGamePrice(gameTitle) {
  let games = null;

  // Step 1a — exact match
  const exactGames = await fetchJson(
    `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(gameTitle)}&limit=5&exact=1`
  );
  if (Array.isArray(exactGames) && exactGames.length > 0) games = exactGames;

  // Step 1b — fuzzy fallback
  if (!games) {
    const fuzzyGames = await fetchJson(
      `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(gameTitle)}&limit=8&exact=0`
    );
    if (!Array.isArray(fuzzyGames) || fuzzyGames.length === 0) return null;
    games = fuzzyGames;
  }

  const topGame = pickBestMatch(games, gameTitle);
  if (!topGame) return null;

  // Step 2 — detailed pricing (deals + cheapestPriceEver)
  const detail = await fetchJson(
    `https://www.cheapshark.com/api/1.0/games?id=${topGame.gameID}`
  );

  if (!detail) {
    return {
      title: topGame.title || gameTitle,
      cheapest: topGame.cheapest,
      cheapestEver: null,
      deals: [],
      thumb: topGame.thumb,
    };
  }

  const deals = (detail.deals || [])
    .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
    .slice(0, 4);

  return {
    title: detail.info?.title || topGame.title || gameTitle,
    cheapest: topGame.cheapest,
    cheapestEver: detail.cheapestPriceEver || null,
    deals: deals.map(d => ({
      store: STORE_NAMES[d.storeID] || `Store #${d.storeID}`,
      storeID: d.storeID,
      dealID: d.dealID,
      price: d.price,
      retailPrice: d.retailPrice,
      savings: Math.round(parseFloat(d.savings || 0)),
      // CheapShark redirect URL — drops the user on the store page for that deal.
      url: d.dealID ? `https://www.cheapshark.com/redirect?dealID=${d.dealID}` : null,
    })),
    thumb: topGame.thumb,
  };
}

/**
 * Primary entry — direct lookup for the /price slash command.
 * Cached for 15 min. Returns null on any failure (caller falls back to LLM).
 */
async function fetchPriceDirect(gameTitle) {
  if (!gameTitle || !gameTitle.trim()) return null;
  const key = gameTitle.toLowerCase().trim();
  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

  try {
    const result = await fetchGamePrice(gameTitle.trim());
    if (result) priceCache.set(key, { data: result, timestamp: Date.now() });
    return result;
  } catch {
    return null;
  }
}

module.exports = {
  fetchPriceDirect,
  STORE_NAMES,
};
