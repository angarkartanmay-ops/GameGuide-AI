# Peerlist Launchpad: GameGuide

**When:** Monday Oct 5 (the weekly window opens Monday). If you miss it, schedule
a later day that week.
**Before:** verify your personal profile, and add a photo, a bio and at least
one other project. A project with any empty field won't launch, so fill every
field below.

---

## Fields

**Project name:** GameGuide

**Tagline:** The game guide that won't spoil it

**Website:** https://game-guide-ai-plum.vercel.app

**Logo:** `assets/logo-240.png` (or `assets/logo-512-rounded.png` if it asks for larger)

**Images (in this order):**
1. `assets/gallery@1x/gallery-1-cover.png`
2. `assets/gallery@1x/gallery-2-spoiler-shield.png`
3. `assets/gallery@1x/gallery-3-live-answers.png`
4. `assets/gallery@1x/gallery-5-discord.png`
5. `assets/gallery@1x/gallery-6-mobile.png`
6. `assets/gallery@1x/gallery-4-toolkit.png`

**Video:** your 60-second screen recording (see `demo-video-script.md`). Until
you have it, use `assets/teaser-24s.mp4`.

**Categories:** **Games** and **AI**. Two accurate categories beat four loose
ones, and Developer Tools would bring the wrong crowd.

**Tech stack:** React, Vite, GSAP, Supabase, Deno, Vercel, discord.js, Gemini, Groq

**Status:** Live / Public

**Description:**

> Every chatbot will answer a game question, and spoil the ending while it's at it.
>
> GameGuide asks where you are first. Say "I just beat Margit" and story answers
> stop at that line; anything past it sits behind a bar until you click it.
>
> It researches each answer live from wikis, official patch notes and the web,
> so it follows the current patch and shows its sources. It also does missables
> (what you can still lose for good), PC prices against the all-time low,
> screenshot questions, and share links that keep the spoilers hidden for
> whoever opens them.
>
> Free on the web, no account needed. Also a Discord bot that can post a game's
> patch notes and deals into a channel.

---

## Launch note / first comment (peer update, not an ad)

> Hey Peerlist 👋 Launching GameGuide this week, a game guide you can talk to
> that doesn't spoil what you haven't reached.
>
> **What it is:** you tell it where you are in a game, ask anything, and it does
> live research (wikis, patch notes, web) and answers like a strategy guide.
> Story spoilers past your progress go behind a click-to-reveal bar.
>
> **Stack:** React 19 + Vite on Vercel, a Deno edge function on Supabase that
> fans out to several search sources and several LLM providers with automatic
> fallback, and a discord.js bot sharing the same backend.
>
> **What went wrong:** for a while the bot told people real games didn't exist.
> Corrupted regex escapes meant live research never reached the model in
> production, and every local test still passed. The lesson was to test against
> production, not just the code.
>
> **Feedback I want:** pick a game you're partway through, tell it where you
> are, and ask something. Did anything slip past the Shield? Did it get a fact
> wrong? I read everything.

---

## Launch-day routine

- Reply to every comment, ideally within the hour. Peerlist ranks on comments, views and link clicks as well as upvotes.
- Placement is random for the first two days, so don't chase a launch hour.
- Post your Peerlist link once on X/LinkedIn the same day (see `social.md`).
