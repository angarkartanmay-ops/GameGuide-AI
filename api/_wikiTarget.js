// ═══════════════════════════════════════════════════════════════════════════
//  Fandom target validation — shared by the wiki proxy endpoints.
//  ───────────────────────────────────────────────────────────────────────
//  These handlers interpolate a caller-supplied value into the URL HOSTNAME:
//
//      `https://${game}.fandom.com/api.php?...`
//
//  Unvalidated, that is a full-read SSRF. `game=example.com%23` truncates the
//  intended host with a fragment, so the request goes to example.com and the
//  handler returns the response body verbatim to the caller. With
//  `Access-Control-Allow-Origin: *` on these routes, any website on the
//  internet can use the deployment as an open proxy, and reach anything the
//  serverless function can route to.
//
//  The fix is an allowlist on SHAPE, not a blocklist of payloads: a Fandom
//  wiki subdomain is only ever lowercase alphanumerics with internal hyphens.
//  Anything containing a dot, slash, colon, '#', '?', '@', or encoded variants
//  simply is not a subdomain and is rejected.
// ═══════════════════════════════════════════════════════════════════════════

const SUBDOMAIN_RX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Validate a caller-supplied Fandom wiki name.
 * @returns {string|null} the safe subdomain, or null if it must be rejected.
 */
export function safeFandomSubdomain(game) {
  if (typeof game !== 'string') return null;

  // Decode first: %23 / %2e / %2f would otherwise slip past a raw check and
  // only become dangerous once the URL is assembled.
  let decoded = game;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return null;   // malformed percent-encoding — reject outright
    }
  }

  const candidate = decoded.trim().toLowerCase();
  if (!SUBDOMAIN_RX.test(candidate)) return null;

  // 'www' would resolve to the Fandom hub rather than a wiki, and these are
  // reserved names that should never be proxied.
  if (['www', 'api', 'localhost', 'internal', 'admin'].includes(candidate)) return null;

  return candidate;
}

/** Build a validated Fandom API URL, or null when the target is not allowed. */
export function buildFandomUrl(game, params) {
  const sub = safeFandomSubdomain(game);
  if (!sub) return null;
  const url = new URL(`https://${sub}.fandom.com/api.php`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}

// ── CORS ───────────────────────────────────────────────────────────────────
//  These routes make outbound fetches on the caller's behalf, so the origin
//  allowlist is a real control, not a formality.
//
//  `hostname.endsWith('.vercel.app')` is NOT an allowlist: vercel.app is a
//  public suffix, so anyone can deploy `evil.vercel.app` for free and would be
//  trusted by that check. Match exact hosts instead, and let additional
//  origins (preview deployments, a custom domain) be added deliberately via
//  the ALLOWED_ORIGINS env var as a comma-separated list of hostnames.
const DEFAULT_ALLOWED_HOSTS = new Set([
  'gameguide-ai.vercel.app',
  'localhost',
  '127.0.0.1',
]);

function allowedHosts() {
  const extra = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_HOSTS, ...extra]);
}

/** @returns {boolean} whether `origin` may receive CORS headers. */
export function isAllowedOrigin(origin) {
  if (typeof origin !== 'string' || !origin) return false;
  try {
    const { hostname, protocol } = new URL(origin);
    const host = hostname.toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    // Everything but local dev must be HTTPS.
    if (protocol !== 'https:' && !(isLocal && protocol === 'http:')) return false;
    return allowedHosts().has(host);
  } catch {
    return false;
  }
}
