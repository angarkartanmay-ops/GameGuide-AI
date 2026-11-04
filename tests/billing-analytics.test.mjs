// Server-side conversion event: billing-core → discord-bot/analytics.js.
//
// The website cannot see a payment complete (it happens on the provider's
// page), so the bot reports `subscription_activated` from the webhook. These
// checks pin: once per new plan (never on renewals or "already covered"), no
// Discord/guild ids or provider refs in the payload, off without a key, and a
// failing PostHog never breaks a grant.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDb } from './helpers/fake-supabase.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'discord-bot');
const require = createRequire(join(ROOT, 'index.js'));
const core = require('./billing-core.js');
const { serverAnalytics, digestUuid } = require('./analytics.js');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => { if (cond) { passed++; return; } failed++; console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`); };
const silent = { log() {}, warn() {}, error() {} };

const U = '123456789012345678', U2 = '223456789012345678', G = '876543210987654321';
const end = (days = 30) => new Date(Date.now() + days * 864e5).toISOString();

function world() {
  const db = makeDb();
  const repo = core.supabaseRepo(db);
  const events = [];
  const capture = (event, props, opts) => events.push({ event, props, opts });
  const c = core.createBillingCore({ repo, notify: async () => {}, capture, log: silent });
  return { db, c, events };
}

// ── when it fires ──────────────────────────────────────────────────────────
{
  const w = world();
  await w.c.grant({ source: 'razorpay', plan: 'base', userId: U, providerRef: 'rzp:sub_1', periodEnd: end() });
  check('a new plan fires one subscription_activated', w.events.length === 1 && w.events[0].event === 'subscription_activated');
  check('payload: plan + source + upgrade flag', w.events[0].props.plan === 'base' && w.events[0].props.source === 'razorpay' && w.events[0].props.upgrade === false);

  await w.c.grant({ source: 'razorpay', plan: 'base', userId: U, providerRef: 'rzp:sub_1', periodEnd: end(60) });
  check('a renewal does not fire again', w.events.length === 1);

  await w.c.grant({ source: 'razorpay', plan: 'pro', userId: U, providerRef: 'rzp:sub_2', periodEnd: end() });
  check('Base → Pro fires, marked as an upgrade', w.events.length === 2 && w.events[1].props.plan === 'pro' && w.events[1].props.upgrade === true);

  await w.c.grant({ source: 'razorpay', plan: 'base', userId: U, providerRef: 'rzp:sub_3', periodEnd: end() });
  check('"already covered" (no change) does not fire', w.events.length === 2);

  await w.c.grant({ source: 'razorpay', plan: 'server', userId: U2, guildId: G, providerRef: 'rzp:sub_4', periodEnd: end() });
  check('a server plan fires once', w.events.length === 3 && w.events[2].props.plan === 'server');
  await w.c.grant({ source: 'razorpay', plan: 'server', userId: U2, guildId: G, providerRef: 'rzp:sub_4', periodEnd: end(60) });
  check('a server renewal does not fire', w.events.length === 3);

  check('bad user id fires nothing', await w.c.grant({ source: 'x', plan: 'pro', userId: 'abc', providerRef: 'r9' }) === 'invalid' && w.events.length === 3);

  const blob = JSON.stringify(w.events.map(e => e.props));
  check('no Discord ids, guild ids or provider refs in properties', !blob.includes(U) && !blob.includes(U2) && !blob.includes(G) && !blob.includes('rzp:'));
}

// ── the HTTP side ──────────────────────────────────────────────────────────
{
  check('off without POSTHOG_KEY (no fetch at all)', (() => {
    let called = false;
    serverAnalytics({ env: {}, fetchImpl: () => { called = true; } })('x', {});
    return !called;
  })());

  const sent = [];
  const send = serverAnalytics({ env: { POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://eu.i.posthog.com/' }, fetchImpl: async (url, init) => { sent.push({ url, init }); return { ok: true }; }, log: silent });
  send('subscription_activated', { plan: 'pro' }, { dedupeKey: 'rzp:sub_1:pro' });
  const body = JSON.parse(sent[0].init.body);
  check('posts to the configured host capture endpoint', sent[0].url === 'https://eu.i.posthog.com/i/v0/e/' && sent[0].init.method === 'POST');
  check('carries the key, event and properties', body.api_key === 'phc_test' && body.event === 'subscription_activated' && body.properties.plan === 'pro');
  check('no person profile, random distinct id', body.properties.$process_person_profile === false && /^[0-9a-f-]{36}$/.test(body.distinct_id));
  check('dedupe uuid is a one-way digest, stable per ref', body.uuid === digestUuid('rzp:sub_1:pro') && !body.uuid.includes('sub_1') && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/.test(body.uuid));

  // A dead PostHog (sync throw or rejected promise) must not reach the grant.
  const db = makeDb();
  const throwing = serverAnalytics({ env: { POSTHOG_KEY: 'k' }, fetchImpl: () => { throw new Error('boom'); }, log: silent });
  const rejecting = serverAnalytics({ env: { POSTHOG_KEY: 'k' }, fetchImpl: () => Promise.reject(new Error('down')), log: silent });
  const c1 = core.createBillingCore({ repo: core.supabaseRepo(db), notify: async () => {}, capture: throwing, log: silent });
  const c2 = core.createBillingCore({ repo: core.supabaseRepo(makeDb()), notify: async () => {}, capture: rejecting, log: silent });
  check('fetch that throws: grant still succeeds', await c1.grant({ source: 'razorpay', plan: 'pro', userId: U, providerRef: 'rzp:a', periodEnd: end() }) === 'pro');
  check('fetch that rejects: grant still succeeds', await c2.grant({ source: 'razorpay', plan: 'pro', userId: U, providerRef: 'rzp:b', periodEnd: end() }) === 'pro');
  await new Promise(r => setTimeout(r, 10));
}

console.log(`billing-analytics: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
