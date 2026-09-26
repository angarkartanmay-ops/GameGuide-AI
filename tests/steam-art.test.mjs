// Steam art lookup (api/_steamArt.js) — what the chat backdrop shows.
// No art beats wrong art; the user's text never reaches a host or path.

import {
  normalizeTitle, scoreTitle, pickBestMatch, buildSearchUrl, isAllowedArtUrl,
  buildArtCandidates, resolveSteamArt, knownGame,
} from '../api/_steamArt.js';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

check('roman numerals as digits', normalizeTitle('Hades II') === 'hades 2');
check('marks and punctuation dropped', normalizeTitle("Baldur's Gate™ 3") === 'baldurs gate 3');
check('first word never read as a numeral', normalizeTitle('X-Com 2') === 'x com 2');

const ITEMS = [
  { type: 'app', id: 2622380, name: 'ELDEN RING NIGHTREIGN' },
  { type: 'app', id: 999001, name: 'ELDEN RING Soundtrack' },
  { type: 'app', id: 1245620, name: 'ELDEN RING', tiny_image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1245620/capsule_231x87.jpg?t=1' },
  { type: 'dlc', id: 5, name: 'Elden Ring' },
];
check('exact title wins over the spin-off and the soundtrack', pickBestMatch(ITEMS, 'elden ring')?.id === 1245620);
check('"hades 2" matches "Hades II"', pickBestMatch([{ type: 'app', id: 1, name: 'Hades II' }, { type: 'app', id: 2, name: 'Hades' }], 'hades 2')?.id === 1);
check('junk term → null (no art beats wrong art)', pickBestMatch(ITEMS, 'qwerty zxcv') === null);
check('soundtrack scores below the game', scoreTitle('ELDEN RING Soundtrack', 'elden ring') < scoreTitle('ELDEN RING', 'elden ring'));
check('non-app results ignored', pickBestMatch([{ type: 'dlc', id: 5, name: 'Elden Ring' }], 'elden ring') === null);

{
  const u = new URL(buildSearchUrl('a&b#c%0d\n/evil?x=1'));
  check('search host fixed', u.origin === 'https://store.steampowered.com' && u.pathname === '/api/storesearch/');
  check('term stays one query value', u.searchParams.get('term') === 'a&b#c%0d /evil?x=1' && u.searchParams.get('cc') === 'US', u.search);
  check('term capped at 80 chars', u.searchParams.get('term').length <= 80 || buildSearchUrl('x'.repeat(500)).length < 200);
}

check('https steamstatic allowed', isAllowedArtUrl('https://cdn.akamai.steamstatic.com/steam/apps/1/header.jpg'));
check('http refused', !isAllowedArtUrl('http://cdn.akamai.steamstatic.com/steam/apps/1/header.jpg'));
check('other hosts refused', !isAllowedArtUrl('https://evil.com/steamstatic.com.jpg'));
check('lookalike host refused', !isAllowedArtUrl('https://steamstatic.com.evil.com/a.jpg'));
check('quotes/parens refused (CSS url() breakout)', !isAllowedArtUrl('https://cdn.akamai.steamstatic.com/a.jpg")x(') && !isAllowedArtUrl("https://cdn.akamai.steamstatic.com/a'.jpg"));

{
  const hashed = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2622380/0123456789abcdef0123456789abcdef01234567/capsule_231x87.jpg?t=9';
  const c = buildArtCandidates(2622380, hashed);
  check('hashed folder kept for the big art', c.hero[0] === 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2622380/0123456789abcdef0123456789abcdef01234567/library_hero.jpg', c.hero[0]);
  check('legacy path is the fallback', c.hero[1] === 'https://cdn.akamai.steamstatic.com/steam/apps/2622380/library_hero.jpg');
  check('cover + header candidates', c.cover.length === 2 && c.header.length === 2);
  check('bad tiny_image ignored', buildArtCandidates(1, 'javascript:alert(1)').hero.length === 1);
}

check('known game resolves without search', knownGame('Elden Ring')?.appid === 1245620 && knownGame('bg3')?.appid === 1086940);

{
  let calls = 0;
  const fakeFetch = (items, ok = true) => async () => { calls++; return { ok, json: async () => ({ items }) }; };
  const known = await resolveSteamArt('Elden Ring', { fetchImpl: fakeFetch([]) });
  check('known game: no network call', calls === 0 && known.status === 200 && known.body.match.appid === 1245620);
  check('known game: cached a week at the edge', /s-maxage=604800/.test(known.cacheControl));
  const found = await resolveSteamArt('Some Indie Game', { fetchImpl: fakeFetch([{ type: 'app', id: 42, name: 'Some Indie Game', tiny_image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/42/capsule_231x87.jpg' }]) });
  check('searched game resolves', found.status === 200 && found.body.match.appid === 42 && found.body.match.hero.length === 2);
  const miss = await resolveSteamArt('Nothing Like It', { fetchImpl: fakeFetch([{ type: 'app', id: 7, name: 'Totally Different' }]) });
  check('no confident match → null, cached shorter', miss.status === 200 && miss.body.match === null && /s-maxage=86400/.test(miss.cacheControl));
  const down = await resolveSteamArt('Some Game', { fetchImpl: async () => { throw new Error('ECONNRESET secret-internal-detail'); } });
  check('upstream failure → 502, generic body', down.status === 502 && !JSON.stringify(down.body).includes('secret'));
  const bad = await resolveSteamArt('Some Game', { fetchImpl: fakeFetch([], false) });
  check('upstream non-200 → 502', bad.status === 502);
  const empty = await resolveSteamArt(' ', { fetchImpl: fakeFetch([]) });
  check('empty term → 400', empty.status === 400);
}

console.log(`steam-art: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
