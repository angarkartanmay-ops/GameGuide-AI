// ═══════════════════════════════════════════════════════════════════════════
//  Game art for the chat backdrop — client side.
//
//  resolveGameArt(name) → { appid, name, hero[], header[], cover[], accent? }
//  via /api/game-art (a Vercel function; a Vite middleware in dev), cached in
//  memory and, unless told not to (stealth), in localStorage for a week.
//
//  sampleAccent(url) reads a small copy of the art through a canvas. Steam's
//  CDN sends Access-Control-Allow-Origin: *, so this works; if some image
//  ever arrives without it the canvas is tainted, getImageData throws, and the
//  theme accent simply stays. Visible <img> layers never set crossOrigin — a
//  missing CORS header must cost only the accent, never the picture.
// ═══════════════════════════════════════════════════════════════════════════

import { pickAccent, ensureContrast, toHex } from './accent.js';
import { normalizeGameKey } from './gameContext.js';

const STORE_KEY = 'gg.gameArt.v1';
const HIT_TTL = 7 * 24 * 3600 * 1000;
const MISS_TTL = 24 * 3600 * 1000;
const MAX_ENTRIES = 40;

const memory = new Map();

function readStore() {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function writeStore(key, match) {
  try {
    const all = readStore();
    all[key] = { at: Date.now(), match };
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(keys.map(k => [k, all[k]]))));
  } catch { /* storage blocked: memory cache only */ }
}

function fresh(entry) {
  if (!entry || typeof entry.at !== 'number') return false;
  return Date.now() - entry.at < (entry.match ? HIT_TTL : MISS_TTL);
}

/** @returns {Promise<object|null>} null = no confident match (or lookup down). */
export async function resolveGameArt(name, { signal, persist = true } = {}) {
  const key = normalizeGameKey(name);
  if (!key) return null;
  if (memory.has(key)) return memory.get(key);
  const stored = readStore()[key];
  if (fresh(stored)) {
    memory.set(key, stored.match);
    return stored.match;
  }
  if (!persist) return null;   // stealth: never announce the game to the network
  try {
    const res = await fetch(`/api/game-art?q=${encodeURIComponent(name)}`, { signal });
    if (!res.ok) return null;  // lookup down: try again next time, don't cache
    const body = await res.json();
    const match = body?.match && Number.isInteger(body.match.appid) ? body.match : null;
    memory.set(key, match);
    writeStore(key, match);
    return match;
  } catch {
    return null;
  }
}

/** Remember the sampled accent with the art, so a return visit skips sampling. */
export function rememberAccent(name, accent) {
  const key = normalizeGameKey(name);
  const match = memory.get(key);
  if (!match || !accent) return;
  const next = { ...match, accent };
  memory.set(key, next);
  writeStore(key, next);
}

function loadImage(url, { cors = false } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** First URL that actually loads (hashed path, then legacy path, …). */
export async function firstLoadable(urls) {
  for (const url of urls || []) {
    try {
      await loadImage(url);
      return url;
    } catch { /* next candidate */ }
  }
  return null;
}

/** Accent colour as #rrggbb, or null (grey art, tainted canvas, no image). */
export async function sampleAccent(urls) {
  for (const url of urls || []) {
    try {
      const img = await loadImage(url, { cors: true });
      const canvas = document.createElement('canvas');
      canvas.width = 24;
      canvas.height = 24;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 24, 24);
      const rgb = pickAccent(ctx.getImageData(0, 0, 24, 24).data);
      return rgb ? toHex(ensureContrast(rgb)) : null;
    } catch { /* next candidate */ }
  }
  return null;
}
