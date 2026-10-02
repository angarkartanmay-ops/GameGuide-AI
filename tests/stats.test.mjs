// The landing page's live count — the SQL that produces it, run on a real
// Postgres (PGlite), and the helpers that validate and format it. The rule
// under test: real numbers or nothing.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseStats, formatCount, statParts, statSentence, fetchPublicStats, SHOW_FROM_PLAYERS,
} from '../src/site/stats.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MESH = readFileSync(join(ROOT, 'supabase/migrations/20260813_mesh_v3.sql'), 'utf8');
const STATS = readFileSync(join(ROOT, 'supabase/migrations/20261002_public_stats.sql'), 'utf8');
const DISCORD = readFileSync(join(ROOT, 'discord-bot/schema.sql'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; return; }
  fail++; console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
};

// Supabase provides these; the migrations reference them.
const SUPABASE_SHIM = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id UUID PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
`;

async function freshDb({ discord }) {
  const db = await PGlite.create();
  await db.exec(SUPABASE_SHIM);
  await db.exec(MESH);
  if (discord) await db.exec(DISCORD);
  await db.exec(STATS);
  return db;
}

const stats = async (db) => (await db.query('select public.gg_public_stats() as s')).rows[0].s;
const trace = (db, bucket, game) =>
  db.query('insert into gg_request_trace (bucket_key, game) values ($1, $2)', [bucket, game]);
const expire = (db) => db.exec(`update gg_public_stats_cache set computed_at = now() - interval '11 minutes'`);

// ── Empty database: zeros, not an error ────────────────────────────────────
{
  const db = await freshDb({ discord: true });
  const s = await stats(db);
  check('empty db reports zero players', s.players === 0, JSON.stringify(s));
  check('empty db reports zero answers', s.answers === 0);
  check('empty db reports zero games', s.games === 0);
  check('payload carries a timestamp', typeof s.updated_at === 'string');
  check('zero players renders nothing', statParts(parseStats(s)).length === 0);
}

// ── Counting rules, with the Discord table present ─────────────────────────
{
  const db = await freshDb({ discord: true });
  await trace(db, 'ip:aaaaaaaaaaaaaaaaaaaaaaaa', 'Elden Ring');
  await trace(db, 'ip:aaaaaaaaaaaaaaaaaaaaaaaa', 'elden ring ');      // same player, same game
  await trace(db, 'u:6f1d2c9e-0000-4000-8000-000000000001', 'Hades II');
  await trace(db, 'd:123456789012345678', 'Hollow Knight');
  await trace(db, 'd:_global', 'Hollow Knight');                     // limiter bucket, not a player
  await trace(db, 'probe:ip:bbbbbbbbbbbbbbbbbbbbbbbb', null);        // diagnostics, not a player
  await trace(db, 'ip:cccccccccccccccccccccccc', '');                 // no game recognised
  await trace(db, null, null);
  // Discord users: one already traced (must not double count), one only seen
  // by the bot (cache hits are never traced).
  await db.exec(`insert into discord_usage_stats (user_id, total_calls) values
                   (123456789012345678, 5), (987654321098765432, 2)`);

  const s = await stats(db);
  check('players = distinct real callers + Discord-only users', s.players === 5, JSON.stringify(s));
  check('answers counts every traced answer', s.answers === 8, String(s.answers));
  check('games are distinct, case- and space-insensitive', s.games === 3, String(s.games));

  // Cached for ten minutes: new rows don't show until it expires.
  await trace(db, 'ip:dddddddddddddddddddddddd', 'Sekiro');
  const cached = await stats(db);
  check('second call inside 10 minutes is served from cache', cached.players === 5 && cached.answers === 8);
  await expire(db);
  const fresh = await stats(db);
  check('after 10 minutes it recomputes', fresh.players === 6 && fresh.answers === 9 && fresh.games === 4,
    JSON.stringify(fresh));
  check('only one cache row ever exists',
    (await db.query('select count(*)::int c from gg_public_stats_cache')).rows[0].c === 1);

  // The anon key may call the function — and nothing else.
  await db.exec('SET ROLE anon');
  const asAnon = await stats(db);
  check('anon can call gg_public_stats()', asAnon.players === 6);
  let traceDenied = false;
  try { await db.query('select * from gg_request_trace'); } catch { traceDenied = true; }
  check('anon cannot read the request trace', traceDenied);
  let cacheDenied = false;
  try { await db.query('select * from gg_public_stats_cache'); } catch { cacheDenied = true; }
  check('anon cannot read the cache table directly', cacheDenied);
  await db.exec('RESET ROLE');

  check('the payload has only the four public fields',
    JSON.stringify(Object.keys(fresh).sort()) === JSON.stringify(['answers', 'games', 'players', 'updated_at']));
}

// ── Web-only project: no Discord table, still works ────────────────────────
{
  const db = await freshDb({ discord: false });
  await trace(db, 'ip:aaaaaaaaaaaaaaaaaaaaaaaa', 'Terraria');
  await trace(db, 'ip:bbbbbbbbbbbbbbbbbbbbbbbb', 'Terraria');
  const s = await stats(db);
  check('works without discord_usage_stats', s.players === 2 && s.answers === 2 && s.games === 1, JSON.stringify(s));
}

// ── parseStats: real numbers or nothing ────────────────────────────────────
check('accepts a well-formed reply', JSON.stringify(parseStats({ players: 3, answers: 9, games: 2, updated_at: 'x' }))
  === JSON.stringify({ players: 3, answers: 9, games: 2 }));
for (const [label, bad] of [
  ['null', null], ['an array', [1, 2, 3]], ['a string', '12'],
  ['a missing field', { players: 3, answers: 9 }],
  ['a null field', { players: null, answers: 9, games: 2 }],
  ['a negative count', { players: -1, answers: 9, games: 2 }],
  ['a fractional count', { players: 2.5, answers: 9, games: 2 }],
  ['a numeric string', { players: '3', answers: 9, games: 2 }],
  ['NaN', { players: NaN, answers: 9, games: 2 }],
  ['Infinity', { players: Infinity, answers: 9, games: 2 }],
]) check(`rejects ${label}`, parseStats(bad) === null);

// ── formatCount ────────────────────────────────────────────────────────────
check('small numbers are exact', formatCount(7) === '7');
check('thousands get commas', formatCount(1284) === '1,284');
check('9,999 stays exact', formatCount(9999) === '9,999');
check('10,000 compacts to 10k', formatCount(10000) === '10k');
check('12,480 compacts to 12.4k (never rounds up)', formatCount(12480) === '12.4k');
check('999,999 does not round up to 1000k', formatCount(999999) === '999.9k');
check('millions compact', formatCount(1_250_000) === '1.2M');
check('garbage formats to empty', formatCount(-3) === '' && formatCount(NaN) === '');

// ── statParts / statSentence ───────────────────────────────────────────────
const parts = statParts({ players: 1284, answers: 9312, games: 412 });
check('three parts in order', parts.map(p => p.label).join('|') === 'players|answers researched|games');
check('sentence reads naturally', statSentence(parts) === '1,284 players, 9,312 answers researched, 412 games');
check('singulars are singular', statParts({ players: 1, answers: 1, games: 1 }).map(p => p.label).join('|')
  === 'player|answer researched|game');
check('zero answers and games are left out', statParts({ players: 4, answers: 0, games: 0 }).length === 1);
check('below the threshold nothing shows', statParts({ players: SHOW_FROM_PLAYERS - 1, answers: 5, games: 1 }).length === 0);
check('no stats, no parts', statParts(null).length === 0);

// ── fetchPublicStats: never throws, never invents ──────────────────────────
globalThis.sessionStorage = (() => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), clear: () => m.clear() };
})();
const client = (reply, calls = { n: 0 }) => ({ rpc: async (name) => { calls.n++; check('calls gg_public_stats', name === 'gg_public_stats'); return reply; } });

check('an RPC error resolves to null', await fetchPublicStats(client({ data: null, error: { message: 'not found' } })) === null);
check('a malformed reply resolves to null', await fetchPublicStats(client({ data: { players: 'lots' }, error: null })) === null);
check('a throwing client resolves to null',
  await fetchPublicStats({ rpc: () => { throw new Error('boom'); } }) === null);

const calls = { n: 0 };
const t0 = 1_000_000;
const first = await fetchPublicStats(client({ data: { players: 5, answers: 20, games: 3 }, error: null }, calls), t0);
check('a good reply comes through', first?.players === 5 && first?.answers === 20);
const again = await fetchPublicStats(client({ data: { players: 99, answers: 99, games: 99 }, error: null }, calls), t0 + 60_000);
check('within 10 minutes the visit reuses its copy', again?.players === 5 && calls.n === 1);
const later = await fetchPublicStats(client({ data: { players: 6, answers: 22, games: 3 }, error: null }, calls), t0 + 11 * 60_000);
check('after 10 minutes it asks again', later?.players === 6 && calls.n === 2);

sessionStorage.setItem('gg.site.stats', JSON.stringify({ at: t0 * 10, stats: { players: -4, answers: 0, games: 0 } }));
const poisoned = await fetchPublicStats(client({ data: { players: 7, answers: 1, games: 1 }, error: null }), t0 * 10);
check('a tampered cache is ignored, not shown', poisoned?.players === 7);

console.log(`stats: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
