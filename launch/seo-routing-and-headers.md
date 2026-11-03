# Real addresses, static pages, share previews and security headers

How the site is addressed and served now, what to check after deploying, and
how to move the Content-Security-Policy from report-only to enforced.

## 1. Addresses

| Page | Canonical | Also answers (same page, no redirect) |
|---|---|---|
| Home | `/` | |
| Chat | `/chat` (noindex) | |
| About | `/about` | |
| Terms | `/terms` | `/terms-and-conditions`, `/terms-of-service` |
| Privacy | `/privacy` | `/privacy-policy` |
| Refunds | `/refunds` | `/refund`, `/refund-policy`, `/cancellation`, `/cancellation-policy` |
| Delivery | `/delivery` | `/shipping`, `/shipping-policy`, `/delivery-policy` |
| Contact | `/contacts` | `/contact`, `/contact-us` |
| Plans | `/pricing` | `/upgrade`, `/plans` |
| A shared answer | `/share/<payload>` (noindex) | |

The table lives in `src/site/route.js` (`ROUTES`); `vercel.json` rewrites the
aliases to the canonical page, and `tests/security-headers.test.mjs` fails if
the two disagree. The aliases are the addresses a payment reviewer types
(`/refund-policy`, `/contact-us`), so they keep returning 200 with the page,
and the page's canonical tag names the canonical path.

**Old links.** Anything that used the fragment (`/#about`, `/#upgrade/<token>`,
`/#upgrade/thanks`) is moved to its path by a script at the top of
`index.html` before the app starts. The Discord bot and the payment providers
still send `/#upgrade/...`; that keeps working, and the bot does not need
changing (it would save one redirect if `discord-bot/billingApi.js` and
`upgradeLink.js` said `/pricing#upgrade/...`).

**A share made before this change** (`/#share/<payload>`) stays where it is on
purpose. See section 4.

**Unknown addresses** are a real 404: `vercel.json` has no catch-all rewrite
any more, so the host serves `404.html` with status 404 and the app shows its
"No page here" view over it.

## 2. Static pages (prerender)

`npm run build` is `vite build && node scripts/prerender.mjs`. The second step
writes `dist/<page>/index.html` for every address above, plus `404.html`,
`share-shell.html` and `sitemap.xml`. Each file has its own title,
description, canonical, Open Graph tags, `og:locale`, structured data and the
page's text inside `#root`.

* Visitors with JavaScript never see that text: one rule in the head hides it
  and React replaces it on mount, so the first paint is unchanged (checked:
  LCP is the same as before, 0.78 s in the lab).
* The home page's real headline names today's game (from Steam). The static
  one is "Ask anything about any game.", which the live headline also carries
  for screen readers.
* Text pages are rendered from the same components as the app
  (`src/components/InfoContent.jsx`), so the words cannot differ.
* To add a page: add a row to `ROUTES`, a `VIEW_META` entry, a view in
  `App.jsx`, and (for a text page) an entry in `infoPages.js`. The tests list
  what is missing.

## 3. Structured data

`src/site/seo.js`: Organization (home, About), WebSite and WebApplication
(home), BreadcrumbList (every page but home) and FAQPage (About, from
`src/site/faq.js`, which is also what the About page shows).

* Check a page: <https://search.google.com/test/rich-results> and
  <https://validator.schema.org/>.
* Since 2023 Google shows FAQ rich results only for well-known government and
  health sites, so expect none here. The markup is still valid and other
  search engines and AI crawlers read it.
* The markup is written into each page's HTML at build time. After an in-app
  navigation the document keeps the first page's blocks until a reload. That
  only matters to a crawler that clicks through the app, which none do.

After deploying, in Google Search Console: submit `https://gameguide.online/sitemap.xml`,
and expect the aliases to show as "Alternate page with proper canonical tag".

## 4. Share previews

A new share link is `/share/<payload>`. `api/share.js` (an edge function)
decodes the payload and serves the app's shell with the question as the title
and the safe opening of the answer as the description, so a pasted link
unfurls in Discord, Slack, X and so on. Spoilers (`||...||`) are left out,
the page is `noindex` and has no canonical.

**This is a privacy change.** Links used to carry the answer after the `#`,
which a browser never sends to a server. A path is sent, so Vercel sees it and
its request logs may record it. Nothing is stored by us, the analytics and
crash scrubbers blank `/share/<payload>`, share pages send no referrer, and
the Privacy page says all of this. To go back to private-only links, make
`buildShareUrl` in `src/utils/share.js` return the fragment form always and
delete `api/share.js` and its rewrite.

Payloads over 6,000 characters fall back to the fragment form (no preview).
There is no generated preview image: the card uses `/og.png`. A per-answer
image would need `@vercel/og`; it can be added to `api/share.js` later.

## 5. Security headers

Set in `vercel.json` for every response:

| Header | Value | Mode |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | enforced |
| `Content-Security-Policy` | `frame-ancestors 'none'` | enforced (nothing else in it, so it cannot break a page) |
| `X-Frame-Options` | `DENY` | enforced |
| `Referrer-Policy` | `strict-origin-when-cross-origin`; `no-referrer` on `/share/*` | enforced |
| `Content-Security-Policy-Report-Only` | the full policy | **report-only** |

### Reading the reports

Violations POST to `/api/csp-report`, which logs one JSON line per report
(`{"csp":true,"directive":...,"blocked":...,"page":...}`) without queries,
fragments or share payloads. In Vercel: project > Logs > search `csp`. Group by
`directive` and `blocked`. Browser extensions cause some noise
(`blocked` of `chrome-extension` or `inline` from a source you do not own).

### What was tested, against what

The policy was loaded in Chrome against a production build served with the
same headers, with fake keys so that every SDK started:

| Service | What our pages do | Result |
|---|---|---|
| PostHog | lazy chunk of ours, then `us-assets.i.posthog.com` (config script) and `us.i.posthog.com` | no violations; both regions listed |
| Sentry | lazy chunk of ours, then an envelope to `*.ingest.us.sentry.io` | no violations; US, EU and default ingest listed |
| Vercel Analytics | `/_vercel/insights/script.js`, same origin | no violations |
| Google Fonts | not used: the fonts are ours (`/fonts`) | nothing to allow |
| Razorpay, PayPal, Stripe | nothing: the plans page redirects to their hosted checkout (a navigation, which a CSP does not govern) and they return to `/pricing` | nothing to allow; a test fails if one of their scripts is ever added |
| Supabase | chat backend and sign-in | no violations on `/chat` |
| The bot's billing API | `https://gameguide-bot-7cf4.onrender.com` | listed; the plans page needs it |

A deliberate bad request (a script from another host, an http image) did
raise a report, so the check can fail.

**Not tested:** a real payment, since that happens on the providers' sites; and
real traffic. That is what the report-only period is for.

### Before enforcing

1. Leave it report-only for at least a week with real traffic, and read the log.
2. Anything legitimate in the log goes into `vercel.json` (and the test).
3. If an inline script in `index.html` changes, run `node scripts/csp-hashes.mjs`
   and paste the hashes into `script-src`; the headers test fails until you do.
4. Change the header name from `Content-Security-Policy-Report-Only` to
   `Content-Security-Policy`, and add `frame-ancestors 'none'` to it (it can
   then replace the separate enforced header).
5. Keep `report-uri` for a while after, to see what enforcing breaks.

`style-src` allows `'unsafe-inline'` because React and GSAP set style
attributes; `img-src` allows any `https:` host because answers can embed wiki
images. Both are deliberate.

If the bot moves host, update `connect-src` and `tests/security-headers.test.mjs`.

## 6. After the first deploy

Some behaviour belongs to Vercel and was checked here only against a stand-in
that reads `vercel.json` (`trailingSlash`, page files served at their path,
`404.html` with a 404 status, the edge function behind `/share/...`). Check the
real thing on a preview deployment first:

```
curl -sI https://<preview>/about            # 200, text/html
curl -sI https://<preview>/about/           # 308 to /about
curl -sI https://<preview>/refund-policy    # 200 (not a redirect)
curl -sI https://<preview>/contact-us       # 200
curl -sI https://<preview>/no-such-page     # 404
curl -sI https://<preview>/index.html       # 308 to /
curl -sI https://<preview>/about | grep -i "content-security\|nosniff\|x-frame"
curl -s  https://<preview>/share/<a real link's payload> | grep -i "<title>\|og:description\|noindex"
```

If `/about` is a 404 (page files not found at their path), set
`"cleanUrls": true` and re-test; if the share page is a 404, read the
function's logs (edge runtime errors show there).

