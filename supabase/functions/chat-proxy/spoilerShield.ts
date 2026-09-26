// ═══════════════════════════════════════════════════════════════════════════
//  SPOILER SHIELD
//  ───────────────────────────────────────────────────────────────────────
//  "The game guide that won't spoil your game."
//
//  A general-purpose AI answer spoils freely and knows nothing about the
//  player. The shield answers everything UP TO where the player is and keeps
//  everything past it out of sight:
//
//    * progress known  ("I just beat Margit") → nothing beyond that point is
//      named, not even in passing; direct questions about later content are
//      answered inside ||spoiler bars|| so a click is required to read them.
//    * progress unknown + a story question    → premise yes, reveals no; the
//      reveal the user asked for goes inside ||bars||, then ask where they are.
//    * "spoil it" / finished the game / shield off → full answer. In a Discord
//      server channel major reveals are still barred: bystanders never agreed.
//
//  ||text|| is Discord's native spoiler syntax; the web client renders the same
//  syntax as click-to-reveal, so one output format serves both.
//
//  Pure module — no Deno globals — so tests import it directly.
// ═══════════════════════════════════════════════════════════════════════════

export type ShieldMode = 'progress' | 'unknown' | 'off' | 'none';

export interface ClientSpoilerContext {
  mode?: 'shield' | 'off';
  progress?: Record<string, string>;
  publicChannel?: boolean;
}

export interface ShieldInput {
  prompt: string;
  history?: Array<{ sender?: string; text?: string } | null | undefined>;
  game: string | null;
  intent?: string;
  client?: ClientSpoilerContext | null;
  profileGames?: Array<{ name?: string; status?: string; progress?: string }> | null;
}

export interface ShieldState {
  /** Inject a directive this turn. */
  active: boolean;
  mode: ShieldMode;
  game: string | null;
  progress: string | null;
  source: 'prompt' | 'history' | 'client' | 'profile' | null;
  /** Progress was stated in THIS prompt — clients should persist it. */
  learned: boolean;
  publicChannel: boolean;
  /** The user asked for spoilers this turn ("spoil it"). */
  asked: boolean;
  /** The question itself is about story (not just "which settings"). */
  risk: boolean;
  reason: string;
}

// ── Detection ──────────────────────────────────────────────────────────────

const RISK_RX = new RegExp(String.raw`\b(?:` + [
  'endings?', 'final\\s+boss', 'last\\s+boss', 'true\\s+(?:final\\s+boss|ending)',
  'secret\\s+(?:ending|boss)', 'who\\s+(?:dies|died|killed|is\\s+the\\s+(?:villain|traitor|real|final))',
  'does\\s+\\w+(?:\\s+\\w+)?\\s+(?:die|survive|betray)', 'die\\s+at\\s+the\\s+end',
  '(?:plot\\s+)?twists?', 'reveal(?:ed|s)?', '(?:true|real|secret)\\s+identity', 'betray\\w*', 'traitor',
  'post[-\\s]?game', 'epilogue', '(?:final|last)\\s+chapter', 'what\\s+happens\\s+(?:at|in|after|to|when)',
  'what\\s+happened\\s+to', 'story', 'plot', 'lore', 'cutscene', 'spoilers?',
].join('|') + String.raw`)\b`, 'i');

// "spoil it" but NOT "don't spoil it" / "do not spoil it" / "never spoil it".
const WANTS_RX = /(?<!\b(?:don'?t|do\s+not|never|not|dont)\s+)\bspoil\s+(?:it|me|away|everything)\b|\bspoilers?\s+(?:are\s+)?(?:fine|ok|okay|allowed|welcome|good)\b|\b(?:i\s+)?(?:don'?t|do\s+not)\s+(?:care|mind)\s+(?:about\s+)?spoilers?\b|\b(?:show|tell)\s+me\s+(?:the\s+)?spoilers?\b|\bfull\s+spoilers?\b|\bwith\s+spoilers\b|\bgo\s+ahead\s+and\s+spoil\b/i;

const NO_SPOILERS_RX = /\b(?:no|without|avoid)\s+spoilers?\b|\bspoiler[-\s]?free\b|\b(?:don'?t|do\s+not|dont|please\s+don'?t)\s+spoil\b/i;

// Finished = spoilers are fine. A second playthrough / NG+ means they've seen it all once.
// "beat it" is deliberately NOT enough — mid-conversation it usually means a
// boss ("beat it on my third try"), and reading it as the game would drop the
// shield.
const FINISHED_RX = /\b(?:i\s+)?(?:just\s+)?(?:finished|completed|100%'?d?)\s+(?:the\s+)?(?:whole\s+)?(?:game|story|campaign|main\s+story|it)\b|\bbeat\s+(?:the\s+)?(?:whole\s+)?(?:game|story|campaign|main\s+story)\b|\brolled\s+(?:the\s+)?credits\b|\b(?:second|2nd|third|3rd|another)\s+playthrough\b|\bng\s?\+|\bnew\s+game\s+plus\b/i;

export function detectSpoilerRisk(prompt: string, intent?: string): boolean {
  if (intent === 'lore') return true;
  return RISK_RX.test(prompt || '');
}

export function wantsSpoilers(prompt: string): boolean {
  const p = prompt || '';
  return !NO_SPOILERS_RX.test(p) && WANTS_RX.test(p);
}

export function explicitlyNoSpoilers(prompt: string): boolean {
  return NO_SPOILERS_RX.test(prompt || '');
}

export function saysFinished(text: string): boolean {
  return FINISHED_RX.test(text || '');
}

// ── Progress extraction ────────────────────────────────────────────────────

// Things people are "at / on / in" that are not a point in a game.
const NOT_PROGRESS_RX = new RegExp(String.raw`^(?:` + [
  // platforms
  'pc', 'ps[345]', 'playstation', 'xbox', 'switch', 'steam\\s*deck', 'console', 'mobile', 'phone',
  'laptop', 'desktop', 'mac', 'linux', 'windows', 'controller', 'keyboard', 'mouse', 'gamepass', 'game\\s+pass',
  // ranks
  'bronze', 'silver', 'gold', 'plat(?:inum)?', 'diamond', 'master', 'grandmaster', 'challenger', 'iron',
  'emerald', 'ascendant', 'immortal', 'radiant', 'champion', 'legend', 'elo', 'rank(?:ed)?', 'low\\s+elo',
  // life
  'work', 'home', 'school', 'college', 'uni', 'the\\s+office', 'lunch', 'bed', 'vacation', 'holiday',
  'a\\s+loss', 'a\\s+party', 'voice', 'discord', 'trouble', 'love', 'the\\s+moment', 'a\\s+crossroads',
  'my\\s+(?:wits|limit)', 'a\\s+wall', 'it', 'this', 'that', 'the\\s+same\\s+(?:place|spot)',
  // tuning, not location
  'low', 'medium', 'high', 'ultra', 'max', '\\d+\\s*fps', '\\d+\\s*hz', '1080p', '1440p', '4k',
  'normal', 'hard', 'easy', 'nightmare', 'difficulty',
  // character state and versions, not a place in the story
  'level', 'lvl', 'rune\\s+level', 'version', 'patch', 'update', 'beta', 'early\\s+access',
  // too vague to be a position ("I'm at the part where…")
  'part', 'point', 'bit', 'section',
].join('|') + String.raw`)\b`, 'i');

// Where a captured phrase ends: conjunctions, questions, the game name itself.
const CUT_RX = /\s+(?:and|but|so|then|now|what|how|who|where|why|which|should|could|would|is|are|was|can|any|in\s+the\s+game|(?:on|with|using|as|in)\s+(?:my|a|an)|at\s+(?:level|lvl)|-|—|–)\s+.*$/i;

const PHRASE_PATTERNS: RegExp[] = [
  // "I just beat Margit", "just reached Limgrave", "just got to the Roundtable"
  /\bjust\s+(?:beat|defeated|killed|cleared|reached|got\s+(?:to|past)|arrived\s+(?:at|in)|unlocked|made\s+it\s+to)\s+(?:the\s+)?([^.,!?\n;]{2,70})/i,
  // "I'm stuck on the Radahn fight", "stuck at Godrick"
  /\bstuck\s+(?:on|at|in)\s+(?:the\s+)?([^.,!?\n;]{2,70})/i,
  // "I'm at / on / in / up to X", "currently at X"
  /\b(?:i'?m|i\s+am|im|currently)\s+(?:currently\s+|now\s+|only\s+|still\s+)?(?:at|on|in|up\s+to|near|around)\s+(?:the\s+)?([^.,!?\n;]{2,70})/i,
  // "I've reached X", "I have reached X"
  /\b(?:i'?ve|i\s+have)\s+(?:just\s+)?(?:reached|beaten|beat|cleared|unlocked)\s+(?:the\s+)?([^.,!?\n;]{2,70})/i,
];

const NUMBERED_RX = /\b(chapter|act|mission|episode|part|world|arc)\s+(\d{1,3}|[ivx]{1,5}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;
const PERCENT_RX = /\b(\d{1,3})\s?%\s+(?:through|done|complete)\b/i;

/** Make a user-supplied progress string safe to place in a system prompt. */
export function sanitizeProgress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw)
    .replace(/[\r\n\t]+/g, ' ')
    // Only characters a place/boss/chapter name needs. Strips =, #, *, `, |, <,
    // > and friends — i.e. anything that could open a fake prompt section,
    // format a heading, or close/open a spoiler bar.
    .replace(/[^\p{L}\p{N}\s'’:.,&()\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return s.length >= 2 ? s : null;
}

function cleanCapture(raw: string, game: string | null): string | null {
  let s = raw.trim().replace(CUT_RX, '').trim();
  if (game) {
    // "just reached Limgrave in Elden Ring" / "Margit (elden ring)"
    const g = game.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(String.raw`\s*(?:in|of|on|\()\s*${g}\)?$`, 'i'), '').trim();
    if (new RegExp(`^${g}$`, 'i').test(s)) return null;   // "I'm on Elden Ring" = playing, not a point
  }
  s = s.replace(/\s+(?:right\s+now|now|atm|currently|rn|lol|lmao)$/i, '').trim();
  if (/^(?:the\s+)?(?:game|story|campaign|main\s+story|beginning|start)$/i.test(s)) return null;
  if (NOT_PROGRESS_RX.test(s)) return null;
  return sanitizeProgress(s);
}

/**
 * Where the player says they are, or null. Only meaningful with a game in
 * context — "I'm at work" and "I'm on PS5" are not progress, and without a
 * game there is nothing to attach a position to.
 */
export function extractProgress(text: string, game: string | null): string | null {
  if (!text || !game) return null;
  const t = String(text);

  const num = NUMBERED_RX.exec(t);
  if (num) return sanitizeProgress(`${num[1][0].toUpperCase()}${num[1].slice(1).toLowerCase()} ${num[2]}`);

  const pct = PERCENT_RX.exec(t);
  if (pct && Number(pct[1]) <= 100) return `${pct[1]}% through`;

  for (const rx of PHRASE_PATTERNS) {
    const m = rx.exec(t);
    if (!m) continue;
    const cleaned = cleanCapture(m[1], game);
    if (cleaned) {
      // Keep the verb for "just beat X" — "beat Margit" is a position after X,
      // "at Margit" is a position before it.
      if (/\bjust\s+(?:beat|defeated|killed|cleared)\b/i.test(m[0]) || /\b(?:beaten|beat|cleared)\b/i.test(m[0].split(m[1])[0])) {
        return sanitizeProgress(`beat ${cleaned}`);
      }
      return cleaned;
    }
  }
  return null;
}

// ── Resolution ─────────────────────────────────────────────────────────────

const normTitle = (s: string) => s.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Same title, or one is a whole-word part of the other ("witcher 3" / "the witcher 3"). */
function sameGame(a: string | undefined | null, b: string | null): boolean {
  if (!a || !b) return false;
  const x = normTitle(a);
  const y = normTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  // A substring match let a stored key like "ring" claim every game with
  // "ring" in its name. Only a multi-word title may match as a whole-word part.
  return short.includes(' ') && ` ${long} `.includes(` ${short} `);
}

/** Does this text name the game? Whole words, punctuation-insensitive. */
function mentionsGame(text: string, game: string): boolean {
  const g = normTitle(game);
  return !!g && ` ${normTitle(text)} `.includes(` ${g} `);
}

export function resolveShield(input: ShieldInput): ShieldState {
  const prompt = input.prompt || '';
  const game = input.game ? input.game.toLowerCase().trim() : null;
  const client = input.client || null;
  const publicChannel = !!client?.publicChannel;
  const risk = detectSpoilerRisk(prompt, input.intent);

  const base = (mode: ShieldMode, reason: string, extra: Partial<ShieldState> = {}): ShieldState => ({
    active: false, mode, game, progress: null, source: null, learned: false,
    publicChannel, asked: false, risk, reason, ...extra,
  });

  // Progress, most specific first.
  let progress: string | null = null;
  let source: ShieldState['source'] = null;

  const fromPrompt = extractProgress(prompt, game);
  if (fromPrompt) { progress = fromPrompt; source = 'prompt'; }

  // History only speaks for THIS game from the point the conversation reached
  // it. Before, "I finished the game" about Elden Ring switched the shield OFF
  // when the next question was about Dark Souls 3, and "I just beat Margit"
  // became the player's position in it.
  const turns = (input.history || [])
    .filter((m): m is { sender?: string; text?: string } => !!m && typeof m.text === 'string');
  let from = 0;
  if (game) {
    const first = turns.findIndex(m => mentionsGame(m.text as string, game));
    if (first >= 0) from = first;
    else if (mentionsGame(prompt, game)) from = turns.length;   // named for the first time now
    // ponytail: earliest mention, not last switch — ER → DS3 → ER still lets
    // the DS3 turns in between count. Needs per-turn game attribution to fix.
  }
  const userTurns = turns
    .slice(from)
    .filter(m => !m.sender || m.sender === 'user')
    .slice(-8)
    .reverse();

  if (!progress) {
    for (const m of userTurns) {
      const p = extractProgress(m.text as string, game);
      if (p) { progress = p; source = 'history'; break; }
    }
  }
  if (!progress && client?.progress && game) {
    const hit = Object.entries(client.progress).find(([k]) => sameGame(k, game));
    const p = hit ? sanitizeProgress(hit[1]) : null;
    if (p) { progress = p; source = 'client'; }
  }
  const profileEntry = (input.profileGames || []).find(g => sameGame(g?.name, game));
  if (!progress && profileEntry?.progress) {
    const p = sanitizeProgress(profileEntry.progress);
    if (p) { progress = p; source = 'profile'; }
  }

  const finished = saysFinished(prompt)
    || userTurns.some(m => saysFinished(m.text as string))
    || profileEntry?.status === 'finished';
  const asked = wantsSpoilers(prompt);
  const noSpoil = explicitlyNoSpoilers(prompt);
  const clientOff = client?.mode === 'off';

  const withProgress = { progress, source, learned: source === 'prompt' };

  // An explicit "no spoilers" in this message outranks every stored setting.
  if (noSpoil) {
    return { ...base(progress ? 'progress' : 'unknown', 'asked-no-spoilers', withProgress), active: true };
  }
  if (asked || finished || clientOff) {
    const reason = asked ? 'asked-for-spoilers' : finished ? 'finished' : 'shield-off';
    // Full answer — but a server channel is shared, so reveals stay barred.
    return { ...base('off', reason, withProgress), asked, active: publicChannel && (risk || asked) };
  }
  if (progress) return { ...base('progress', 'progress-known', withProgress), active: true };
  if (risk) return { ...base('unknown', 'story-question', withProgress), active: true };
  return base('none', 'no-story-risk', withProgress);
}

// ── Prompt directive ───────────────────────────────────────────────────────

export function buildShieldDirective(s: ShieldState): string {
  if (!s.active) return '';
  const g = s.game ? `**${titleCase(s.game)}**` : 'this game';
  const BARS = 'Wrap it in Discord spoiler bars — ||like this|| — so the reader has to click to see it. Keep the bars tight around the reveal itself, never around a whole paragraph.';

  if (s.mode === 'progress') {
    return `\n\n=== 🛡️ SPOILER SHIELD — ACTIVE ===
The player is playing ${g} and has told you where they are: **${s.progress}**.
Everything past that point is a spoiler to them — plot events, character fates and identities, bosses, areas, items, and mechanics that only appear later.
- Answer fully for everything up to and including where they are.
- Do not name or describe any boss, area, character twist, item or event that comes after that point — not in passing, not as a fun fact, not in a comparison, not in a follow-up suggestion. Live INTEL blocks may contain full plot summaries and late-game build guides: relay nothing from them that lies past the player's point.
- If they ask directly about something past their point, give a one-line heads-up ("⚠️ That's past where you are:") and put the answer itself in spoiler bars. ${BARS}
- Twists about things they HAVE already met are still spoilers: a character's true identity, hidden bloodline, secret allegiance or real motive that the game reveals later. Meeting someone is not the same as learning who they are — bar it.
- If the best answer to a practical question (gear, route, build) is found later, don't name it. Say "there's a stronger option later — reply **spoil it** if you want it", then give the best option available up to where they are.
- This outranks any persona style above: a lore deep-dive stops at the player's point.
- Don't lecture about spoilers or restate these rules.
=== END SPOILER SHIELD ===`;
  }

  if (s.mode === 'unknown') {
    return `\n\n=== 🛡️ SPOILER SHIELD — ACTIVE ===
This is a story question about ${g}, and the player hasn't said how far they are. Assume they're mid-game.
- The premise, setting and opening are fine to discuss openly.
- Endings, final bosses, character deaths, twists, betrayals and true identities are spoilers — including who a character they've already met really is. If the question asks for one directly, give a one-line heads-up and put the reveal in spoiler bars. ${BARS}
- This outranks any persona style above.
- Close with one short line inviting them to say where they are ("Tell me where you are and I'll keep everything past that hidden.").
- Don't lecture about spoilers or restate these rules.
=== END SPOILER SHIELD ===`;
  }

  // mode 'off' — full answer, but this is a shared server channel.
  const followUp = s.asked
    ? '\nThey just asked for spoilers: answer the question they asked previously in full, including anything you held back last time.'
    : '';
  return `\n\n=== 🛡️ SPOILER SHIELD — PUBLIC CHANNEL ===
The person asking wants the full answer about ${g}.${followUp}
This reply is posted in a Discord server channel where other members may not have finished the game. Give the full answer, but put every major reveal — ending, final boss, deaths, twists, true identities — in spoiler bars. ${BARS}
=== END SPOILER SHIELD ===`;
}

/**
 * A short restatement placed at the very END of the user message, after the
 * live INTEL blocks. Those blocks carry full-game plot summaries and late-game
 * boss lists and are the last thing the model reads before writing, so a rule
 * that lives only in the system prompt loses to them. Measured on a 12-prompt
 * leak battery: list-shaped answers ("hardest bosses", "the lore of X") were
 * where compliance broke, so the reminder names that case.
 */
export function buildShieldReminder(s: ShieldState): string {
  if (!s.active) return '';
  const g = s.game ? titleCase(s.game) : 'this game';
  const LISTS = 'That includes lists: if the answer is a list (hardest bosses, all endings, every region, the lore of the world), list only what is up to their point, or put each later item in its own ||bars||.';
  if (s.mode === 'progress') {
    return `=== 🛡️ BEFORE YOU ANSWER ===\nThe player is at **${s.progress}** in ${g}. The INTEL above covers the whole game — it is not all safe to repeat. Anything past their point (bosses, areas, items, lore, endings, who characters really are) is either left out or put inside ||spoiler bars||. ${LISTS}\n=== END ===`;
  }
  if (s.mode === 'unknown') {
    return `=== 🛡️ BEFORE YOU ANSWER ===\nThe player hasn't said how far they are in ${g}. Endings, final bosses, deaths, twists and true identities go inside ||spoiler bars||. ${LISTS}\n=== END ===`;
  }
  return `=== 🛡️ BEFORE YOU ANSWER ===\nThis reply is posted in a shared server channel. Every major reveal about ${g} goes inside ||spoiler bars||. ${LISTS}\n=== END ===`;
}

/**
 * The Loremaster persona asks for "a hook revealing something most players
 * miss" and "Hidden Connections across the franchise" — a spoiler generator
 * by design. On the leak battery every leak that survived the echo guard came
 * from those sections (a closing "the truth waits in the Haligtree", an aside
 * about the sewers beneath Leyndell). While the shield is up, the persona keeps
 * its voice but tells the story only as far as the player has lived it.
 */
export function shieldPersonaOverlay(personaId: string, overlay: string, s: ShieldState): string {
  if (!s.active || personaId !== 'loremaster' || (s.mode !== 'progress' && s.mode !== 'unknown')) return overlay;
  const upTo = s.mode === 'progress' ? `up to **${s.progress}**` : 'up to the opening hours';
  return `
# ACTIVE PERSONA: 📜 LOREMASTER MODE (spoiler-safe)
You are the **LOREMASTER** — dramatic, atmospheric, a narrative archaeologist — telling the story only as far as this player has lived it (${upTo}).
- Open with "**📜 The Story So Far**" — a hook built from what they have already seen.
- "**⚔️ Timeline (so far)**" — bullets in order, stopping at their point. Backstory the game tells in its opening is fine; anything it reveals later is not.
- "**💀 Connections You Can Already Make**" — link only characters, places and items they have already met. No foreshadowing of where the story goes, places they haven't been, or who someone really is.
- Quote in-game text they have already seen (use > blockquotes).
- Do not close with a teaser of what lies ahead or where "the truth" is found.`;
}

/** Private "spoil it" turn: no shield, just make sure the model answers the withheld question. */
export function buildSpoilItNote(s: ShieldState): string {
  if (s.active || !s.asked) return '';
  return '\n\nThe player just asked for spoilers. Answer the question they asked previously in full, including anything you held back.';
}

export function shieldChips(game: string | null): string[] {
  const g = game ? titleCase(game) : 'this game';
  return [
    `[?] What should I focus on next where I am in ${g}?`,
    `[?] Any spoiler-free lore I might have missed so far in ${g}?`,
  ];
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
