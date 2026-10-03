import React, { useState } from 'react';

/**
 * The scan line that passes over the screen when Stealth turns on (top to
 * bottom, the colour draining behind it) or off (bottom to top, the colour
 * coming back). Where view transitions run, it rides the edge of the
 * shutter in codex.css; elsewhere it still sweeps over the swapped screen.
 * Decorative, one-shot: it unmounts itself when the sweep ends, and
 * low-power mode never shows it.
 */
export default function StealthSweep({ dir }) {
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <div
      className={`cx-sweep cx-sweep--${dir === 'off' ? 'up' : 'down'}`}
      aria-hidden="true"
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) setDone(true); }}
    >
      <span className="cx-sweep__line" />
    </div>
  );
}
