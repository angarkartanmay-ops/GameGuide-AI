# Search consoles, analytics and crash reports

The site is already wired for all four. Each stays off until you paste its value
into Vercel, so there is nothing to change in code. About 15 minutes in total.

**Where values go:** Vercel → project `game-guide-ai` → Settings → Environment
Variables → add for **Production** (and Preview if you want it there).
**Then redeploy** (Deployments → ⋯ on the latest → Redeploy): `VITE_*` values are
baked in at build time, so changing one does nothing until a new build.

| Tool | Variable | Where the value comes from |
|---|---|---|
| Google Search Console | `VITE_GSC_VERIFICATION` | step 1 |
| Bing Webmaster Tools | `VITE_BING_VERIFICATION` | step 2 (optional, see below) |
| PostHog | `VITE_POSTHOG_KEY` (+ `VITE_POSTHOG_HOST` if EU) | step 3 |
| Sentry | `VITE_SENTRY_DSN` | step 4 |

## 1. Google Search Console

1. <https://search.google.com/search-console> → **Add property** → **URL prefix** →
   `https://game-guide-ai-plum.vercel.app/` (a `vercel.app` subdomain can't be verified
   as a Domain property, because that needs DNS you don't control).
2. Choose **HTML tag**. Copy only the `content="…"` value (not the whole tag).
3. Add it as `VITE_GSC_VERIFICATION`, redeploy, then press **Verify**.
4. **Sitemaps** → submit `sitemap.xml`.
5. **URL Inspection** → paste the home URL → **Request indexing**.

## 2. Bing Webmaster Tools

<https://www.bing.com/webmasters> → sign in → **Import from Google Search Console**.
It reuses the verification from step 1 and brings the sitemap with it, so
`VITE_BING_VERIFICATION` is not needed. Only if you add the site by hand: choose
**HTML Meta Tag**, copy the `content` of `msvalidate.01`, set `VITE_BING_VERIFICATION`,
redeploy, verify.

## 3. PostHog

1. <https://posthog.com> → sign up → pick the **US** or **EU** region → create a project.
2. Project settings → **Project API key** (starts `phc_`) → `VITE_POSTHOG_KEY`.
   EU region also needs `VITE_POSTHOG_HOST=https://eu.i.posthog.com`.
3. Project settings → turn **on** "Discard client IP data" (the site never needs it).
4. Events the app sends: `press_start`, `missables`, `share_created`, `share_opened`,
   `share_broken`, plus `$pageview`. The launch funnel is
   `$pageview → press_start → share_created → share_opened`.

Deliberately off: cookies and storage, autocapture, session recording, anything while
Stealth is on. Tested in `tests/privacy.test.mjs`.

## 4. Sentry

1. <https://sentry.io> → create an organisation → **Create Project** → **Browser JavaScript**
   (not React, not Next.js).
2. Copy the **DSN** → `VITE_SENTRY_DSN`.
3. Alerts: Sentry's default "new issue" email is enough for launch week.

Stack traces will show minified names until source maps are uploaded (a separate
step needing a Sentry auth token). It is not needed to see *what* broke or how often.

## Checking it works

Open the live site, then:

- **Search Console:** the Verify button turns green.
- **PostHog:** Activity → Live events shows a `$pageview` within seconds.
- **Sentry:** in the browser console run
  `setTimeout(() => { throw new Error('sentry-test') })` and the issue appears in about a minute.
- **View source** on the site: you should see `google-site-verification` in the `<head>`.

## If you ever add a custom domain

The domain is written into `index.html` (canonical, Open Graph, JSON-LD),
`public/sitemap.xml` and `public/robots.txt`. Change those, add the new domain as
its own Search Console property, and use a **Domain** property (DNS verification).
