// The plans page's copy of the price list, and its two calls to the bot.
//
// Prices are decided in discord-bot/plans.js — the webhooks check payments
// against that file. This is a mirror for the page to render before (or
// without) the network; tests/pricing.test.mjs fails if the two disagree.
// The live list from GET /api/plans wins whenever it arrives.

export const PLANS = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'For trying it on the game you are playing now.',
    features: [
      '15 messages a day',
      '3 screenshot reads a day',
      'Spoiler Shield and /missables',
      'Watchtower: 3 games per server',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For playing every day, and getting it right.',
    features: [
      '200 messages a day',
      '40 screenshot reads and 15 images a day',
      'The most accurate model first on deep questions',
      'Never queued when the free pool is busy',
      'Remembers 24 turns of the conversation',
    ],
    offers: { month: { usd: 499, inr: 399 }, year: { usd: 4999, inr: 3999 } },
    lifetime: { usd: 3999, inr: 3299 },
  },
  {
    id: 'server',
    name: 'Server',
    tagline: 'For a whole community, on one plan.',
    features: [
      '60 messages a day for every member',
      '800 shared each day across the server',
      'Watchtower: 25 games with patch and deal alerts',
      'Priority routing for everyone in it',
    ],
    offers: { month: { usd: 1499, inr: 1199 }, year: { usd: 14999, inr: 11999 } },
  },
];

/** "$4.99" / "₹3,999" from minor-unit USD cents or whole rupees. */
export function money(amount, currency) {
  if (!Number(amount)) return currency === 'inr' ? '₹0' : '$0';
  if (currency === 'inr') return `₹${Number(amount).toLocaleString('en-IN')}`;
  return `$${(Number(amount) / 100).toFixed(2)}`;
}

/** What a yearly plan saves against twelve months, as a whole percentage. */
export function yearlySaving(offers, currency = 'usd') {
  const m = offers?.month?.[currency];
  const y = offers?.year?.[currency];
  if (!m || !y) return 0;
  return Math.round((1 - y / (m * 12)) * 100);
}

/**
 * Read (not verify) the payload of a /upgrade link: who is buying, for the
 * greeting and the expiry countdown. The bot verifies the signature before it
 * creates any checkout, so nothing here is trusted for money.
 */
export function readUpgradeToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  try {
    const bin = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    if (!p || typeof p.u !== 'string' || !Number.isFinite(p.exp)) return null;
    return { name: typeof p.n === 'string' ? p.n.slice(0, 32) : '', inServer: !!p.g, exp: p.exp };
  } catch {
    return null;
  }
}

// The bot's public address (its billing API). Unset = the page shows prices
// but cannot take payment yet.
const API = (import.meta.env?.VITE_BILLING_API_URL || '').replace(/\/+$/, '');
export const billingOpen = () => !!API;

/** Live prices, open payment methods and, with a token, who is buying and their plan. */
export async function fetchPlans(token, { signal } = {}) {
  if (!API) return null;
  const q = token ? `?t=${encodeURIComponent(token)}` : '';
  const res = await fetch(`${API}/api/plans${q}`, { signal });
  if (!res.ok) throw new Error(`plans ${res.status}`);
  return res.json();
}

/** Ask the bot for a checkout; resolves to its URL or rejects with the API's error code. */
export async function startCheckout({ token, plan, interval, rail }) {
  if (!API) throw new Error('closed');
  const res = await fetch(`${API}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ t: token, plan, interval, rail }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.url !== 'string') throw new Error(data.error || `checkout ${res.status}`);
  return data.url;
}

/** Email sign-in for test / review accounts; resolves to an upgrade token. */
export async function signIn(email, password) {
  if (!API) throw new Error('closed');
  const res = await fetch(`${API}/api/review-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.token !== 'string') throw new Error(data.error || `sign-in ${res.status}`);
  return data.token;
}

/** Plain words for the API's error codes. */
export const CHECKOUT_ERRORS = {
  'link-expired': 'This upgrade link has expired. Run /upgrade in Discord for a fresh one.',
  'needs-server': 'Open /upgrade from inside the server you want to upgrade, so the link knows which server it is.',
  'already-pro': 'You already have Pro. To go yearly, cancel the monthly plan from your receipt email and pick yearly once it ends. Or go Lifetime now.',
  'already-lifetime': 'You already have Pro Lifetime, so there is nothing more to buy. Thank you!',
  'server-already-premium': 'This server already has the Server plan.',
  unavailable: 'That option is not available with this payment method. Try the other one.',
  'slow-down': 'One moment. Your last checkout is still being made.',
  'provider-unavailable': 'The payment provider did not answer. Please try again in a minute.',
};
