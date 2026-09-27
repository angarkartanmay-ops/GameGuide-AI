import React from 'react';

/** The rotated-square mark used across GameGuide. */
export function Mark({ size = 'md' }) {
  return <span className={`s-mark s-mark--${size}`} aria-hidden="true" />;
}

/** Mark + mono label + hairline: the codex overline. */
export function Overline({ children }) {
  return (
    <p className="s-overline">
      <Mark size="sm" />
      <span>{children}</span>
      <span className="s-overline__rule" aria-hidden="true" />
    </p>
  );
}

/** HUD corner brackets around a frame. Pure decoration. */
export function HudCorners() {
  return (
    <span className="s-hud" aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

/** A chapter heading block: overline, title, optional lead. */
export function ChapterHead({ index, label, title, lead, id }) {
  return (
    <header className="s-chapter__head" data-reveal>
      <Overline>{index} · {label}</Overline>
      <h2 className="s-h2" id={id}>{title}</h2>
      {lead && <p className="s-lead">{lead}</p>}
    </header>
  );
}

// lucide doesn't ship brand glyphs; these two are simple outlines.
export function LinkedInGlyph({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

export function GitHubGlyph({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  );
}
