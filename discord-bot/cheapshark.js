// ═══════════════════════════════════════════════════════════════════════════
//  CheapShark Price Intelligence — Discord bot port of src/services/priceScraper.js
//  ───────────────────────────────────────────────────────────────────────
//  Hits CheapShark's public API directly (no API key) to return real,
//  structured pricing data for the /price slash command. This mirrors the
//  web app's /price flow — which short-circuits the LLM entirely — so the
//  Discord bot stops falling back to web-search guesses.
//
//  The alias table, numeral handling, price-intent gate and scoring below
//  are ported 1:1 from src/services/priceScraper.js — update both together
//  so "/price gta 5" resolves the same game on the website and in Discord.
//
//  API docs: https://apidocs.cheapshark.com/
// ═══════════════════════════════════════════════════════════════════════════

const priceCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min — matches web app
const FETCH_TIMEOUT_MS = 8000;

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

/**
 * A network-level failure (unreachable, timed out, bad HTTP status, not
 * JSON) — distinct from a clean search that simply found nothing. Callers
 * use this to tell the user "try again" instead of "that game isn't
 * tracked", and to skip burning an LLM-fallback turn on a plain outage.
 */
class PriceLookupError extends Error {}

// ═══════════════════════════════════════════════════════════════════════════
//  Game-title resolution — identical table to src/services/priceScraper.js.
//  See that file's header comment for the "why" (CheapShark's own fuzzy
//  search doesn't know "gta 5" means "Grand Theft Auto V", and the old
//  unordered substring map let a short generic key like "final fantasy"
//  swallow every specific numbered title into the wrong game).
// ═══════════════════════════════════════════════════════════════════════════

const ALIASES = [
  // ── Souls-likes ──────────────────────────────────────────────────────
  ['elden ring nightreign', 'Elden Ring Nightreign'],
  ['nightreign', 'Elden Ring Nightreign'],
  ['elden ring', 'Elden Ring'],
  ['dark souls remastered', 'Dark Souls Remastered'],
  ['dark souls 3', 'Dark Souls III'],
  ['dark souls 2', 'Dark Souls II'],
  ['dark souls', 'Dark Souls'],
  ['sekiro', 'Sekiro Shadows Die Twice'],
  ['bloodborne', 'Bloodborne'],
  ["demon's souls", "Demon's Souls"],
  ['demons souls', "Demon's Souls"],
  ['lies of p', 'Lies of P'],
  ['lords of the fallen', 'Lords of the Fallen'],
  ['nioh 2', 'Nioh 2'],
  ['nioh', 'Nioh'],
  ['ac6', 'Armored Core VI Fires of Rubicon'],
  ['armored core 6', 'Armored Core VI Fires of Rubicon'],

  // ── Grand Theft Auto ─────────────────────────────────────────────────
  ['gta vi', 'Grand Theft Auto VI'],
  ['gta 6', 'Grand Theft Auto VI'],
  ['gta v', 'Grand Theft Auto V'],
  ['gta 5', 'Grand Theft Auto V'],
  ['gta san andreas', 'Grand Theft Auto San Andreas'],
  ['gta iv', 'Grand Theft Auto IV'],
  ['gta 4', 'Grand Theft Auto IV'],
  ['gta', 'Grand Theft Auto V'],
  ['red dead redemption 2', 'Red Dead Redemption 2'],
  ['rdr2', 'Red Dead Redemption 2'],
  ['red dead redemption', 'Red Dead Redemption'],
  ['rdr1', 'Red Dead Redemption'],

  // ── Shooters / battle royale ─────────────────────────────────────────
  ['fortnite', 'Fortnite'],
  ['apex legends', 'Apex Legends'],
  ['apex', 'Apex Legends'],
  ['warzone', 'Call of Duty Warzone'],
  ['pubg', 'PUBG BATTLEGROUNDS'],
  ['valorant', 'Valorant'],
  ['overwatch 2', 'Overwatch 2'],
  ['overwatch', 'Overwatch 2'],
  ['cod black ops 6', 'Call of Duty Black Ops 6'],
  ['black ops 6', 'Call of Duty Black Ops 6'],
  ['bo6', 'Call of Duty Black Ops 6'],
  ['cod black ops cold war', 'Call of Duty Black Ops Cold War'],
  ['black ops cold war', 'Call of Duty Black Ops Cold War'],
  ['cod modern warfare 3', 'Call of Duty Modern Warfare III'],
  ['modern warfare 3', 'Call of Duty Modern Warfare III'],
  ['mw3', 'Call of Duty Modern Warfare III'],
  ['cod modern warfare 2', 'Call of Duty Modern Warfare II'],
  ['modern warfare 2', 'Call of Duty Modern Warfare II'],
  ['mw2', 'Call of Duty Modern Warfare II'],
  ['cod modern warfare', 'Call of Duty Modern Warfare'],
  ['modern warfare', 'Call of Duty Modern Warfare'],
  ['call of duty', 'Call of Duty'],
  ['cod', 'Call of Duty'],
  ['counter strike 2', 'Counter-Strike 2'],
  ['cs2', 'Counter-Strike 2'],
  ['csgo', 'Counter-Strike 2'],
  ['cs go', 'Counter-Strike 2'],
  ['rainbow six siege', 'Tom Clancy’s Rainbow Six Siege'],
  ['r6 siege', 'Tom Clancy’s Rainbow Six Siege'],
  ['r6', 'Tom Clancy’s Rainbow Six Siege'],
  ['battlefield 2042', 'Battlefield 2042'],
  ['battlefield v', 'Battlefield V'],
  ['battlefield 1', 'Battlefield 1'],
  ['destiny 2', 'Destiny 2'],
  ['titanfall 2', 'Titanfall 2'],
  ['the finals', 'THE FINALS'],
  ['delta force', 'Delta Force'],
  ['helldivers 2', 'Helldivers 2'],
  ['helldivers', 'Helldivers 2'],
  ['deep rock galactic', 'Deep Rock Galactic'],
  ['drg', 'Deep Rock Galactic'],
  ['insurgency sandstorm', 'Insurgency Sandstorm'],
  ['tf2', 'Team Fortress 2'],
  ['team fortress 2', 'Team Fortress 2'],
  ['payday 3', 'PAYDAY 3'],
  ['payday 2', 'PAYDAY 2'],
  ['left 4 dead 2', 'Left 4 Dead 2'],
  ['l4d2', 'Left 4 Dead 2'],
  ['half life 2', 'Half-Life 2'],
  ['half life alyx', 'Half-Life Alyx'],
  ['portal 2', 'Portal 2'],
  ['portal', 'Portal'],

  // ── RPGs / open world ─────────────────────────────────────────────────
  ["baldur's gate 3", "Baldur's Gate 3"],
  ['baldurs gate 3', "Baldur's Gate 3"],
  ['bg3', "Baldur's Gate 3"],
  ['cyberpunk 2077', 'Cyberpunk 2077'],
  ['cyberpunk', 'Cyberpunk 2077'],
  ['the witcher 3', 'The Witcher 3 Wild Hunt'],
  ['witcher 3', 'The Witcher 3 Wild Hunt'],
  ['witcher', 'The Witcher 3 Wild Hunt'],
  ['starfield', 'Starfield'],
  ['fallout 4', 'Fallout 4'],
  ['fallout 76', 'Fallout 76'],
  ['fallout new vegas', 'Fallout New Vegas'],
  ['fallout 3', 'Fallout 3'],
  ['fallout', 'Fallout 4'],
  ['skyrim special edition', 'The Elder Scrolls V Skyrim Special Edition'],
  ['skyrim', 'The Elder Scrolls V Skyrim'],
  ['elder scrolls online', 'The Elder Scrolls Online'],
  ['eso', 'The Elder Scrolls Online'],
  ['mass effect legendary edition', 'Mass Effect Legendary Edition'],
  ['mass effect', 'Mass Effect Legendary Edition'],
  ['dragon age the veilguard', 'Dragon Age The Veilguard'],
  ['dragon age veilguard', 'Dragon Age The Veilguard'],
  ['dragon age', 'Dragon Age The Veilguard'],
  ['diablo 4', 'Diablo IV'],
  ['diablo iv', 'Diablo IV'],
  ['diablo 3', 'Diablo III'],
  ['diablo', 'Diablo IV'],
  ['path of exile 2', 'Path of Exile 2'],
  ['poe2', 'Path of Exile 2'],
  ['poe 2', 'Path of Exile 2'],
  ['path of exile', 'Path of Exile'],
  ['poe', 'Path of Exile'],
  ['persona 5 royal', 'Persona 5 Royal'],
  ['persona 5', 'Persona 5 Royal'],
  ['persona 3 reload', 'Persona 3 Reload'],
  ['persona 3 portable', 'Persona 3 Portable'],
  ['persona 3', 'Persona 3 Reload'],
  ['metaphor refantazio', 'Metaphor ReFantazio'],
  ['metaphor', 'Metaphor ReFantazio'],
  ['final fantasy vii remake', 'FINAL FANTASY VII REMAKE'],
  ['final fantasy 7 remake', 'FINAL FANTASY VII REMAKE'],
  ['ff7 remake', 'FINAL FANTASY VII REMAKE'],
  ['ff7r', 'FINAL FANTASY VII REMAKE'],
  ['final fantasy vii rebirth', 'FINAL FANTASY VII REBIRTH'],
  ['final fantasy 7 rebirth', 'FINAL FANTASY VII REBIRTH'],
  ['ff7 rebirth', 'FINAL FANTASY VII REBIRTH'],
  ['final fantasy xvi', 'FINAL FANTASY XVI'],
  ['final fantasy 16', 'FINAL FANTASY XVI'],
  ['ff16', 'FINAL FANTASY XVI'],
  ['final fantasy xiv', 'FINAL FANTASY XIV Online'],
  ['final fantasy 14', 'FINAL FANTASY XIV Online'],
  ['ffxiv', 'FINAL FANTASY XIV Online'],
  ['ff14', 'FINAL FANTASY XIV Online'],
  ['final fantasy', 'FINAL FANTASY XIV Online'],
  ['monster hunter wilds', 'Monster Hunter Wilds'],
  ['mh wilds', 'Monster Hunter Wilds'],
  ['monster hunter world', 'Monster Hunter World'],
  ['mhw', 'Monster Hunter World'],
  ['monster hunter rise', 'Monster Hunter Rise'],
  ['mh rise', 'Monster Hunter Rise'],
  ['monster hunter', 'Monster Hunter Wilds'],
  ["dragon's dogma 2", "Dragon's Dogma 2"],
  ['dragons dogma 2', "Dragon's Dogma 2"],
  ['hogwarts legacy', 'Hogwarts Legacy'],
  ['black myth wukong', 'Black Myth Wukong'],
  ['black myth', 'Black Myth Wukong'],
  ['wukong', 'Black Myth Wukong'],
  ['clair obscur expedition 33', 'Clair Obscur Expedition 33'],
  ['expedition 33', 'Clair Obscur Expedition 33'],
  ['clair obscur', 'Clair Obscur Expedition 33'],
  ['kingdom come deliverance 2', 'Kingdom Come Deliverance II'],
  ['kingdom come deliverance', 'Kingdom Come Deliverance'],
  ['divinity original sin 2', 'Divinity Original Sin 2'],
  ['death stranding 2', 'Death Stranding 2'],
  ['death stranding', 'Death Stranding'],
  ['sea of thieves', 'Sea of Thieves'],
  ['borderlands 4', 'Borderlands 4'],
  ['borderlands 3', 'Borderlands 3'],
  ['borderlands', 'Borderlands 3'],
  ['god of war ragnarok', 'God of War Ragnaroek'],
  ['god of war', 'God of War'],
  ['horizon zero dawn', 'Horizon Zero Dawn'],
  ['horizon forbidden west', 'Horizon Forbidden West'],
  ['stalker 2', 'S.T.A.L.K.E.R. 2 Heart of Chornobyl'],

  // ── Survival / crafting / sandbox ────────────────────────────────────
  ['valheim', 'Valheim'],
  ['palworld', 'Palworld'],
  ['ark survival ascended', 'ARK Survival Ascended'],
  ['ark survival evolved', 'ARK Survival Evolved'],
  ['ark', 'ARK Survival Ascended'],
  ['rust', 'Rust'],
  ['terraria', 'Terraria'],
  ['minecraft java edition', 'Minecraft Java Edition'],
  ['minecraft bedrock', 'Minecraft Bedrock Edition'],
  ['minecraft', 'Minecraft'],
  ['subnautica below zero', 'Subnautica Below Zero'],
  ['subnautica', 'Subnautica'],
  ["no man's sky", "No Man's Sky"],
  ['no mans sky', "No Man's Sky"],
  ['nms', "No Man's Sky"],
  ['enshrouded', 'Enshrouded'],
  ['sons of the forest', 'Sons of the Forest'],
  ['the forest', 'The Forest'],
  ['grounded', 'Grounded'],
  ['lethal company', 'Lethal Company'],
  ['satisfactory', 'Satisfactory'],
  ['factorio', 'Factorio'],
  ['7 days to die', '7 Days to Die'],
  ['project zomboid', 'Project Zomboid'],

  // ── Racing / sports ───────────────────────────────────────────────────
  ['forza horizon 5', 'Forza Horizon 5'],
  ['forza horizon 4', 'Forza Horizon 4'],
  ['forza motorsport', 'Forza Motorsport'],
  ['ea sports fc 25', 'EA SPORTS FC 25'],
  ['fc 25', 'EA SPORTS FC 25'],
  ['ea sports fc 24', 'EA SPORTS FC 24'],
  ['fc 24', 'EA SPORTS FC 24'],
  ['nba 2k25', 'NBA 2K25'],
  ['nba 2k24', 'NBA 2K24'],
  ['gran turismo 7', 'Gran Turismo 7'],
  ['f1 25', 'F1 25'],
  ['f1 24', 'F1 24'],
  ['rocket league', 'Rocket League'],

  // ── Indie darlings ────────────────────────────────────────────────────
  ['hollow knight silksong', 'Hollow Knight Silksong'],
  ['silksong', 'Hollow Knight Silksong'],
  ['hollow knight', 'Hollow Knight'],
  ['hades ii', 'Hades II'],
  ['hades 2', 'Hades II'],
  ['hades', 'Hades'],
  ['celeste', 'Celeste'],
  ['stardew valley', 'Stardew Valley'],
  ['undertale', 'Undertale'],
  ['cult of the lamb', 'Cult of the Lamb'],
  ['balatro', 'Balatro'],
  ['vampire survivors', 'Vampire Survivors'],
  ['among us', 'Among Us'],
  ['fall guys', 'Fall Guys'],
  ['dave the diver', 'Dave the Diver'],
  ['it takes two', 'It Takes Two'],

  // ── Fighting ───────────────────────────────────────────────────────────
  ['tekken 8', 'TEKKEN 8'],
  ['street fighter 6', 'Street Fighter 6'],
  ['mortal kombat 1', 'Mortal Kombat 1'],
  ['guilty gear strive', 'Guilty Gear Strive'],

  // ── Live-service / MMO ────────────────────────────────────────────────
  ['world of warcraft', 'World of Warcraft'],
  ['wow', 'World of Warcraft'],
  ['genshin impact', 'Genshin Impact'],
  ['genshin', 'Genshin Impact'],
  ['honkai star rail', 'Honkai Star Rail'],
  ['zenless zone zero', 'Zenless Zone Zero'],
  ['zzz', 'Zenless Zone Zero'],
  ['wuthering waves', 'Wuthering Waves'],
  ['marvel rivals', 'Marvel Rivals'],
  ['dota 2', 'Dota 2'],
  ['league of legends', 'League of Legends'],
  ['lol', 'League of Legends'],

  // ── Horror ─────────────────────────────────────────────────────────────
  ['resident evil 9', 'Resident Evil Requiem'],
  ['resident evil requiem', 'Resident Evil Requiem'],
  ['resident evil 4 remake', 'Resident Evil 4'],
  ['re4 remake', 'Resident Evil 4'],
  ['resident evil 4', 'Resident Evil 4'],
  ['re4', 'Resident Evil 4'],
  ['resident evil village', 'Resident Evil Village'],
  ['re8', 'Resident Evil Village'],
  ['resident evil 3', 'Resident Evil 3'],
  ['re3', 'Resident Evil 3'],
  ['resident evil 2', 'Resident Evil 2'],
  ['re2', 'Resident Evil 2'],
  ['resident evil', 'Resident Evil Village'],
  ['dead space remake', 'Dead Space Remake'],
  ['dead space', 'Dead Space Remake'],
  ['silent hill 2', 'Silent Hill 2'],
  ['alan wake 2', 'Alan Wake 2'],
  ['alan wake', 'Alan Wake Remastered'],
  ['phasmophobia', 'Phasmophobia'],
  ['dead by daylight', 'Dead by Daylight'],
  ['dbd', 'Dead by Daylight'],
  ['the outlast trials', 'The Outlast Trials'],
  ['outlast 2', 'Outlast 2'],
  ['outlast', 'Outlast'],

  // ── Sim / management ───────────────────────────────────────────────────
  ['cities skylines 2', 'Cities Skylines II'],
  ['cities skylines ii', 'Cities Skylines II'],
  ['manor lords', 'Manor Lords'],
  ['planet coaster 2', 'Planet Coaster 2'],
  ['two point museum', 'Two Point Museum'],
  ['frostpunk 2', 'Frostpunk 2'],
  ['civilization 6', 'Sid Meier’s Civilization VI'],
  ['civilization vi', 'Sid Meier’s Civilization VI'],
  ['civ 6', 'Sid Meier’s Civilization VI'],
  ['civilization 7', 'Sid Meier’s Civilization VII'],
  ['civ 7', 'Sid Meier’s Civilization VII'],

  // ── Misc classics/staples ──────────────────────────────────────────────
  ['doom eternal', 'DOOM Eternal'],
  ['doom 2016', 'DOOM'],
  ['doom', 'DOOM Eternal'],
  ['deus ex mankind divided', 'Deus Ex Mankind Divided'],
  ['warframe', 'Warframe'],
];

const NUMERAL_TO_DIGIT = {
  ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
  xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16',
};
const DIGIT_TO_NUMERAL = Object.fromEntries(
  Object.entries(NUMERAL_TO_DIGIT).map(([roman, digit]) => [digit, roman]),
);

const FILLER_PREFIX_RX = /^(?:so\s+|um+,?\s+|hey\s+|okay\s+|ok\s+)?(?:what'?s|whats|what\s+is|what\s+are|how\s+much\s+(?:is|does|are|for|would)|hows?\s+much|price\s+(?:of|for|on|check)|prices?\s+for|cost\s+(?:of|for|on)|is)\s+/i;
const FILLER_SUFFIX_RX = /\s+(?:cost(?:ing)?|costs?|going\s+for|worth(?:\s+(?:it|buying))?|right\s+now|currently|these\s+days|on\s+steam|on\s+pc|nowadays|today)\s*\??$/i;

/** Lowercase, trim, strip a leading/trailing question wrapper. Pure. */
function cleanPriceQuery(raw) {
  return String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/[?!.,]+$/g, '')
    .replace(FILLER_PREFIX_RX, '')
    .replace(FILLER_SUFFIX_RX, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Swap the FIRST numbered token in `cleaned` between its roman and digit
 * form ("elden ring 2" ⇄ "elden ring ii"), so an alias keyed in one form
 * still matches a user who typed the other. Bare "i"/"v"/"x" are excluded —
 * too easily a real word ("I", "vs", "x") rather than a numeral — so those
 * titles need both forms spelled out as separate aliases instead.
 */
function numeralVariant(cleaned) {
  const tokens = cleaned.split(' ');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (NUMERAL_TO_DIGIT[t]) return [...tokens.slice(0, i), NUMERAL_TO_DIGIT[t], ...tokens.slice(i + 1)].join(' ');
    if (DIGIT_TO_NUMERAL[t]) return [...tokens.slice(0, i), DIGIT_TO_NUMERAL[t], ...tokens.slice(i + 1)].join(' ');
  }
  return null;
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'of', 'the', 'in', 'on', 'for']);
/** Cosmetic only — CheapShark's search is case-insensitive either way. */
function titleCaseFallback(cleaned) {
  return cleaned
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const SORTED_ALIASES = [...ALIASES].sort((a, b) => b[0].length - a[0].length);

/** The first (longest, i.e. most specific) alias whose key appears as a whole word/phrase in `cleaned`. */
function findAlias(cleaned) {
  if (!cleaned) return null;
  const candidates = [cleaned, numeralVariant(cleaned)].filter(Boolean);
  for (const text of candidates) {
    for (const [key, title] of SORTED_ALIASES) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`).test(text)) return title;
    }
  }
  return null;
}

/**
 * Turn whatever the user typed — "/price gta 5", "how much is elden ring
 * nightreign", "cost of ff7 remake" — into the title to actually search
 * CheapShark for, and (when we recognised it) the canonical name, so the
 * reply can show the user exactly what game/edition we understood.
 */
function resolvePriceQuery(raw) {
  const cleaned = cleanPriceQuery(raw);
  if (!cleaned) return { query: '', alias: null };
  const alias = findAlias(cleaned);
  return { query: alias || titleCaseFallback(cleaned), alias };
}

// Regex-only gate so this stays cheap enough to run on every @mention/DM —
// the point of "don't hit CheapShark on every message" was never "never
// detect a price question", just "don't pay for one on every turn".
const PRICE_INTENT_RX = /\b(price|prices|priced|pricing|cost|costs|costing|cheap|cheaper|cheapest|discount(?:ed)?|deal|deals|on\s+sale|sale|worth\s+buying|how\s+much|going\s+for|marked\s+down|price\s*check)\b/i;

/** Does this message plausibly ask about buying, cost, or a discount? */
function looksLikePriceQuestion(text) {
  return PRICE_INTENT_RX.test(String(text || ''));
}

/**
 * Best-effort single game name for a price-intent message. Returns '' when
 * nothing title-shaped survives filler-stripping, so callers skip the
 * lookup rather than search CheapShark for a sentence fragment.
 */
// Leftovers that are never a title on their own — "is this worth it" strips
// down to "this", and searching CheapShark for "This" wastes a call on
// something that was never a game name.
const NON_TITLE_WORDS = new Set([
  'this', 'that', 'these', 'those', 'it', 'one', 'thing', 'game', 'games',
  'anything', 'something', 'everything', 'stuff', 'here', 'there',
]);

function extractPriceSubject(text) {
  const cleaned = cleanPriceQuery(text);
  if (!cleaned) return '';
  const alias = findAlias(cleaned);
  if (alias) return alias;
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 6) return '';
  if (words.every(w => NON_TITLE_WORDS.has(w))) return '';
  return titleCaseFallback(cleaned);
}

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

/** GET some JSON with a timeout. Returns null on any failure — used where a soft failure is fine. */
async function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
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

/** Same as fetchJson, but throws PriceLookupError instead of swallowing a failure — for the steps where that distinction matters. */
async function fetchJsonStrict(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'GameGuide-Discord-Bot/2.0' },
    });
    if (!res.ok) throw new PriceLookupError(`CheapShark responded ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err instanceof PriceLookupError) throw err;
    throw new PriceLookupError(err?.message || 'CheapShark unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns `null` when the search itself succeeded but matched nothing.
 * Throws `PriceLookupError` when CheapShark could not be reached at all.
 */
async function fetchGamePrice(gameTitle) {
  let games = null;

  // Step 1a — exact match. Allowed to fail quietly; the fuzzy fallback below
  // covers it, and CheapShark itself 400s on some exact-match queries that
  // its own fuzzy search handles fine.
  try {
    const exactGames = await fetchJsonStrict(
      `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(gameTitle)}&limit=5&exact=1`
    );
    if (Array.isArray(exactGames) && exactGames.length > 0) games = exactGames;
  } catch { /* fall through to fuzzy */ }

  // Step 1b — fuzzy fallback. A failure here IS a real network problem,
  // since exact match already had its chance.
  if (!games) {
    const fuzzyGames = await fetchJsonStrict(
      `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(gameTitle)}&limit=8&exact=0`
    );
    if (!Array.isArray(fuzzyGames) || fuzzyGames.length === 0) return null;
    games = fuzzyGames;
  }

  const topGame = pickBestMatch(games, gameTitle);
  if (!topGame) return null;

  // Step 2 — detailed pricing (deals + cheapestPriceEver). A failure here is
  // soft — we already have a usable price from step 1.
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
 * Primary entry — direct lookup for the /price slash command. `gameTitle`
 * should already be resolved (see resolvePriceQuery/extractPriceSubject) —
 * this just searches CheapShark for exactly the string it's given.
 *
 * Cached for 15 min. Returns null on a clean "not found". Throws
 * PriceLookupError when CheapShark could not be reached — callers decide
 * whether that should fall back to the LLM or just say "try again".
 */
async function fetchPriceDirect(gameTitle) {
  if (!gameTitle || !gameTitle.trim()) return null;
  const key = gameTitle.toLowerCase().trim();
  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

  const result = await fetchGamePrice(gameTitle.trim());
  if (result) priceCache.set(key, { data: result, timestamp: Date.now() });
  return result;
}

/**
 * Plain-text context block for forwarding into the AI prompt as
 * `priceContext` — used when a plain @mention/DM message looks like a price
 * question, so the model can cite live numbers instead of guessing from
 * training data.
 *
 * No `=== LIVE PRICE INTEL ===` wrapper here — the edge function adds its
 * own around whatever `priceContext` it receives (same as wikiContext /
 * redditContext), so wrapping here too would double it up in the prompt.
 */
function formatPriceContext(priceData) {
  if (!Array.isArray(priceData) || !priceData.length) return '';

  const blocks = priceData.map((game) => {
    let context = `💰 "${game.title}"\n`;
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
    return context.trimEnd();
  });
  return blocks.join('\n\n');
}

module.exports = {
  fetchPriceDirect,
  fetchJson,
  scoreTitleMatch,
  STORE_NAMES,
  PriceLookupError,
  resolvePriceQuery,
  looksLikePriceQuestion,
  extractPriceSubject,
  formatPriceContext,
};
