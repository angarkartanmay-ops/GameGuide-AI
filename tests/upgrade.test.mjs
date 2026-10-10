// /upgrade → website plans page → checkout. Viewing your plan is /quota.
//
// Covers the signed link (upgradeLink.js), the plans API the website calls
// (billingApi.js, on a real Express server), the yearly/once price table
// (plans.js) and its website mirror (src/site/pricing.js), the /quota badge
// copy (membership.js), and each provider's interval-aware checkout creator.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOT = join(ROOT, 'discord-bot');
const require = createRequire(join(BOT, 'index.js'));
const express = require('express');
const link = require('./upgradeLink.js');
const plans = require('./plans.js');
const membership = require('./membership.js');
const { createBillingApi, mountBillingApi, availableRails } = require('./billingApi.js');
const rzp = require('./billing-razorpay.js');
const lemon = require('./billing-lemon.js');
const stripeMod = require('./billing-stripe.js');
const site = await import(pathToFileURL(join(ROOT, 'src', 'site', 'pricing.js')).href);

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => { if (cond) { passed++; return; } failed++; console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`); };

const U = '123456789012345678', G = '876543210987654321', SECRET = 'a-long-random-secret-for-tests';
const NOW = 1_800_000_000_000;

// ═══ the signed link ═══════════════════════════════════════════════════════
{
  const t = link.createUpgradeToken({ userId: U, guildId: G, name: 'Tanmay 🎮 <b>' }, { secret: SECRET, now: NOW });
  const p = link.verifyUpgradeToken(t, { secret: SECRET, now: NOW + 1000 });
  check('a fresh link verifies', p?.userId === U && p.guildId === G);
  check('the display name is cleaned of markup and symbols', p?.name === 'Tanmay b');
  check('a wrong secret is refused', link.verifyUpgradeToken(t, { secret: 'other', now: NOW }) === null);
  check('an expired link is refused', link.verifyUpgradeToken(t, { secret: SECRET, now: NOW + (link.TTL_SECONDS + 1) * 1000 }) === null);
  const [v, body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ u: '999999999999999999', g: null, n: 'x', exp: NOW / 1000 + 600 })).toString('base64url');
  check('a payload swapped for someone else is refused', link.verifyUpgradeToken(`${v}.${forged}.${sig}`, { secret: SECRET, now: NOW }) === null);
  check('a tampered signature is refused', link.verifyUpgradeToken(`${v}.${body}.${sig.slice(0, -2)}xx`, { secret: SECRET, now: NOW }) === null);
  check('garbage is refused', link.verifyUpgradeToken('nope', { secret: SECRET }) === null && link.verifyUpgradeToken('', { secret: SECRET }) === null && link.verifyUpgradeToken('v1.a.b', { secret: SECRET }) === null);
  check('an oversized token is refused unread', link.verifyUpgradeToken('v1.' + 'a'.repeat(700) + '.b', { secret: SECRET }) === null);
  check('no secret, no link', link.createUpgradeToken({ userId: U }, { secret: '' }) === '' && link.upgradeUrl({ userId: U }, {}) === '');
  check('a bad user id makes no link', link.createUpgradeToken({ userId: 'abc' }, { secret: SECRET }) === '');
  const url = link.upgradeUrl({ userId: U }, { UPGRADE_LINK_SECRET: SECRET, SITE_URL: 'https://gameguide.example/' }, NOW);
  check('the link lands on #upgrade/<token> of the site', url.startsWith('https://gameguide.example/#upgrade/v1.'));
  check('a non-https SITE_URL falls back to the real site', link.siteUrl({ SITE_URL: 'http://evil.example' }).startsWith('https://gameguide.online'));

  // The website reads (never trusts) the same payload.
  const read = site.readUpgradeToken(t);
  check('the website reads who is buying', read?.name === 'Tanmay b' && read.inServer === true && read.exp === Math.floor(NOW / 1000) + link.TTL_SECONDS);
  check('the website ignores junk tokens', site.readUpgradeToken('x.y.z') === null && site.readUpgradeToken(null) === null);
}

// ═══ prices: yearly, once, and the website's mirror ════════════════════════
{
  check('pro yearly costs ten months', plans.offer('pro', 'year').cents === 4999 && plans.offer('pro', 'year').inr === 3999);
  check('there is no yearly lifetime and no one-off pro', plans.offer('lifetime', 'year') === null && plans.offer('pro', 'once') === null);
  check('labels', plans.priceLabel('pro') === '$4.99/mo' && plans.priceLabel('pro', { interval: 'year' }) === '$49.99/yr'
    && plans.priceLabel('lifetime') === '$39.99 once' && plans.inrLabel('server', { interval: 'year' }) === '₹11,999/yr');
  const env = { STRIPE_PRICE_PRO: 'pm', STRIPE_PRICE_PRO_YEARLY: 'py', STRIPE_PRICE_SERVER: 'sm' };
  check('stripe price per interval', plans.stripePriceFor('pro', 'year', env) === 'py' && plans.stripePriceFor('server', 'year', env) === '');
  check('a yearly price id still maps to pro', plans.planForCheckout({ priceIds: ['py'] }, env) === 'pro');
  check('by amount: a $49.99 yearly Pro is Pro, not a monthly server', plans.planForCheckout({ amountTotal: 4999, mode: 'subscription' }, {}) === 'pro');
  check('by amount: $149.99 is the yearly server', plans.planForCheckout({ amountTotal: 14999, mode: 'subscription' }, {}) === 'server');
  check('by amount: monthly prices still map', plans.planForCheckout({ amountTotal: 499, mode: 'subscription' }, {}) === 'pro' && plans.planForCheckout({ amountTotal: 1499, mode: 'subscription' }, {}) === 'server');
  check('by amount: tax on top is fine', plans.planForCheckout({ amountTotal: 5899, mode: 'subscription' }, {}) === 'pro');
  check('by amount: an amount matching nothing is refused', plans.planForCheckout({ amountTotal: 3000, mode: 'subscription' }, {}) === null);

  // The website shows exactly what the bot charges.
  for (const p of site.PLANS.filter(x => x.offers)) {
    for (const iv of ['month', 'year']) {
      const o = plans.offer(p.id, iv);
      check(`website ${p.id}/${iv} price matches plans.js`, p.offers[iv].usd === o.cents && p.offers[iv].inr === o.inr);
    }
  }
  const life = site.PLANS.find(p => p.id === 'pro').lifetime;
  check('website lifetime price matches plans.js', life.usd === plans.offer('lifetime', 'once').cents && life.inr === plans.offer('lifetime', 'once').inr);
  check('website money formats', site.money(4999, 'usd') === '$49.99' && site.money(11999, 'inr') === '₹11,999' && site.money(0, 'usd') === '$0');
  check('website yearly saving', site.yearlySaving(site.PLANS[1].offers) === 17);
}

// ═══ /quota badge ══════════════════════════════════════════════════════════
{
  const later = new Date(NOW + 20 * 864e5).toISOString();
  const d = (o) => membership.describeMembership({ now: NOW, ...o });
  check('free badge and an upgrade nudge', d({ tier: 'free' }).title === '⚪ FREE' && /\/upgrade/.test(d({ tier: 'free' }).lines.join()));
  check('pro badge with its renewal', d({ tier: 'pro', entitlement: { tier: 'pro', status: 'active', source: 'stripe', current_period_end: later } }).lines[0].startsWith('Renews around <t:'));
  check('a cancelled pro says until when', /Cancelled — Pro stays on until <t:/.test(d({ tier: 'pro', entitlement: { tier: 'pro', status: 'ending', current_period_end: later } }).lines[0]));
  check('a failed payment is flagged', /didn't go through/.test(d({ tier: 'pro', entitlement: { tier: 'pro', status: 'past_due', current_period_end: later } }).lines[0]));
  check('lifetime badge', d({ tier: 'lifetime', entitlement: { tier: 'lifetime', status: 'active', source: 'razorpay' } }).title === '💎 PRO LIFETIME');
  check('server badge', d({ tier: 'server', server: { expires_at: later } }).title === '🌟 PREMIUM SERVER');
  check('a lapsed plan says so', /plan ended/.test(d({ tier: 'free', entitlement: { tier: 'pro', status: 'canceled', current_period_end: new Date(NOW - 864e5).toISOString() } }).lines[0]));
  check('every badge has a colour', Object.values(membership.BADGES).every(b => Number.isInteger(b.color)));
}

// ═══ checkout creators with intervals ═════════════════════════════════════
{
  const calls = [];
  const fetchOk = (resp) => async (url, init) => { calls.push({ url, body: JSON.parse(init.body), headers: init.headers }); return { ok: true, status: 200, json: async () => resp }; };

  const rcfg = rzp.razorpayConfig({ RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w', RAZORPAY_PLAN_PRO: 'plan_pm', RAZORPAY_PLAN_PRO_YEARLY: 'plan_py' });
  await rzp.createCheckout({ plan: 'pro', interval: 'year', userId: U }, { config: rcfg, fetchImpl: fetchOk({ id: 's', short_url: 'https://rzp.io/i/a' }) });
  check('razorpay yearly uses the yearly plan and a 10-cycle cap', calls[0].body.plan_id === 'plan_py' && calls[0].body.total_count === 10);
  check('razorpay offers what has a plan id', JSON.stringify(rzp.razorpayOffers(rcfg)) === JSON.stringify([{ plan: 'lifetime', interval: 'once' }, { plan: 'pro', interval: 'month' }, { plan: 'pro', interval: 'year' }]));
  calls.length = 0;
  await rzp.createCheckout({ plan: 'lifetime', userId: U, callbackUrl: 'https://site/#upgrade/thanks' }, { config: rcfg, fetchImpl: fetchOk({ id: 'p', short_url: 'https://rzp.io/i/b' }) });
  check('razorpay lifetime returns to the site after paying', calls[0].body.callback_url === 'https://site/#upgrade/thanks');

  const lenv = { LEMONSQUEEZY_WEBHOOK_SECRET: 'x', LEMON_VARIANT_PRO: '11', LEMON_VARIANT_PRO_YEARLY: '12', LEMONSQUEEZY_API_KEY: 'key', LEMONSQUEEZY_STORE_ID: '7' };
  const lcfg = lemon.lemonConfig(lenv);
  calls.length = 0;
  const lc = await lemon.createLemonCheckout({ plan: 'pro', interval: 'year', userId: U, redirectUrl: 'https://site/#upgrade/thanks' },
    { config: lcfg, fetchImpl: fetchOk({ data: { attributes: { url: 'https://gameguide.lemonsqueezy.com/checkout/custom/abc' } } }) });
  const lb = calls[0].body.data;
  check('lemon API checkout: yearly variant, server-written buyer, store, return link',
    lb.relationships.variant.data.id === '12' && lb.relationships.store.data.id === '7'
    && lb.attributes.checkout_data.custom.discord_user_id === U && lb.attributes.product_options.redirect_url === 'https://site/#upgrade/thanks'
    && lc.url.includes('lemonsqueezy.com'));
  check('lemon API uses JSON:API and the bearer key', calls[0].headers.Authorization === 'Bearer key' && calls[0].headers['Content-Type'] === 'application/vnd.api+json');
  check('lemon refuses a link off its domain', await lemon.createLemonCheckout({ plan: 'pro', userId: U }, { config: lcfg, fetchImpl: fetchOk({ data: { attributes: { url: 'https://evil.example/x' } } }) }).then(() => false, () => true));
  check('lemon offers yearly when its variant is set', lemon.lemonOffers(lcfg).some(o => o.plan === 'pro' && o.interval === 'year'));
  const noApi = lemon.lemonConfig({ LEMONSQUEEZY_WEBHOOK_SECRET: 'x', LEMON_VARIANT_PRO: '11', LEMON_CHECKOUT_PRO: 'https://s.lemonsqueezy.com/checkout/buy/a' });
  check('without an API key lemon falls back to the buy link', (await lemon.createLemonCheckout({ plan: 'pro', userId: U }, { config: noApi })).url.includes(`discord_user_id]=${U}`));

  const created = [];
  const fakeStripe = { checkout: { sessions: { create: async (args) => { created.push(args); return { url: 'https://checkout.stripe.com/c/pay/cs_1' }; } } } };
  const senv = { STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_SERVER_YEARLY: 'sy', STRIPE_PRICE_LIFETIME: 'pl' };
  await stripeMod.createStripeCheckout({ plan: 'server', interval: 'year', userId: U, guildId: G, successUrl: 's', cancelUrl: 'c' }, { client: fakeStripe, env: senv });
  check('stripe session: subscription, yearly price, server reference written by the server',
    created[0].mode === 'subscription' && created[0].line_items[0].price === 'sy' && created[0].client_reference_id === `g_${G}_${U}`);
  await stripeMod.createStripeCheckout({ plan: 'lifetime', userId: U, successUrl: 's', cancelUrl: 'c' }, { client: fakeStripe, env: senv });
  check('stripe lifetime is a one-off payment for the buyer', created[1].mode === 'payment' && created[1].client_reference_id === `u_${U}`);
  check('stripe offers what has a price', JSON.stringify(stripeMod.stripeOffers(senv)) === JSON.stringify([{ plan: 'server', interval: 'year' }, { plan: 'lifetime', interval: 'once' }]));
  check('stripe refuses an interval with no price', await stripeMod.createStripeCheckout({ plan: 'pro', interval: 'month', userId: U }, { client: fakeStripe, env: senv }).then(() => false, () => true));
}

// ═══ the plans API, over real HTTP ═════════════════════════════════════════
{
  const SITE = 'https://gameguide.example';
  const env = {
    UPGRADE_LINK_SECRET: SECRET, SITE_URL: SITE,
    STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_PRO: 'pm', STRIPE_PRICE_PRO_YEARLY: 'py', STRIPE_PRICE_SERVER: 'sm', STRIPE_PRICE_LIFETIME: 'pl',
    RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w', RAZORPAY_PLAN_PRO: 'plan_pm',
  };
  let tier = 'free';
  let status = 'active';
  const supabase = { from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: tier === 'free' ? null : { tier, status, source: 'stripe', current_period_end: new Date(Date.now() + 864e5).toISOString() } }) }; return q; } };
  const made = [];
  const creators = {
    stripe: async (a) => { made.push(['stripe', a]); return { url: 'https://checkout.stripe.com/c/pay/x' }; },
    lemon: async (a) => { made.push(['lemon', a]); return { url: 'https://x.lemonsqueezy.com/c' }; },
    razorpay: async (a) => { if (a.plan === 'lifetime') throw new Error('razorpay 500: secret internals'); made.push(['razorpay', a]); return { url: 'https://rzp.io/i/x' }; },
  };
  const app = express();
  app.use(express.json());
  check('the API stays off without a link secret', mountBillingApi(express(), { supabase, checkQuota: async () => ({}), env: {} }) === false);
  check('the API mounts with one', mountBillingApi(app, { supabase, env, creators, checkQuota: async () => ({ tier, degraded: false }) }) === true);
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = link.createUpgradeToken({ userId: U, guildId: G, name: 'tanmay' }, { secret: SECRET });
  const dmToken = link.createUpgradeToken({ userId: U, name: 'tanmay' }, { secret: SECRET });
  const post = async (body, origin = SITE) => {
    const res = await fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
  };

  const anon = await fetch(`${base}/api/plans`, { headers: { origin: SITE } });
  const aj = await anon.json();
  check('plans without a link: prices and open rails, nobody signed in', anon.status === 200 && aj.plans.length === 3 && aj.rails.card.provider === 'stripe' && aj.rails.upi.provider === 'razorpay' && aj.buyer === null && aj.account === null);
  check('CORS allows the site', anon.headers.get('access-control-allow-origin') === SITE);
  const other = await fetch(`${base}/api/plans`, { headers: { origin: 'https://evil.example' } });
  check('CORS does not allow other origins', !other.headers.get('access-control-allow-origin'));
  // The host still has the OLD SITE_URL (gameguide.example here stands in for it):
  // the real site must work anyway, and look-alikes must not.
  const real = await fetch(`${base}/api/plans`, { headers: { origin: 'https://gameguide.online' } });
  check('CORS always allows the canonical site, even with a stale SITE_URL', real.headers.get('access-control-allow-origin') === 'https://gameguide.online');
  const lookalike = await fetch(`${base}/api/plans`, { headers: { origin: 'https://gameguide.online.evil.example' } });
  check('CORS does not allow a look-alike of the canonical site', !lookalike.headers.get('access-control-allow-origin'));
  const pre = await fetch(`${base}/api/checkout`, { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'POST' } });
  check('preflight answers 204 for the site', pre.status === 204 && pre.headers.get('access-control-allow-methods')?.includes('POST'));

  const linked = await (await fetch(`${base}/api/plans?t=${encodeURIComponent(token)}`)).json();
  check('plans with a link: who is buying and their current plan', linked.buyer?.name === 'tanmay' && linked.buyer.inServer === true && linked.account?.tier === 'free');
  const stale = await (await fetch(`${base}/api/plans?t=${encodeURIComponent(token.slice(0, -3) + 'abc')}`)).json();
  check('a bad link is reported as expired, not trusted', stale.linkExpired === true && stale.buyer === null && stale.account === null);

  check('checkout without a valid link is refused', (await post({ t: 'x', plan: 'pro', interval: 'month' })).status === 401);
  check('an unknown plan is refused', (await post({ t: token, plan: 'platinum', interval: 'month' })).status === 400);
  check('a yearly pro on UPI (no yearly rupee plan) is unavailable', (await post({ t: token, plan: 'pro', interval: 'year', rail: 'upi' })).json?.error === 'unavailable');
  check('a server plan from a DM link is refused', (await post({ t: dmToken, plan: 'server', interval: 'month' })).json?.error === 'needs-server');

  const ok = await post({ t: token, plan: 'pro', interval: 'year', rail: 'card', u: '999999999999999999' });
  check('a good request returns the checkout URL', ok.status === 200 && ok.json?.url === 'https://checkout.stripe.com/c/pay/x');
  check('…for the buyer in the signed link, whatever the body claims', made[0][1].userId === U && made[0][1].plan === 'pro' && made[0][1].interval === 'year');
  check('…with the site\'s return links', made[0][1].successUrl === `${SITE}/#upgrade/thanks` && made[0][1].cancelUrl.startsWith(`${SITE}/#upgrade/v1.`));
  check('a personal plan carries no server id', made[0][1].guildId === null);
  check('a second request inside the cooldown is slowed', (await post({ t: token, plan: 'pro', interval: 'month' })).status === 429);

  const t2 = link.createUpgradeToken({ userId: '223456789012345678', guildId: G }, { secret: SECRET });
  await post({ t: t2, plan: 'server', interval: 'month', rail: 'card' });
  check('a server plan carries the server from the link', made.at(-1)[1].guildId === G && made.at(-1)[1].plan === 'server');
  const fail = await post({ t: link.createUpgradeToken({ userId: '323456789012345678' }, { secret: SECRET }), plan: 'lifetime', interval: 'once', rail: 'upi' });
  check('a provider failure is a generic 502', fail.status === 502 && JSON.stringify(fail.json) === '{"error":"provider-unavailable"}');

  tier = 'pro';
  const t3 = link.createUpgradeToken({ userId: '423456789012345678' }, { secret: SECRET });
  check('someone already on Pro is not sold Pro again', (await post({ t: t3, plan: 'pro', interval: 'month' })).json?.error === 'already-pro');
  check('…but can go Lifetime', (await post({ t: t3, plan: 'lifetime', interval: 'once' })).status === 200);
  status = 'ending';
  const t4 = link.createUpgradeToken({ userId: '523456789012345678' }, { secret: SECRET });
  check('a cancelled Pro may buy Pro again', (await post({ t: t4, plan: 'pro', interval: 'month' })).status === 200);
  tier = 'lifetime'; status = 'active';
  const t5 = link.createUpgradeToken({ userId: '623456789012345678' }, { secret: SECRET });
  check('a lifetime holder is not sold Pro or Lifetime', (await post({ t: t5, plan: 'lifetime', interval: 'once' })).json?.error === 'already-lifetime');

  check('availableRails prefers Stripe, honours PAYMENT_GLOBAL', availableRails(env).card.provider === 'stripe'
    && availableRails({ ...env, PAYMENT_GLOBAL: 'lemon', LEMONSQUEEZY_WEBHOOK_SECRET: 'x', LEMON_VARIANT_PRO: '1', LEMON_CHECKOUT_PRO: 'https://a.lemonsqueezy.com/b' }).card.provider === 'lemon');
  check('no rails when nothing is configured', JSON.stringify(availableRails({})) === '{"card":null,"upi":null}');
  server.closeAllConnections?.();
  await new Promise(r => server.close(r));
  check('createBillingApi is usable on its own', typeof createBillingApi({ env, checkQuota: async () => ({}) }).plans === 'function');
}

// ═══ test / review sign-in ════════════════════════════════════════════════
{
  const env = { UPGRADE_LINK_SECRET: SECRET, REVIEW_LOGIN_EMAIL: 'Review@Example.com', REVIEW_LOGIN_PASSWORD: 'correct-horse-battery' };
  const app = express();
  app.use(express.json());
  mountBillingApi(app, { supabase: {}, env, checkQuota: async () => ({ tier: 'free' }) });
  const off = express();
  off.use(express.json());
  mountBillingApi(off, { supabase: {}, env: { UPGRADE_LINK_SECRET: SECRET }, checkQuota: async () => ({}) });
  const s1 = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const s2 = await new Promise(r => { const s = off.listen(0, '127.0.0.1', () => r(s)); });
  const login = async (srv, body) => {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/review-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  check('review sign-in is off unless configured', (await login(s2, { email: 'a', password: 'b' })).status === 404);
  const bad = await login(s1, { email: 'review@example.com', password: 'wrong' });
  check('a wrong password is refused without detail', bad.status === 401 && JSON.stringify(bad.json) === '{"error":"bad-login"}');
  const good = await login(s1, { email: '  REVIEW@example.com ', password: 'correct-horse-battery' });
  const p = link.verifyUpgradeToken(good.json?.token, { secret: SECRET });
  check('the right login gets a link for the TEST identity, never a real user', good.status === 200 && p?.userId === '100000000000000001' && p.guildId === '100000000000000002' && p.name === 'Test account');
  let locked = false;
  for (let i = 0; i < 10 && !locked; i++) locked = (await login(s1, { email: 'review@example.com', password: `guess${i}` })).status === 429;
  check('repeated wrong passwords lock the address out', locked);
  check('…even the right password, while locked', (await login(s1, { email: 'review@example.com', password: 'correct-horse-battery' })).status === 429);
  s1.closeAllConnections?.(); s2.closeAllConnections?.();
  await Promise.all([new Promise(r => s1.close(r)), new Promise(r => s2.close(r))]);
}

console.log(`upgrade: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
