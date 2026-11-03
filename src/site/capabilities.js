// The capability list on the landing page ("04 Loadout") and in its static
// fallback (scripts/prerender.mjs). Plain data, so both read the same words.

// Only things the product does today — each "try" is a real command or a
// question that works as written.
export const CAPABILITIES = [
  {
    id: 'research', label: 'Live research', hint: 'Wikis, patch notes, web',
    body: 'Every answer is researched when you ask. It reads game wikis, official patch notes and the web, weighs them against each other, and lists the sources so you can check.',
    tries: ['What changed in the latest Helldivers 2 patch?'],
  },
  {
    id: 'shield', label: 'Spoiler Shield', hint: 'Answers stop where you are',
    body: 'Say how far you have played and story answers stay on your side of that line. Anything past it sits under a bar until you choose to look.',
    tries: ['/progress Elden Ring: beat Margit', '/spoilers off'],
  },
  {
    id: 'missables', label: 'Missables', hint: 'Before the point of no return',
    body: 'What can you still lose for good: items, questlines, trophies, one-time choices. Listed in the order you will reach them, starting from where you are and spoiling nothing after it.',
    tries: ['/missables Elden Ring'],
  },
  {
    id: 'vision', label: 'Screenshot reading', hint: 'Up to three per message',
    body: 'Drop in a build screen, a map or a puzzle and ask about what is in it. Up to three screenshots in one message.',
    tries: ['Attach a screenshot, then: "What should I upgrade next?"'],
  },
  {
    id: 'price', label: 'Deals', hint: '/price',
    body: 'Checks PC storefronts for the best current price on a game and how it compares with its lowest ever.',
    tries: ['/price Hades II'],
  },
  {
    id: 'discover', label: 'Discover', hint: '/discover',
    body: 'A random pro tip, a hidden detail or a piece of lore, for the minutes between matches.',
    tries: ['/discover'],
  },
  {
    id: 'stealth', label: 'Stealth', hint: 'Nothing saved',
    body: 'A throwaway conversation: nothing saved, nothing remembered, no art looked up. Leave it and it is gone.',
    tries: ['/stealth'],
  },
  {
    id: 'share', label: 'Share it', hint: 'Spoilers stay hidden',
    body: 'Send an answer to a friend who is behind you. The link opens it with every spoiler still under its bar. The answer travels inside the link itself, so nothing is stored on our side.',
    tries: ['Share under any answer'],
  },
];
