import React, { useEffect, useRef, useState } from 'react';
import { motion, useSpring, useMotionValue } from 'framer-motion';
import './Crosshair.css';

/* ============================================================
   Crosshair — site-wide FPS-style reticle.
   Two layers: a tight inner reticle (4 ticks + center pin) and
   a softer trailing outer ring. Color is driven by the active
   theme (--accent-1), so it morphs with every theme swap.

   - Inner reticle uses a stiff spring (responsive, no lag).
   - Outer ring uses a soft spring (trail reads as motion).
   - Hover over any interactive element widens the ticks and
     scales the ring up like a target lock.
   - Pointer-down collapses the ring into the reticle (fire).
   - Disabled on touch/coarse pointers and reduced motion.

   Mounted ONCE at the App root so it persists across view
   transitions (landing → chat → info) without resetting
   position or spring state.
   ============================================================ */

// Closest-ancestor selector for "interactive" elements. Inputs/textareas
// are excluded because the OS still shows the text caret there — we don't
// want to swap to "lock" state mid-edit.
const HOT_SELECTOR = 'button, a, [role="button"], [data-magnetic], summary, label, select';

export default function Crosshair() {
  const [enabled, setEnabled] = useState(false);
  const [hot, setHot] = useState(false);
  const [firing, setFiring] = useState(false);
  const [textMode, setTextMode] = useState(false);
  // Track the last hovered hot element so pointer events on a child don't
  // re-trigger setHot on every nested pointerover.
  const lastHotRef = useRef(null);

  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  // Inner reticle: stiff = 1:1 follow.
  const ix = useSpring(x, { stiffness: 750, damping: 35, mass: 0.22 });
  const iy = useSpring(y, { stiffness: 750, damping: 35, mass: 0.22 });
  // Outer ring: soft = trailing follower.
  const rx = useSpring(x, { stiffness: 200, damping: 24, mass: 0.35 });
  const ry = useSpring(y, { stiffness: 200, damping: 24, mass: 0.35 });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Enable only on fine pointers (mouse / trackpad). Coarse → native cursor.
    const fine = window.matchMedia('(pointer: fine)');
    const noMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setEnabled(fine.matches && !noMotion.matches);
    update();
    fine.addEventListener?.('change', update);
    noMotion.addEventListener?.('change', update);
    return () => {
      fine.removeEventListener?.('change', update);
      noMotion.removeEventListener?.('change', update);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const move = (e) => { x.set(e.clientX); y.set(e.clientY); };
    const evalTarget = (target) => {
      if (!target || target === document) return;
      const hotEl = target.closest?.(HOT_SELECTOR) || null;
      if (hotEl !== lastHotRef.current) {
        lastHotRef.current = hotEl;
        setHot(!!hotEl);
      }
      // Show a thin I-beam-like overlay when over editable text. The OS
      // text caret remains for actual typing; this is just a hint that the
      // reticle has "soft-locked" off text input.
      const tagName = target.tagName;
      const editable = (
        tagName === 'INPUT' || tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      setTextMode(editable);
    };
    const over = (e) => evalTarget(e.target);
    const down = () => setFiring(true);
    const up = () => setFiring(false);
    const leave = () => { x.set(-200); y.set(-200); lastHotRef.current = null; setHot(false); setTextMode(false); };

    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerover', over, { passive: true });
    window.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    document.addEventListener('mouseleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerover', over);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      document.removeEventListener('mouseleave', leave);
    };
  }, [enabled, x, y]);

  if (!enabled) return null;

  const stateClass = [
    hot && 'is-hot',
    firing && 'is-firing',
    textMode && 'is-text',
  ].filter(Boolean).join(' ');

  return (
    <>
      <motion.div
        className={`gg-cursor-ring ${stateClass}`}
        style={{ x: rx, y: ry }}
        aria-hidden="true"
      />
      <motion.div
        className={`gg-cursor-reticle ${stateClass}`}
        style={{ x: ix, y: iy }}
        aria-hidden="true"
      >
        <span className="gg-tick gg-tick--n" />
        <span className="gg-tick gg-tick--e" />
        <span className="gg-tick gg-tick--s" />
        <span className="gg-tick gg-tick--w" />
        <span className="gg-pin" />
      </motion.div>
    </>
  );
}
