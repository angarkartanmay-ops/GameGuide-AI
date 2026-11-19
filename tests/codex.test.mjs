// Living Codex chat UI — the pure logic behind it: slash palette, game
// context, accent colour, recent-games shelf. No DOM needed.

import {
  paletteState, nextIndex, selectionAction, usageFor, wantsSlashFocus, QUICK_COMMANDS, quickDraft,
} from '../src/utils/slashPalette.js';
import {
  parseStreamStage, stageLabel, normalizeGameKey, latestGameFromMessages, latestSpoilerMeta, titleCase, upperRomans,
  looksLikeGameTitle,
} from '../src/utils/gameContext.js';
import { pickAccent, ensureContrast, contrastRatio, rgbToHsl, toHex } from '../src/utils/accent.js';
import { addRecent, buildShelf, CURATED, loadRecentGames } from '../src/utils/recentGames.js';
import { backdropCandidates } from '../src/utils/gameArt.js';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

// ── slash palette ──────────────────────────────────────────────────────────
const CMDS = ['/clear', '/stealth', '/help', '/spoilers', '/progress', '/price', '/discover', '/konami']
  .map(trigger => ({ trigger, description: trigger.slice(1), emoji: '' }));
const names = (s) => s.items.map(i => i.trigger).join(',');
check('"/" lists every command', paletteState('/', CMDS).items.length === CMDS.length);
check('"/pr" → /progress and /price', names(paletteState('/pr', CMDS)) === '/progress,/price', names(paletteState('/pr', CMDS)));
check('case-insensitive', paletteState('/PR', CMDS).items.length === 2);
check('"/price elden" keeps /price as a hint', (() => { const s = paletteState('/price elden', CMDS); return s.mode === 'hint' && names(s) === '/price'; })());
check('"/xyz" closes', paletteState('/xyz', CMDS).mode === 'closed');
check('plain text closes', paletteState('who is the final boss', CMDS).mode === 'closed');
check('"/pricey stuff" is not /price', paletteState('/pricey stuff', CMDS).mode === 'closed');
check('nextIndex wraps down', nextIndex(1, 2, 1) === 0);
check('nextIndex wraps up', nextIndex(0, 3, -1) === 2);
check('nextIndex on empty list', nextIndex(0, 0, 1) === 0);
const pick = (t, typed) => selectionAction(CMDS.find(c => c.trigger === t), typed);
check('/price inserts with a space', JSON.stringify(pick('/price', '/pr')) === '{"type":"insert","text":"/price "}');
check('/progress inserts', pick('/progress', '/pro').type === 'insert');
check('/spoilers inserts', pick('/spoilers', '/sp').type === 'insert');
check('/help sends', JSON.stringify(pick('/help', '/he')) === '{"type":"send","text":"/help"}');
check('/clear needs a second Enter', pick('/clear', '/cl').type === 'insert' && pick('/clear', '/clear').type === 'send');
check('usage hint for /progress', usageFor({ trigger: '/progress' }) === '<game> : <where>');

// ── game context ───────────────────────────────────────────────────────────
check('stage without detail', JSON.stringify(parseStreamStage('generating')) === '{"stage":"generating","detail":null}');
check('stage with a colon in the title keeps it whole',
  parseStreamStage('searching:Clair Obscur: Expedition 33').detail === 'Clair Obscur: Expedition 33');
check('null stage', parseStreamStage(null).stage === null);
check('stage label', stageLabel('scanning-sources:Elden Ring') === 'Reading wikis, patch notes and community threads…');
check('unknown stage has no label', stageLabel('nope') === null);
check('game key normalised', normalizeGameKey('  Elden Ring™  ') === 'elden ring');
{
  const msgs = [
    { sender: 'user', text: 'hi' },
    { sender: 'ai', text: 'a', meta: { game: 'elden ring', spoiler: { mode: 'progress', progress: 'beat Margit' } } },
    { sender: 'user', text: '/help' },
    { sender: 'ai', text: 'help', isCommand: true, meta: { game: 'cyberpunk 2077' } },
    { sender: 'ai', text: 'partial', streaming: true, meta: null },
  ];
  check('latest game skips command replies and streaming drafts', latestGameFromMessages(msgs) === 'elden ring');
  check('history without meta → no game', latestGameFromMessages([{ sender: 'ai', text: 'old' }]) === null);
  check('latest spoiler meta', latestSpoilerMeta(msgs)?.progress === 'beat Margit');
}

// ── accent ─────────────────────────────────────────────────────────────────
const buffer = (pixels) => Uint8ClampedArray.from(pixels.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));
const fill = (px, n) => Array.from({ length: n }, () => px);
check('contrast of white on black is 21', Math.round(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })) === 21);
{
  const red = pickAccent(buffer(fill([220, 30, 30], 50)));
  check('red art → red accent', red && Math.abs(rgbToHsl(red).h - 0) < 10, JSON.stringify(red));
  const mixed = pickAccent(buffer([...fill([120, 120, 120], 400), ...fill([30, 90, 230], 30)]));
  check('grey scene with a blue sigil → blue', mixed && rgbToHsl(mixed).h > 200 && rgbToHsl(mixed).h < 240, JSON.stringify(mixed));
  check('all grey → null', pickAccent(buffer(fill([128, 128, 128], 300))) === null);
  check('transparent pixels ignored', pickAccent(buffer(fill([220, 30, 30, 0], 300))) === null);
  const gold = pickAccent(buffer([...fill([20, 40, 45], 500), ...fill([235, 175, 80], 60)]));
  check('dark teal scene with a gold glow → gold (Elden Ring)', gold && rgbToHsl(gold).h > 25 && rgbToHsl(gold).h < 50, JSON.stringify(gold));
}
{
  const bg = { r: 7, g: 9, b: 13 };
  const navy = ensureContrast({ r: 20, g: 30, b: 90 }, bg);
  check('dark navy lifted to AA on the chat background', contrastRatio(navy, bg) >= 4.5, String(contrastRatio(navy, bg)));
  const neon = ensureContrast({ r: 255, g: 0, b: 255 }, bg);
  check('neon desaturated', rgbToHsl(neon).s <= 0.8, JSON.stringify(rgbToHsl(neon)));
  check('hex output', toHex({ r: 255, g: 8, b: 0 }) === '#ff0800');
}

// ── recent games ───────────────────────────────────────────────────────────
{
  let list = [];
  list = addRecent(list, { name: 'Elden Ring' });
  list = addRecent(list, { name: 'Hades II', appid: 1145350 });
  list = addRecent(list, { name: 'elden ring' });
  check('dedupe ignores case, newest first', list.map(e => e.key).join('|') === 'elden ring|hades ii', JSON.stringify(list));
  check('appid kept', addRecent([], { name: 'Hades II', appid: 1145350 })[0].appid === 1145350);
  check('rejects empty and overlong names', addRecent([], { name: ' ' }).length === 0 && addRecent([], { name: 'x'.repeat(81) }).length === 0);
  let many = [];
  for (let i = 0; i < 12; i++) many = addRecent(many, { name: `Game ${i}` });
  check('capped at 8', many.length === 8 && many[0].name === 'Game 11');
  const shelf = buildShelf([{ key: 'elden ring', name: 'Elden Ring', appid: 1245620 }], { 'elden ring': 'beat Margit', 'stardew valley': 'Year 2' });
  check('shelf: recent first with its progress', shelf[0].key === 'elden ring' && shelf[0].progress === 'beat Margit');
  check('shelf: progress-only games next, title-cased', shelf[1].name === 'Stardew Valley' && shelf[1].progress === 'Year 2', JSON.stringify(shelf[1]));
  check('shelf: curated fills to 6 without repeats', shelf.length === 6 && new Set(shelf.map(s => s.key)).size === 6);
  check('shelf: empty history → curated', buildShelf([], {}).map(s => s.key).join() === CURATED.map(c => c.key).join());
}

// ── only titles reach the shelf ────────────────────────────────────────────
// The server once answered meta.game = "have drs option still" for an F1
// question, and the shelf kept "Have Drs Option Still" as a recent game.
{
  for (const t of ['Have Drs Option Still', 'have drs option still', 'Still Have Drs', 'F1 Cars Still Have Drs Option', '2026']) {
    check(`fragment rejected: ${t}`, !looksLikeGameTitle(t));
  }
  // Lexical, not a Steam lookup: games without Steam art are legitimate.
  for (const t of ['Grand Theft Auto VI', 'War Thunder', 'F1', 'Elden Ring', "Baldur's Gate 3", 'Life Is Strange',
    'Still Wakes the Deep', 'Clair Obscur: Expedition 33', 'Ori And The Will Of The Wisps', 'Hades II']) {
    check(`title kept: ${t}`, looksLikeGameTitle(t));
  }
  check('empty is not a title', !looksLikeGameTitle('') && !looksLikeGameTitle(null));

  // A shelf saved before the fix sheds the fragment on load.
  const saved = [
    { key: 'have drs option still', name: 'Have Drs Option Still' },
    { key: 'war thunder', name: 'War Thunder' },
    { key: 'grand theft auto vi', name: 'Grand Theft Auto VI' },
  ];
  const prevWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => JSON.stringify(saved), setItem() {} } };
  try {
    const loaded = loadRecentGames().map(e => e.key).join('|');
    check('stored fragment dropped on load, real games kept', loaded === 'war thunder|grand theft auto vi', loaded);
  } finally {
    if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
  }
}

// ── backdrop art ───────────────────────────────────────────────────────────
// The hero is the wide atmospheric art; header.jpg is the store capsule, and
// using it as the masthead shows the game's logo twice. Hero always leads.
{
  const match = { hero: ['H1', 'H2'], header: ['E1'], cover: ['C1'] };
  check('hero leads, header is the fallback', backdropCandidates(match).join() === 'H1,H2,E1');
  check('the cover is never a backdrop', !backdropCandidates(match).includes('C1'));
  check('no art is not a crash', backdropCandidates(null).length === 0 && backdropCandidates({}).length === 0);
}

// ── The "/" shortcut ───────────────────────────────────────────────────────
// A bare "/" outside any field moves focus into the bar; anything that could
// be someone typing, or a shortcut of their own, is left alone.
const key = (over = {}) => ({ key: '/', target: { tagName: 'BUTTON' }, ...over });
check('"/" on a button focuses the bar', wantsSlashFocus(key()));
check('"/" on the page body focuses the bar', wantsSlashFocus(key({ target: { tagName: 'BODY' } })));
check('"/" with no target focuses the bar', wantsSlashFocus({ key: '/' }));
check('"/" typed in a field stays in that field', !wantsSlashFocus(key({ target: { tagName: 'INPUT' } })) && !wantsSlashFocus(key({ target: { tagName: 'textarea' } })) && !wantsSlashFocus(key({ target: { tagName: 'SELECT' } })));
check('"/" in contenteditable stays there', !wantsSlashFocus(key({ target: { tagName: 'DIV', isContentEditable: true } })));
check('Ctrl/Cmd/Alt + "/" belong to the browser', !wantsSlashFocus(key({ ctrlKey: true })) && !wantsSlashFocus(key({ metaKey: true })) && !wantsSlashFocus(key({ altKey: true })));
check('Shift + "/" still counts (layouts where "/" needs Shift)', wantsSlashFocus(key({ shiftKey: true })));
check('other keys do nothing', !wantsSlashFocus(key({ key: 'a' })) && !wantsSlashFocus(key({ key: '?' })) && !wantsSlashFocus(key({ key: 'Enter' })));
check('an open modal keeps its keys', !wantsSlashFocus(key(), true));
check('IME composition is never interrupted', !wantsSlashFocus(key({ isComposing: true })));
check('an already-handled key is left alone', !wantsSlashFocus(key({ defaultPrevented: true })));
check('nothing is a no', !wantsSlashFocus(null) && !wantsSlashFocus(undefined));

// ── Quick commands in the bar ──────────────────────────────────────────────
// Each is a draft the player still sends, with the game in context named.
check('quick commands all take arguments (so a draft, never a send)', QUICK_COMMANDS.every(q => selectionAction(q, '').type === 'insert' && usageFor(q)));
check('quick labels are the command names', QUICK_COMMANDS.every(q => `/${q.label}` === q.trigger));
check('/price names the game in context', quickDraft('/price', 'Cyberpunk 2077') === '/price Cyberpunk 2077');
check('/missables names the game in context', quickDraft('/missables', 'Elden Ring') === '/missables Elden Ring');
check('/progress leaves "where" for the player', quickDraft('/progress', 'Elden Ring') === '/progress Elden Ring : ');
check('no game: just the command and a space', quickDraft('/price', null) === '/price ' && quickDraft('/progress', '  ') === '/progress ');
check('a quick draft keeps the palette in its usage hint', paletteState(quickDraft('/price', 'Hades II'), CMDS).mode === 'hint');

// ── Game names ─────────────────────────────────────────────────────────────
check('roman numerals are capitals', titleCase('grand theft auto vi') === 'Grand Theft Auto VI', titleCase('grand theft auto vi'));
check('…of any length', titleCase('final fantasy xiv') === 'Final Fantasy XIV' && titleCase('hades ii') === 'Hades II');
check('no capital after an apostrophe', titleCase("baldur's gate 3") === "Baldur's Gate 3", titleCase("baldur's gate 3"));
check('a colon starts a word', titleCase('clair obscur: expedition 33') === 'Clair Obscur: Expedition 33');
check('words that merely contain numerals are left alone', titleCase('civilization vi') === 'Civilization VI' && titleCase('vivid mix') === 'Vivid Mix');
check('a saved name is only fixed, never re-cased', upperRomans('Grand Theft Auto Vi') === 'Grand Theft Auto VI' && upperRomans('iRacing') === 'iRacing');
{
  const shelf = buildShelf([{ key: 'grand theft auto vi', name: 'Grand Theft Auto Vi' }], {});
  check('shelf: names saved as "Auto Vi" show as "Auto VI"', shelf[0].name === 'Grand Theft Auto VI', shelf[0].name);
}

console.log(`codex: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
