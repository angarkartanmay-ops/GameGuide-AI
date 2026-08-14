// ═══════════════════════════════════════════════════════════════════════════
//  MESH DB — service-role access to the rate limiter, provider health,
//  quota ledger, player memory and request trace.
//  ───────────────────────────────────────────────────────────────────────
//  Deliberately uses raw fetch against PostgREST rather than supabase-js:
//  every import costs cold-start time on an edge function that already has a
//  tight latency budget, and all we need is five RPC calls.
//
//  DESIGN RULE — never let telemetry break a chat.
//  Every function here swallows its errors and returns a safe default. The one
//  exception is the rate limiter, which falls back to an in-memory limiter so
//  a database outage cannot silently remove all abuse protection.
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  Deno.env.get('SERVICE_ROLE_KEY') || '';

export const dbConfigured = !!(SUPABASE_URL && SERVICE_KEY);

async function rpc<T>(fn: string, args: Record<string, unknown>, timeoutMs = 2500): Promise<T | null> {
  if (!dbConfigured) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      console.warn(`[MESH-DB] ${fn} → HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
      return null;
    }
    return await res.json() as T;
  } catch (e) {
    console.warn(`[MESH-DB] ${fn} failed:`, (e as Error).message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  RATE LIMITING
// ───────────────────────────────────────────────────────────────────────────

export interface RateDecision {
  allowed: boolean;
  scope: string | null;
  retryAfter: number;
  minute: number; minuteLimit: number;
  hour: number;   hourLimit: number;
  day: number;    dayLimit: number;
  degraded: boolean;   // true when the DB was unreachable and we used memory
}

export interface RateLimits {
  perMinute: number;
  perHour: number;
  perDay: number;
}

// Signed-in users get a real allowance; anonymous callers sharing an IP get a
// tighter one, since that is the bucket an abuser will actually target.
export const LIMITS_AUTHED: RateLimits = { perMinute: 12, perHour: 120, perDay: 600 };
export const LIMITS_ANON: RateLimits   = { perMinute: 6,  perHour: 40,  perDay: 120 };

// Per-isolate fallback. Not shared across isolates, so it is strictly weaker
// than the DB limiter — but it still caps a single hot isolate, which is where
// a burst from one client lands.
const memBuckets = new Map<string, number[]>();

function memoryRateLimit(bucket: string, limits: RateLimits, weight = 1): RateDecision {
  const now = Date.now();
  const hits = (memBuckets.get(bucket) || []).filter(ts => now - ts < 86_400_000);

  const inWindow = (ms: number) => hits.filter(ts => now - ts < ms).length;
  const minute = inWindow(60_000);
  const hour = inWindow(3_600_000);
  const day = hits.length;

  let allowed = true, scope: string | null = null, retryAfter = 0;
  if (minute >= limits.perMinute)      { allowed = false; scope = 'minute'; retryAfter = 60; }
  else if (hour >= limits.perHour)     { allowed = false; scope = 'hour';   retryAfter = 900; }
  else if (day >= limits.perDay)       { allowed = false; scope = 'day';    retryAfter = 3600; }

  if (allowed) {
    // Mirror the server-side weighting so the fallback charges expensive kinds
    // the same as the DB limiter would.
    for (let i = 0; i < Math.max(weight, 1); i++) hits.push(now);
    memBuckets.set(bucket, hits);
    // Bound memory growth across many distinct buckets.
    if (memBuckets.size > 5000) {
      for (const [k, v] of memBuckets) {
        if (!v.some(ts => now - ts < 3_600_000)) memBuckets.delete(k);
        if (memBuckets.size <= 4000) break;
      }
    }
  }

  return {
    allowed, scope, retryAfter,
    minute: allowed ? minute + weight : minute, minuteLimit: limits.perMinute,
    hour:   allowed ? hour + weight   : hour,   hourLimit:   limits.perHour,
    day:    allowed ? day + weight    : day,    dayLimit:    limits.perDay,
    degraded: true,
  };
}

// Slots consumed per request kind. A vision turn costs an OCR pass, a HUD crop
// and possibly a second-opinion model; image generation costs more again.
// Charging all three the same as a text reply would let the expensive paths
// drain the free tiers unchecked.
const KIND_WEIGHT: Record<'chat' | 'vision' | 'image_gen', number> = {
  chat: 1,
  vision: 3,
  image_gen: 5,
};

export async function checkRateLimit(
  bucket: string,
  kind: 'chat' | 'vision' | 'image_gen',
  limits: RateLimits,
): Promise<RateDecision> {
  const weight = KIND_WEIGHT[kind] ?? 1;
  const row = await rpc<any>('gg_check_rate_limit', {
    p_bucket: bucket,
    p_kind: kind,
    p_limit_min: limits.perMinute,
    p_limit_hour: limits.perHour,
    p_limit_day: limits.perDay,
    p_weight: weight,
  }, 2000);

  if (!row || typeof row.allowed !== 'boolean') {
    // DB unavailable — degrade to the in-memory limiter rather than failing open.
    return memoryRateLimit(bucket, limits, weight);
  }

  return {
    allowed: row.allowed,
    scope: row.scope ?? null,
    retryAfter: row.retry_after ?? 0,
    minute: row.minute ?? 0, minuteLimit: row.minute_limit ?? limits.perMinute,
    hour:   row.hour   ?? 0, hourLimit:   row.hour_limit   ?? limits.perHour,
    day:    row.day    ?? 0, dayLimit:    row.day_limit    ?? limits.perDay,
    degraded: false,
  };
}

// Stable, non-reversible bucket id for anonymous callers. We never store a
// raw IP — only a truncated salted hash, which is enough to rate limit.
export async function anonBucket(req: Request): Promise<string> {
  // X-Forwarded-For is client-writable, and its LEFTMOST entry is whatever the
  // caller claimed — trusting it lets an attacker mint a fresh bucket per
  // request and bypass rate limiting entirely. Prefer the platform-set header,
  // and otherwise take the RIGHTMOST entry, which is the one appended by the
  // nearest trusted proxy rather than supplied by the client.
  const fwd = req.headers.get('x-forwarded-for') || '';
  const chain = fwd.split(',').map(s => s.trim()).filter(Boolean);
  const ip = req.headers.get('cf-connecting-ip')
    || req.headers.get('x-real-ip')
    || (chain.length ? chain[chain.length - 1] : '')
    || 'unknown';
  const salt = Deno.env.get('RATE_LIMIT_SALT') || 'gameguide-static-salt';
  const buf = new TextEncoder().encode(`${salt}:${ip}`);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `ip:${hex.slice(0, 24)}`;
}

// ── Caller identity ────────────────────────────────────────────────────────
//  The subject claim decides (a) which rate-limit bucket you draw from and
//  (b) WHOSE player profile gets loaded with the service-role key, which
//  bypasses RLS. Both make this a genuine authentication boundary, so the
//  signature MUST be verified. Decoding the payload without verifying would
//  let anyone mint `{"sub": "<victim uuid>", "role": "authenticated"}` and
//  read or poison another player's profile, and hand themselves an unlimited
//  supply of fresh rate-limit buckets.
//
//  Verification order:
//    1. Local HMAC check against SUPABASE_JWT_SECRET  (fast, no network)
//    2. Remote check via GoTrue /auth/v1/user          (covers RS256/ES256
//       projects where we hold no shared secret)
//  If neither can run, we fail CLOSED and treat the caller as anonymous —
//  the lower-privilege path — rather than trusting unvalidated claims.

const JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET') || Deno.env.get('JWT_SECRET') || '';

// Allocates over an explicit ArrayBuffer so the result satisfies BufferSource
// for Web Crypto (a bare `new Uint8Array(n)` widens to ArrayBufferLike, which
// includes SharedArrayBuffer and is rejected by crypto.subtle).
function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(pad.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeSegment(seg: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
}

// Verified subjects, cached briefly so a chatty client does not re-verify on
// every keystroke-fast request. Keyed by the full token.
const verifiedSubs = new Map<string, { sub: string | null; ts: number }>();
const SUB_TTL_MS = 60_000;

async function verifyHs256(token: string): Promise<boolean> {
  if (!JWT_SECRET) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return false;
  }
}

async function verifyRemote(token: string): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      signal: ctrl.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': Deno.env.get('SUPABASE_ANON_KEY') || SERVICE_KEY,
      },
    });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Trusted bot identity ───────────────────────────────────────────────────
//  The Discord bot is one process on one host authenticating with the anon
//  key, so under IP bucketing every Discord user in every guild collapses into
//  a single bucket — 40 turns/hour for the entire bot. Unusable.
//
//  Instead the bot presents a shared secret plus the Discord user id, and we
//  bucket per Discord user. Deliberately scoped to RATE LIMITING ONLY: this
//  path never selects a player profile, so a leaked bot token cannot be used
//  to read or poison anyone's stored data. The worst it buys an attacker is
//  the ability to spend a claimed id's own quota.
const BOT_TOKEN = Deno.env.get('BOT_SERVICE_TOKEN') || '';

/** Constant-time compare so a leaked token can't be recovered by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface BotCaller { discordUserId: string; }

export function botCallerFromHeaders(req: Request): BotCaller | null {
  if (!BOT_TOKEN) return null;
  const presented = req.headers.get('x-gg-bot-token') || '';
  if (!presented || !timingSafeEqual(presented, BOT_TOKEN)) return null;

  const raw = (req.headers.get('x-gg-bot-user') || '').trim();
  // Discord snowflakes are 17-20 digits. Anything else is not an id, and
  // letting arbitrary strings through would allow unbounded bucket minting.
  if (!/^\d{17,20}$/.test(raw)) return null;
  return { discordUserId: raw };
}

export async function userIdFromAuthHeader(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.split('.').length !== 3) return null;

  const cached = verifiedSubs.get(token);
  if (cached && Date.now() - cached.ts < SUB_TTL_MS) return cached.sub;

  let sub: string | null = null;
  try {
    const header = decodeSegment(token.split('.')[0]);
    const payload = decodeSegment(token.split('.')[1]);

    // Claim-shape checks first — cheap, and they reject the anon key (whose
    // role is 'anon', not a real end user) before any crypto work.
    const candidate = payload?.sub;
    const roleOk = payload?.role === 'authenticated';
    const notExpired = !payload?.exp || Date.now() / 1000 < payload.exp;
    if (roleOk && notExpired && typeof candidate === 'string' && candidate.length >= 8) {
      const alg = String(header?.alg || '');
      // "alg: none" and algorithm-confusion attempts never reach verification.
      const verified = alg === 'HS256'
        ? (await verifyHs256(token)) || (await verifyRemote(token))
        : /^(RS|ES|PS)\d{3}$/.test(alg)
          ? await verifyRemote(token)
          : false;
      if (verified) sub = candidate;
      else console.warn('[AUTH] token failed verification — treating as anonymous');
    }
  } catch {
    sub = null;
  }

  verifiedSubs.set(token, { sub, ts: Date.now() });
  if (verifiedSubs.size > 2000) {
    const now = Date.now();
    for (const [k, v] of verifiedSubs) {
      if (now - v.ts > SUB_TTL_MS) verifiedSubs.delete(k);
    }
  }
  return sub;
}

// ───────────────────────────────────────────────────────────────────────────
//  MESH STATE — today's spend + active cooldowns, one round trip
// ───────────────────────────────────────────────────────────────────────────

export interface MeshState {
  usage: Record<string, number>;      // "provider|model" → requests today
  cooldowns: Record<string, number>;  // "provider|model" → seconds remaining
}

const EMPTY_STATE: MeshState = { usage: {}, cooldowns: {} };

let stateCache: { ts: number; state: MeshState } | null = null;
const STATE_TTL_MS = 20_000;

export async function getMeshState(): Promise<MeshState> {
  if (stateCache && Date.now() - stateCache.ts < STATE_TTL_MS) return stateCache.state;
  const row = await rpc<any>('gg_mesh_state', {}, 1500);
  const state: MeshState = row
    ? { usage: row.usage || {}, cooldowns: row.cooldowns || {} }
    : EMPTY_STATE;
  stateCache = { ts: Date.now(), state };
  return state;
}

// Local echo so repeated calls within one request see their own writes without
// waiting for the 20s state cache to expire.
export function noteLocalFailure(provider: string, model: string) {
  if (!stateCache) return;
  stateCache.state.cooldowns[`${provider}|${model}`] = 60;
}

export function reportProvider(provider: string, model: string, ok: boolean, status?: number, error?: string): void {
  // Fire-and-forget: the caller must never await telemetry.
  void rpc('gg_report_provider', {
    p_provider: provider, p_model: model, p_ok: ok,
    p_status: status ?? null, p_error: error ? error.slice(0, 300) : null,
  }, 2000);
}

export function recordUsage(provider: string, model: string, tokensIn = 0, tokensOut = 0, isError = false): void {
  void rpc('gg_record_usage', {
    p_provider: provider, p_model: model,
    p_tokens_in: tokensIn, p_tokens_out: tokensOut, p_error: isError,
  }, 2000);
}

// ───────────────────────────────────────────────────────────────────────────
//  PLAYER MEMORY
// ───────────────────────────────────────────────────────────────────────────

export interface PlayerProfile {
  platform?: string; gpu?: string; cpu?: string; ram?: string; display?: string;
  games?: Array<{ name: string; hours?: number; rank?: string; status?: string; note?: string }>;
  prefs?: Record<string, unknown>;
  notes?: string;
}

export async function loadProfile(userId: string | null): Promise<PlayerProfile | null> {
  if (!userId || !dbConfigured) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/gg_player_profile?user_id=eq.${encodeURIComponent(userId)}&select=platform,gpu,cpu,ram,display,games,prefs,notes`,
      {
        signal: ctrl.signal,
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
      },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? rows[0] as PlayerProfile : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function saveProfilePatch(userId: string | null, patch: PlayerProfile): void {
  if (!userId || !patch || Object.keys(patch).length === 0) return;
  void rpc('gg_upsert_profile', { p_user_id: userId, p_patch: patch }, 2500);
}

// ───────────────────────────────────────────────────────────────────────────
//  REQUEST TRACE
// ───────────────────────────────────────────────────────────────────────────

export function recordTrace(row: Record<string, unknown>): void {
  if (!dbConfigured) return;
  void (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      await fetch(`${SUPABASE_URL}/rest/v1/gg_request_trace`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(row),
      });
      clearTimeout(t);
    } catch { /* tracing must never surface */ }
  })();
}
