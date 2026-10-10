// ═══════════════════════════════════════════════════════════════════════════
//  What may leave the browser in a usage event or a crash report.
//
//  A shared answer lives in the URL fragment (`/#s=…`): the question and the
//  whole answer, packed into the link so nothing is stored on our side. Any
//  tool that records `location.href` would therefore record the answer. Every
//  event passes through these functions first, and they drop the fragment.
//
//  Pure on purpose (no import.meta.env, no DOM): tests/privacy.test.mjs runs
//  them under plain node.
// ═══════════════════════════════════════════════════════════════════════════

/** `https://x.app/path?a=1#s=SECRET` → `https://x.app/path?a=1`. Non-strings pass through. */
export function stripFragment(url) {
  if (typeof url !== 'string') return url;
  const i = url.indexOf('#');
  return i === -1 ? url : url.slice(0, i);
}

/** PostHog `before_send`: scrub the URL-bearing properties, keep everything else. */
export function scrubPostHogEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const props = event.properties;
  if (props && typeof props === 'object') {
    for (const key of ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer']) {
      if (key in props) props[key] = stripFragment(props[key]);
    }
  }
  return event;
}

// Console output can echo what a player typed; clicks and inputs are noise.
const DROPPED_BREADCRUMBS = new Set(['console', 'ui.input']);

/** Sentry `beforeBreadcrumb`: null drops it. */
export function scrubBreadcrumb(crumb) {
  if (!crumb) return crumb;
  if (DROPPED_BREADCRUMBS.has(crumb.category)) return null;
  const data = crumb.data;
  if (data && typeof data === 'object') {
    for (const key of ['url', 'from', 'to']) {
      if (key in data) data[key] = stripFragment(data[key]);
    }
  }
  return crumb;
}

/** Sentry `beforeSend`: no fragments in the URL, referrer or breadcrumbs; no user record. */
export function scrubSentryEvent(event) {
  if (!event || typeof event !== 'object') return event;
  if (event.request) {
    event.request.url = stripFragment(event.request.url);
    const h = event.request.headers;
    if (h && typeof h === 'object') {
      for (const k of Object.keys(h)) {
        if (k.toLowerCase() === 'referer') h[k] = stripFragment(h[k]);
      }
    }
    // Never ship cookies or a request body, whatever the SDK collected.
    delete event.request.cookies;
    delete event.request.data;
  }
  delete event.user;
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter(Boolean);
  }
  return event;
}

/** Browser noise that is never ours to fix. Passed to Sentry's `ignoreErrors`. */
export const IGNORED_ERRORS = [
  /ResizeObserver loop/i,
  /Non-Error promise rejection captured/i,
  /^AbortError/i,
  /The user aborted a request/i,
  // "Failed to fetch" is deliberately NOT ignored: when chat-proxy is down,
  // that message is how we would find out.
];
