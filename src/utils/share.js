// ═══════════════════════════════════════════════════════════════════════════
//  Spoiler-safe share links — with nothing stored anywhere.
//
//  The question and answer ride in the URL fragment (#share/…), which the
//  browser never sends to a server: deflated, then base64url-encoded. The
//  reader sees the answer with its spoilers still behind bars, so you can
//  send a boss guide to a friend who hasn't finished the game.
//
//  Decoding treats the fragment as hostile — anyone can hand-craft one — so
//  sizes are capped before AND after inflating (a small deflate stream can
//  expand enormously), every field is type-checked and clipped, and the page
//  that shows it labels it as a shared copy rather than something GameGuide
//  vouches for.
// ═══════════════════════════════════════════════════════════════════════════

export const SHARE_PREFIX = 'share/';
const VERSION = 1;

const MAX_ENCODED = 48_000;      // characters of fragment we'll even look at
const MAX_JSON_BYTES = 64 * 1024; // after inflating
const LIMITS = { q: 1_500, a: 16_000, g: 80, source: 40, sources: 12 };

// ── base64url ────────────────────────────────────────────────────────────
function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── deflate-raw via the platform's CompressionStream ───────────────────────
const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function readAll(stream, max) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error('share too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

async function deflate(bytes) {
  return readAll(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw')), Infinity);
}

async function inflate(bytes) {
  return readAll(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')), MAX_JSON_BYTES);
}

// ── payload ──────────────────────────────────────────────────────────────
const clip = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * The only shape a share may take. Anything else — wrong version, missing
 * answer, non-string fields — is rejected or dropped, never passed through.
 */
export function normalizeShare(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return null;
  const a = clip(raw.a, LIMITS.a).trim();
  if (!a) return null;
  const sources = Array.isArray(raw.s)
    ? [...new Set(raw.s.filter(x => typeof x === 'string' && x.trim()).map(x => clip(x.trim(), LIMITS.source)))].slice(0, LIMITS.sources)
    : [];
  return {
    v: VERSION,
    q: clip(raw.q, LIMITS.q).trim(),
    a,
    g: clip(raw.g, LIMITS.g).trim() || null,
    s: sources,
  };
}

/** { q, a, g?, s? } → the fragment payload (without the "share/" prefix). */
export async function encodeShare({ q = '', a = '', g = null, s = [] } = {}) {
  const payload = normalizeShare({ v: VERSION, q, a, g, s });
  if (!payload) throw new Error('nothing to share');
  const json = new TextEncoder().encode(JSON.stringify(payload));
  // "z" = deflated; "j" = plain JSON for the rare browser without
  // CompressionStream (or an older one without its deflate-raw format).
  // Longer link, same content.
  if (canCompress()) {
    try {
      return `z${toBase64Url(await deflate(json))}`;
    } catch { /* fall through to the plain form */ }
  }
  return `j${toBase64Url(json)}`;
}

/** Fragment payload → normalized share, or null for anything malformed. */
export async function decodeShare(encoded) {
  try {
    const text = String(encoded || '');
    if (text.length < 2 || text.length > MAX_ENCODED) return null;
    const kind = text[0];
    const bytes = fromBase64Url(text.slice(1));
    let json;
    if (kind === 'z') {
      if (!canCompress()) return null;
      json = await inflate(bytes);
    } else if (kind === 'j') {
      if (bytes.length > MAX_JSON_BYTES) return null;
      json = bytes;
    } else {
      return null;
    }
    return normalizeShare(JSON.parse(new TextDecoder().decode(json)));
  } catch {
    return null;
  }
}

/** Full link for a share, on whatever origin the app is served from. */
export async function buildShareUrl(share, origin = window.location.origin, path = window.location.pathname) {
  return `${origin}${path}#${SHARE_PREFIX}${await encodeShare(share)}`;
}
