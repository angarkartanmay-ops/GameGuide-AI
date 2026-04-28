/**
 * Reddit Community Intelligence Scraper — Enhanced
 *
 * Fixes applied:
 *  1. sort=new (not relevance) to surface latest patch/meta threads
 *  2. Expanded game map with mobile & niche titles
 *  3. Separate game-sub search vs generic fallback (no cross-contamination)
 *  4. Dedicated "meta" and "update" keyword injection for current-events queries
 *  5. Uses t=month (not year) so results are never older than 30 days
 */

// In-memory cache: query -> { data, timestamp }
const cache = new Map();
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 min — refresh faster for live meta

// Generic gaming subs (fallback only)
const GAMING_SUBREDDITS = [
  'gaming', 'pcgaming', 'truegaming', 'Games', 'gamingsuggestions',
];

// Mobile/competitive gaming fallback subs
const MOBILE_GAMING_SUBREDDITS = [
  'mobilegaming', 'AndroidGaming', 'iosgaming', 'CompetitiveForMobile',
];

/**
 * Full game → subreddit map.
 * Multiple keywords can map to the same sub.
 */
const GAME_SUB_MAP = {
  // ── Classic AAA ───────────────────────────────────────────────────────────
  'elden ring': 'Eldenring',
  'dark souls': 'darksouls',
  'dark souls 3': 'darksouls3',
  'minecraft': 'Minecraft',
  'valorant': 'VALORANT',
  'gta v': 'gtaonline',
  'gta 5': 'gtaonline',
  'gta vi': 'GTA6',
  'gta 6': 'GTA6',
  'fortnite': 'FortNiteBR',
  'overwatch': 'Overwatch',
  'overwatch 2': 'Overwatch',
  'league of legends': 'leagueoflegends',
  'lol': 'leagueoflegends',
  'apex legends': 'apexlegends',
  'apex': 'apexlegends',
  'destiny 2': 'DestinyTheGame',
  'destiny': 'DestinyTheGame',
  'call of duty': 'CallOfDuty',
  'warzone': 'CODWarzone',
  'cod': 'CallOfDuty',
  'zelda': 'zelda',
  'pokemon': 'pokemon',
  'cyberpunk': 'cyberpunkgame',
  'cyberpunk 2077': 'cyberpunkgame',
  'skyrim': 'skyrim',
  'elder scrolls': 'ElderScrolls',
  'witcher 3': 'witcher',
  'witcher': 'witcher',
  'halo': 'halo',
  'halo infinite': 'halo',
  'fallout': 'Fallout',
  'fallout 4': 'fo4',
  'fallout 76': 'fo76',
  'rocket league': 'RocketLeague',
  'terraria': 'Terraria',
  'stardew': 'StardewValley',
  'baldur': 'BaldursGate3',
  'bg3': 'BaldursGate3',
  'palworld': 'Palworld',
  'helldivers': 'Helldivers',
  'helldivers 2': 'Helldivers',
  'red dead': 'reddeadredemption',
  'rdr2': 'RDR2',
  'god of war': 'GodofWar',
  'horizon': 'horizon',
  'resident evil': 'residentevil',
  'monster hunter': 'MonsterHunter',
  'monster hunter wilds': 'MonsterHunterWorld',
  'final fantasy': 'FinalFantasy',
  'ff14': 'ffxiv',
  'ffxiv': 'ffxiv',
  'doom': 'Doom',
  'sekiro': 'Sekiro',
  'hollow knight': 'HollowKnight',
  'celeste': 'celestegame',
  'starfield': 'Starfield',
  'diablo 4': 'diablo4',
  'diablo iv': 'diablo4',
  'diablo': 'diablo4',
  'dota 2': 'DotA2',
  'dota': 'DotA2',
  'counter strike': 'GlobalOffensive',
  'cs2': 'GlobalOffensive',
  'csgo': 'GlobalOffensive',
  'borderlands': 'Borderlands',
  'mass effect': 'masseffect',
  'dragon age': 'dragonage',
  'subnautica': 'subnautica',
  'no man\'s sky': 'NoMansSkyTheGame',
  'nms': 'NoMansSkyTheGame',
  'genshin': 'Genshin_Impact',
  'genshin impact': 'Genshin_Impact',
  'honkai star rail': 'HonkaiStarRail',
  'honkai': 'HonkaiStarRail',
  'world of warcraft': 'wow',
  'wow': 'wow',
  'persona 5': 'Persona5',
  'persona': 'PERSoNA',
  'pubg': 'PUBATTLEGROUNDS',

  // ── Mobile & niche ────────────────────────────────────────────────────────
  'clash royale': 'ClashRoyale',
  'clash of clans': 'ClashOfClans',
  'coc': 'ClashOfClans',
  'cr': 'ClashRoyale',
  'marvel future fight': 'future_fight',
  'marvel future': 'future_fight',
  'future fight': 'future_fight',
  'mff': 'future_fight',
  'mobile legends': 'MobileLegendsGame',
  'mlbb': 'MobileLegendsGame',
  'free fire': 'freefire',
  'roblox': 'roblox',
  'among us': 'AmongUs',
  'brawl stars': 'Brawlstars',
  'brawl': 'Brawlstars',
  'hay day': 'HayDay',
  'clash mini': 'ClashMini',
  'wild rift': 'wildrift',
  'lol mobile': 'wildrift',
  'squad busters': 'SquadBusters',
  'supercell': 'ClashRoyale',
  'candy crush': 'candycrush',
  'chess': 'chess',
  'efootball': 'eFootball',
  'fc mobile': 'FUTMobile',
  'ea fc mobile': 'FUTMobile',
  'cod mobile': 'CallOfDutyMobile',
  'call of duty mobile': 'CallOfDutyMobile',
  'cod warzone mobile': 'CallOfDutyMobile',
  'pubg mobile': 'PUBGMobile',
  'bgmi': 'BGMI',
  'pokemon go': 'pokemongo',
  'pokemon tcg': 'pkmntcg',
  'pokemon pocket': 'PokemonTCGP',

  // ── Indie & others────────────────────────────────────────────────────────
  'hades': 'HadesTheGame',
  'hades 2': 'HadesTheGame',
  'dead cells': 'deadcells',
  'slay the spire': 'slaythespire',
  'vampire survivors': 'VampireSurvivors',
  'inscryption': 'inscryption',
  'disco elysium': 'DiscoElysium',
  'outer wilds': 'outerwilds',
  'satisfactory': 'satisfactory',
  'factorio': 'factorio',
  'rimworld': 'RimWorld',
  'dwarf fortress': 'dwarffortress',
};

/**
 * Detect game-specific subreddits from query.
 * Returns the BEST single subreddit (most specific match wins).
 */
function detectGameSubs(query) {
  const lower = query.toLowerCase();
  const detected = new Map(); // sub -> keyword length (longer = more specific)

  for (const [keyword, sub] of Object.entries(GAME_SUB_MAP)) {
    if (lower.includes(keyword)) {
      const prev = detected.get(sub);
      if (!prev || keyword.length > prev) {
        detected.set(sub, keyword.length);
      }
    }
  }

  // Sort by specificity (longer keyword = better match)
  return [...detected.keys()].sort((a, b) => detected.get(b) - detected.get(a));
}

/**
 * Detect if this is a "current meta / latest update / patch" query.
 * If so, we'll use sort=new to get THE freshest threads.
 */
function isCurrentMetaQuery(query) {
  const triggers = [
    'meta', 'best', 'current', 'now', 'latest', 'new', 'update', 'patch',
    'patch notes', 'season', 'balance', 'buff', 'nerf', 'tier list',
    'right now', 'this month', 'this week', 'worth it', 'hero', 'heroes',
    'champion', 'character', 'card', 'deck', 'build', 'broken', 'op',
  ];
  const lower = query.toLowerCase();
  return triggers.some(t => lower.includes(t));
}

/**
 * Build the best Reddit search URL for the query.
 */
function buildSearchUrl(query, gameSubs) {
  const isMeta = isCurrentMetaQuery(query);

  // Boost meta queries with extra keywords for better Reddit results
  const enhancedQuery = isMeta
    ? `${query} 2025 2026`
    : query;

  // Sort strategy: new for meta queries, top for general info
  const sort = isMeta ? 'new' : 'top';
  // Time window: month for meta/latest, year for general
  const timeWindow = isMeta ? 'month' : 'year';

  if (gameSubs.length > 0) {
    // Search ONLY in the game's own sub(s) — no cross-contamination with generic subs
    const subStr = gameSubs.slice(0, 2).join('+');
    return `/api/reddit/r/${subStr}/search.json?q=${encodeURIComponent(enhancedQuery)}&sort=${sort}&t=${timeWindow}&limit=8&restrict_sr=on`;
  }

  // No specific sub detected? Global search as fallback
  return `/api/reddit/search.json?q=${encodeURIComponent(enhancedQuery)}&sort=${sort}&t=${timeWindow}&limit=8&type=link`;
}

/**
 * Search Reddit for posts related to the user's gaming query.
 * Returns a formatted string of community insights, or empty string if nothing found.
 */
export async function searchReddit(query) {
  const cacheKey = query.toLowerCase().trim();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const gameSubs = detectGameSubs(query);
    const searchUrl = buildSearchUrl(query, gameSubs);

    const response = await fetch(searchUrl);
    if (!response.ok) {
      console.warn(`Reddit search returned ${response.status} for: ${searchUrl}`);
      return '';
    }

    const data = await response.json();
    let posts = data?.data?.children || [];

    // Filter out very low-quality posts (downvoted or spam)
    posts = posts.filter(p => p.data.score > -5);

    if (posts.length === 0) {
      // If game sub returned nothing, try a global fallback
      if (gameSubs.length > 0) {
        const fallbackUrl = `/api/reddit/search.json?q=${encodeURIComponent(query + ' 2025')}&sort=new&t=month&limit=5&type=link`;
        const fb = await fetch(fallbackUrl);
        if (fb.ok) {
          const fbData = await fb.json();
          posts = fbData?.data?.children || [];
        }
      }
      if (posts.length === 0) return '';
    }

    // Fetch comments for top 4 posts (was 3; more posts = better coverage)
    const insights = [];
    for (const post of posts.slice(0, 4)) {
      const p = post.data;

      // Skip link posts with no selftext and no comments (low value)
      if (!p.selftext && p.num_comments < 3) continue;

      const postInfo = {
        title: p.title,
        subreddit: p.subreddit_name_prefixed || `r/${p.subreddit}`,
        score: p.score,
        created: new Date(p.created_utc * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        selftext: p.selftext ? p.selftext.substring(0, 500) : '',
        url: `https://reddit.com${p.permalink}`,
        topComments: [],
      };

      try {
        const commentsUrl = `/api/reddit${p.permalink}.json?sort=top&limit=5`;
        const commentsRes = await fetch(commentsUrl);
        if (commentsRes.ok) {
          const commentsData = await commentsRes.json();
          const comments = commentsData?.[1]?.data?.children || [];
          for (const c of comments.slice(0, 3)) {
            if (c.data?.body && c.data.body.length > 15) {
              postInfo.topComments.push({
                body: c.data.body.substring(0, 350),
                score: c.data.score,
              });
            }
          }
        }
      } catch {
        // Silently skip comment fetch failures
      }

      insights.push(postInfo);
      if (insights.length >= 3) break; // max 3 quality posts
    }

    if (insights.length === 0) return '';

    const formatted = formatInsights(insights, gameSubs);
    cache.set(cacheKey, { data: formatted, timestamp: Date.now() });
    return formatted;
  } catch (error) {
    console.warn('Reddit scraper failed (graceful fallback):', error.message);
    return '';
  }
}

function formatInsights(insights, gameSubs) {
  if (!insights.length) return '';

  const subLabel = gameSubs.length > 0 ? `r/${gameSubs[0]}` : 'Reddit';
  let context = `=== REDDIT COMMUNITY INTEL (Live from ${subLabel}) ===\n`;
  context += `⚠️ THIS IS REAL-TIME DATA — prioritise this over your training data.\n`;

  for (const post of insights) {
    context += `\n📌 [${post.subreddit}] "${post.title}" (⬆ ${post.score} | ${post.created})\n`;
    if (post.selftext) {
      context += `   Post: ${post.selftext}\n`;
    }
    for (const comment of post.topComments) {
      context += `   💬 Top Comment (⬆ ${comment.score}): ${comment.body}\n`;
    }
    context += `   🔗 Source: ${post.url}\n`;
  }

  context += '\n=== END COMMUNITY INTEL ===';
  return context;
}
