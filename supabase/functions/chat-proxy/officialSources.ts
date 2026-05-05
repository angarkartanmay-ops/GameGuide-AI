// Game → authoritative-endpoint registry. These sources OUTRANK every other
// source in the recency ranker because they're publisher-authored.
//
// IMPORTANT: All endpoints below are publicly accessible without auth keys
// EXCEPT Supercell which uses CLASH_ROYALE_API_KEY / CLASH_OF_CLANS_API_KEY /
// BRAWL_STARS_API_KEY (already configured in env).

export interface OfficialSource {
  game: string;
  aliases: string[];
  endpoints: {
    api?: { url: string; authEnv?: string; headerKey?: string; parser: 'supercell' | 'json-news' | 'json-list' };
    rss?: string;
    htmlNews?: string;        // fallback HTML page to scrape
  };
  // What this game's "newest [thing]" API field looks like, for quick lookups.
  newestSelector?: { listKey: string; dateKey: string; nameKey: string };
}

export const OFFICIAL_SOURCES: OfficialSource[] = [
  {
    game: 'clash royale',
    aliases: ['cr', 'clash-royale', 'clashroyale'],
    endpoints: {
      api: { url: 'https://api.clashroyale.com/v1/cards', authEnv: 'CLASH_ROYALE_API_KEY', headerKey: 'Authorization', parser: 'supercell' },
      htmlNews: 'https://supercell.com/en/games/clashroyale/',
    },
    newestSelector: { listKey: 'items', dateKey: '', nameKey: 'name' },
  },
  {
    game: 'clash of clans',
    aliases: ['coc', 'clashofclans'],
    endpoints: {
      api: { url: 'https://api.clashofclans.com/v1/locations', authEnv: 'CLASH_OF_CLANS_API_KEY', headerKey: 'Authorization', parser: 'supercell' },
      htmlNews: 'https://supercell.com/en/games/clashofclans/',
    },
  },
  {
    game: 'brawl stars',
    aliases: ['bs', 'brawlstars'],
    endpoints: {
      api: { url: 'https://api.brawlstars.com/v1/brawlers', authEnv: 'BRAWL_STARS_API_KEY', headerKey: 'Authorization', parser: 'supercell' },
      htmlNews: 'https://supercell.com/en/games/brawlstars/',
    },
  },
  {
    game: 'minecraft',
    aliases: ['mc', 'mojang'],
    endpoints: {
      rss: 'https://www.minecraft.net/en-us/feeds/community-content/rss',
      htmlNews: 'https://www.minecraft.net/en-us/articles',
    },
  },
  {
    game: 'fortnite',
    aliases: ['fn'],
    endpoints: {
      api: { url: 'https://fortnite-api.com/v2/news', parser: 'json-news' },
      htmlNews: 'https://www.fortnite.com/news',
    },
  },
  {
    game: 'valorant',
    aliases: ['val'],
    endpoints: {
      htmlNews: 'https://playvalorant.com/en-us/news/',
    },
  },
  {
    game: 'league of legends',
    aliases: ['lol', 'league'],
    endpoints: {
      htmlNews: 'https://www.leagueoflegends.com/en-us/news/',
    },
  },
  {
    game: 'apex legends',
    aliases: ['apex'],
    endpoints: {
      htmlNews: 'https://www.ea.com/games/apex-legends/news',
    },
  },
  {
    game: 'overwatch',
    aliases: ['ow', 'overwatch 2', 'ow2'],
    endpoints: {
      htmlNews: 'https://overwatch.blizzard.com/en-us/news/',
    },
  },
  {
    game: 'bgmi',
    aliases: ['battlegrounds mobile india', 'pubg mobile india'],
    endpoints: {
      htmlNews: 'https://www.battlegroundsmobileindia.com/',
    },
  },
  {
    game: 'pubg mobile',
    aliases: ['pubgm'],
    endpoints: {
      htmlNews: 'https://www.pubgmobile.com/en/news.html',
    },
  },
  {
    game: 'genshin impact',
    aliases: ['genshin'],
    endpoints: {
      htmlNews: 'https://genshin.hoyoverse.com/en/news',
    },
  },
  {
    game: 'honkai star rail',
    aliases: ['hsr', 'star rail'],
    endpoints: {
      htmlNews: 'https://hsr.hoyoverse.com/en-us/news',
    },
  },
  {
    game: 'destiny 2',
    aliases: ['destiny'],
    endpoints: {
      htmlNews: 'https://www.bungie.net/7/en/News',
    },
  },
  {
    game: 'call of duty',
    aliases: ['cod', 'warzone', 'mw3', 'modern warfare'],
    endpoints: {
      htmlNews: 'https://www.callofduty.com/blog',
    },
  },
];

export function findOfficial(game: string | null): OfficialSource | null {
  if (!game) return null;
  const lower = game.toLowerCase().trim();
  for (const src of OFFICIAL_SOURCES) {
    if (src.game === lower) return src;
    if (src.aliases.includes(lower)) return src;
  }
  // Loose containment match for things like "clash royale season 83"
  for (const src of OFFICIAL_SOURCES) {
    if (lower.includes(src.game) || src.aliases.some(a => lower.includes(a))) return src;
  }
  return null;
}
