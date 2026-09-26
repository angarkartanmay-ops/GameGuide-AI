// ═══════════════════════════════════════════════════════════════════════════
//  Steam art lookup — for the chat's game-reactive backdrop.
//
//  Shared by the Vercel function (api/game-art.js) and the Vite dev
//  middleware, like _wikiTarget.js. The leading underscore keeps Vercel from
//  deploying this file as a function of its own.
//
//  Two rules shape it:
//    * The outbound host is fixed. The user's text only ever lands in a query
//      string value, URL-encoded — never in a host or path — so this cannot be
//      turned into a request to anywhere else.
//    * No art beats wrong art. A fuzzy search that lands on the soundtrack or a
//      different game would dress the chat in the wrong world, so weak matches
//      return null and the chat keeps its theme ambience.
// ═══════════════════════════════════════════════════════════════════════════

const SEARCH_URL = 'https://store.steampowered.com/api/storesearch/';
const LEGACY_CDN = 'https://cdn.akamai.steamstatic.com/steam/apps';

// Popular games resolve without a search call: faster, and it keeps working
// when the store API is slow or unreachable. Keys are normalizeTitle() forms.
const KNOWN = [
  [1245620, 'ELDEN RING', ['elden ring', 'er']],
  [2622380, 'ELDEN RING NIGHTREIGN', ['elden ring nightreign', 'nightreign']],
  [1086940, "Baldur's Gate 3", ['baldurs gate 3', 'bg3']],
  [1091500, 'Cyberpunk 2077', ['cyberpunk 2077', 'cyberpunk', 'cp2077']],
  [1145350, 'Hades II', ['hades 2']],
  [1145360, 'Hades', ['hades']],
  [553850, 'HELLDIVERS 2', ['helldivers 2']],
  [367520, 'Hollow Knight', ['hollow knight']],
  [1030300, 'Hollow Knight: Silksong', ['hollow knight silksong', 'silksong']],
  [413150, 'Stardew Valley', ['stardew valley', 'stardew']],
  [730, 'Counter-Strike 2', ['counter strike 2', 'cs2', 'csgo', 'cs go', 'counter strike']],
  [570, 'Dota 2', ['dota 2', 'dota']],
  [1172470, 'Apex Legends', ['apex legends', 'apex']],
  [1085660, 'Destiny 2', ['destiny 2']],
  [2246340, 'Monster Hunter Wilds', ['monster hunter wilds', 'mh wilds']],
  [582010, 'Monster Hunter: World', ['monster hunter world', 'mhw']],
  [292030, 'The Witcher 3: Wild Hunt', ['the witcher 3 wild hunt', 'the witcher 3', 'witcher 3']],
  [1174180, 'Red Dead Redemption 2', ['red dead redemption 2', 'rdr2']],
  [271590, 'Grand Theft Auto V', ['grand theft auto 5', 'gta 5', 'gta v', 'gta']],
  [374320, 'DARK SOULS III', ['dark souls 3', 'ds3']],
  [814380, 'Sekiro: Shadows Die Twice', ['sekiro shadows die twice', 'sekiro']],
  [105600, 'Terraria', ['terraria']],
  [1623730, 'Palworld', ['palworld']],
  [2694490, 'Path of Exile 2', ['path of exile 2', 'poe2', 'poe 2']],
  [238960, 'Path of Exile', ['path of exile', 'poe']],
  [230410, 'Warframe', ['warframe']],
  [252490, 'Rust', ['rust']],
  [578080, 'PUBG: BATTLEGROUNDS', ['pubg battlegrounds', 'pubg']],
  [359550, "Tom Clancy's Rainbow Six Siege", ['rainbow six siege', 'r6 siege', 'r6']],
  [548430, 'Deep Rock Galactic', ['deep rock galactic', 'drg']],
  [1966720, 'Lethal Company', ['lethal company']],
  [892970, 'Valheim', ['valheim']],
  [2358720, 'Black Myth: Wukong', ['black myth wukong', 'wukong']],
  [1903340, 'Clair Obscur: Expedition 33', ['clair obscur expedition 33', 'clair obscur', 'expedition 33']],
  [2767030, 'Marvel Rivals', ['marvel rivals']],
  [1716740, 'Starfield', ['starfield']],
  [275850, "No Man's Sky", ['no mans sky']],
  [39210, 'FINAL FANTASY XIV Online', ['final fantasy 14 online', 'final fantasy 14', 'ffxiv', 'ff14']],
  [1627720, 'Lies of P', ['lies of p']],
  [1888160, 'ARMORED CORE VI FIRES OF RUBICON', ['armored core 6 fires of rubicon', 'armored core 6', 'ac6']],
  [990080, 'Hogwarts Legacy', ['hogwarts legacy']],
  [1172620, 'Sea of Thieves', ['sea of thieves']],
  [440, 'Team Fortress 2', ['team fortress 2', 'tf2']],
  [252950, 'Rocket League', ['rocket league']],
  [381210, 'Dead by Daylight', ['dead by daylight', 'dbd']],
  [526870, 'Satisfactory', ['satisfactory']],
  [427520, 'Factorio', ['factorio']],
  [264710, 'Subnautica', ['subnautica']],
];
const KNOWN_BY_KEY = new Map();
for (const [appid, name, keys] of KNOWN) for (const k of keys) KNOWN_BY_KEY.set(k, { appid, name });

const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };

/** Lower-case, no marks or punctuation, roman numerals as digits ("Hades II" → "hades 2"). */
export function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .map((w, i) => (i > 0 && ROMAN[w] ? ROMAN[w] : w))
    .join(' ');
}

/** The search term as sent: printable, bounded. */
export function cleanTerm(term) {
  // Control characters are exactly what this strips.
  // eslint-disable-next-line no-control-regex
  return String(term || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function buildSearchUrl(term) {
  return `${SEARCH_URL}?term=${encodeURIComponent(cleanTerm(term))}&l=english&cc=US`;
}

const PENALTY_RX = /\b(soundtrack|ost|dlc|demo|playtest|bundle|season pass|dedicated server|artbook|art book|expansion pass|upgrade|pack|sdk|editor|test server)\b/;

/** 0–100. Exact beats prefix beats shared words; extras like "Soundtrack" sink. */
export function scoreTitle(candidate, term) {
  const c = normalizeTitle(candidate);
  const t = normalizeTitle(term);
  if (!c || !t) return 0;
  let score;
  if (c === t) score = 100;
  else if (c.startsWith(`${t} `)) score = 82 - Math.min(20, (c.length - t.length) * 0.6);
  else {
    const ct = new Set(c.split(' '));
    const tt = new Set(t.split(' '));
    let shared = 0;
    for (const w of tt) if (ct.has(w)) shared++;
    score = (shared / new Set([...ct, ...tt]).size) * 70;
  }
  if (PENALTY_RX.test(c) && !PENALTY_RX.test(t)) score -= 45;
  return score;
}

const MIN_SCORE = 55;

/** Best Steam app for the term, or null when nothing is a confident match. */
export function pickBestMatch(items, term) {
  const apps = (Array.isArray(items) ? items : [])
    .filter(i => i && i.type === 'app' && Number.isInteger(i.id) && typeof i.name === 'string');
  let best = null;
  for (const a of apps) {
    const s = scoreTitle(a.name, term);
    if (!best || s > best.score) best = { app: a, score: s };
  }
  return best && best.score >= MIN_SCORE ? best.app : null;
}

/** Only https images on Steam's own CDNs, with nothing that could break out of a url(). */
export function isAllowedArtUrl(url) {
  if (typeof url !== 'string' || /["'()\\\s<>]/.test(url)) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return h.endsWith('.steamstatic.com') || h === 'steamcdn-a.akamaihd.net';
  } catch {
    return false;
  }
}

/**
 * Candidate image URLs, best first. Newer apps keep their assets under a
 * hashed folder; the search result's small image carries that folder, so the
 * big ones are derived from it first, with the legacy path as the fallback.
 */
export function buildArtCandidates(appid, tinyImage) {
  const bases = [];
  if (isAllowedArtUrl(tinyImage)) {
    const m = /^(https:\/\/[^?#]+\/apps\/\d+\/(?:[0-9a-f]{40}\/)?)[^/?#]+/.exec(tinyImage);
    if (m) bases.push(m[1]);
  }
  bases.push(`${LEGACY_CDN}/${appid}/`);
  const list = (file) => [...new Set(bases.map(b => b + file))].filter(isAllowedArtUrl);
  return { hero: list('library_hero.jpg'), header: list('header.jpg'), cover: list('library_600x900.jpg') };
}

export function knownGame(term) {
  return KNOWN_BY_KEY.get(normalizeTitle(term)) || null;
}

const HIT_CACHE = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400';
const MISS_CACHE = 'public, max-age=3600, s-maxage=86400';

/**
 * @returns {Promise<{status:number, body:object, cacheControl?:string}>}
 *   body is { match: {appid, name, hero[], header[], cover[]} | null }.
 */
export async function resolveSteamArt(term, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  const t = cleanTerm(term);
  if (t.length < 2) return { status: 400, body: { error: 'Missing q' } };

  const known = knownGame(t);
  if (known) {
    return { status: 200, cacheControl: HIT_CACHE, body: { match: { appid: known.appid, name: known.name, ...buildArtCandidates(known.appid) } } };
  }

  try {
    const res = await fetchImpl(buildSearchUrl(t), {
      headers: { 'User-Agent': 'GameGuide-AI/1.0 (game art lookup)', Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { status: 502, body: { error: 'Lookup unavailable' } };
    const data = await res.json();
    const app = pickBestMatch(data?.items, t);
    if (!app) return { status: 200, cacheControl: MISS_CACHE, body: { match: null } };
    return {
      status: 200,
      cacheControl: HIT_CACHE,
      body: { match: { appid: app.id, name: String(app.name).slice(0, 120), ...buildArtCandidates(app.id, app.tiny_image) } },
    };
  } catch {
    // Never relay upstream error text (see chat-proxy's /health lesson).
    return { status: 502, body: { error: 'Lookup unavailable' } };
  }
}
