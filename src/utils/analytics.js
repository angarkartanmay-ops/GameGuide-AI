// ═══════════════════════════════════════════════════════════════════════════
//  Anonymous usage counts — off unless you turn them on.
//
//  Vercel Web Analytics: no cookies, no fingerprinting, nothing that
//  identifies a player. Enable it in the Vercel dashboard (Project →
//  Analytics), then set VITE_ANALYTICS=vercel in the project's environment
//  variables and redeploy. Until both are done this file does nothing — it
//  won't even request the script, which 404s on projects without it enabled.
//
//  Events are the handful that tell you whether advertising works: who
//  pressed start, who shared, who opened a shared link, who used /missables.
//  (Custom events need a paid Vercel plan; page views work on every plan.)
// ═══════════════════════════════════════════════════════════════════════════

const ENABLED = import.meta.env.VITE_ANALYTICS === 'vercel';

export function initAnalytics() {
  if (!ENABLED || typeof window === 'undefined' || window.va) return;
  // Vercel's documented queue stub: calls made before the script loads are
  // replayed once it does.
  window.va = function va(...args) { (window.vaq = window.vaq || []).push(args); };
  const script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  document.head.appendChild(script);
}

/** Count one event. Never throws, never blocks, no personal data. */
export function track(name, data) {
  if (!ENABLED || typeof window === 'undefined') return;
  try {
    window.va?.('event', data ? { name, data } : { name });
  } catch { /* analytics must never break the app */ }
}
