// The questions people ask first. One list, read twice: the About page shows
// it, and the build turns it into FAQPage structured data (src/site/seo.js).
// Search engines only accept FAQ markup for questions that are on the page, so
// the two must never be written separately.
//
// Answers are plain text: no markup, so the same string is the visible answer
// and the structured one. Every claim here is stated on another page of the
// site (the plans, the refund policy, the commands), and the numbers come from
// the plans table rather than being typed again.

import { PLANS } from './pricing.js';

const FREE = PLANS.find((p) => p.id === 'free');
const FREE_MESSAGES = FREE.features.find((f) => /messages a day/.test(f)) || '15 messages a day';

export const FAQ = [
  {
    q: 'Is GameGuide free?',
    a: `Yes. The free plan covers ${FREE_MESSAGES} on the web and in Discord, with the Spoiler Shield and missables included. Paid plans raise the limits; they are listed on the plans page.`,
  },
  {
    q: 'Do I need an account?',
    a: 'No account is needed to ask. Sign in with Google if you want your conversation history kept. A Stealth conversation is never saved.',
  },
  {
    q: 'How does the Spoiler Shield work?',
    a: 'Tell GameGuide where you are, for example /progress Elden Ring: beat Margit. Anything from later in the story stays behind a bar until you click it. The shield is on from the start, and /spoilers off turns it off once you have finished.',
  },
  {
    q: 'Where do the answers come from?',
    a: 'GameGuide looks things up when you ask: game wikis, official patch notes and web search. Answers list their sources and follow the current patch rather than last year’s. For a purchase or a choice you cannot undo, check them.',
  },
  {
    q: 'Can I share an answer without spoiling a friend?',
    a: 'Yes. The share button makes a link with the question and answer inside it, and the spoilers stay behind their bars for whoever opens it. Nothing is stored in a database, and the link’s preview never shows the hidden parts.',
  },
  {
    q: 'Does it work in Discord?',
    a: 'Yes. Add the bot to a server, then @mention it or use its slash commands for the same answers as the web. /watch posts a game’s patch notes and best deals into a channel.',
  },
  {
    q: 'Can I cancel a plan or get a refund?',
    a: 'Cancel a monthly or yearly plan at any time and keep what you paid for. In your first 7 days you can have a full refund. The refund policy has the details.',
  },
];
