// Freshness: making sure every answer is reasoned from TODAY, not from the
// model's training date.
//
// Why this module exists. On 2026-11-20, the day after Grand Theft Auto VI
// launched, GameGuide still answered "is GTA 6 out?" with "it's coming
// November 19, 2026". Each of these causes was enough on its own:
//
//   1. Today's date was only put in the system prompt when PULSE fired or a
//      game was detected. When PULSE ran out of time, or the game wasn't
//      detected, the model got no date and assumed its training-era "now".
//   2. Even with a date, nothing told the model that a release date in the
//      past means the game is out. Almost all the coverage of a big launch is
//      written beforehand ("set to launch November 19, 2026"), and the model
//      repeated that future tense word for word.
//   3. "is X out?", "has X come out?" and "did X release?" were not treated
//      as recency questions, so they got the general-purpose search with no
//      recency filter, and the old preview articles won.
//   4. Relative search dates ("2 days ago", the format Serper and Brave use
//      for their newest results) didn't parse, so the freshest results were
//      ranked as "date unknown", below year-old articles that had a date.
//
// Everything here is pure and has no dependencies, so it is unit tested
// directly (tests/freshness.test.ts).

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const DAY_MS = 86_400_000;

function utcDay(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d);
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** "2026-11-20" → "Friday 20 November 2026". */
export function humanDate(todayISO: string): string {
  const d = new Date(`${todayISO}T12:00:00Z`);
  if (isNaN(d.getTime())) return todayISO;
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).replace(/,/g, '');
}

// ─── Search-result dates ───────────────────────────────────────────────────

const RELATIVE_RX = /^\s*(an?|\d+)\s*(second|sec|minute|min|hour|hr|day|week|wk|month|mo|year|yr)s?\s+ago\s*$/i;

/**
 * A search result's date, from whatever shape the backend sends: ISO, RFC
 * 2822 ("Thu, 19 Nov 2026 08:00:00 GMT"), "Nov 19, 2026", or the relative
 * form Serper and Brave use for their newest results ("2 days ago",
 * "5 hours ago", "yesterday"). Returns an ISO timestamp, or undefined.
 *
 * Before this existed the relative form fell through Date.parse as NaN, so the
 * most recent results were ranked as undated, below year-old articles.
 */
export function normalizeHitDate(raw: unknown, now = Date.now()): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower === 'today' || lower === 'just now') return new Date(now).toISOString();
  if (lower === 'yesterday') return new Date(now - DAY_MS).toISOString();
  const rel = RELATIVE_RX.exec(s);
  if (rel) {
    const n = /^an?$/i.test(rel[1]) ? 1 : parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const ms =
      unit.startsWith('s') ? 1000
      : unit === 'min' || unit.startsWith('minute') ? 60_000
      : unit.startsWith('h') ? 3_600_000
      : unit.startsWith('d') ? DAY_MS
      : unit.startsWith('w') ? 7 * DAY_MS
      : unit === 'mo' || unit.startsWith('month') ? 30 * DAY_MS
      : 365 * DAY_MS;
    return new Date(now - n * ms).toISOString();
  }
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t).toISOString();
  return undefined;
}

/** "3d ago" style label for a hit date, or '' when unknown. */
export function ageLabel(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  const days = (now - t) / DAY_MS;
  if (days < 0) return isoDay(t);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 30) return `${Math.round(days)}d ago`;
  return isoDay(t);
}

// ─── Recency questions ─────────────────────────────────────────────────────

/**
 * Questions about whether something has happened yet: "is GTA 6 out?",
 * "has silksong come out", "did it release", "can I play it yet",
 * "is it available on PC". Their answer changes on a single day, so they need
 * the recency-filtered search. The older recency patterns only knew
 * "coming out" and "release date", and missed every one of these.
 */
// Each "out" / "release" must END the clause ("is it out?", "is it out yet",
// "is it out on PC") so guide questions stay evergreen: "is there a way out
// of this room" and "when does the boss release its grab" are not about dates.
const CLAUSE_END = String.raw`(?=\s*(?:yet|now|already|on\s+\w+|for\s+\w+|in\s+(?:the\s+)?(?:us|uk|eu|europe|india|japan|my\s+region)|\?|!|\.|,|$))`;
export const RELEASE_STATUS_RX = new RegExp([
  String.raw`\b(?:is|are|has|have|did|does|was)\b[^?.!]{0,60}?\b(?:out${CLAUSE_END}|released|launched|come\s+out|came\s+out|dropped${CLAUSE_END}|release${CLAUSE_END}|launch${CLAUSE_END}|available\s+(?:yet|now|already|on|for|in)\b)`,
  String.raw`\b(?:out|released|available|launched|playable)\s+(?:yet|now|already)\b`,
  String.raw`\b(?:can|could)\s+i\s+(?:play|buy|get|download|pre-?order)\b[^?.!]{0,40}?\b(?:yet|now|already)\b`,
  String.raw`\bwhen(?:'s|\s+(?:is|are|does|did|will|do))\b[^?.!]{0,50}?\b(?:come\s+out|coming\s+out|out${CLAUSE_END}|release${CLAUSE_END}|releasing|launch${CLAUSE_END}|launching|drop${CLAUSE_END})`,
  String.raw`\b(?:release|launch)(?:ed|es|ing)?\s+(?:date|day|time|status)\b`,
  String.raw`\b(?:delayed|postponed)\b`,
].join('|'), 'i');

export function isReleaseStatusQuestion(prompt: string): boolean {
  return RELEASE_STATUS_RX.test(prompt || '');
}

// ─── Dates the sources speak of in the future tense ───────────────────────

// Wording that marks a date as still to come at the time of writing.
const FUTURE_CUE_RX = /\b(?:set\s+to|scheduled\s+(?:to|for)|slated\s+(?:to|for)|will\s+(?:be\s+)?(?:release|launch|arrive|come|hit|drop|go\s+live|be\s+available|be\s+out)|(?:is|are)\s+(?:coming|due|expected|planned|launching|releasing|arriving)|coming\s+(?:out\s+)?(?:on|in)|due\s+(?:out\s+)?(?:on|in)|expected\s+(?:to|on|in)|planned\s+for|targeting|aims?\s+(?:to|for)|delayed\s+(?:to|until|into)|pushed\s+(?:back\s+)?(?:to|into|until)|moved\s+to|now\s+(?:set|launching|releasing|arriving)|launch(?:es|ing)?\s+(?:on|in)|releas(?:es|ing)\s+(?:on|in)|arriv(?:es|ing)\s+(?:on|in)|upcoming|pre-?orders?|countdown|until\s+(?:the\s+)?(?:release|launch)|ahead\s+of\s+(?:its\s+)?(?:release|launch))\b/i;

// Present-tense verbs written directly before the date, "launches November 18".
// Anchored to the end of the text before the date, and "launched" (past) does
// not match because the verb must be followed only by an optional on/in.
const FUTURE_CUE_END_RX = /\b(?:launch(?:es|ing)?|releas(?:es|ing)|arriv(?:es|ing)|drops?|goes\s+live|begins?|starts?|ends?|kicks?\s+off)(?:\s+(?:on|in|from))?\s*$/i;

interface FoundDate { ms: number; endMs: number; text: string; index: number; precise: boolean; }

const DMY_RX = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH_ALT})\.?,?\s+(20\d\d)\b`, 'gi');
const MDY_RX = new RegExp(String.raw`\b(${MONTH_ALT})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\b`, 'gi');
const ISO_RX = /\b(20\d\d)-(\d{2})-(\d{2})\b/g;
const MY_RX = new RegExp(String.raw`\b(${MONTH_ALT})\.?\s+(20\d\d)\b`, 'gi');

function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  const taken: Array<[number, number]> = [];
  const add = (index: number, len: number, ms: number, endMs: number, precise: boolean) => {
    if (isNaN(ms)) return;
    if (taken.some(([s, e]) => index < e && index + len > s)) return;
    taken.push([index, index + len]);
    out.push({ ms, endMs, text: text.slice(index, index + len), index, precise });
  };
  let m: RegExpExecArray | null;
  for (const rx of [DMY_RX, MDY_RX]) {
    rx.lastIndex = 0;
    while ((m = rx.exec(text))) {
      const dmy = rx === DMY_RX;
      const day = parseInt(dmy ? m[1] : m[2], 10);
      const mon = MONTHS[(dmy ? m[2] : m[1]).toLowerCase()];
      const year = parseInt(m[3], 10);
      if (mon === undefined || day < 1 || day > 31) continue;
      const ms = utcDay(year, mon, day);
      add(m.index, m[0].length, ms, ms, true);
    }
  }
  ISO_RX.lastIndex = 0;
  while ((m = ISO_RX.exec(text))) {
    const mon = parseInt(m[2], 10) - 1, day = parseInt(m[3], 10);
    if (mon < 0 || mon > 11 || day < 1 || day > 31) continue;
    const ms = utcDay(parseInt(m[1], 10), mon, day);
    add(m.index, m[0].length, ms, ms, true);
  }
  // Month + year ("May 2026"): the whole month must be over before it counts.
  MY_RX.lastIndex = 0;
  while ((m = MY_RX.exec(text))) {
    const mon = MONTHS[m[1].toLowerCase()];
    const year = parseInt(m[2], 10);
    if (mon === undefined) continue;
    // "may" is also a verb: only trust it capitalised.
    if (m[1].toLowerCase() === 'may' && m[1] !== 'May') continue;
    const start = utcDay(year, mon, 1);
    const end = utcDay(year, mon + 1, 1) - DAY_MS;
    add(m.index, m[0].length, start, end, false);
  }
  return out.sort((a, b) => a.index - b.index);
}

export interface ElapsedDate {
  /** The date as the source wrote it. */
  dateText: string;
  /** ISO day the date resolves to (last day of the month for "May 2026"). */
  iso: string;
  daysAgo: number;
  /** The surrounding sentence, trimmed. */
  snippet: string;
}

/**
 * Release-style dates that the sources describe as still to come but which
 * are on or before today — the exact shape of the GTA VI failure. A launch is
 * covered for months beforehand and for hours afterwards, so on launch week
 * almost every result says "set to launch November 19, 2026".
 */
export function findElapsedFutureDates(text: string, todayISO: string, max = 6): ElapsedDate[] {
  const todayMs = Date.parse(`${todayISO}T00:00:00Z`);
  if (isNaN(todayMs) || !text) return [];
  const out: ElapsedDate[] = [];
  const seen = new Set<string>();
  for (const d of findDates(text)) {
    if (d.endMs > todayMs) continue;
    // Only recent history is interesting. A 2013 date is not "news".
    const daysAgo = Math.round((todayMs - d.endMs) / DAY_MS);
    if (daysAgo > 400) continue;
    // The cue has to sit in the same sentence, just before the date.
    const sentStart = Math.max(
      text.lastIndexOf('. ', d.index), text.lastIndexOf('\n', d.index), d.index - 160,
    ) + 1;
    const before = text.slice(sentStart, d.index);
    if (!FUTURE_CUE_RX.test(before) && !FUTURE_CUE_END_RX.test(before)) continue;
    const iso = isoDay(d.endMs);
    const key = `${iso}|${before.slice(-60).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const after = text.slice(d.index + d.text.length, d.index + d.text.length + 60).split(/[.\n]/)[0];
    const snippet = (before + d.text + after).replace(/\s+/g, ' ').trim().slice(-200);
    out.push({ dateText: d.text, iso, daysAgo, snippet });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The block that tells the model, in plain words, which of the dates its
 * sources call "upcoming" have already passed. Computed here because the
 * models are bad at date arithmetic against a date they were only just told.
 */
export function buildElapsedDatesBlock(text: string, todayISO: string): string {
  const found = findElapsedFutureDates(text, todayISO);
  if (!found.length) return '';
  const lines = found.map(f => {
    const when = f.daysAgo === 0 ? 'that is TODAY' : f.daysAgo === 1 ? 'that was YESTERDAY' : `that was ${f.daysAgo} days ago`;
    return `- "…${f.snippet}" → ${f.dateText}: ${when}.`;
  });
  return `=== ⏱️ DATE CHECK (computed against today, ${todayISO}) ===
Some sources above were written BEFORE these dates and still speak of them in the future tense:
${lines.join('\n')}
These dates have PASSED. What was scheduled for them has happened: a game "set to launch" on one of these dates is OUT NOW, an event "coming" then has started. Say so in the past or present tense ("it launched on…", "it's out"), never "it's coming" or "it will release". The only exception is a source dated AFTER that date which explicitly reports a further delay; then say that, and cite it.
=== END DATE CHECK ===`;
}

// ─── The date, in every system prompt ──────────────────────────────────────

/**
 * Always-on date grounding. It used to be added only when live retrieval
 * fired or a game was detected, which left exactly the thin-retrieval turns,
 * where it matters most, reasoning from the model's training-era "now".
 */
export function buildDateGrounding(todayISO: string, opts: { full: boolean }): string {
  const head = `\n\n=== 📅 TODAY ===
Today is ${humanDate(todayISO)} (${todayISO}). Your training data stops months or years before this.
- Anything your training remembers as "upcoming", "announced" or "scheduled" may have happened since. If its date is on or before today, it has happened: a game whose release date has passed is OUT. Say so in the past tense.
- Work out every "how long ago / how long until / is it out yet" from TODAY's date, never from when you were trained.
- Never say a date that is already past is "coming", "upcoming" or "will release".`;
  if (!opts.full) return `${head}\n=== END TODAY ===\n`;
  return `${head}

RULES FOR CURRENT STATE:
1. NEVER state that something is "the newest", "the latest", "the current", "upcoming" or "not out yet" from training data alone. Such claims must come from a live INTEL block (PULSE, OFFICIAL API, WEB SEARCH, WIKI, STEAM NEWS, YOUTUBE, GAMING NEWS, REDDIT).
2. INTEL blocks override your training on any fact they cover. Cite them: "per [source], [date]…".
3. Prefer the NEWEST dated source. Pre-release previews ("set to launch…") are outdated the moment launch day passes; a launch-day or later source wins.
4. If a "what's new / is it out / which is the newest" question has no live INTEL on it, say plainly that you couldn't verify it live today (${todayISO}), give what you last knew, and say it may have changed. Do not assert the old state as current.
5. Never invent release dates, season numbers or hero/card names for current content.
6. Live-service games change every month. Never assume training-era rosters, seasons or metas are still current.
=== END TODAY ===\n`;
}
