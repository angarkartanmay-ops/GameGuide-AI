// How a URL becomes a view. Pure, so every case can be tested.
//
//   /#about  /#chat  /#upgrade/<token>  /#share/<payload>   that view
//   /  (no hash)                                             null: the caller decides
//   /#access_token=...  /#error=...                          null: a sign-in redirect
//                                                            is not ours to judge
//   /#nonsense     or     /nonsense (no hash)                'notfound'
//
// Plain paths such as /terms or /refund-policy never get here: the inline
// script in index.html forwards the known ones to /#terms before the app
// starts, so a path that is still unknown by now really is one.

const SHARE_PREFIX = 'share/';

// A fragment shaped like a route name ("about", "upgrade/<token>"). Anything
// with "=" or "&" in it is a query-style fragment (Google sign-in returns the
// session this way), and is left for whatever put it there.
const ROUTE_LIKE = /^[\w-]+(?:\/.*)?$/;

/**
 * @param {{ hash?: string, pathname?: string }} loc  window.location, or a stand-in
 * @param {Set<string>} allViews  the hash views this app can show
 * @returns {string|null} a view name, or null for "no opinion, use the default"
 */
export function readViewFromLocation(loc, allViews) {
  const raw = String(loc?.hash || '').replace(/^#\/?/, '');
  if (raw) {
    // The share payload is case-sensitive base64url: read raw, never lowercased.
    // A bare "share" is a link someone cut short, which the share view explains.
    if (raw === 'share' || raw.startsWith(SHARE_PREFIX)) return 'share';
    const lower = raw.toLowerCase();
    if (lower.startsWith('upgrade')) return 'upgrade';
    const name = lower.replace(/\/+$/, '');
    if (allViews.has(name)) return name;
    return ROUTE_LIKE.test(raw) ? 'notfound' : null;
  }
  const path = String(loc?.pathname || '/').replace(/^\/+|\/+$/g, '');
  if (path && path !== 'index.html') return 'notfound';
  return null;
}
