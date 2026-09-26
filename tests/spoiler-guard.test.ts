// Spoiler guard — the deterministic backstop behind the shield.
//
// Every case here is a shape seen on the live leak battery: the model hides a
// reveal correctly, then names it again in a Sources line or a follow-up chip.
// The guard must catch those echoes and must NOT hide what the player already
// knows, touch code, links or tables, or change a reply that has no bars.

import {
  barEchoes, barredNames, filterChips, guardShieldedReply, barAfterHeadsUp, guardStreaming,
} from '../supabase/functions/chat-proxy/spoilerGuard.ts';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}
const visible = (t: string) => t.replace(/\|\|[\s\S]*?\|\|/g, ' ');
const shows = (t: string, name: string) => new RegExp(`\\b${name}\\b`, 'i').test(visible(t));
const pipesBalanced = (t: string) => (t.match(/\|\|/g) || []).length % 2 === 0;
const KNOWN = ['who is the final boss?', 'I just beat Margit in Elden Ring!', 'beat Margit', 'elden ring'];

// ── the observed echo: hidden in the answer, named again in the sources ──
{
  const reply = [
    '⚠️ That’s past where you’re currently at:',
    '',
    '||**Elden Beast** – the true embodiment of the Elden Ring.||',
    '',
    '*Sources: Fextralife “Elden Beast” entry and a Reddit thread.*',
  ].join('\n');
  const out = barEchoes(reply, KNOWN);
  check('echo in a Sources line is barred', !shows(out, 'Elden Beast'), out);
  check('the original bar is intact', out.includes('||**Elden Beast** – the true embodiment of the Elden Ring.||'));
  check('bars stay balanced', pipesBalanced(out));
  check('unrelated names in the same line stay readable', shows(out, 'Fextralife'));
  check('idempotent', barEchoes(out, KNOWN) === out);
}

// ── case-insensitive echo; leading "The" is not part of the name ──
{
  const out = barEchoes('||The Elden Beast waits at the end.||\n\nPrepare well before the elden beast.', KNOWN);
  check('lowercase echo is barred', !shows(out, 'elden beast'), out);
  check('"The" stripped from the harvested name', barredNames('||The Elden Beast waits.||', KNOWN).includes('Elden Beast'));
}

// ── a name first mentioned openly was judged safe by the model ──
{
  const reply = 'The Greater Will shaped the Lands Between.\n\n||The Greater Will abandons Marika at the end.||\n\nThe Greater Will is a recurring idea.';
  const out = barEchoes(reply, KNOWN);
  check('first mention visible → later mentions stay visible', shows(out, 'Greater Will') && out === reply, out);
  check('a name first seen inside a bar is still caught', barredNames(reply, KNOWN).includes('Marika') === true);
}

// ── the reverse order, seen live: named openly first, barred after ──
{
  const a = 'The final showdown is the fight against the **Elden Beast**, the true form of the Ring.\n\n||⚠️ Spoiler: The Elden Beast is the final boss.||';
  const outA = barEchoes(a, KNOWN);
  check('a bar labelled "Spoiler" hides earlier mentions too', !shows(outA, 'Elden Beast'), outA);
  const b = 'The community crowns **Malenia** the hardest fight.\n\nLater nightmares include ||Radahn||, ||Malenia||, and ||Godfrey||.';
  const outB = barEchoes(b, KNOWN);
  check('a bar holding only a name hides earlier mentions too', !shows(outB, 'Malenia'), outB);
  check('…and keeps the markdown around it', outB.includes('**||Malenia||**'));
  const c = 'The Greater Will shaped the world.\n\n||Later you learn the Greater Will abandoned Marika entirely.||';
  check('an ordinary sentence bar still uses first mention', barEchoes(c, KNOWN) === c);
}

// ── names the player used themselves are never hidden ──
{
  const known = ['does Ranni die?', ...KNOWN];
  const out = barEchoes('||Ranni does not die — she ascends.||\n\nRanni’s questline starts at the Church of Elleh.', known);
  check('a name from the question stays readable', shows(out, 'Ranni'), out);
}

// ── nothing to do → exactly the same string ──
{
  const plain = 'Stormveil Castle is next. Bring a shield.\n\n[?] How do I get past the gate?';
  check('no bars → unchanged', barEchoes(plain, KNOWN) === plain);
  check('no bars → no names barred', barredNames(plain, KNOWN).length === 0);
}

// ── code, links and tables are left alone ──
{
  const reply = '||Mohg is optional.||\n\nUse `Mohg` in the search box.\n\n```\nboss = "Mohg"\n```\n\nSee [Mohg guide](https://example.com/Mohg).';
  const out = barEchoes(reply, KNOWN);
  check('inline code untouched', out.includes('`Mohg`'));
  check('fenced code untouched', out.includes('boss = "Mohg"'));
  check('markdown link untouched', out.includes('[Mohg guide](https://example.com/Mohg)'));
}
{
  const table = '| Boss | Area |\n| --- | --- |\n| Godrick || Stormveil |';
  const reply = `||Morgott waits in the capital.||\n\n${table}\n\nMorgott again.`;
  const out = barEchoes(reply, KNOWN);
  check('table rows untouched (an empty cell is "||")', out.includes(table));
  check('text after a table still guarded', !shows(out.split(table)[1], 'Morgott'), out);
}

// ── URLs: never rewritten inside; hidden whole when they name a hidden thing ──
{
  const out = barEchoes('||Malenia is optional.||\n\nGuide: https://wiki.example.com/Malenia+Blade and <https://x.com/Malenia> and https://x.com/Godrick', KNOWN);
  check('a URL naming a hidden thing is barred whole', out.includes('||https://wiki.example.com/Malenia+Blade||'), out);
  check('autolink form barred whole, brackets dropped', out.includes('||https://x.com/Malenia||'), out);
  check('a URL naming nothing hidden is untouched', out.includes(' https://x.com/Godrick'), out);
  check('no bars inside a URL', !/\/\|\|/.test(out), out);
}

// ── word boundaries ──
{
  const out = barEchoes('||Mohg is a late boss.||\n\nMohgwyn Palace is a place name, and so is Mohg.', KNOWN);
  check('longer word containing the name untouched', out.includes('Mohgwyn Palace'));
  check('the bare name is barred', /\|\|Mohg\|\|\./.test(out), out);
}

// ── streaming: an unclosed bar hides to the end, and its names count ──
{
  check('unclosed bar harvested', barredNames('Heads up: ||The final boss is the Elden Beast', KNOWN).includes('Elden Beast'));
  const mid = 'Heads up: ||The final boss is the Elden Beast||, see the Elden Beast wiki';
  check('mid-stream echo barred', !shows(barEchoes(mid, KNOWN), 'Elden Beast'));
}

// ── chips: plain buttons, so they may only name what is already visible ──
{
  const reply = [
    '⚠️ That’s past where you are.',
    '',
    '||The endings include the Age of the Stars and the Lord of Frenzied Flame.||',
    '',
    'For now, Stormveil Castle is your next stop.',
    '',
    '[?] How do I unlock the Age of the Stars ending?',
    '[?] How do I get past the gate at Stormveil Castle?',
    '[?] Which side quests matter for the endings?',
    '[?] Where do I find Rogier?',
    '[?] How do I beat Margit faster?',
    '[?] Is ||this|| worth it?',
  ].join('\n');
  const out = filterChips(reply, KNOWN);
  check('chip naming a hidden reveal dropped', !out.includes('Age of the Stars ending?'));
  check('chip naming a visible place kept', out.includes('[?] How do I get past the gate at Stormveil Castle?'));
  check('chip with no names kept', out.includes('[?] Which side quests matter for the endings?'));
  check('chip naming someone never shown dropped', !out.includes('Rogier'));
  check('chip naming what the player said kept', out.includes('[?] How do I beat Margit faster?'));
  check('chip containing bars dropped', !out.includes('[?] Is ||this|| worth it?'));
  check('body untouched by the chip filter', out.startsWith(reply.split('\n[?]')[0].trimEnd()));
}
{
  const reply = 'Past your point.\n\n||It ends with the Elden Beast.||\n\n[?] How do I beat the Elden Beast?\n[?] What level for the Elden Beast?';
  const out = guardShieldedReply(reply, KNOWN);
  check('all chips dropped → no [?] left (caller appends safe ones)', !out.includes('[?]'), out);
}
check('no chips → unchanged', filterChips('Just text.', KNOWN) === 'Just text.');

// ── linear time: the web client runs this on every streamed token ──
{
  const big = "That's past where you are.\n" + 'x\n'.repeat(20000);
  const t = performance.now();
  const out = guardShieldedReply(big, KNOWN);
  const ms = performance.now() - t;
  check('20k hidden lines guarded in well under a second', ms < 500, `${ms.toFixed(0)}ms`);
  check('…and every line is still hidden', !/^x$/m.test(out));
}

// ── heads-up, then the answer in plain text, then a bar (seen live) ──
{
  const reply = [
    "⚠️ That's past where you are.",
    '',
    'There are six endings, including the **Age of the Stars** and the **Lord of the Frenzied Flame**.',
    '- Age of Order',
    '',
    '||Each ending hinges on an NPC questline.||',
    '',
    'Honestly, just enjoy the journey.',
    '',
    '[?] What should I focus on next?',
  ].join('\n');
  const out = barAfterHeadsUp(reply);
  check('plain answer between heads-up and bar is hidden', !shows(out, 'Frenzied Flame') && !shows(out, 'Age of Order'), out);
  check('list items keep their marker', out.includes('- ||Age of Order||'));
  check('text after the bar stays readable', out.includes('\nHonestly, just enjoy the journey.'));
  check('chips untouched', out.includes('[?] What should I focus on next?'));
  check('heads-up line itself stays readable', out.startsWith("⚠️ That's past where you are."));
  check('balanced', pipesBalanced(out));
  const full = guardShieldedReply(reply, KNOWN);
  check('full guard: nothing late readable', !shows(full, 'Frenzied Flame') && !shows(full, 'Age of the Stars'), full);
}
{
  const out = barAfterHeadsUp("⚠️ That’s past where you’re currently at: the final boss is the Elden Beast.");
  check('answer on the heads-up line after the colon is hidden', !shows(out, 'Elden Beast') && out.includes('currently at: ||'), out);
  const ok = "⚠️ That's past where you are:\n\n||The final boss is the Elden Beast.||";
  check('heads-up followed straight by a bar → unchanged', barAfterHeadsUp(ok) === ok);
  check('no heads-up → unchanged', barAfterHeadsUp('Past patches were buggy.\nStill fine.') === 'Past patches were buggy.\nStill fine.');
  const noBar = "That's past where you are.\n\n## Final boss\nRadagon, then the Elden Beast.";
  const o2 = barAfterHeadsUp(noBar);
  check('no bar ever comes → rest hidden; headings keep "#"', o2.includes('## ||Final boss||') && !shows(o2, 'Radagon'), o2);
  const fenced = "That's past where you are.\n```\nRadagon\n```";
  check('code fences untouched', barAfterHeadsUp(fenced) === fenced);
}
{
  // Streaming: the heads-up has arrived, the leak is mid-sentence.
  const mid = "⚠️ That's past where you are.\n\nThe endings are the Age of the Sta";
  check('streaming: a half-written plain answer is already hidden', !/Age of the Sta/.test(guardStreaming(mid).replace(/\|\|[\s\S]*?\|\|/g, '')));
}

console.log(`spoiler-guard: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
