// ═══════════════════════════════════════════════════════════════════════════
//  /missables — Discord port of src/utils/missables.js. Keep the prompt
//  wording identical (tests/missables.test.mjs compares the two); the bot
//  deploys from this folder alone, so it can't import the web copy.
// ═══════════════════════════════════════════════════════════════════════════

const clip = (s, max) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function buildMissablesPrompt(game, where) {
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

/**
 * Which game /missables means. Saved progress lives in a Postgres jsonb
 * column, which does not keep key order — so unlike the web client (where
 * the newest entry is last) "most recent" can't be recovered here. With
 * exactly one saved game that's the answer; with several, the caller asks.
 *
 * @returns {{ game: string, where: string|null } | { choose: string[] } | { none: true }}
 */
function pickMissablesGame(typed, progress = {}) {
  const entries = Object.entries(progress || {}).filter(([g, w]) => g && w);
  const name = clip(typed, 60);
  if (name) {
    const hit = entries.find(([g]) => g === name.toLowerCase());
    return { game: name, where: hit ? clip(hit[1], 80) : null };
  }
  if (entries.length === 1) return { game: entries[0][0], where: clip(entries[0][1], 80) };
  if (entries.length > 1) return { choose: entries.map(([g]) => g) };
  return { none: true };
}

module.exports = { buildMissablesPrompt, pickMissablesGame };
