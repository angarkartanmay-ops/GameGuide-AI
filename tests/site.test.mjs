// "Press Start" landing and info pages — the pure logic and data behind them:
// the Konami matcher, achievements, the showcase games and their accents,
// the spoiler demo, and a guard against claims the product can't back up.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KONAMI, advance, isTypingTarget } from '../src/site/konami.js';
import { ACHIEVEMENTS, createAchievements } from '../src/site/achievements.js';
import {
  HERO_GAMES, LIBRARY, SITE_BG, heroArt, coverArt, SHIELD_LINES, SHIELD_MILESTONES, isVisibleAt, visibleCount, HOW_DEMO,
} from '../src/site/showcase.js';
import { LINKS, mailto } from '../src/site/links.js';
import { parseProgressArgs } from '../src/utils/spoilerPrefs.js';
import { SAMPLE_QUESTIONS } from '../src/site/sampleQuestions.js';
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
check('launch badge links are https and unmodified',
  LINKS.launchbuff === 'https://launchbuff.com/products/gameguide-f9fwfb'
  && /^https:\/\/www\.producthunt\.com\/products\/gameguide-ai\?/.test(LINKS.productHunt)
  && LINKS.launchbuffBadge.startsWith('https://launchbuff.com/') && LINKS.productHuntBadge.startsWith('https://api.producthunt.com/'));
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
  join(ROOT, 'src', 'components', 'InfoContent.jsx'),
  join(ROOT, 'src', 'components', 'infoPages.js'),
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

// ── The quick explainer ────────────────────────────────────────────────────
// One question answered twice. The line it holds back is the Shield demo's
// own, decided by the same isVisibleAt(), and the command it teaches goes
// through the app's real /progress parser, so none of it can drift.
check('the explainer asks one question', HOW_DEMO.question.endsWith('?') && !/[—–]/.test(HOW_DEMO.question));
check('it opens with a line the player may read', isVisibleAt(HOW_DEMO.lines[0], HOW_DEMO.milestone));
check('and holds the late-game reveal back', !isVisibleAt(HOW_DEMO.lines[1], HOW_DEMO.milestone));
check('the held-back line is the Shield demo line, not a copy', HOW_DEMO.lines[1] === SHIELD_LINES[3]);
check('"where" names the milestone it holds back from', HOW_DEMO.where === SHIELD_MILESTONES[HOW_DEMO.milestone].label);
{
  const args = HOW_DEMO.command.replace(/^\/progress\s+/, '');
  const parsed = parseProgressArgs(args);
  check('its /progress example parses', !!parsed && parsed.game === HOW_DEMO.game && parsed.where === SHIELD_MILESTONES[HOW_DEMO.milestone].progress, JSON.stringify(parsed));
}
check('the one-sentence reply is the spoiler-free opener', HOW_DEMO.lines[0].text.startsWith(HOW_DEMO.gist) && /\.$/.test(HOW_DEMO.gist));
check('no explainer line carries an em-dash', HOW_DEMO.lines.every(l => !/[—–]/.test(l.text)));

// ── Sample questions ───────────────────────────────────────────────────────
// The hero's chips (and the chat's empty state) read this one list. The chat
// only accepts a landing draft up to 200 characters, so a longer question
// would open the chat empty.
check('three sample questions', SAMPLE_QUESTIONS.length === 3);
check('sample questions are unique', new Set(SAMPLE_QUESTIONS).size === SAMPLE_QUESTIONS.length);
check('each fits the 200-character draft', SAMPLE_QUESTIONS.every(q => q.length <= 200));
check('each is a question without an em-dash', SAMPLE_QUESTIONS.every(q => q.endsWith('?') && !/[—–]/.test(q)));

// The landing's hero and the chat's empty state read ONE list. Mechanical
// guard: both import it, and neither carries a literal copy of a question.
{
  const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
  const hero = read('src', 'components', 'site', 'Hero.jsx');
  const empty = read('src', 'components', 'codex', 'EmptyState.jsx');
  check('the hero imports the shared questions', /from '\.\.\/\.\.\/site\/sampleQuestions'/.test(hero));
  check('the empty state imports the shared questions', /from '\.\.\/\.\.\/site\/sampleQuestions'/.test(empty));
  check('no question is copied into a component', SAMPLE_QUESTIONS.every(q => !hero.includes(q) && !empty.includes(q)));
}

// ── Static content for crawlers and no-JS visitors ─────────────────────────
// The app renders in the browser, so index.html carries the real pitch in its
// <noscript> block. It must keep saying what the product is, link to the
// pages, and follow the site's no-dash rule like the rest of the copy.
{
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] || '';
  check('index.html keeps a heading and the pitch in <noscript>', /<h1[^>]*>[^<]*game guide/i.test(noscript) && /spoiler/i.test(noscript));
  check('the <noscript> pitch links to the info pages', ['about', 'privacy', 'terms', 'contacts'].every(p => noscript.includes(`href="/${p}"`)));
  check('the <noscript> copy has no em-dash', !/[—–]/.test(noscript));
}

// ── Fonts are ours, and the page does not wait on a third party for them ───
// src/styles/fonts.css replaced the render-blocking Google Fonts stylesheet.
// Guard the three ways that goes wrong: a file the CSS names is missing, a
// face blocks text while it loads, or the third-party link creeps back.
{
  const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
  const css = read('src', 'styles', 'fonts.css');
  const html = read('index.html');
  const files = [...css.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map(m => m[1]);
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) || [];
  check('fonts.css declares faces', faces.length >= 8 && files.length === faces.length);
  check('every font file the CSS names is shipped', files.every(f => readdirSync(join(ROOT, 'public', 'fonts')).includes(f)), files.join(', '));
  check('every face swaps (text shows before the file lands)', faces.every(f => /font-display:\s*swap/.test(f)));
  check('every face is woff2 and limits its characters', faces.every(f => /format\('woff2'\)/.test(f) && /unicode-range/.test(f)));
  check('the four families the site uses are all declared', ['Archivo', 'Geist', 'Geist Mono', 'Fraunces'].every(n => css.includes(`font-family: '${n}'`)));
  check('index.html has no Google Fonts stylesheet or preconnect', !/fonts\.(googleapis|gstatic)\.com/.test(html));
  check('the main entry loads fonts.css', /styles\/fonts\.css/.test(read('src', 'main.jsx')));
  check('the fonts carry their licence', /SIL OPEN FONT LICENSE/i.test(read('public', 'fonts', 'LICENSE.txt')));
}

// ── The first game's art is asked for before the bundle runs ───────────────
// The inline script in index.html adds the preload; it must stay on Steam's
// two art hosts and mirror the files Hero.jsx picks (1x capsule on phones).
{
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const hero = readFileSync(join(ROOT, 'src', 'components', 'site', 'Hero.jsx'), 'utf8');
  check('the preload covers the phone cover and the wide hero', /\(max-width: 767px\)/.test(html) && /\(min-width: 768px\)/.test(html) && /rel = 'preload'/.test(html));
  check('the preload only trusts the two Steam art hosts', html.includes(String.raw`(shared|cdn)\.akamai\.steamstatic\.com`));
  check('the preload and the hero agree on the phone breakpoint', /MOBILE_MQ = '\(max-width: 767px\)'/.test(hero));
}

// ── Keyboard focus is always visible on controls ───────────────────────────
// A blanket `[tabindex="-1"]:focus { outline: none }` once removed the ring from
// the capability tabs' roving items (they are tabindex -1 until selected).
// Script-focused sections may go ringless; controls may not.
{
  const css = readFileSync(join(ROOT, 'src', 'styles', 'site.css'), 'utf8');
  const rules = css.match(/[^{}]*\[tabindex="-1"\][^{}]*\{[^}]*outline:\s*none[^}]*\}/g) || [];
  check('a tabindex -1 outline reset exists for focus targets', rules.length >= 1);
  check('...and it never applies to controls', rules.every(r => /:not\([^)]*button[^)]*\)/.test(r) && /\[role="tab"\]/.test(r)), rules.join(' | '));
  check('the site draws one focus ring for everything focusable', /\.site :focus-visible \{ outline: 2px solid var\(--s-accent\)/.test(css));
}

console.log(`site: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
