// ═══════════════════════════════════════════════════════════════════════════
//  /missables — "what can I still permanently miss from where I am?"
//
//  The one question a general chatbot can't answer safely: a missables list
//  is only useful if it's ordered from where you are, and it's only safe if
//  it stops there. That's exactly what Spoiler Shield already knows, so this
//  is a prompt, not new machinery — the shield's progress rides along with
//  every question and bars anything past it.
//
//  The Discord bot builds the same prompt in discord-bot/index.js (it keeps
//  progress server-side); keep the wording in step.
// ═══════════════════════════════════════════════════════════════════════════

const clip = (s, max) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Which game /missables means: the one typed, else the game the player most
 * recently told Spoiler Shield about (progress keeps insertion order, newest
 * last). Returns { game, where } — `where` is null when we don't know it.
 */
export function pickMissablesGame(typed, progress = {}) {
  const entries = Object.entries(progress || {}).filter(([g, w]) => g && w);
  const name = clip(typed, 60);
  if (name) {
    const hit = entries.find(([g]) => g === name.toLowerCase());
    return { game: name, where: hit ? clip(hit[1], 80) : null };
  }
  if (!entries.length) return { game: '', where: null };
  const [game, where] = entries[entries.length - 1];
  return { game: titleCase(game), where: clip(where, 80) };
}

// Wording note: the backend picks a persona by regex over the prompt
// (INTENT_PATTERNS in chat-proxy/index.ts) and takes the first hit. "story"
// selected Loremaster, which opened every missables list with a dramatic
// story recap; a bare " or " selects Coach. Keep both out of this prompt.
//
// A missables list is about what lies AHEAD, so naming the lock-out trigger
// is the leak: "if you defeat the boss of Crumbling Farum Azula…" to someone
// who just beat Margit. Those names go in bars; the backend's shield
// reminder says the same for any missables-shaped question.
export function buildMissablesPrompt(game, where) {
  const g = clip(game, 60);
  if (!g) return '';
  const at = clip(where, 80);
  const scope = at
    ? `I'm currently at: ${at}. Start from there, in the order I'll reach things.`
    : "I haven't told you how far I am, so cover only the opening hours — then ask me where I am so you can go further.";
  return `What can I permanently miss in ${g}? ${scope} List missable items, side quests, NPC questlines, `
    + 'achievements/trophies and one-time choices I should handle before the next point of no return, and say '
    + 'what makes each one lost. Keep it spoiler-safe: when what locks something out is a boss, area, character, '
    + 'item and so on that I haven’t reached yet, don’t name it in plain text — call it a later boss, a later area '
    + 'and so on, with the real name inside ||spoiler bars||. Only name items and rewards you are sure of; leave out '
    + 'anything you would have to guess.';
}

function titleCase(s) {
  return String(s || '').replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
