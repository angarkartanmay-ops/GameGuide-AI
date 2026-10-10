// What analytics and crash reports may carry (src/utils/privacy.js,
// src/utils/analytics.js). A shared answer travels in the URL fragment, so the
// property under test is simple: no event, breadcrumb or report keeps a
// fragment — and the SDK settings that keep tracking cookieless and
// content-free can't be loosened without this failing.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stripFragment, scrubPostHogEvent, scrubBreadcrumb, scrubSentryEvent, IGNORED_ERRORS,
} from '../src/utils/privacy.js';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = '#s=zSECRET-ANSWER-PAYLOAD';

// ── stripFragment ──────────────────────────────────────────────────────────
check('strips a share fragment', stripFragment(`https://x.app/${SECRET}`) === 'https://x.app/');
check('keeps path and query (utm tags stay useful)', stripFragment(`https://x.app/a?utm_source=ph${SECRET}`) === 'https://x.app/a?utm_source=ph');
check('a url with no fragment is untouched', stripFragment('https://x.app/a?b=1') === 'https://x.app/a?b=1');
check('only the first # matters', stripFragment('https://x.app/#a#b') === 'https://x.app/');
check('non-strings pass through', stripFragment(undefined) === undefined && stripFragment(null) === null && stripFragment(7) === 7);

// ── PostHog ────────────────────────────────────────────────────────────────
{
  const ev = scrubPostHogEvent({
    event: 'press_start',
    properties: {
      $current_url: `https://x.app/${SECRET}`,
      $referrer: `https://t.co/${SECRET}`,
      $initial_current_url: `https://x.app/${SECRET}`,
      from: 'button',
    },
  });
  check('posthog: current url scrubbed', ev.properties.$current_url === 'https://x.app/');
  check('posthog: referrer scrubbed', ev.properties.$referrer === 'https://t.co/');
  check('posthog: initial url scrubbed', ev.properties.$initial_current_url === 'https://x.app/');
  check('posthog: our own properties survive', ev.properties.from === 'button' && ev.event === 'press_start');
  check('posthog: junk events do not throw', scrubPostHogEvent(null) === null && scrubPostHogEvent({}) !== undefined);
}

// ── Sentry breadcrumbs ─────────────────────────────────────────────────────
check('console breadcrumbs are dropped (they can echo what was typed)', scrubBreadcrumb({ category: 'console', message: 'prompt: how do I…' }) === null);
check('input breadcrumbs are dropped', scrubBreadcrumb({ category: 'ui.input' }) === null);
{
  const nav = scrubBreadcrumb({ category: 'navigation', data: { from: `/${SECRET}`, to: `/x${SECRET}` } });
  check('navigation breadcrumb fragments removed', nav.data.from === '/' && nav.data.to === '/x');
  const f = scrubBreadcrumb({ category: 'fetch', data: { url: `https://api/x${SECRET}`, method: 'POST' } });
  check('fetch breadcrumb url scrubbed, method kept', f.data.url === 'https://api/x' && f.data.method === 'POST');
}

// ── Sentry events ──────────────────────────────────────────────────────────
{
  const ev = scrubSentryEvent({
    message: 'boom',
    request: {
      url: `https://x.app/${SECRET}`,
      headers: { Referer: `https://x.app/${SECRET}`, 'User-Agent': 'UA' },
      cookies: { sb: 'token' },
      data: 'typed text',
    },
    user: { id: '1', ip_address: '1.2.3.4' },
    breadcrumbs: [
      { category: 'console', message: 'typed text' },
      { category: 'navigation', data: { to: `/${SECRET}` } },
    ],
  });
  check('sentry: request url scrubbed', ev.request.url === 'https://x.app/');
  check('sentry: referer scrubbed, other headers kept', ev.request.headers.Referer === 'https://x.app/' && ev.request.headers['User-Agent'] === 'UA');
  check('sentry: no cookies, no request body', !('cookies' in ev.request) && !('data' in ev.request));
  check('sentry: no user record', !('user' in ev));
  check('sentry: console crumb dropped, nav crumb kept and scrubbed',
    ev.breadcrumbs.length === 1 && ev.breadcrumbs[0].data.to === '/');
  check('sentry: nothing anywhere still holds the secret', !JSON.stringify(ev).includes('SECRET'));
  check('sentry: junk events do not throw', scrubSentryEvent(null) === null && scrubSentryEvent({}) !== undefined);
}

check('ResizeObserver noise is ignored', IGNORED_ERRORS.some(rx => rx.test('ResizeObserver loop completed with undelivered notifications.')));
check('a real fetch failure is NOT ignored (it is how an outage shows up)',
  !IGNORED_ERRORS.some(rx => rx.test('Failed to fetch') || rx.test('TypeError: Failed to fetch')));

// ── Settings that must not drift ───────────────────────────────────────────
// Source-level on purpose: analytics.js needs a browser (import.meta.env), and
// these are exactly the lines a well-meaning change would loosen.
const SRC = readFileSync(join(ROOT, 'src', 'utils', 'analytics.js'), 'utf8');
check('posthog is lazy-loaded, never a static import', /import\('posthog-js'\)/.test(SRC) && !/^import .*posthog-js/m.test(SRC));
check('sentry is lazy-loaded, never a static import', /import\('@sentry\/browser'\)/.test(SRC) && !/^import .*@sentry\/browser/m.test(SRC));
check("posthog: no cookie and no localStorage (persistence 'memory')", /persistence:\s*'memory'/.test(SRC));
check('posthog: autocapture off', /autocapture:\s*false/.test(SRC));
check('posthog: session recording off', /disable_session_recording:\s*true/.test(SRC));
check('posthog: honours Do Not Track', /respect_dnt:\s*true/.test(SRC));
check('posthog: fragment scrubber wired in', /before_send:\s*scrubPostHogEvent/.test(SRC));
check('sentry: no default PII', /sendDefaultPii:\s*false/.test(SRC));
check('sentry: no session replay or tracing', /tracesSampleRate:\s*0/.test(SRC) && !/replayIntegration|replaysSessionSampleRate|browserTracingIntegration/.test(SRC));
check('sentry: scrubbers wired in', /beforeSend:\s*scrubSentryEvent/.test(SRC) && /beforeBreadcrumb:\s*scrubBreadcrumb/.test(SRC));
check('track() is gated on the stealth flag', /if \(paused/.test(SRC.slice(SRC.indexOf('export function track'))));

// The chat hook must actually flip that flag.
const CHAT = readFileSync(join(ROOT, 'src', 'hooks', 'useChat.js'), 'utf8');
check('stealth mode pauses tracking', /setTrackingPaused\(stealthMode\)/.test(CHAT));

console.log(`privacy: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
