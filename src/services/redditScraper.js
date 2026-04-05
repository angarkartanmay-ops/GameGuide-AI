/**
 * Reddit Community Intelligence Scraper
 * Uses Vite's dev proxy to fetch Reddit's public JSON endpoints.
 */

// In-memory cache: query -> { data, timestamp }
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Gaming subreddits to search across
const GAMING_SUBREDDITS = [
  'gaming', 'pcgaming', 'truegaming', 'patientgamers',
  'GamePhysics', 'Games', 'tips', 'gamingsuggestions',
];

// Attempt to detect a game-specific subreddit from the query
function detectGameSubs(query) {
  const gameMap = {
    'elden ring': 'Eldenring',
    'dark souls': 'darksouls',
    'minecraft': 'Minecraft',
    'valorant': 'VALORANT',
    'gta': 'GTA',
    'gta v': 'gtaonline',
    'fortnite': 'FortNiteBR',
    'overwatch': 'Overwatch',
    'league of legends': 'leagueoflegends',
    'apex legends': 'apexlegends',
    'destiny': 'DestinyTheGame',
    'call of duty': 'CallOfDuty',
    'cod': 'CallOfDuty',
    'zelda': 'zelda',
    'pokemon': 'pokemon',
    'cyberpunk': 'cyberpunkgame',
    'skyrim': 'skyrim',
    'witcher': 'witcher',
    'halo': 'halo',
    'fallout': 'Fallout',
    'warzone': 'CODWarzone',
    'rocket league': 'RocketLeague',
    'terraria': 'Terraria',
    'stardew': 'StardewValley',
    'baldur': 'BaldursGate3',
    'palworld': 'Palworld',
    'helldivers': 'Helldivers',
    'red dead': 'reddeadredemption',
    'god of war': 'GodofWar',
    'horizon': 'horizon',
    'resident evil': 'residentevil',
    'monster hunter': 'MonsterHunter',
    'final fantasy': 'FinalFantasy',
    'doom': 'Doom',
    'sekiro': 'Sekiro',
    'hollow knight': 'HollowKnight',
    'celeste': 'celestegame',
  };

  const lowerQuery = query.toLowerCase();
  const detected = [];
  for (const [keyword, sub] of Object.entries(gameMap)) {
    if (lowerQuery.includes(keyword)) {
      detected.push(sub);
    }
  }
  return detected;
}

/**
 * Search Reddit for posts related to the user's gaming query.
 * Returns a formatted string of community insights, or empty string if nothing found.
 */
export async function searchReddit(query) {
  // Check cache first
  const cacheKey = query.toLowerCase().trim();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    // Build search across gaming subs + any detected game-specific sub
    const detectedSubs = detectGameSubs(query);
    const allSubs = [...new Set([...detectedSubs, ...GAMING_SUBREDDITS.slice(0, 3)])];
    const subredditStr = allSubs.join('+');

    const searchUrl = `/api/reddit/r/${subredditStr}/search.json?q=${encodeURIComponent(query)}&sort=relevance&t=year&limit=5&restrict_sr=on`;

    const response = await fetch(searchUrl);
    if (!response.ok) {
      console.warn(`Reddit search returned ${response.status}`);
      return '';
    }

    const data = await response.json();
    const posts = data?.data?.children || [];

    if (posts.length === 0) return '';

    // Now fetch top comments for the top 3 posts
    const insights = [];

    for (const post of posts.slice(0, 3)) {
      const p = post.data;
      const postInfo = {
        title: p.title,
        subreddit: p.subreddit_name_prefixed || `r/${p.subreddit}`,
        score: p.score,
        selftext: p.selftext ? p.selftext.substring(0, 300) : '',
        url: `https://reddit.com${p.permalink}`,
        topComments: [],
      };

      // Fetch comments for this post
      try {
        const commentsUrl = `/api/reddit${p.permalink}.json?sort=top&limit=3`;
        const commentsRes = await fetch(commentsUrl);
        if (commentsRes.ok) {
          const commentsData = await commentsRes.json();
          const comments = commentsData?.[1]?.data?.children || [];
          for (const c of comments.slice(0, 2)) {
            if (c.data?.body) {
              postInfo.topComments.push({
                body: c.data.body.substring(0, 250),
                score: c.data.score,
              });
            }
          }
        }
      } catch {
        // Silently skip comment fetch failures
      }

      insights.push(postInfo);
    }

    // Format into a context block
    const formatted = formatInsights(insights);
    cache.set(cacheKey, { data: formatted, timestamp: Date.now() });
    return formatted;
  } catch (error) {
    console.warn('Reddit scraper failed (graceful fallback):', error.message);
    return '';
  }
}

function formatInsights(insights) {
  if (!insights.length) return '';

  let context = '=== REDDIT COMMUNITY INTEL ===\n';
  for (const post of insights) {
    context += `\n📌 [${post.subreddit}] "${post.title}" (⬆ ${post.score})\n`;
    if (post.selftext) {
      context += `   Post: ${post.selftext}\n`;
    }
    for (const comment of post.topComments) {
      context += `   💬 Top Comment (⬆ ${comment.score}): ${comment.body}\n`;
    }
  }
  context += '\n=== END COMMUNITY INTEL ===';
  return context;
}
