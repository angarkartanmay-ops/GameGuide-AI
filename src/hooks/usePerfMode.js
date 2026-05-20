import { useEffect, useState } from 'react';

/* ============================================================
   usePerfMode — runtime perf-gating, hoisted out of LandingPage.

   Probes real-world frame cadence over ~40 frames. If the
   trimmed average is below the threshold we treat the device
   as low-power. Result is mirrored onto <html data-low-power>
   so plain CSS anywhere in the app can branch on it (no React
   prop drilling required).

   Combined with prefers-reduced-motion: either signal locks the
   site into low-power mode for the rest of the session. Caps
   are also cached for the session — we only probe once per
   tab so navigations between landing / chat / info don't re-pay
   the probe cost.
   ============================================================ */

const FPS_THRESHOLD = 48;
const SAMPLES = 40;
const PROBE_DELAY_MS = 600;

let _resultCache = null; // 'low' | 'full' | null

function gpuOk() {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return false;
    let ok = true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const r = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
      if (/swiftshader|llvmpipe|software|microsoft basic|basic render/.test(r)) ok = false;
    }
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return ok;
  } catch {
    return false;
  }
}

function probeFps() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.requestAnimationFrame) {
      resolve(60);
      return;
    }
    const deltas = [];
    let last = performance.now();
    let count = 0;
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      count++;
      if (count < SAMPLES) {
        requestAnimationFrame(tick);
      } else {
        // Drop the slowest 3 frames (initial jitter) and average the rest.
        deltas.sort((a, b) => a - b);
        const trimmed = deltas.slice(0, deltas.length - 3);
        const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
        resolve(1000 / avg);
      }
    };
    requestAnimationFrame(tick);
  });
}

function readReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function readEnvLowPower() {
  if (typeof window === 'undefined') return false;
  const lowMem = (navigator.deviceMemory || 8) < 4;
  const lowCores = (navigator.hardwareConcurrency || 8) < 4;
  const conn = navigator.connection || {};
  const saveData = !!conn.saveData;
  return lowMem || lowCores || saveData || !gpuOk();
}

function applyHtmlAttrs(low) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (low) html.setAttribute('data-low-power', '1');
  else html.removeAttribute('data-low-power');
}

export default function usePerfMode() {
  const [reduce, setReduce] = useState(readReducedMotion);
  // Initial value — apply env-derived low-power immediately so heavy
  // effects never render even once on low-spec machines.
  const [lowPower, setLowPower] = useState(() => {
    if (_resultCache === 'low') return true;
    if (_resultCache === 'full') return false;
    return readEnvLowPower();
  });

  // Track reduced-motion changes.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Mirror state to <html>.
  useEffect(() => {
    applyHtmlAttrs(lowPower || reduce);
  }, [lowPower, reduce]);

  // FPS probe — only runs once per session.
  useEffect(() => {
    if (_resultCache !== null) return undefined;
    let cancelled = false;
    const id = setTimeout(() => {
      probeFps().then((fps) => {
        if (cancelled) return;
        const low = fps < FPS_THRESHOLD;
        _resultCache = low ? 'low' : 'full';
        if (low) setLowPower(true);
        if (typeof console !== 'undefined') {
          console.log(`[PERF] FPS probe = ${fps.toFixed(1)}fps → ${low ? 'low-power' : 'full'} mode`);
        }
      });
    }, PROBE_DELAY_MS);
    return () => { cancelled = true; clearTimeout(id); };
  }, []);

  return { lowPower, reduce, effective: lowPower || reduce };
}
