// ═══════════════════════════════════════════════════════════════════════════
//  View transitions — whole-screen state changes (entering/leaving Stealth)
//  animated by the browser: it snapshots the old screen, applies `update`,
//  then plays the CSS for html[data-vt="<name>"] (see codex.css).
//
//  `update` is flushed synchronously so React has committed the new screen
//  by the time the browser captures it. Where the API is missing (older
//  Firefox) or the device is in low-power / reduced-motion mode, `update`
//  just runs immediately — the state change never depends on the animation.
// ═══════════════════════════════════════════════════════════════════════════

import { flushSync } from 'react-dom';

function motionAllowed() {
  if (typeof document === 'undefined') return false;
  if (document.documentElement.hasAttribute('data-low-power')) return false;
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

export function withViewTransition(name, update) {
  if (typeof document === 'undefined' || !document.startViewTransition || !motionAllowed() || document.hidden) {
    update();
    return;
  }
  const html = document.documentElement;
  html.dataset.vt = name;
  try {
    const vt = document.startViewTransition(() => flushSync(update));
    vt.finished.finally(() => {
      if (html.dataset.vt === name) delete html.dataset.vt;
    });
  } catch {
    delete html.dataset.vt;
    update();
  }
}
