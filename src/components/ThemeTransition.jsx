import React, { useMemo } from 'react';
import './ThemeTransition.css';

/**
 * Four subtle, theme-matched, gaming-aesthetic transition variants. Cycles
 * round-robin on every theme selection. All variants are restrained — they
 * never wash out the page, never flash white, never block the underlying
 * UI from being read. The body's `is-theme-morphing` class handles the
 * actual color interpolation; these overlays are AMBIENT mood layers
 * played over that morph.
 *
 *   1. AURORA WASH   — diffuse diagonal gradient sweep (mix-blend: screen)
 *   2. SCANLINE DRIFT — single thin line + faint trail descending top→bottom
 *   3. DEPTH FOCUS    — radial vignette pulse focused on click origin
 *   4. PARTICLE DRIFT — handful of slow rising motes in theme accents
 *
 * All variants peak at ≤ 22% opacity. Reduced-motion users see the body
 * morph but skip the overlay entirely (handled in CSS).
 */

export const VARIANTS = ['aurora', 'scan', 'focus', 'drift'];
// Cap covers the longest variant (PARTICLE DRIFT, ~1500ms) plus a margin.
export const THEME_TRANSITION_DURATION = 1600;

export default function ThemeTransition({ variant = 'aurora', accent, accent2, origin }) {
  return (
    <div
      className={`tt-root tt-root--${variant}`}
      style={{
        '--tt-accent': accent,
        '--tt-accent-2': accent2,
        '--tt-ox': `${origin.x}px`,
        '--tt-oy': `${origin.y}px`,
      }}
      aria-hidden="true"
    >
      {variant === 'aurora' && <AuroraWash />}
      {variant === 'scan'   && <ScanlineDrift />}
      {variant === 'focus'  && <DepthFocus />}
      {variant === 'drift'  && <ParticleDrift accent={accent} accent2={accent2} />}
    </div>
  );
}

/* ============================================================
   1. AURORA WASH
   A wide soft-edged diagonal band of the new accent + secondary
   slides across the screen at low opacity. Reads as ambient
   tint, not as a separate effect on top of the page.
   ============================================================ */
function AuroraWash() {
  return (
    <div className="tt-aurora">
      <span className="tt-aurora__sheet" />
      <span className="tt-aurora__edge" />
    </div>
  );
}

/* ============================================================
   2. SCANLINE DRIFT
   A single hairline scanline drifts top→bottom with a faint
   gradient trail behind it. Like a system scan completing.
   ============================================================ */
function ScanlineDrift() {
  return (
    <div className="tt-scan">
      <span className="tt-scan__trail" />
      <span className="tt-scan__line" />
    </div>
  );
}

/* ============================================================
   3. DEPTH FOCUS
   Radial vignette pulses inward from the click origin — center
   gets a faint accent tint, edges briefly darken. Reads as a
   camera/HUD focus shift.
   ============================================================ */
function DepthFocus() {
  return (
    <div className="tt-focus">
      <span className="tt-focus__radial" />
      <span className="tt-focus__core" />
    </div>
  );
}

/* ============================================================
   4. PARTICLE DRIFT
   ~14 ambient motes rise slowly from the bottom of the screen
   in the theme's accent pair. Like dust in a sunbeam or the
   ambient particle fields in many AAA game menus.
   ============================================================ */
function ParticleDrift({ accent, accent2 }) {
  const particles = useMemo(() => {
    return Array.from({ length: 16 }, (_, i) => {
      // Deterministic pseudo-random so HMR doesn't reshuffle mid-animation.
      const seed = (i + 1) * 9301 + 49297;
      const rand = (n) => (((seed * (n + 1)) % 233280) / 233280);
      return {
        x: rand(1) * 100,
        delay: rand(2) * 280,
        duration: 1300 + rand(3) * 300,
        size: 2 + rand(4) * 3,
        drift: -20 + rand(5) * 40,
        color: i % 3 === 0 ? accent2 : accent,
        key: i,
      };
    });
  }, [accent, accent2]);

  return (
    <div className="tt-drift">
      {particles.map((p) => (
        <span
          key={p.key}
          className="tt-drift__mote"
          style={{
            left: `${p.x}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: p.color,
            boxShadow: `0 0 8px ${p.color}`,
            animationDelay: `${p.delay}ms`,
            animationDuration: `${p.duration}ms`,
            '--drift-x': `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
