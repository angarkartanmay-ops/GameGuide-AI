// ═══════════════════════════════════════════════════════════════════════════
//  PLAYER MEMORY
//  ───────────────────────────────────────────────────────────────────────
//  Turns a stateless Q&A endpoint into something that knows who it is talking
//  to. "Don't enable ray tracing on your 3060" is a different product from
//  "ray tracing carries a performance cost".
//
//  Extraction is deliberately regex-based rather than an extra LLM call:
//  it costs no tokens, adds no latency, and cannot hallucinate a fact about
//  the user. It only captures things people state outright ("I'm on a 4070",
//  "I play on PS5"). Anything subtler is simply not worth a wrong memory —
//  a confidently wrong stored fact poisons every future answer.
// ═══════════════════════════════════════════════════════════════════════════

import { PlayerProfile } from './meshDb.ts';

// ── Hardware ───────────────────────────────────────────────────────────────
const GPU_RX = /\b(?:(?:rtx|gtx)\s?\d{3,4}\s?(?:ti|super|xt)?|rx\s?\d{3,4}\s?(?:xt|xtx)?|arc\s?a\d{3,4}|radeon\s+rx\s?\d{3,4})\b/i;
const CPU_RX = /\b(?:(?:i[3579])[\s-]?\d{4,5}[a-z]{0,2}|ryzen\s?[3579]\s?\d{4}[a-z]{0,2}|(?:r[3579])[\s-]?\d{4})\b/i;
const RAM_RX = /\b(\d{1,3})\s?gb\s+(?:of\s+)?ram\b/i;
const DISPLAY_RX = /\b((?:1080p|1440p|4k|2160p|ultrawide)(?:\s+\d{2,3}\s?hz)?|\d{2,3}\s?hz)\b/i;

// ── Platform ───────────────────────────────────────────────────────────────
const PLATFORM_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:on|using|play(?:ing)?\s+on)\s+(?:my\s+)?(ps5|playstation\s?5)\b/i, 'PS5'],
  [/\b(?:on|using|play(?:ing)?\s+on)\s+(?:my\s+)?(ps4|playstation\s?4)\b/i, 'PS4'],
  [/\b(?:on|using|play(?:ing)?\s+on)\s+(?:my\s+)?(xbox\s+series\s?[sx]|xbox)\b/i, 'Xbox'],
  [/\b(?:on|using|play(?:ing)?\s+on)\s+(?:my\s+)?(switch\s?2|nintendo\s+switch|switch)\b/i, 'Switch'],
  [/\b(?:on|using|play(?:ing)?\s+on)\s+(?:my\s+)?(steam\s?deck)\b/i, 'Steam Deck'],
  [/\b(?:on|using|play(?:ing)?\s+on)\s+(?:my\s+)?(pc|desktop|laptop|rig)\b/i, 'PC'],
];

// ── Status of a game ───────────────────────────────────────────────────────
const STUCK_RX = /\b(?:i'?m\s+)?(?:stuck|hardstuck|can'?t\s+beat|struggling)\s+(?:on|at|with)\b/i;
const FINISHED_RX = /\b(?:i\s+)?(?:just\s+)?(?:finished|beat|completed|100%'?ed)\b/i;
const DROPPED_RX = /\b(?:i\s+)?(?:dropped|quit|uninstalled|gave\s+up\s+on|bounced\s+off)\b/i;
const RANK_RX = /\b(?:i'?m|i\s+am|currently)\s+(bronze|silver|gold|platinum|plat|diamond|emerald|ascendant|immortal|radiant|master|grandmaster|challenger|champion|legend|mythic|iron|obsidian)\s?(\d|i{1,3}|iv|v)?\b/i;

export interface ExtractResult {
  patch: PlayerProfile;
  learned: string[];   // human-readable, for logging only
}

/**
 * Pull durable facts out of one user message.
 * Returns an empty patch when nothing confident was found — the caller should
 * skip the write entirely rather than touching updated_at for nothing.
 */
export function extractProfileFacts(prompt: string, detectedGame: string | null): ExtractResult {
  const patch: PlayerProfile = {};
  const learned: string[] = [];
  if (!prompt || prompt.length < 4) return { patch, learned };

  const gpu = GPU_RX.exec(prompt);
  if (gpu) { patch.gpu = normalizeSpaces(gpu[0]); learned.push(`gpu=${patch.gpu}`); }

  const cpu = CPU_RX.exec(prompt);
  if (cpu) { patch.cpu = normalizeSpaces(cpu[0]); learned.push(`cpu=${patch.cpu}`); }

  const ram = RAM_RX.exec(prompt);
  if (ram) { patch.ram = `${ram[1]}GB`; learned.push(`ram=${patch.ram}`); }

  const disp = DISPLAY_RX.exec(prompt);
  if (disp) { patch.display = normalizeSpaces(disp[1]); learned.push(`display=${patch.display}`); }

  for (const [rx, label] of PLATFORM_PATTERNS) {
    if (rx.test(prompt)) { patch.platform = label; learned.push(`platform=${label}`); break; }
  }

  // Per-game status only makes sense once we know which game is being discussed.
  if (detectedGame) {
    const entry: Record<string, unknown> = { name: detectedGame };
    let meaningful = false;

    if (STUCK_RX.test(prompt))         { entry.status = 'stuck';    meaningful = true; }
    else if (FINISHED_RX.test(prompt)) { entry.status = 'finished'; meaningful = true; }
    else if (DROPPED_RX.test(prompt))  { entry.status = 'dropped';  meaningful = true; }

    const rank = RANK_RX.exec(prompt);
    if (rank) {
      entry.rank = normalizeSpaces([rank[1], rank[2]].filter(Boolean).join(' '));
      meaningful = true;
    }

    if (meaningful) {
      patch.games = [entry as any];
      learned.push(`game:${detectedGame}=${JSON.stringify(entry)}`);
    }
  }

  return { patch, learned };
}

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Render the stored profile as a compact context block.
 * Kept short on purpose: this rides along on every request, and a bloated
 * block crowds out live INTEL that matters more for the current question.
 */
export function buildProfileBlock(profile: PlayerProfile | null, currentGame: string | null): string {
  if (!profile) return '';

  const lines: string[] = [];

  const rig = [
    profile.gpu && `GPU ${profile.gpu}`,
    profile.cpu && `CPU ${profile.cpu}`,
    profile.ram && `${profile.ram} RAM`,
    profile.display && `display ${profile.display}`,
  ].filter(Boolean).join(', ');

  if (profile.platform) lines.push(`- Plays on: **${profile.platform}**`);
  if (rig) lines.push(`- Rig: ${rig}`);

  const games = Array.isArray(profile.games) ? profile.games : [];
  if (games.length) {
    // Surface the game under discussion first — it is the one that matters now.
    const sorted = [...games].sort((a, b) => {
      const am = currentGame && a.name?.toLowerCase() === currentGame.toLowerCase() ? -1 : 0;
      const bm = currentGame && b.name?.toLowerCase() === currentGame.toLowerCase() ? -1 : 0;
      return am - bm;
    }).slice(0, 8);

    lines.push('- Games on record:');
    for (const g of sorted) {
      const bits = [
        g.rank && `rank ${g.rank}`,
        g.hours && `${g.hours}h`,
        g.status && g.status,
        g.note,
      ].filter(Boolean).join(', ');
      lines.push(`  - **${g.name}**${bits ? ` — ${bits}` : ''}`);
    }
  }

  if (profile.prefs && Object.keys(profile.prefs).length) {
    lines.push(`- Preferences: ${JSON.stringify(profile.prefs)}`);
  }
  if (profile.notes) lines.push(`- Notes: ${profile.notes}`);

  if (!lines.length) return '';

  return `=== 🎮 PLAYER PROFILE (this specific user — remembered from earlier sessions) ===
${lines.join('\n')}

How to use this:
- Tailor advice to their actual hardware and platform. Recommending settings their GPU can't hold, or a PC-only mod to a console player, is a wasted answer.
- Reference what you already know instead of re-asking ("since you're on the 3060...").
- Do NOT recite this profile back at them or open with it. It is background knowledge, not a greeting.
- If something here contradicts what they say now, THEY ARE RIGHT — the profile is stale. Go with the new information.
=== END PLAYER PROFILE ===`;
}
