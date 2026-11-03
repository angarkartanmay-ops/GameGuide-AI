// The text pages: heading, lead and body for each. Plain data, so the build
// (scripts/prerender.mjs) and the app (InfoPage.jsx) read the same words.

import { About, Terms, Contact, Refunds, Delivery, NotFound } from './InfoContent';

export const PAGES = {
  about: {
    title: 'About', label: 'About',
    heading: 'A game guide you can talk to.',
    lead: 'Ask about a boss, a build, a quest or a sale. GameGuide researches it live, sets the answer out like a strategy guide, and keeps the story you haven’t reached behind a bar.',
    Body: About,
  },
  terms: {
    title: 'Terms', label: 'Terms & copyright',
    heading: 'Terms of service & copyright.',
    lead: 'The rules for using GameGuide, what it stores and for how long, and how to reach us.',
    meta: 'Last updated: November 2026',
    Body: Terms,
  },
  privacy: {
    title: 'Privacy', label: 'Privacy',
    heading: 'Privacy & terms.',
    lead: 'What GameGuide stores, for how long and who it is shared with, plus the rules for using it.',
    meta: 'Last updated: November 2026',
    Body: Terms,
    start: 't-privacy',
  },
  refunds: {
    title: 'Refunds & cancellation', label: 'Refunds & cancellation',
    heading: 'Refunds & cancellation.',
    lead: 'Cancel any time, keep what you paid for, and a full refund in your first 7 days.',
    meta: 'Last updated: October 2026',
    Body: Refunds,
  },
  delivery: {
    title: 'Delivery', label: 'Delivery',
    heading: 'Delivery policy.',
    lead: 'GameGuide plans are digital: they switch on in Discord within minutes of paying. Nothing is shipped.',
    meta: 'Last updated: October 2026',
    Body: Delivery,
  },
  contacts: {
    title: 'Contact', label: 'Contact',
    heading: 'Contact & connect.',
    lead: 'Questions, partnerships, bug reports or copyright concerns. Pick a channel.',
    Body: Contact,
  },
  notfound: {
    title: 'Not found', label: 'Not found',
    heading: 'No page here.',
    lead: 'The link may be old, or mistyped. These all work.',
    Body: NotFound,
  },
};
