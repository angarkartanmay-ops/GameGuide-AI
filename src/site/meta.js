// Per-view <title>, description and canonical, set from JavaScript.
//
// An interim step. The app routes on the hash, so to a crawler every view is
// the same document at "/": the static tags in index.html describe the home
// page, and anything that renders JavaScript (search engines that do, a tab
// title, a bookmark, a share sheet) gets the view's own. Canonicals use the
// plain paths index.html already forwards (/terms, /refund-policy, ...).
// Real per-view URLs plus prerendering would replace all of this.
//
// Pure data plus one small DOM writer, so tests can check every string, and
// check that the landing's entry here is exactly what index.html says.

export const ORIGIN = 'https://gameguide.online';

export const VIEW_META = {
  landing: {
    title: 'GameGuide: ask anything about any game',
    description: "A game guide you can talk to. Live answers from wikis, patch notes and the web, set like a strategy guide. It won't spoil what you haven't reached. Free on the web and in Discord.",
    share: 'Live answers, set like a strategy guide, that stop where you are in the story.',
    path: '/',
  },
  chat: {
    title: 'Chat | GameGuide',
    description: 'Ask GameGuide about any game. Live answers from wikis, patch notes and the web that stop where you are in the story.',
    path: '/',
  },
  about: {
    title: 'About | GameGuide',
    description: 'How GameGuide researches answers from wikis, patch notes and the web, keeps spoilers behind a Spoiler Shield, and who builds it.',
    path: '/about',
  },
  terms: {
    title: 'Terms and copyright | GameGuide',
    description: 'The terms of use, copyright notice and acceptable-use rules for GameGuide.',
    path: '/terms',
  },
  privacy: {
    title: 'Privacy | GameGuide',
    description: 'What GameGuide stores, for how long and who it is shared with, on the web and in the Discord bot.',
    path: '/privacy',
  },
  refunds: {
    title: 'Refunds and cancellation | GameGuide',
    description: 'Cancel any GameGuide plan at any time, keep what you paid for, and get a full refund in your first 7 days.',
    path: '/refund-policy',
  },
  delivery: {
    title: 'Delivery | GameGuide',
    description: 'GameGuide plans are digital and switch on in Discord within minutes of paying. Nothing is shipped.',
    path: '/delivery-policy',
  },
  contacts: {
    title: 'Contact | GameGuide',
    description: 'Email, Discord and GitHub for questions, partnerships, bug reports and copyright concerns.',
    path: '/contact-us',
  },
  upgrade: {
    title: 'Plans and pricing | GameGuide',
    description: 'Plans and pricing for GameGuide, monthly, yearly or once. A plan stays on until the end of what you paid for.',
    path: '/pricing',
  },
  // What someone shared is theirs, and lives in the link's fragment: never indexed.
  share: {
    title: 'Shared answer | GameGuide',
    description: 'An answer someone shared from GameGuide. Spoilers stay hidden until you press them.',
    path: '/',
    robots: 'noindex',
  },
  // No canonical: there is no page to point at.
  notfound: {
    title: 'Page not found | GameGuide',
    description: 'That page does not exist. Open GameGuide, or head back to the home page.',
    path: null,
    robots: 'noindex',
  },
};

const MAX_TITLE = 70;

/** The meta for a view, optionally with fields replaced. Unknown views get the landing's. */
export function metaFor(view, overrides = {}) {
  const base = VIEW_META[view] || VIEW_META.landing;
  const meta = { ...base, ...overrides };
  meta.title = String(meta.title).slice(0, MAX_TITLE);
  return meta;
}

/** The absolute canonical URL, or null when the view has none. */
export const canonicalUrl = (meta) => (typeof meta.path === 'string' ? `${ORIGIN}${meta.path}` : null);

function tag(doc, selector, make) {
  let el = doc.head.querySelector(selector);
  if (!el) {
    el = make();
    doc.head.appendChild(el);
  }
  return el;
}

function metaTag(doc, attr, key) {
  return tag(doc, `meta[${attr}="${key}"]`, () => {
    const el = doc.createElement('meta');
    el.setAttribute(attr, key);
    return el;
  });
}

/** Write a view's meta into the document head. Safe to call again and again. */
export function applyMeta(meta, doc = document) {
  const url = canonicalUrl(meta);
  const social = meta.share || meta.description;

  doc.title = meta.title;
  metaTag(doc, 'name', 'description').setAttribute('content', meta.description);

  const canonical = doc.head.querySelector('link[rel="canonical"]');
  if (url) {
    tag(doc, 'link[rel="canonical"]', () => {
      const el = doc.createElement('link');
      el.setAttribute('rel', 'canonical');
      return el;
    }).setAttribute('href', url);
  } else canonical?.remove();

  // Share cards read these; only touch the ones the page already has.
  const set = (selector, value) => doc.head.querySelector(selector)?.setAttribute('content', value);
  set('meta[property="og:title"]', meta.title);
  set('meta[property="og:description"]', social);
  if (url) set('meta[property="og:url"]', url);
  set('meta[name="twitter:title"]', meta.title);
  set('meta[name="twitter:description"]', social);

  const robots = doc.head.querySelector('meta[name="robots"]');
  if (meta.robots) metaTag(doc, 'name', 'robots').setAttribute('content', meta.robots);
  else robots?.remove();
}
