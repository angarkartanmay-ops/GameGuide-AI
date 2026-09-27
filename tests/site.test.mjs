// "Press Start" landing and info pages — the pure logic and data behind them:
// the Konami matcher, achievements, the showcase games and their accents,
// the spoiler demo, and a guard against claims the product can't back up.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KONAMI, advance, isTypingTarget } from '../src/site/konami.js';
import { ACHIEVEMENTS, createAchievements } from '../src/site/achievements.js';
import {
  HERO_GAMES, LIBRARY, SITE_BG, heroArt, coverArt, SHIELD_LINES, SHIELD_MILESTONES, isVisibleAt, visibleCount,
} from '../src/site/showcase.js';
import { LINKS, mailto } from '../src/site/links.js';
import { contrastRatio } from '../src/utils/accent.js';
import { isAllowedArtUrl } from '../api/_steamArt.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

// ── Konami ─────────────────────────────────────────────────────────────────
function feed(keys) {
  let pos = 0;
  let done = 0;
  for (const k of keys) {
    const r = advance(pos, k);
    pos = r.pos;
    if (r.done) done++;
  }
  return { pos, done };
}
check('the full code completes once', feed(KONAMI).done === 1);
check('upper-case B A counts', feed([...KONAMI.slice(0, 8), 'B', 'A']).done === 1);
check('a wrong key resets', feed([...KONAMI.slice(0, 5), 'x', ...KONAMI.slice(5)]).done === 0);
check('an extra ↑ at the start still completes', feed(['ArrowUp', ...KONAMI]).done === 1);
check('↑ ↑ ↑ keeps two ↑ of progress', feed(['ArrowUp', 'ArrowUp', 'ArrowUp']).pos === 2);
check('completing resets the position', feed(KONAMI).pos === 0);
check('twice in a row completes twice', feed([...KONAMI, ...KONAMI]).done === 2);
check('fields are typing targets', isTypingTarget({ tagName: 'INPUT' }) && isTypingTarget({ tagName: 'textarea' }) && isTypingTarget({ tagName: 'DIV', isContentEditable: true }));
check('buttons and the page are not', !isTypingTarget({ tagName: 'BUTTON' }) && !isTypingTarget(null));

// ── Achievements ───────────────────────────────────────────────────────────
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
}
{
  const mem = memoryStorage();
  const store = createAchievements(mem);
  const heard = [];
  store.subscribe(a => heard.push(a.id));
  check('first unlock returns the achievement', store.unlock('tutorial')?.id === 'tutorial');
  check('second unlock returns null', store.unlock('tutorial') === null);
  check('unknown ids are ignored', store.unlock('nope') === null && store.count() === 1);
  check('listeners hear each unlock once', heard.join() === 'tutorial');
  check('saved to storage', JSON.parse(mem.data['gg.site.achievements.v1']).includes('tutorial'));
  const again = createAchievements(mem);
  check('restored from storage', again.has('tutorial') && again.count() === 1);
  check('total matches the list', store.total === ACHIEVEMENTS.length);
}
{
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const store = createAchievements(throwing);
  check('blocked storage still unlocks in memory', store.unlock('old-school')?.id === 'old-school' && store.count() === 1);
  check('no storage at all works too', createAchievements(null).unlock('watchman')?.id === 'watchman');
  const junk = createAchievements(memoryStorage({ 'gg.site.achievements.v1': '{not json' }));
  check('corrupt storage starts empty', junk.count() === 0);
  const foreign = createAchievements(memoryStorage({ 'gg.site.achievements.v1': '["tutorial","hacked"]' }));
  check('unknown stored ids are dropped', foreign.count() === 1);
}
check('achievement ids are unique', new Set(ACHIEVEMENTS.map(a => a.id)).size === ACHIEVEMENTS.length);

// ── Showcase data ──────────────────────────────────────────────────────────
const hexRgb = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
const bg = hexRgb(SITE_BG);
for (const g of HERO_GAMES) {
  check(`${g.name}: accent is a hex colour`, /^#[0-9a-f]{6}$/i.test(g.accent), g.accent);
  const ratio = contrastRatio(hexRgb(g.accent), bg);
  check(`${g.name}: accent readable on the page (≥ 4.5:1)`, ratio >= 4.5, ratio.toFixed(2));
}
check('six hero games', HERO_GAMES.length === 6);
const ids = LIBRARY.map(g => g.appid);
check('library appids are unique', new Set(ids).size === ids.length);
check('library fills three rows of eight', LIBRARY.length === 24);
check('every library entry has a name and integer appid', LIBRARY.every(g => g.name && Number.isInteger(g.appid)));
const offCdn = [...HERO_GAMES, ...LIBRARY]
  .filter(g => !isAllowedArtUrl(heroArt(g.appid)) || !isAllowedArtUrl(coverArt(g.appid)))
  .map(g => g.name);
check('every art URL is on Steam\'s CDN', offCdn.length === 0, offCdn.join(', '));

// ── Spoiler Shield demo ────────────────────────────────────────────────────
check('at the start only the first line shows', visibleCount(SHIELD_LINES, 0) === 1);
check('at the end everything shows', visibleCount(SHIELD_LINES, SHIELD_MILESTONES.length - 1) === SHIELD_LINES.length);
check('visibility only grows with progress', SHIELD_MILESTONES.every((_, i) => i === 0 || visibleCount(SHIELD_LINES, i) >= visibleCount(SHIELD_LINES, i - 1)));
check('the Morgott reveal is hidden before Leyndell', !isVisibleAt(SHIELD_LINES.find(l => /Morgott/.test(l.text)), 2));
check('every line belongs to a real milestone', SHIELD_LINES.every(l => l.stage >= 0 && l.stage < SHIELD_MILESTONES.length));

// ── Links ──────────────────────────────────────────────────────────────────
check('external links are https', ['linkedin', 'github', 'discordInvite', 'topgg'].every(k => LINKS[k].startsWith('https://')));
check('mailto without a subject', mailto() === `mailto:${LINKS.email}`);
check('mailto encodes the subject', mailto('Bug & idea') === `mailto:${LINKS.email}?subject=Bug%20%26%20idea`);

// ── Honest copy ────────────────────────────────────────────────────────────
// Claims the old pages made that the product no longer backs up, and the
// design system's banned marketing words. Any of these in the site's copy
// is a regression.
const STALE = [
  [/<\s*400\s*ms|sub-400|400\s*ms/i, 'a latency promise'],
  [/200\+\s*titles/i, '"200+ titles"'],
  [/4[- ]provider|four (?:AI|LLM) providers|providers race/i, 'the provider race'],
  [/\/build\b|\/counter\b/, 'commands that do not exist'],
  [/\b(?:Elevate|Seamless|Unleash)\b/, 'banned marketing words'],
  [/Inter['"]|Space Grotesk|JetBrains Mono/, 'fonts the page never loads'],
];
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : [p];
  });
}
const SITE_FILES = [
  ...files(join(ROOT, 'src', 'components', 'site')),
  ...files(join(ROOT, 'src', 'site')),
  join(ROOT, 'src', 'components', 'LandingPage.jsx'),
  join(ROOT, 'src', 'components', 'InfoPage.jsx'),
  join(ROOT, 'src', 'styles', 'site.css'),
  join(ROOT, 'index.html'),
  join(ROOT, 'public', 'llms.txt'),
];
for (const f of SITE_FILES) {
  const text = readFileSync(f, 'utf8');
  for (const [rx, what] of STALE) {
    const m = rx.exec(text);
    check(`${f.slice(ROOT.length + 1)}: no ${what}`, !m, m?.[0]);
  }
}

console.log(`site: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
