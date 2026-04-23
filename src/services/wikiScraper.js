/**
 * Fandom Wiki & Game Knowledge Scraper
 * Searches game-specific wikis on fandom.com for deep lore, mechanics, and guides.
 */

// In-memory cache: cacheKey -> { data, timestamp }
const wikiCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes (wiki content changes less often)

// Map of game keywords → fandom wiki subdomain
const GAME_WIKI_MAP = {
  'elden ring': 'eldenring',
  'dark souls': 'darksouls',
  'dark souls 3': 'darksouls',
  'dark souls 2': 'darksouls2',
  'minecraft': 'minecraft',
  'valorant': 'valorant',
  'gta': 'gta',
  'gta v': 'gta',
  'gta 5': 'gta',
  'gta 6': 'gta',
  'fortnite': 'fortnite',
  'overwatch': 'overwatch',
  'overwatch 2': 'overwatch',
  'league of legends': 'leagueoflegends',
  'lol': 'leagueoflegends',
  'apex legends': 'apexlegends',
  'apex': 'apexlegends',
  'destiny': 'destinypedia',
  'destiny 2': 'destinypedia',
  'call of duty': 'callofduty',
  'cod': 'callofduty',
  'warzone': 'callofduty',
  'zelda': 'zelda',
  'tears of the kingdom': 'zelda',
  'totk': 'zelda',
  'breath of the wild': 'zelda',
  'botw': 'zelda',
  'pokemon': 'pokemon',
  'cyberpunk': 'cyberpunk',
  'cyberpunk 2077': 'cyberpunk',
  'skyrim': 'elderscrolls',
  'elder scrolls': 'elderscrolls',
  'witcher': 'witcher',
  'witcher 3': 'witcher',
  'halo': 'halo',
  'halo infinite': 'halo',
  'fallout': 'fallout',
  'fallout 4': 'fallout',
  'rocket league': 'rocketleague',
  'terraria': 'terraria',
  'stardew valley': 'stardew',
  'stardew': 'stardew',
  'baldur\'s gate': 'baldursgate3',
  'baldur\'s gate 3': 'baldursgate3',
  'bg3': 'baldursgate3',
  'palworld': 'palworld',
  'helldivers': 'helldivers',
  'helldivers 2': 'helldivers',
  'red dead': 'reddead',
  'red dead redemption': 'reddead',
  'rdr2': 'reddead',
  'god of war': 'godofwar',
  'horizon': 'horizon',
  'resident evil': 'residentevil',
  'monster hunter': 'monsterhunter',
  'final fantasy': 'finalfantasy',
  'ff14': 'finalfantasy',
  'ffxiv': 'finalfantasy',
  'doom': 'doom',
  'sekiro': 'sekiroshadowsdietwice',
  'hollow knight': 'hollowknight',
  'celeste': 'celeste',
  'mario': 'mario',
  'super mario': 'mario',
  'animal crossing': 'animalcrossing',
  'splatoon': 'splatoon',
  'among us': 'among-us',
  'roblox': 'roblox',
  'clash royale': 'clashroyale',
  'clash of clans': 'clashofclans',
  'genshin': 'genshin-impact',
  'genshin impact': 'genshin-impact',
  'honkai': 'honkaistarrail',
  'honkai star rail': 'honkaistarrail',
  'diablo': 'diablo',
  'diablo 4': 'diablo',
  'world of warcraft': 'wowpedia',
  'wow': 'wowpedia',
  'dota': 'dota2',
  'dota 2': 'dota2',
  'counter strike': 'counterstrike',
  'cs2': 'counterstrike',
  'csgo': 'counterstrike',
  'persona': 'megamitensei',
  'persona 5': 'megamitensei',
  'borderlands': 'borderlands',
  'mass effect': 'masseffect',
  'dragon age': 'dragonage',
  'subnautica': 'subnautica',
  'no man\'s sky': 'nomanssky',
  'starfield': 'starfield',
  'pubg': 'pubg',
  'free fire': 'freefire',
  'marvel future fight': 'marvelcontestofchampions', // closest available
  'marvel future': 'marvelcontestofchampions',
  'mff': 'marvelcontestofchampions',
  'brawl stars': 'brawlstars',
  'brawl': 'brawlstars',
  'squad busters': 'squadbusters',
  'hay day': 'hayday',
  'clash mini': 'clashmini',
  'wild rift': 'leagueoflegends',
  'cod mobile': 'callofduty',
  'call of duty mobile': 'callofduty',
  'pokemon go': 'pokemongo',
  'pokemon tcg pocket': 'pokemontcgpocket',
  'bgmi': 'battlegroundsmobileindia',
  'efootball': 'efootball',
  'hades': 'hades',
  'dead cells': 'deadcells',
  'slay the spire': 'slay-the-spire',
  'vampire survivors': 'vampiresurvivors',
  'mobile legends': 'mobile-legends-bang-bang',
  'subway surfers': 'subwaysurfers',
};

/**
 * Detect which fandom wiki(s) to search based on the user's query.
 */
function detectWikis(query) {
  const lower = query.toLowerCase();
  const wikis = new Set();

  for (const [keyword, wiki] of Object.entries(GAME_WIKI_MAP)) {
    if (lower.includes(keyword)) {
      wikis.add(wiki);
    }
  }

  return [...wikis];
}

/**
 * Search a specific fandom wiki for articles matching the query.
 */
async function searchWiki(wikiName, query) {
  try {
    const url = `/api/wiki/search?game=${encodeURIComponent(wikiName)}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    // OpenSearch format: [searchTerm, [titles], [descriptions], [urls]]
    if (Array.isArray(data) && data.length >= 2) {
      return data[1].slice(0, 3); // Return top 3 article titles
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Fetch the content of a specific wiki article.
 */
async function fetchArticle(wikiName, title) {
  try {
    const url = `/api/wiki/article?game=${encodeURIComponent(wikiName)}&title=${encodeURIComponent(title)}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return null;

    // MediaWiki returns pages keyed by page ID
    const pageId = Object.keys(pages)[0];
    if (pageId === '-1') return null; // Page not found

    const extract = pages[pageId]?.extract;
    if (!extract) return null;

    return {
      title: pages[pageId].title,
      content: extract.substring(0, 2000), // 2000 chars: enough to capture patch notes
    };
  } catch {
    return null;
  }
}

/**
 * Main entry: scrape wiki knowledge for a user query.
 * Returns a formatted context string for the AI.
 */
export async function searchWikis(query) {
  const cacheKey = `wiki:${query.toLowerCase().trim()}`;
  const cached = wikiCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const wikis = detectWikis(query);
  if (wikis.length === 0) return '';

  try {
    const allArticles = [];

    // Search up to 3 wikis max (was 2)
    for (const wiki of wikis.slice(0, 3)) {
      const titles = await searchWiki(wiki, query);

      // Fetch top 2 articles per wiki
      for (const title of titles.slice(0, 2)) {
        const article = await fetchArticle(wiki, title);
        if (article) {
          allArticles.push({ wiki, ...article });
        }
      }
    }

    if (allArticles.length === 0) return '';

    const formatted = formatWikiContext(allArticles);
    wikiCache.set(cacheKey, { data: formatted, timestamp: Date.now() });
    return formatted;
  } catch (error) {
    console.warn('Wiki scraper failed (graceful fallback):', error.message);
    return '';
  }
}

function formatWikiContext(articles) {
  if (!articles.length) return '';

  let context = '=== GAME WIKI INTEL ===\n';
  for (const article of articles) {
    context += `\n📖 [${article.wiki}.fandom.com] "${article.title}"\n`;
    context += `${article.content}\n`;
  }
  context += '\n=== END WIKI INTEL ===';
  return context;
}
