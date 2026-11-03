// vercel.json: the routes, the true 404, and the security headers.
//
// The Content-Security-Policy is REPORT-ONLY on purpose (see
// launch/security-headers.md for how to read the reports and when to enforce).
// These tests keep it honest while it is: every inline script the page runs is
// hashed in it, nothing it allows is wider than the site needs, and every
// third party the site talks to is either listed or provably not loaded.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineScriptHashes } from '../src/prerender/csp.js';
import { ROUTES } from '../src/site/route.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const cfg = JSON.parse(read('vercel.json'));
const html = read('index.html');

const headersFor = (source) => Object.fromEntries(
  (cfg.headers.find((h) => h.source === source)?.headers || []).map((h) => [h.key, h.value]),
);
const all = headersFor('/(.*)');
const policy = (all['Content-Security-Policy-Report-Only'] || '').split(';').map((d) => d.trim()).filter(Boolean);
const directive = (name) => (policy.find((d) => d.split(/\s+/)[0] === name) || '').split(/\s+/).slice(1);

// ── The plain headers ──────────────────────────────────────────────────────
check('nosniff on every response', all['X-Content-Type-Options'] === 'nosniff');
check('framing is refused: frame-ancestors none', all['Content-Security-Policy'] === "frame-ancestors 'none'");
check('...and the enforced policy is only that (it cannot break the page)', !/script-src|default-src|connect-src/.test(all['Content-Security-Policy']));
check('...with X-Frame-Options for browsers that predate it', all['X-Frame-Options'] === 'DENY');
check('the site has no iframes of its own to protect', !/<iframe/i.test([...files(join(ROOT, 'src'))].map((f) => read(f.slice(ROOT.length + 1))).join('\n') + html));

// A share link's address is its content: those pages send no referrer at all.
const refAll = cfg.headers.find((h) => h.headers.some((x) => x.key === 'Referrer-Policy' && x.value === 'strict-origin-when-cross-origin'));
const refShare = cfg.headers.find((h) => h.headers.some((x) => x.key === 'Referrer-Policy' && x.value === 'no-referrer'));
check('the site sends only its origin to other sites', !!refAll);
check('...except share pages, which send nothing', !!refShare && /share/.test(refShare.source));
check('the general rule does not cover share pages (no two policies on one response)', !!refAll && new RegExp(`^${refAll.source}$`).test('/about') && !new RegExp(`^${refAll.source}$`).test('/share/zAbC'));
check('share pages are noindex in a header too', refShare.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value)));

// ── The Content-Security-Policy (report-only) ──────────────────────────────
check('it is report-only for now', !!all['Content-Security-Policy-Report-Only']);
check('default-src is self', directive('default-src').join(' ') === "'self'");
check('no eval anywhere', !/unsafe-eval|wasm-unsafe-eval/.test(all['Content-Security-Policy-Report-Only']));
check('scripts are not allowed inline wholesale (hashes only)', !directive('script-src').includes("'unsafe-inline'"));
check('objects, base and form targets are locked down', directive('object-src').join() === "'none'" && directive('base-uri').join() === "'self'" && directive('form-action').join() === "'self'");
check('frames: none (frame-ancestors is not in a report-only policy; browsers ignore it there)', directive('frame-src').join() === "'none'" && directive('frame-ancestors').length === 0);
check('images may come from any https host (answers can embed wiki images), plus data and blob', ['data:', 'blob:', 'https:'].every((s) => directive('img-src').includes(s)));
check('fonts are our own: nothing from Google Fonts is allowed', directive('font-src').join(' ') === "'self' data:" && !/googleapis|gstatic/.test(all['Content-Security-Policy-Report-Only']));
// report-uri, not the newer report-to + Reporting-Endpoints pair: when both are present Chrome uses only report-to,
// whose delivery is batched and was not seen to arrive in testing, while report-uri was seen to post at once.
check('reports go to our endpoint by report-uri (and only that, so one path is in play)', directive('report-uri').join() === '/api/csp-report' && directive('report-to').length === 0 && !('Reporting-Endpoints' in all));
check('the endpoint exists', existsSync(join(ROOT, 'api', 'csp-report.js')));

// Every inline script index.html runs must be hashed, and nothing else.
{
  const have = inlineScriptHashes(html).sort();
  const allowed = directive('script-src').filter((s) => s.startsWith("'sha256-")).sort();
  check('three inline scripts: the redirect, the install listener, the daily-games request', have.length === 3, String(have.length));
  check('script-src carries exactly their hashes (run `node scripts/csp-hashes.mjs` after editing one)', JSON.stringify(have) === JSON.stringify(allowed), `\n have:    ${have.join(' ')}\n allowed: ${allowed.join(' ')}`);
}

// ── The third parties, one by one ──────────────────────────────────────────
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : [p];
  });
}
const SRC = files(join(ROOT, 'src')).filter((f) => /\.(jsx?|css)$/.test(f)).map((f) => read(f.slice(ROOT.length + 1))).join('\n') + '\n' + html;
const connect = directive('connect-src');

// Supabase: the chat's backend and sign-in.
check('Supabase is allowed (https and websocket)', connect.includes('https://*.supabase.co') && connect.includes('wss://*.supabase.co'));
// PostHog and Sentry: both regions, and the SDKs are lazy chunks of our own, so only their endpoints are needed.
check('PostHog: both regions, ingest and assets', ['https://us.i.posthog.com', 'https://eu.i.posthog.com', 'https://us-assets.i.posthog.com', 'https://eu-assets.i.posthog.com'].every((h) => connect.includes(h)));
check('PostHog: its asset hosts may serve scripts', directive('script-src').includes('https://us-assets.i.posthog.com') && directive('script-src').includes('https://eu-assets.i.posthog.com'));
check('Sentry: every ingest region', ['https://*.ingest.sentry.io', 'https://*.ingest.us.sentry.io', 'https://*.ingest.de.sentry.io'].every((h) => connect.includes(h)));
check('both SDKs are lazy imports (their code arrives from our own origin)', /import\('posthog-js'\)/.test(SRC) && /import\('@sentry\/browser'\)/.test(SRC));
// Vercel Web Analytics: one script, from our own origin.
check('Vercel Analytics loads /_vercel/insights/script.js: same origin, so covered by self', /\/_vercel\/insights\/script\.js/.test(SRC) && directive('script-src').includes("'self'"));
// The bot's billing API.
check('the billing API (the bot, on Render) may be fetched', connect.includes('https://gameguide-bot-7cf4.onrender.com'));
check('...and that is the host the docs say the bot lives on', /gameguide-bot-7cf4\.onrender\.com/.test(read('discord-bot', 'PAYMENTS.md')));
// Razorpay, PayPal, Stripe: the plans page only sends people to their hosted checkout (a navigation, which a CSP does not govern). If one of their scripts or frames is ever added, this fails and the policy must grow with it.
check('Razorpay, PayPal and Stripe: no SDK, script or frame on our pages', !/checkout\.razorpay\.com|js\.stripe\.com|paypal\.com\/sdk|paypalobjects\.com|hooks\.stripe\.com|api\.razorpay\.com/.test(SRC));
check('...checkout is a redirect to the provider', /window\.location\.assign\(url\)/.test(read('src', 'components', 'site', 'UpgradePage.jsx')));
// Google Fonts: gone since the fonts became ours.
check('Google Fonts: not used anywhere (fonts are self-hosted)', !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(SRC + read('public', 'manifest.webmanifest')));

// ── Routes and the true 404 ────────────────────────────────────────────────
const rewrites = cfg.rewrites;
const rewriteOf = (source) => rewrites.find((r) => r.source === source)?.destination;
check('no catch-all rewrite: an unknown address is a real 404, served from 404.html', !rewrites.some((r) => /\(\?!|\.\*|\(\.\*\)/.test(r.source) && r.destination === '/index.html'));
const OK_DESTINATION = /^\/(api\/|share-shell\.html$|[a-z]+\/index\.html$)/;
check('every other rewrite points at a page file or a function (no external proxies)', rewrites.every((r) => OK_DESTINATION.test(r.destination)), JSON.stringify(rewrites.filter((r) => !OK_DESTINATION.test(r.destination))));
for (const r of ROUTES) {
  for (const alias of r.aliases) check(`${alias} serves ${r.path} (200, no redirect), as Razorpay's reviewer typed it`, rewriteOf(alias) === `${r.path}/index.html`);
  check(`...and that file is one the build writes (${r.path.slice(1)}/index.html)`, ROUTES.some((x) => x.path === r.path));
}
check('every alias rewrite is in the route table (no strays)', rewrites.filter((r) => /^\/[a-z]+\/index\.html$/.test(r.destination)).every((r) => ROUTES.some((x) => x.aliases.includes(r.source) && `${x.path}/index.html` === r.destination)));
check('every alias in the route table has a rewrite (no gaps)', ROUTES.flatMap((x) => x.aliases).every((a) => rewrites.some((r) => r.source === a)));
check('/share/<payload> goes to the edge function', rewriteOf('/share/:payload') === '/api/share?p=:payload');
check('a bare /share gets the shell, which explains a cut-short link', rewriteOf('/share') === '/share-shell.html');
check('the share function is an edge function', /runtime:\s*'edge'/.test(read('api', 'share.js')));
check('the share function loads the shell the build writes', /share-shell\.html/.test(read('api', 'share.js')));
check('/about/ is /about, not a second page', cfg.trailingSlash === false);
check('/index.html is /', cfg.redirects.some((r) => r.source === '/index.html' && r.destination === '/' && r.permanent));
check('the old preview host still redirects to the real domain', cfg.redirects.some((r) => r.has?.[0]?.value === 'game-guide-ai-plum.vercel.app' && /gameguide\.online/.test(r.destination)));
check('/api/reddit goes through the narrow function, not straight to Reddit', rewriteOf('/api/reddit/:path*') === '/api/reddit?path=:path*');
check('the build writes the pages the routes need', /prerender\.mjs/.test(read('package.json')));

console.log(`security-headers: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
