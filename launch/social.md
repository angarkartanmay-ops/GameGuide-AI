# Social posts: GameGuide launch week

Link: https://gameguide.online. Attach `assets/teaser-24s.mp4` (or
your real demo) to X and LinkedIn; native video beats a link card.

---

## X / Twitter: launch thread

**1/**
I built a game guide that won't spoil the game.

Tell it where you are ("just beat Margit"), ask anything, and it researches the
answer live and keeps everything past your progress behind a bar.

Free, no account 👇
[video]

**2/**
The problem: ask any chatbot one small question about a game and you might get
the ending in the answer. Wikis spoil you in the sidebar. Nothing asks how far
you've got.

**3/**
What it does:
🛡️ Spoiler Shield: answers stop where you are
🔎 Live research from wikis + patch notes, with sources
🧭 /missables: what you can still lose for good
💸 /price: best PC price vs all-time low
🔗 share links that keep the spoilers hidden

**4/**
Also a Discord bot: same answers in your server, plus /watch to post a game's
patch notes (summarised) and big deals into a channel.

**5/**
Solo project, ~6 months, React + Supabase edge functions + a fallback chain of
AI providers.

It's live on [Product Hunt / Peerlist] today. Feedback welcome, especially if
anything slips past the Shield 🙏
[link]

---

## LinkedIn

> I launched my first product this week: **GameGuide**, a game guide you can
> talk to that doesn't spoil what you haven't reached.
>
> The problem is simple. Ask a general AI chatbot one question about a game
> you're playing and it may tell you the ending. GameGuide asks where you are
> first, researches the answer live from wikis and official patch notes, and
> keeps anything past your progress behind a click-to-reveal bar.
>
> A few things I learned building it solo over six months:
> → **Test against production, not just your code.** For a while my retrieval
> pipeline silently failed in production while every local test passed.
> → **Fixing one failure mode often creates another.** A rule I wrote to stop
> the AI arguing with users made it accept false corrections.
> → **Design for providers failing.** It now falls back across several AI
> providers, so one outage doesn't take it down.
>
> Built with React, Vite, Supabase (Postgres + Deno edge functions), Vercel and
> discord.js.
>
> It's free, with no sign-up: https://gameguide.online
> It's on [Product Hunt / Peerlist] this week. I'd really value your feedback.
>
> #buildinpublic #gamedev #AI #webdevelopment

---

## WhatsApp / college groups (short)

> Hey! I just launched something I've been building for 6 months: GameGuide, a
> game guide that doesn't spoil the game. Tell it where you are and ask anything.
> Free, no sign-up 👉 https://gameguide.online
> It's on Product Hunt today. If you try it, an honest comment there would mean
> a lot 🙏 [PH link]

(Ask for a comment, not an upvote. PH penalises vote requests.)

---

## Reddit (only where self-promotion is allowed)

**r/SideProject** or **r/indiehackers**. Read each sub's rules first.

**Title:** I built a game guide that stops at where you are in the story, so it can't spoil it

> Solo project, ~6 months. You tell it where you are in a game ("just beat
> Margit"), ask anything, and it researches the answer live (wikis, patch notes)
> and puts anything past your progress behind a click-to-reveal bar.
>
> Free, no account: https://gameguide.online
>
> The hardest part wasn't the AI. It was making "stop at this point in the
> story" actually hold. If you try it on a game you know well, I'd love to hear
> where it slips.

For game-specific subreddits (r/Eldenring etc.): **don't post the link cold.**
Most ban self-promotion. Instead, answer people's questions there yourself and
mention the tool only if someone asks how you found the answer.
