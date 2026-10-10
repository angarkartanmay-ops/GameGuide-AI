# GameGuide — core launch copy

The source copy every platform file below draws from. Change it here first, then
in the platform files.

**Link:** https://gameguide.online
**Discord invite:** https://discord.com/oauth2/authorize?client_id=1499622566472712202&permissions=277025508352&scope=bot+applications.commands
**top.gg:** https://top.gg/bot/1499622566472712202
**Contact:** gameguideai.support@gmail.com

Items in `[brackets]` are facts only you know. Fill them in or delete them before
posting. Nothing in brackets has been verified.

---

## Name

GameGuide (the repo and the Discord bot are "GameGuide-AI"; use **GameGuide** in
listings, which is what the site and the logo say)

## Taglines (all under 60 characters)

| Use | Tagline | Chars |
|---|---|---|
| **Primary** | The game guide that won't spoil it | 34 |
| Product Hunt (more literal) | A spoiler-safe game guide you can talk to | 41 |
| Alt: problem-first | Game help that stops where you are in the story | 47 |
| Alt: feature-first | Live game answers, spoilers kept behind a bar | 45 |

## One-liner

GameGuide answers any question about any game, researched live from wikis and
patch notes, and stops at where you are in the story.

## Two-sentence description

Ask GameGuide anything about a game: a boss, a build, a quest, whether it's on
sale. It researches the answer live from wikis, patch notes and the web, sets it
out like a strategy guide, and keeps anything past where you are behind a bar.

## Long description (~150 words)

Every general chatbot will answer a game question, and spoil the ending while
it's at it. GameGuide is built around the one thing a player actually needs from
a guide: help from where you are, and nothing past it.

Tell it where you are ("I just beat Margit") and story answers stop at that
line. Anything past it sits behind a click-to-reveal bar.

- **Live research:** it reads wikis, official patch notes and web search when you ask, so answers follow the current patch, with sources.
- **/missables:** what you can still lose for good, starting from where you are.
- **/price:** the best current PC price across 20+ stores, compared with the all-time low.
- **Screenshots:** drop in a build screen or a map and ask about it.
- **Spoiler-safe share links:** your friend sees the answer with the spoilers still hidden.
- **Discord bot:** the same guide in your server, plus patch-note and deal alerts.

Free on the web, and you don't need an account to ask.

## "Why I built this" (draft, so make it yours)

> [The moment: e.g. "I was 30 hours into <game>, asked a chatbot where to find one
> item, and it told me who dies in Act 3."] That's the whole problem. Wikis spoil
> you in the sidebar, videos spoil you in the thumbnail, and chatbots don't know
> where you are, so they tell you everything.
>
> So I built a guide that asks first. You tell it how far you've got, it does the
> research live (wikis, patch notes, the web) so it isn't stuck on last year's
> patch, and it keeps the rest of the story behind a bar until you want it.
>
> I've been building it on my own since April 2026: [CS student in Bengaluru? —
> confirm or remove], about 100 commits, a website and a Discord bot.

## What went wrong (true stories from the git history, good for Peerlist/IH)

- **The bot denied real games existed.** Corrupted regex escapes in the retrieval
  code meant live research silently never reached the model in production. It
  told people real games didn't exist. (commits `5842e60`, `9bb339a`)
- **It agreed with you when you were wrong.** A rule meant to stop it arguing
  about your own screenshots made it accept false corrections: "BG3 came out in
  2024?" "You're right!" It now holds checkable facts and asks.
- **Reddit stopped answering.** Every request returned 403, so that source was
  dropped rather than left to time out. (`b8fa69f`)
- **A billing bug that gave Pro away forever.** Stripe moved a field between API
  versions, and a missing date read as "never expires". Fixed, with 19 regression
  tests. (Only mention this one if you're comfortable talking about billing.)

## Tech stack

React 19 · Vite · GSAP · Supabase (Postgres + Deno Edge Functions) · Vercel ·
discord.js · multiple LLM providers with automatic fallback (Gemini, Groq,
Cerebras, OpenRouter) · CheapShark for prices · Steam for game art

## Categories / tags

Games · Artificial Intelligence · Discord bot · Productivity (secondary) ·
Web app / PWA

## Feedback to ask for (pick one per platform)

1. "Tell me a game and a point you're at, and let me know if anything slipped past the Shield."
2. "Which game did it get wrong? I read every report."
3. "Would your Discord server use the patch-note alerts?"
