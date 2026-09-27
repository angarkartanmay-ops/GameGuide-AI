// Motion plumbing for the landing and info pages: GSAP with its scroll
// plugins, Lenis smooth scrolling, and the one question every animation asks
// first — is motion welcome here?
//
// "Calm" means the player asked for reduced motion OR usePerfMode found a
// slow device (it sets <html data-low-power> for either). Calm pages get
// their final, fully readable state with no pins, scrubs or loops.

import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin);

export { gsap, ScrollTrigger, SplitText };

// ─── Calm ──────────────────────────────────────────────────────────────────

const REDUCE_MQ = '(prefers-reduced-motion: reduce)';

function readCalm() {
  if (typeof window === 'undefined') return true;
  return window.matchMedia(REDUCE_MQ).matches || document.documentElement.hasAttribute('data-low-power');
}

function subscribeCalm(onChange) {
  const mq = window.matchMedia(REDUCE_MQ);
  mq.addEventListener('change', onChange);
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-low-power'] });
  return () => { mq.removeEventListener('change', onChange); mo.disconnect(); };
}

export function useCalm() {
  return useSyncExternalStore(subscribeCalm, readCalm, () => true);
}

const DESKTOP_MQ = '(min-width: 768px)';
const PHONE_MQ = '(max-width: 767.98px)';
function subscribeDesktop(onChange) {
  const mq = window.matchMedia(DESKTOP_MQ);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
export function useDesktop() {
  return useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_MQ).matches, () => true);
}

// ─── Lenis ─────────────────────────────────────────────────────────────────

let lenis = null;

/**
 * Smooth wheel scrolling, driven by GSAP's ticker so ScrollTrigger and Lenis
 * agree on every frame. Lazy-loaded: calm pages never download it.
 */
export function useLenis(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    let tick = null;
    let alive = true;
    (async () => {
      const [{ default: Lenis }] = await Promise.all([import('lenis'), import('lenis/dist/lenis.css')]);
      if (!alive) return;
      lenis = new Lenis({ duration: 1.05, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      tick = (time) => lenis?.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
    })();
    return () => {
      alive = false;
      if (tick) gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      try { lenis?.destroy(); } catch { /* already torn down */ }
      lenis = null;
    };
  }, [enabled]);
}

/**
 * Scroll to a section without touching the URL: the app's hash router reads
 * any "#x" as a page, so in-page anchors would strand a reload.
 */
export function scrollToId(id) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
  if (!el) return;
  // Both paths honour html's scroll-padding-top, which clears the fixed nav.
  if (lenis) {
    lenis.scrollTo(el, { duration: 1.3 });
  } else {
    el.scrollIntoView({ behavior: readCalm() ? 'auto' : 'smooth', block: 'start' });
  }
  // Move focus for keyboard and screen-reader users without a second jump.
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

// ─── Scenes ────────────────────────────────────────────────────────────────

let refreshTimer = null;
/** Many scenes mount at once; re-measure once, after all of them. */
export function scheduleRefresh(delay = 120) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  }, delay);
}

/**
 * Build a chapter's animations inside a gsap.matchMedia scoped to `ref`, so
 * resizing across the desktop breakpoint rebuilds them and unmounting reverts
 * every tween, trigger and pin. `build({ desktop, calm }, root)` may return a
 * cleanup function for anything GSAP doesn't own (listeners, tickers).
 */
export function useScene(ref, build, deps) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const mm = gsap.matchMedia(root);
    // matchMedia only runs the builder while at least one condition matches,
    // so desktop and phone are both listed: one of them always does.
    mm.add({ desktop: DESKTOP_MQ, phone: PHONE_MQ, reduce: REDUCE_MQ }, (ctx) => {
      const calm = ctx.conditions.reduce || document.documentElement.hasAttribute('data-low-power');
      return build({ desktop: ctx.conditions.desktop, calm }, root);
    });
    scheduleRefresh();
    return () => mm.revert();
    // The caller owns the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
