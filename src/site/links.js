// Every external link the site shows, in one place. The landing, the info
// pages and the footer all import from here, so an address changes once.
//
// The Discord invite asks for the minimal permission set only — View
// Channel, Send Messages, Send Messages in Threads, Embed Links, Attach
// Files, Read Message History, Use Application Commands. The discord-launch
// test decodes this exact literal, so build it as one string, never from parts.

export const LINKS = {
  email: 'gameguideai.support@gmail.com',
  linkedin: 'https://www.linkedin.com/in/tanmay-angarkar-4b8a47319/',
  github: 'https://github.com/angarkartanmay-ops',
  discordInvite: 'https://discord.com/oauth2/authorize?client_id=1499622566472712202&permissions=277025508352&scope=bot+applications.commands',
  topgg: 'https://top.gg/bot/1499622566472712202?s=0c09d3395142b',
  // Launch listings. The badge images are served by each platform, so their
  // listing owner can verify the badge is on the live site.
  launchbuff: 'https://launchbuff.com/products/gameguide-f9fwfb',
  launchbuffBadge: 'https://launchbuff.com/badge-featured-dark.svg',
  productHunt: 'https://www.producthunt.com/products/gameguide-ai?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-gameguide-ai',
  productHuntBadge: 'https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1268238&theme=dark&t=1791088470703',
};

export const mailto = (subject) =>
  `mailto:${LINKS.email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
