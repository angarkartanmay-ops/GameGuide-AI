// How a URL becomes a view, and a view becomes a URL. Pure, so every case can
// be tested, and plain ESM so the build scripts (sitemap, prerender, the
// vercel.json check) read the same table the app does.
//
// The site routes on real paths:
//
//   /  /chat  /about  /terms  /privacy  /refunds  /delivery  /contacts  /pricing
//   /share/<payload>                          a shared answer
//   anything else                             'notfound' (and a real 404 from the host)
//
// Older addresses keep working, because they are in people's bookmarks, in
// Discord messages and in the return URLs a payment provider was given:
//
//   /refund-policy /contact-us /terms-and-conditions ...    aliases: same page
//   /#about  /#chat  /#upgrade/<token>  /#upgrade/thanks    redirected to the path (legacyRedirect)
//   /#share/<payload>                                       stays where it is: see below
//   /#access_token=...  /#error=...                         a sign-in redirect is not ours to judge
//   /#nonsense                                              'notfound'
//
// A share in the fragment is never sent to a server, which is why it is never
// "upgraded" to /share/<payload> behind its owner's back: a path is visible to
// the host (logs, previews), a fragment is not. Only links created today use
// the path (src/utils/share.js).

/**
 * One row per page the app can show. `path` is the canonical address (what the
 * canonical tag, the sitemap and the footer use); `aliases` are other
 * addresses that serve the same page (payment-provider reviewers type
 * /refund-policy, an old `#upgrade` link says /upgrade).
 */
export const ROUTES = [
  { view: 'landing', path: '/', aliases: [] },
  { view: 'chat', path: '/chat', aliases: [] },
  { view: 'about', path: '/about', aliases: [] },
  { view: 'terms', path: '/terms', aliases: ['/terms-and-conditions', '/terms-of-service'] },
  { view: 'privacy', path: '/privacy', aliases: ['/privacy-policy'] },
  { view: 'refunds', path: '/refunds', aliases: ['/refund', '/refund-policy', '/cancellation', '/cancellation-policy'] },
  { view: 'delivery', path: '/delivery', aliases: ['/shipping', '/shipping-policy', '/delivery-policy'] },
  { view: 'contacts', path: '/contacts', aliases: ['/contact', '/contact-us'] },
  { view: 'upgrade', path: '/pricing', aliases: ['/upgrade', '/plans'] },
];

/** The views that are text pages (rendered by InfoPage). */
export const INFO_VIEWS = new Set(['about', 'terms', 'privacy', 'refunds', 'delivery', 'contacts']);

/** Every view that has an address of its own. */
export const ALL_VIEWS = new Set(ROUTES.map((r) => r.view));

export const SHARE_ROOT = '/share';
export const SHARE_PREFIX = 'share/';

const PATH_TO_VIEW = new Map();
for (const r of ROUTES) {
  PATH_TO_VIEW.set(r.path, r.view);
  for (const a of r.aliases) PATH_TO_VIEW.set(a, r.view);
}
const VIEW_TO_PATH = new Map(ROUTES.map((r) => [r.view, r.path]));

// A fragment shaped like a route name ("about", "upgrade/<token>"). Anything
// with "=" or "&" in it is a query-style fragment (Google sign-in returns the
// session this way), and is left for whatever put it there.
const ROUTE_LIKE = /^[\w-]+(?:\/.*)?$/;

/** "/About/" → "/about". The share payload is never run through this: it is case-sensitive. */
const tidy = (pathname) => {
  const p = `/${String(pathname || '/').replace(/^\/+|\/+$/g, '')}`;
  return p.toLowerCase();
};

/** The canonical path for a view, or null for one with no address of its own (share, notfound). */
export const pathForView = (view) => VIEW_TO_PATH.get(view) ?? null;

/** The view an address belongs to ("/refund-policy" → "refunds"), or null. */
export const viewForPath = (pathname) => PATH_TO_VIEW.get(tidy(pathname)) ?? null;

/** True when the address is an alias rather than the canonical path ("/contact-us"). */
export const isAliasPath = (pathname) => {
  const view = viewForPath(pathname);
  return !!view && pathForView(view) !== tidy(pathname);
};

/**
 * The share payload in a path: "/share/<payload>" → "<payload>"; "/share" or a
 * path that is not a share → null. Case is kept, the payload is base64url.
 */
export function sharePayloadFromPath(pathname) {
  const m = /^\/share\/([^/]+)\/?$/i.exec(String(pathname || ''));
  return m ? m[1] : null;
}

/** "/share/<payload>" for a payload (no checking: encodeShare made it). */
export const sharePath = (payload) => `${SHARE_ROOT}/${payload}`;

/**
 * Where a share lives in this location, if anywhere: { encoded, where } with
 * where = 'path' for a link made today and 'fragment' for an older one.
 * `encoded` may be '' for a link someone cut short, which the share view
 * explains.
 */
export function readShare(loc) {
  const fromPath = sharePayloadFromPath(loc?.pathname);
  if (fromPath) return { encoded: fromPath, where: 'path' };
  if (tidy(loc?.pathname) === SHARE_ROOT) return { encoded: '', where: 'path' };
  const raw = String(loc?.hash || '').replace(/^#\/?/, '');
  if (raw.startsWith(SHARE_PREFIX)) return { encoded: raw.slice(SHARE_PREFIX.length), where: 'fragment' };
  if (raw === 'share') return { encoded: '', where: 'fragment' };
  return null;
}

/**
 * @param {{ hash?: string, pathname?: string }} loc  window.location, or a stand-in
 * @returns {string|null} a view name, or null for "no opinion, use the default"
 */
export function readViewFromLocation(loc) {
  if (readShare(loc)) return 'share';

  const path = tidy(loc?.pathname);
  const byPath = PATH_TO_VIEW.get(path);
  if (byPath && byPath !== 'landing') return byPath;

  const atRoot = path === '/' || path === '/index.html';
  if (!atRoot) return 'notfound';

  // At the root, an old-style fragment still names a view. The inline script in
  // index.html moves the address before the app starts; this is the same rule
  // for a hash edited by hand while the app is open.
  const raw = String(loc?.hash || '').replace(/^#\/?/, '');
  if (!raw) return null; // the bare root: the caller decides (landing, or the chat for someone already in it)
  const lower = raw.toLowerCase();
  if (lower.startsWith('upgrade')) return 'upgrade';
  const name = lower.replace(/\/+$/, '');
  if (ALL_VIEWS.has(name)) return name;
  return ROUTE_LIKE.test(raw) ? 'notfound' : null;
}

/**
 * The address an old hash link should move to, or null to leave things alone.
 *   /#about            → { path: '/about', hash: '' }
 *   /#upgrade/<token>  → { path: '/pricing', hash: '#upgrade/<token>' }   the page takes the token and clears it
 *   /#share/<payload>  → null    stays private in its fragment
 *   /about#anything    → null    only the root carries old links
 * The same rule lives, in ES5, in index.html's first script; tests run both.
 */
export function legacyRedirect(loc) {
  const path = tidy(loc?.pathname);
  if (path !== '/' && path !== '/index.html') return null;
  const raw = String(loc?.hash || '').replace(/^#\/?/, '');
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'share' || lower.startsWith(SHARE_PREFIX)) return null;

  const head = lower.split('/')[0];
  if (!ALL_VIEWS.has(head)) return null;
  const target = pathForView(head);
  // Only the plans page carries anything in its fragment: a signed link or "thanks".
  const rest = head === 'upgrade' ? raw.slice(head.length).replace(/^\/+/, '') : '';
  return { path: target, hash: rest ? `#upgrade/${rest}` : '' };
}
