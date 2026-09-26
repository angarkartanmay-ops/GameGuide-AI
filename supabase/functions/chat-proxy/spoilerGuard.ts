// ═══════════════════════════════════════════════════════════════════════════
//  SPOILER GUARD — the deterministic backstop behind the Spoiler Shield
//  ───────────────────────────────────────────────────────────────────────
//  The shield is an instruction, and models follow it imperfectly. On the
//  leak battery the commonest failure was not ignoring the rule but ECHOING:
//  the model correctly wrote "||the final boss is the Elden Beast||", then
//  named the Elden Beast again in a Sources line, or offered a follow-up chip
//  "How do I unlock the Age of Stars ending?". That failure is mechanical, so
//  the fix is too:
//
//    1. barEchoes — a name whose FIRST appearance is inside ||bars|| is one
//       the model itself judged a spoiler, so every later visible mention of
//       it is barred as well. Names the player used themselves are left alone.
//    2. filterChips — follow-up chips render as plain buttons, where bars
//       cannot work, so a chip may only name things the reader can already
//       see (or said themselves).
//
//  Pure, no Deno globals: the edge function runs both on the final reply, and
//  the web client runs barEchoes while a reply is still streaming.
// ═══════════════════════════════════════════════════════════════════════════

type SegKind = 'text' | 'bar' | 'code' | 'link' | 'url' | 'table';
interface Seg { kind: SegKind; s: string }

// Capitalised words and multi-word names ("Elden Beast", "Age of the Stars").
// Joined by spaces only — a line break ends a name.
const NAME_RX = /[A-Z][\p{L}\p{N}'’-]*(?:(?:[ \t]+(?:of the|of|the)[ \t]+|[ \t]+)[A-Z][\p{L}\p{N}'’-]*)*/gu;

// Capitalised for grammar, not because they name anything. A name made only
// of these is dropped, and they are stripped from the front of a name
// ("The Elden Beast" → "Elden Beast").
const STOP = new Set(`
a an the this that these those each every his her their its he she they it you your we our my i
i'm i've i'll i'd after before when while if but and or in on at to from with as for once then there
here what who whom how why where which yes no not all some most many one two three both also only
just even still now later first second third final last next new old true real secret hidden ending
endings boss bosses chapter act part area region sources source note tip tips warning spoiler spoilers
heads up ok okay dlc npc npcs pc ps4 ps5 xbox switch steam deck game plus ng lore story timeline
optional main side quest quests phase great big small good best worst hard easy other others any
is are was were be been do does did has have had can could should would will shall may might must`.trim().split(/\s+/));

const CONNECTOR = new Set(['of', 'the']);

/** Split into protected regions (code, links, tables), spoiler bars, and visible text. */
function segment(text: string): Seg[] {
  const out: Seg[] = [];
  // Tables first, by line: a run of |-lines that contains a delimiter row.
  // (A line that merely starts with "||" is a spoiler, not a table.)
  const lines = text.split('\n');
  let buf: string[] = [];
  const flushText = () => {
    if (!buf.length) return;
    out.push(...segmentInline(buf.join('\n')));
    buf = [];
  };
  for (let i = 0; i < lines.length;) {
    if (/^\s*\|.*\|\s*$/.test(lines[i])) {
      let j = i;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) j++;
      const block = lines.slice(i, j);
      if (block.some(l => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l))) {
        // Keep the newline that joins this block to the text before it.
        if (buf.length) { buf.push(''); flushText(); }
        out.push({ kind: 'table', s: block.join('\n') + (j < lines.length ? '\n' : '') });
        i = j;
        continue;
      }
      // Not a table: take the whole run as text. Rescanning it from the next
      // line made a reply of many "||…||" lines quadratic (15s at 20k lines,
      // run on every streamed token in the browser).
      buf.push(...block);
      i = j;
      continue;
    }
    buf.push(lines[i]);
    i++;
  }
  flushText();
  return out;
}

// Order matters: code first, so bars inside code are not bars. An unclosed
// trailing "||" (a reply still streaming) counts as a bar to the end.
// Bare URLs are their own segment: rewriting a name inside one broke the link
// ("…/||Malenia||+Blade") and still left the name readable in the address.
const INLINE_RX = /```[\s\S]*?(?:```|$)|`[^`\n]*`|\|\|[\s\S]*?\|\||\|\|[\s\S]*$|\[[^\]\n]*\]\([^)\s]*\)|<https?:\/\/[^\s>]+>|https?:\/\/[^\s<>()\]|]+/g;

function segmentInline(text: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RX)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ kind: 'text', s: text.slice(last, i) });
    const s = m[0];
    const kind: SegKind = s.startsWith('`') ? 'code' : s.startsWith('||') ? 'bar' : /^<?https?:/.test(s) ? 'url' : 'link';
    out.push({ kind, s });
    last = i + s.length;
  }
  if (last < text.length) out.push({ kind: 'text', s: text.slice(last) });
  return out;
}

function namesIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(NAME_RX)) {
    const words = m[0].split(/[ \t]+/).map(w => w.replace(/['’]s$/, '').replace(/['’-]+$/, ''));
    while (words.length && (STOP.has(words[0].toLowerCase()) || CONNECTOR.has(words[0].toLowerCase()))) words.shift();
    while (words.length && CONNECTOR.has(words[words.length - 1].toLowerCase())) words.pop();
    if (!words.length || words.every(w => STOP.has(w.toLowerCase()))) continue;
    const name = words.join(' ');
    if (name.length < 4) continue;
    if (/^[A-Z0-9+]{2,5}s?$/.test(name)) continue; // acronyms: NPC, DLC, NPCs
    out.push(name);
  }
  return out;
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameRx = (names: string[], flags = 'giu') => new RegExp(
  `(?<![\\p{L}\\p{N}])(${names
    .sort((a, b) => b.length - a.length)
    .map(n => escapeRx(n).replace(/ /g, '[ \\t]+'))
    .join('|')})(?![\\p{L}\\p{N}])`,
  flags,
);

function knownText(known: Array<string | null | undefined>): string {
  return known.filter(Boolean).join('\n').toLowerCase();
}

/**
 * Names the model hid on first mention (and the player never used), in the
 * order they would be matched. Exported for tests.
 */
export function barredNames(text: string, known: Array<string | null | undefined> = []): string[] {
  if (!text.includes('||')) return [];
  const segs = segment(text);
  const k = knownText(known);
  const candidates = new Set<string>();
  // A bar that is nothing but a name ("||Malenia||") or calls itself a
  // spoiler ("||⚠️ Spoiler: the Elden Beast…||") is an explicit verdict, so
  // its names are hidden everywhere, even where the model already let them
  // slip earlier in the reply. Names from ordinary sentence-length bars use
  // the first-mention rule, so an incidental name isn't hidden for good.
  const explicit = new Set<string>();
  const squash = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  for (const seg of segs) if (seg.kind === 'bar') {
    const inner = seg.s.replace(/^\|\||\|\|$/g, '');
    const names = namesIn(inner).filter(n => !k.includes(n.toLowerCase()));
    const verdict = /\bspoilers?\b/i.test(inner) || (names.length === 1 && squash(inner) === squash(names[0]));
    for (const n of names) { candidates.add(n); if (verdict) explicit.add(n); }
  }
  const barred: string[] = [...explicit];
  for (const name of candidates) {
    if (explicit.has(name)) continue;
    const rx = nameRx([name], 'iu');
    // First appearance, reading in order, visible text vs bars.
    for (const seg of segs) {
      if (seg.kind !== 'text' && seg.kind !== 'bar') continue;
      if (rx.test(seg.s)) { if (seg.kind === 'bar') barred.push(name); break; }
    }
  }
  return barred;
}

/**
 * Bar every visible mention of a name the reply itself hid on first mention.
 * No bars in the text → returned unchanged.
 */
export function barEchoes(text: string, known: Array<string | null | undefined> = []): string {
  const names = barredNames(text, known);
  if (!names.length) return text;
  const rx = nameRx(names);
  const hit = nameRx(names, 'iu');
  return segment(text)
    .map(seg => seg.kind === 'text' ? seg.s.replace(rx, '||$1||')
      // A URL naming a hidden thing is hidden whole, still a working link.
      : seg.kind === 'url' && hit.test(seg.s) ? `||${seg.s.replace(/^<|>$/g, '')}||`
      : seg.s)
    .join('');
}

// The shield tells the model to open a reveal with a one-line heads-up
// ("⚠️ That's past where you are:") and put the answer in bars. The other
// failure seen on the battery: the heads-up, then the answer in plain text,
// THEN a bar. Whatever sits between a heads-up and the next bar is the
// answer the model meant to hide.
const HEADS_UP = /\bpast (?:where you(?:['’]re| are)|your (?:current )?(?:point|progress|position)|what you(?:['’]ve| have) (?:reached|seen|played))\b/i;
const MD_PREFIX = /^(\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)*)(.*)$/;

/**
 * Bar the plain-text lines between a spoiler heads-up and the bar that should
 * have followed it (or the end of the reply, if no bar ever comes). Each line
 * keeps its markdown prefix — "- ||item||", "## ||heading||" — so lists and
 * headings still render. Code, tables and chips are left alone.
 */
export function barAfterHeadsUp(text: string): string {
  if (!HEADS_UP.test(text)) return text;
  const lines = text.split('\n');
  let inFence = false;
  let openBar = false;   // inside a multi-line ||…|| span
  let hiding = false;    // between a heads-up and its bar
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; hiding = false; continue; }
    if (inFence || /^\s*\|.*\|\s*$/.test(line) && !line.trim().startsWith('||')) continue;
    if (CHIP_LINE.test(line)) { hiding = false; continue; }
    const pipes = (line.replace(/`[^`]*`/g, '').match(/\|\|/g) || []).length;
    if (openBar || pipes) {
      hiding = false;
      if (pipes % 2) openBar = !openBar;
      continue;
    }
    if (hiding) {
      const [, prefix, body] = line.match(MD_PREFIX) as RegExpMatchArray;
      if (body.trim()) lines[i] = `${prefix}||${body.trim()}||`;
      continue;
    }
    if (HEADS_UP.test(line)) {
      hiding = true;
      // "⚠️ That's past where you are: the final boss is X" — the answer can
      // share the heads-up's line, after its colon.
      const colon = line.indexOf(':', line.search(/\bpast\b/i));
      const rest = colon >= 0 ? line.slice(colon + 1).trim() : '';
      if (rest) lines[i] = `${line.slice(0, colon + 1)} ||${rest}||`;
    }
  }
  return lines.join('\n');
}

const CHIP_LINE = /^\s*\[\?\]/;

/**
 * Drop follow-up chips that name anything the reader cannot already see.
 * Chips are plain buttons — a spoiler bar cannot protect them.
 */
export function filterChips(text: string, known: Array<string | null | undefined> = []): string {
  const lines = text.split('\n');
  const chips = lines.filter(l => CHIP_LINE.test(l));
  if (!chips.length) return text;
  const body = lines.filter(l => !CHIP_LINE.test(l)).join('\n');
  const visible = segment(body).filter(s => s.kind !== 'bar').map(s => s.s).join('\n').toLowerCase();
  const k = knownText(known);
  const barred = barredNames(body, known);
  const barredRx = barred.length ? nameRx(barred, 'iu') : null;
  const seen = (name: string) => { const rx = nameRx([name], 'iu'); return rx.test(visible) || rx.test(k); };
  const keep = chips.filter(chip => {
    if (chip.includes('||')) return false;
    if (barredRx && barredRx.test(chip)) return false;
    return namesIn(chip.replace(CHIP_LINE, '')).every(seen);
  });
  if (keep.length === chips.length) return text;
  return [body.replace(/\s+$/, ''), ...(keep.length ? ['', ...keep] : [])].join('\n');
}

/** All passes, for a shielded reply's final text. */
export function guardShieldedReply(text: string, known: Array<string | null | undefined> = []): string {
  return filterChips(barEchoes(barAfterHeadsUp(text), known), known);
}

/**
 * The web client's pass while a reply is still streaming, before the server
 * has run guardShieldedReply on the final text. No "known" list client-side,
 * so it can over-hide for a moment; the final text replaces it.
 */
export function guardStreaming(text: string): string {
  return barEchoes(barAfterHeadsUp(text));
}
