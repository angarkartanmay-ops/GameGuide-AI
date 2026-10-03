# GameGuide launch kit

Everything for launching on Peerlist, Product Hunt, LaunchBuff and Indie Hackers.

## Files

| File | What it is |
|---|---|
| [copy-core.md](copy-core.md) | Taglines, descriptions, "why I built it", tech stack, true failure stories. **Start here.** |
| [peerlist.md](peerlist.md) | Every Launchpad field + the peer-update launch note |
| [product-hunt.md](product-hunt.md) | Listing fields, gallery order, maker's first comment, launch-day checklist |
| [launchbuff.md](launchbuff.md) | Form fields + readiness-checker notes |
| [indie-hackers.md](indie-hackers.md) | Product page + launch story + the follow-up numbers post |
| [social.md](social.md) | X thread, LinkedIn post, WhatsApp blurb, Reddit |
| [demo-video-script.md](demo-video-script.md) | 60-second screen-recording shot list |

## Assets (`assets/`)

| File | Size | Use |
|---|---|---|
| `logo-240.png` | 240×240 | PH thumbnail, LaunchBuff, Peerlist |
| `logo-480.png` | 480×480 | Anywhere that asks for a larger square |
| `logo-512-rounded.png` | 512×512 | App-icon style, with rounded corners |
| `gallery@2x/gallery-1…6-*.png` | 2540×1520 | PH gallery (1270×760 ratio at 2×) |
| `gallery@1x/gallery-1…6-*.png` | 1270×760 | Peerlist, or anywhere with a file-size limit |
| `teaser-24s.mp4` | 1920×1152, 24s | Stand-in video for X/LinkedIn/Peerlist |
| `teaser.gif` | 640px, 2.2 MB | Stand-in PH gallery video slot (under 3 MB) |
| `../public/og.png` | 1200×630 | Already the site's link preview |
| `frames.html` + `raw/` | | Source for the gallery. Edit the copy, open `frames.html?f=1`…`6` at 1270×760 (DPR 2) and re-screenshot |

Gallery order: cover → Spoiler Shield → live answers → toolkit → Discord → mobile.

## Timeline

| When | Action |
|---|---|
| Sat–Sun Oct 3–4 | Fix "Before Monday" below · deploy · verify the Peerlist profile · run the LaunchBuff readiness checker · record the demo video |
| Mon Oct 5 | Peerlist launch + LaunchBuff submission |
| Tue–Thu | Product Hunt (page scheduled in advance) |
| Same week | Indie Hackers story post, X thread, LinkedIn post |
| Following week | Numbers recap (IH post 2), then start Newsmap prep |

---

## Before Monday

Found by using the live site to make the screenshots, then worked through.
Everything below is in the working tree and **goes live only after you
deploy**: push `main` for the website, `supabase functions deploy chat-proxy`
for the backend, and redeploy the Discord bot.

### 🟠 Partly fixed: `/missables` (spoilers and accuracy)

Seen in production: with progress at "beat Margit", the answer named a
late-game area (Crumbling Farum Azula) and an ending item in plain text, with no
bars, and invented rewards (Kenneth Haight doesn't give a "Tears Scarab
talisman"; Gostoc doesn't give a Talisman Pouch).

Fixed:
- The prompt (web + bot) and a new backend shield rule for missables-shaped
  questions say how to phrase a later trigger: "a later boss", with the real name
  in spoiler bars. It also says to stop at the next point of no return, and to
  name only rewards it's sure of. Missables answers also run at a lower temperature.
- A quoted phrase in the first rewrite was read by the backend as the game's
  title ("Later Boss"), which switched the shield off. Caught locally, removed,
  and now covered by a test.

Checked against the local backend: the shield now holds, with later content
barred and nothing past Margit in plain text. **Accuracy is not fixed.** The free
models still invent items in missables lists (one run produced Bloodborne
mechanics). That needs a stronger model or real grounding (a missables source
page in the retrieval), not more prompt text. Until then, keep `/missables` out
of the spotlight. The launch copy and demo script already do.

### ✅ Fixed: answers cut off part-way were delivered as complete

One production reply ended at "### 1. Right" and was sent as final. The stream
adapters now detect a cut (a dropped connection, a Gemini RECITATION/SAFETY stop,
or a content filter) and throw. The mesh tells the browser to `reset` the
partial text and tries the next model. If every model fails, it returns the
longest partial, marked as cut off. Tests are in `tests/stream-cut.test.ts`.
This also fixes an older bug: a model that failed mid-stream used to have the
next model's answer appended after its own.

### ✅ Fixed: `/price` on filtered networks

The web app now asks `/api/price` (a narrow, edge-cached CheapShark proxy) and
falls back to CheapShark directly. Tests are in `tests/price-proxy.test.mjs`.
This can't be verified from this machine because its filter blocks CheapShark;
check it after deploy.

### ✅ Fixed: agentic search model was dead, at a cost on every recency question

Locally, `groq/compound-mini` returns 404 ("does not exist or you do not have
access"). Each recency question paid that failed call before the real answer
began. After a 404, agentic routing now rests for 6 hours, and the status-code
regex that had lost its backslash is fixed. **To do:** check which compound
model id your Groq account serves, and update `GROQ_AGENTIC` in `meshRouter.ts`.
Also seen locally: Cerebras answers 402 "payment required", and Groq's
gpt-oss-120b hits its tokens-per-minute limit quickly. The free tier is thin.

### ⚪ The live counter on the hero

"12 players · 46 answers researched · 15 games" is the live count you merged on
Oct 2. Left as is, since it was a deliberate choice. To hide it until the
numbers grow, raise `SHOW_FROM_PLAYERS` in `src/site/stats.js`.

### ✅ Also fixed in this prep

- The "GameGuide · GameGuide" label on general answers now reads just "GameGuide".
- `/missables` no longer opens with a "📜 The Story So Far" recap (the word
  "story" picked the Loremaster persona).
- `#privacy` URL and a footer Privacy link.
- `/stealth` now has a real effect: the screen drains to monochrome behind a
  scan line, with grain and an "Off the record" bar that has a Leave button.
