# Indie Hackers: GameGuide

Indie Hackers rewards a story, not an announcement. Two posts: one on launch
day, and one about 1–2 weeks later with real numbers.

**Before posting:**
- Create the product page (Products → Add product): name, tagline, URL, logo, description from `copy-core.md`. Link it from your profile.
- Spend a few days commenting on other people's posts. A profile that only self-promotes gets ignored.
- Check the rules of any group you post in. Some restrict promotion.

---

## Post 1 (launch day)

**Title options** (pick one; the first is the strongest):
1. I spent 6 months building a game guide that won't spoil the game. Here's what broke.
2. [CS student in Bengaluru]: launching my first product, a spoiler-safe game guide
3. My AI game guide told people real games didn't exist. Lessons from a solo launch

**Body:**

> I've been building GameGuide on my own since April: a game guide you can talk
> to that doesn't spoil what you haven't reached. It launched on Peerlist and
> Product Hunt this week, and I wanted to write up what actually happened.
>
> **The idea.** Every chatbot will answer a game question, and spoil the ending
> while it's at it. So GameGuide asks where you are first ("I just beat Margit"),
> researches the answer live from wikis and patch notes, and keeps anything past
> your progress behind a bar.
>
> **What broke along the way:**
>
> 1. **It told people real games didn't exist.** Corrupted regex escapes in the
>    retrieval code meant live research never reached the model in production.
>    Every local test passed. Lesson: test against production, not just the code.
> 2. **It agreed with you when you were wrong.** A rule I wrote so it would stop
>    arguing about people's own screenshots made it accept *any* correction.
>    "Wasn't BG3 a 2024 game?" "You're right!" Fixing one failure mode created
>    another, and that happened more than once.
> 3. **A source just died.** Reddit started returning 403 on every request, so I
>    dropped it instead of letting it slow every answer down.
>
> **What it costs to run:** [fill in: hosting, API spend per month]. It runs on a
> fallback chain of several AI providers, so one outage doesn't take it down.
>
> **Where it is now:** [X] people have asked [Y] questions about [Z] games.
> [Use today's numbers.] Free on the web, plus a Discord bot.
>
> **What I'd love feedback on:** would you pay for this? My current thinking is
> the website stays free and Discord servers pay for patch-note alerts and higher
> limits. Does that sound right to you?
>
> 👉 https://gameguide.online

---

## Post 2 (1–2 weeks later)

Write it only once you have the numbers. Structure:

- **Title:** "Launched on 4 platforms in one week. Here are the real numbers."
- Visitors and questions asked per platform (Peerlist / PH / LaunchBuff / IH / Reddit)
- Which one sent people who **came back**, not just clicks
- What users reported, and what you changed because of it
- What flopped, honestly
- What's next (the paid Discord server plan?)

Indie Hackers readers respect small honest numbers far more than vague big ones.
