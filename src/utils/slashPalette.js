// ═══════════════════════════════════════════════════════════════════════════
//  Slash-command palette logic — pure, so it's testable without a DOM.
//
//  UI metadata only: which commands take arguments lives here, not in
//  useChat, so the command behaviour itself is untouched.
//
//    browse — "/" or "/pr": matching commands, ↑/↓ + Enter/Tab to pick.
//    hint   — "/price elden": the command is chosen and arguments are being
//             typed; show its usage, Enter sends as typed.
//    closed — anything else; Enter sends as typed (the model gets it).
// ═══════════════════════════════════════════════════════════════════════════

export const PALETTE_META = {
  '/price': { args: true, usage: '<game>' },
  '/progress': { args: true, usage: '<game> : <where>' },
  '/spoilers': { args: true, usage: 'on | off' },
  // Wipes history: picking it only fills the box, a second Enter runs it.
  '/clear': { confirm: true },
};

export function paletteState(input, commands) {
  const text = String(input || '');
  if (!text.startsWith('/') || !Array.isArray(commands)) return { mode: 'closed', items: [] };
  const first = text.split(/\s/)[0].toLowerCase();
  if (!/\s/.test(text)) {
    const items = commands.filter(c => c.trigger.startsWith(first));
    return items.length ? { mode: 'browse', items } : { mode: 'closed', items: [] };
  }
  const exact = commands.find(c => c.trigger === first);
  return exact ? { mode: 'hint', items: [exact] } : { mode: 'closed', items: [] };
}

export function nextIndex(i, len, dir) {
  if (!len) return 0;
  return (((i + dir) % len) + len) % len;
}

/**
 * What choosing `cmd` does, given what's typed. Argument-taking and confirm
 * commands are inserted; the rest run. A confirm command that is already
 * typed out in full runs on the second Enter.
 */
export function selectionAction(cmd, typed = '') {
  const meta = PALETTE_META[cmd.trigger] || {};
  if (meta.args) return { type: 'insert', text: `${cmd.trigger} ` };
  if (meta.confirm && String(typed).trim().toLowerCase() !== cmd.trigger) return { type: 'insert', text: cmd.trigger };
  return { type: 'send', text: cmd.trigger };
}

export function usageFor(cmd) {
  return PALETTE_META[cmd?.trigger]?.usage || '';
}
