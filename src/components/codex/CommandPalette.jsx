import React from 'react';
import { usageFor } from '../../utils/slashPalette';

/**
 * The slash-command list above the input. The textarea owns the keyboard
 * (↑/↓, Enter/Tab, Esc) and points at the active option with
 * aria-activedescendant; mouse picks use onMouseDown so the textarea keeps
 * focus. "hint" mode shows the chosen command's usage while its arguments
 * are typed.
 */
export default function CommandPalette({ id, mode, items, active, onPick, onHover }) {
  if (mode === 'hint') {
    const cmd = items[0];
    return (
      <div className="cx-palette cx-palette--hint" id={id}>
        <code className="cx-palette__trigger">{cmd.trigger}</code>
        <code className="cx-palette__usage">{usageFor(cmd)}</code>
        <span className="cx-palette__desc">{cmd.description}</span>
        <span className="cx-palette__keys">Enter sends</span>
      </div>
    );
  }
  return (
    <div className="cx-palette">
      <ul className="cx-palette__list" role="listbox" id={id} aria-label="Commands">
        {items.map((cmd, i) => (
          <li
            key={cmd.trigger}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            className={`cx-palette__item${i === active ? ' is-active' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); onPick(cmd); }}
            onMouseEnter={() => onHover(i)}
          >
            <code className="cx-palette__trigger">{cmd.trigger}</code>
            {usageFor(cmd) && <code className="cx-palette__usage">{usageFor(cmd)}</code>}
            <span className="cx-palette__desc">{cmd.description}</span>
          </li>
        ))}
      </ul>
      <div className="cx-palette__keys" aria-hidden="true">↑↓ move · Enter or Tab to pick · Esc to close</div>
    </div>
  );
}
