// ═══════════════════════════════════════════════════════════════════════════
//  Usage counts and crash reports — every part is off until you turn it on.
//
//  Each tool is switched on by its own environment variable (Vercel project →
//  Settings → Environment Variables, then redeploy). Unset, the SDK is never
//  even downloaded.
//
//    VITE_ANALYTICS=vercel      Vercel Web Analytics. Cookieless. Page views
//                               work on every plan; custom events need a paid one.
//    VITE_POSTHOG_KEY=phc_…     PostHog: the same named events, plus funnels.
//    VITE_POSTHOG_HOST=…        Optional. Default https://us.i.posthog.com
//                               (use https://eu.i.posthog.com for an EU project).
//    VITE_SENTRY_DSN=https://…  Sentry: uncaught errors, no replay, no tracing.
//
//  Privacy rules, enforced here and in privacy.js:
//   · No cookies and no localStorage: PostHog runs with in-memory persistence,
//     so a reload is a new anonymous visit.
//   · No autocapture, no session recording — only the handful of named events
//     the app sends through track(), with flags, never text the player typed.
//   · Do Not Track / Global Privacy Control are honoured.
//   · URL fragments are removed from everything (a shared answer lives there).
//   · Stealth: events stop for as long as it is on (see setTrackingPaused).
// ═══════════════════════════════════════════════════════════════════════════

import { scrubPostHogEvent, scrubSentryEvent, scrubBreadcrumb, IGNORED_ERRORS } from './privacy';

const ENV = import.meta.env;
const VERCEL = ENV.VITE_ANALYTICS === 'vercel';
const POSTHOG_KEY = ENV.VITE_POSTHOG_KEY || '';
const POSTHOG_HOST = ENV.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';
const SENTRY_DSN = ENV.VITE_SENTRY_DSN || '';

let paused = false;
let started = false;
/** Resolved PostHog client once loaded; events sent before that wait in `queue`. */
let posthog = null;
let sentry = null;
const queue = [];
const errorQueue = [];

function whenIdle(fn) {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 4000 });
  else setTimeout(fn, 1500);
}

function startVercel() {
  if (!VERCEL || window.va) return;
  // Vercel's documented queue stub: calls made before the script loads are
  // replayed once it does.
  window.va = function va(...args) { (window.vaq = window.vaq || []).push(args); };
  const script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  document.head.appendChild(script);
}

function startPostHog() {
  if (!POSTHOG_KEY) return;
  import('posthog-js').then(({ default: ph }) => {
    ph.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      persistence: 'memory',          // no cookie, no localStorage
      person_profiles: 'identified_only',
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      respect_dnt: true,
      before_send: scrubPostHogEvent,
    });
    posthog = ph;
    for (const [name, data] of queue.splice(0)) ph.capture(name, data);
  }).catch(() => { /* blocked or offline: analytics must never break the app */ });
}

function startSentry() {
  if (!SENTRY_DSN) return;
  import('@sentry/browser').then((S) => {
    S.init({
      dsn: SENTRY_DSN,
      environment: ENV.MODE,
      release: ENV.VITE_VERCEL_GIT_COMMIT_SHA || undefined,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      ignoreErrors: IGNORED_ERRORS,
      // Extensions and injected scripts throw errors that are not ours.
      denyUrls: [/^chrome-extension:/i, /^moz-extension:/i, /^safari-(web-)?extension:/i],
      beforeBreadcrumb: scrubBreadcrumb,
      beforeSend: scrubSentryEvent,
    });
    sentry = S;
    for (const err of errorQueue.splice(0)) S.captureException(err);
  }).catch(() => { /* blocked or offline */ });
}

/** Call once at startup. Everything heavy waits for an idle moment after first paint. */
export function initAnalytics() {
  if (started || typeof window === 'undefined') return;
  started = true;
  startVercel();
  if (POSTHOG_KEY || SENTRY_DSN) {
    whenIdle(() => { startPostHog(); startSentry(); });
  }
}

/** Count one event. Never throws, never blocks, no personal data. */
export function track(name, data) {
  if (paused || typeof window === 'undefined') return;
  try {
    if (VERCEL) window.va?.('event', data ? { name, data } : { name });
    if (POSTHOG_KEY) {
      if (posthog) posthog.capture(name, data);
      else if (queue.length < 50) queue.push([name, data]);
    }
  } catch { /* analytics must never break the app */ }
}

/** Report a crash. Used by the error boundary; Sentry also catches stray errors itself. */
export function reportError(error) {
  if (!SENTRY_DSN) return;
  try {
    if (sentry) sentry.captureException(error);
    else if (errorQueue.length < 10) errorQueue.push(error);
  } catch { /* never throw from the error path */ }
}

/** Stealth on → usage events stop. (Crash reports carry no content, so they continue.) */
export function setTrackingPaused(value) {
  paused = !!value;
}
