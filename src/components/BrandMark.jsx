import React from 'react';
import { G_PATH, G_STROKE, DIAMOND, MARK_VIEWBOX } from '../site/brandMark';

/**
 * The GameGuide mark, inline: the G in the current ink, the diamond in the
 * current accent (so on the site and in the chat it takes the colour of the
 * game on screen; in Stealth, where the accent is monochrome, so is the mark).
 * Decorative: the button around it carries the name.
 */
export default function BrandMark({ size = 22, className = '' }) {
  const d = DIAMOND;
  return (
    <svg
      className={`gg-brandmark ${className}`.trim()}
      viewBox={MARK_VIEWBOX}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path d={G_PATH} fill="none" stroke="currentColor" strokeWidth={G_STROKE} strokeLinejoin="miter" />
      <rect
        x={d.x} y={d.y} width={d.size} height={d.size} rx={d.rx}
        className="gg-brandmark__gem"
        transform={`rotate(45 ${d.cx} ${d.cy})`}
      />
    </svg>
  );
}
