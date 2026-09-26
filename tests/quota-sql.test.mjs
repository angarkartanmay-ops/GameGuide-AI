// Discord freemium quota - SQL integration.
//
// Runs the real migrations against a real Postgres (PGlite is Postgres 18
// compiled to WASM, with plpgsql) and exercises gg_discord_quota_check exactly
// as the bot calls it. The money-critical path deserves more than a review:
// the first run of this suite caught an ordering bug where a user out of
// messages for the day was told to "wait a minute" instead.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'discord-bot');
const db = await PGlite.create();

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; return; }
  fail++; console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
};

// Supabase-provided roles that schema.sql / schema-v3.sql reference.
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');

await db.exec(readFileSync(`${ROOT}/schema.sql`, 'utf8'));
console.log('schema.sql      applied');
await db.exec(readFileSync(`${ROOT}/schema-v3.sql`, 'utf8'));
console.log('schema-v3.sql   applied');

const q = async (user, { guild = null, kind = 'chat', dry = false } = {}) => {
  const r = await db.query(
    'select public.gg_discord_quota_check($1::bigint, $2::bigint, $3::text, $4::boolean) as d',
    [String(user), guild ? String(guild) : null, kind, dry]);
  return r.rows[0].d;
};
const events = async (user) =>
  Number((await db.query('select count(*)::int c from discord_usage_events where user_id=$1', [String(user)])).rows[0].c);
// Seed prior usage OUTSIDE the 60s burst window. A real user spreads 15
// messages over a day; a test loop fires them in milliseconds and would trip
// the burst limit long before the daily cap it means to exercise.
const seed = async (user, n, kind = 'chat') => {
  if (n <= 0) return;
  await db.exec(`insert into discord_usage_events (user_id, kind, created_at)
                 select ${user}, '${kind}', now() - interval '5 minutes' from generate_series(1,${n})`);
};
const grant = async (user, credits = 10) =>
  (await db.query('select public.gg_discord_grant_bonus($1::bigint,$2,24,20,$3) as r',
    [String(user), credits, 'topgg-vote'])).rows[0].r;

// -- FREE: exactly 15 messages, then refused --------------------------------
const U = '111111111111111111';
await seed(U, 14);
const last = await q(U);
check('free tier resolved', last.tier === 'free', last.tier);
check('15th message allowed', last.allowed === true);
check('counter reads 15/15', last.messages.used === 15 && last.messages.limit === 15);
check('remaining hits zero', last.messages.remaining === 0);

const sixteenth = await q(U);
check('16th message refused', sixteenth.allowed === false);
check('refusal scope is day', sixteenth.scope === 'day', sixteenth.scope);
check('reset_at is exposed', typeof sixteenth.reset_at === 'string');
check('retry_after runs to midnight', sixteenth.retry_after > 0 && sixteenth.retry_after <= 86400);

// The count-before-insert guarantee: a refused caller must not be charged.
check('blocked request records nothing', await events(U) === 15, `${await events(U)} events`);
await q(U); await q(U);
check('hammering does not extend the penalty', await events(U) === 15);

// -- Vision sub-cap, independent of the message cap -------------------------
const V = '222222222222222222';
for (let i = 0; i < 3; i++) {
  check(`vision ${i + 1} admitted`, (await q(V, { kind: 'vision' })).allowed === true);
}
const v4 = await q(V, { kind: 'vision' });
check('4th screenshot refused', v4.allowed === false);
check('refused on the vision scope', v4.scope === 'vision', v4.scope);
const stillChat = await q(V, { kind: 'chat' });
check('text still works once vision is spent', stillChat.allowed === true);
check('a vision turn also cost a message', stillChat.messages.used === 4, String(stillChat.messages.used));

// -- Bonus credits: spent BEFORE refusing, never granted past the cap -------
const B = '333333333333333333';
await seed(B, 15);
check('B is out of daily allowance', (await q(B)).allowed === false);

const g1 = await grant(B);
check('vote grants 10 credits', g1.granted === 10 && g1.balance === 10, JSON.stringify(g1));

const withBonus = await q(B);
check('bonus revives a spent-out user', withBonus.allowed === true);
check('flagged as a bonus turn', withBonus.used_bonus === true);
check('balance decremented', withBonus.bonus_credits === 9, String(withBonus.bonus_credits));

const g2 = await grant(B);
check('second vote tops up toward the cap', g2.balance === 19, String(g2.balance));
const g3 = await grant(B);
check('cap holds against vote farming', g3.balance === 20 && g3.granted === 1, JSON.stringify(g3));

// -- Paid tiers -------------------------------------------------------------
const P = '444444444444444444';
await db.exec(`insert into discord_entitlements (user_id, tier, source, status) values (${P}, 'pro', 'stripe', 'active')`);
const p1 = await q(P);
check('pro tier resolved', p1.tier === 'pro', p1.tier);
check('pro gets 200/day', p1.messages.limit === 200);
check('pro gets 20/min burst', p1.burst.limit === 20);
check('pro gets priority', p1.limits.priority === true);
check('pro gets 24 context turns', p1.limits.context_turns === 24);

const E = '555555555555555555';
await db.exec(`insert into discord_entitlements (user_id, tier, source, status, current_period_end)
               values (${E}, 'pro', 'stripe', 'active', now() - interval '1 day')`);
check('lapsed subscription reverts to free', (await q(E)).tier === 'free');

const C = '666666666666666666';
await db.exec(`insert into discord_entitlements (user_id, tier, source, status) values (${C}, 'pro', 'stripe', 'canceled')`);
check('canceled status reverts to free', (await q(C)).tier === 'free');

// -- Burst window -----------------------------------------------------------
const S = '777777777777777777';
let burst;
for (let i = 0; i < 5; i++) burst = await q(S);
check('5 in a minute allowed on free', burst.allowed === true);
const sixth = await q(S);
check('6th within the minute refused', sixth.allowed === false);
check('burst scope reported', sixth.scope === 'minute', sixth.scope);
check('burst retry is 60s', sixth.retry_after === 60);

// -- Guild tier + shared pool ----------------------------------------------
const G = '999999999999999999', M1 = '888888888888888881', M2 = '888888888888888882';
await db.exec(`insert into discord_premium_servers (guild_id) values (${G})`);
const gm = await q(M1, { guild: G });
check('guild premium resolved', gm.tier === 'server', gm.tier);
check('server member gets 60/day', gm.messages.limit === 60);
check('guild pool surfaced', gm.guild && gm.guild.limit === 800, JSON.stringify(gm.guild));

await db.exec(`insert into discord_entitlements (user_id, tier, source, status) values (${M2}, 'pro', 'stripe', 'active')`);
const proInGuild = await q(M2, { guild: G });
check('pro outranks the server tier', proInGuild.tier === 'pro');
check('pro does not draw on the guild pool', proInGuild.guild === null);

// -- Guild pool actually blocks ---------------------------------------------
const G2 = '999999999999999998', M3 = '888888888888888883';
await db.exec(`insert into discord_premium_servers (guild_id) values (${G2})`);
await db.exec(`update discord_quota_tiers set guild_pool_day = 2 where tier = 'server'`);
await db.exec(`insert into discord_usage_events (user_id, guild_id, kind, created_at)
               select ${M3}, ${G2}, 'chat', now() - interval '5 minutes' from generate_series(1,2)`);
const poolBlocked = await q('888888888888888885', { guild: G2 });
check('guild pool refuses a third member', poolBlocked.allowed === false);
check('guild scope reported', poolBlocked.scope === 'guild', poolBlocked.scope);
await db.exec(`update discord_quota_tiers set guild_pool_day = 800 where tier = 'server'`);

// -- dry_run: /quota must not cost a message --------------------------------
const D = '123123123123123123';
await q(D);
const before = await events(D);
const peek = await q(D, { dry: true });
const after = await events(D);
check('dry run records nothing', after === before, `${before} -> ${after}`);
check('dry run still reports usage', peek.messages.used === 1, String(peek.messages.used));
check('dry run reports the tier', peek.tier === 'free');

// A dry run must not spend a bonus credit either.
const DB2 = '124124124124124124';
await seed(DB2, 15);
await grant(DB2, 5);
const dryBonus = await q(DB2, { dry: true });
check('dry run sees the bonus would be used', dryBonus.allowed === true && dryBonus.used_bonus === true);
const bal = (await db.query('select coalesce(sum(credits),0)::int c from discord_bonus_credits where user_id=$1', [DB2])).rows[0].c;
check('dry run does not spend the credit', Number(bal) === 5, String(bal));

// -- Global capacity breaker ------------------------------------------------
await db.exec("update discord_quota_config set int_value = 1 where key = 'global_daily_cap'");
const capped = await q('321321321321321321');
check('free blocked at global capacity', capped.allowed === false);
check('capacity scope reported', capped.scope === 'capacity', capped.scope);
const PAID2 = '432432432432432432';
await db.exec(`insert into discord_entitlements (user_id, tier, source, status) values (${PAID2}, 'pro', 'stripe', 'active')`);
check('paid users pass the capacity breaker', (await q(PAID2)).allowed === true);
await db.exec("update discord_quota_config set int_value = 3000 where key = 'global_daily_cap'");

// -- Soft cap flag for margin control ---------------------------------------
const SC = '234234234234234234';
await db.exec(`insert into discord_entitlements (user_id, tier, source, status) values (${SC}, 'pro', 'stripe', 'active')`);
await seed(SC, 120);
const sc = await q(SC);
check('soft cap trips past 120/day', sc.limits.soft_capped === true);
check('soft cap does not refuse', sc.allowed === true);

// -- Backfill dropped vote-granted tiers ------------------------------------
const voteRows = (await db.query(
  "select count(*)::int c from discord_entitlements where source='topgg-vote'")).rows[0].c;
check('vote rows were not backfilled as tiers', Number(voteRows) === 0);

// -- Unknown kind must not bypass billing -----------------------------------
const X = '345345345345345345';
const junk = await q(X, { kind: 'nonsense' });
check('unknown kind falls back to chat', junk.allowed === true);
check('unknown kind still bills', junk.messages.used === 1);

// -- Housekeeping ------------------------------------------------------------
await db.exec("insert into discord_usage_events (user_id, kind, created_at) values (1, 'chat', now() - interval '10 days')");
const pruned = (await db.query('select public.gg_discord_prune() as n')).rows[0].n;
check('prune removes stale events', Number(pruned) >= 1, String(pruned));
check('prune keeps live events', await events(U) === 15);

// -- Chat retention -----------------------------------------------------------
// Messages used to be kept forever while the bot only reads the newest 50 per
// user. The privacy policy now promises 90 days / newest 50, so pin both.
const chats = async (user) =>
  Number((await db.query('select count(*)::int c from discord_chat_messages where user_id=$1', [String(user)])).rows[0].c);
const HEAVY = '456456456456456456';   // 70 recent messages -> trimmed to 50
const OLD   = '567567567567567567';   // 5 ancient + 3 recent -> ancient gone
const LIGHT = '678678678678678678';   // 4 recent -> untouched
await db.exec(`insert into discord_chat_messages (user_id, sender, text, created_at)
               select ${HEAVY}, 'user', 'msg ' || g, now() - (g || ' minutes')::interval
                 from generate_series(1, 70) g`);
await db.exec(`insert into discord_chat_messages (user_id, sender, text, created_at)
               select ${OLD}, 'user', 'ancient ' || g, now() - interval '120 days'
                 from generate_series(1, 5) g`);
await db.exec(`insert into discord_chat_messages (user_id, sender, text, created_at)
               select ${OLD}, 'ai', 'recent ' || g, now() - interval '2 days'
                 from generate_series(1, 3) g`);
await db.exec(`insert into discord_chat_messages (user_id, sender, text, created_at)
               select ${LIGHT}, 'user', 'hi ' || g, now() - interval '1 hour'
                 from generate_series(1, 4) g`);

await db.query('select public.gg_discord_prune()');
check('retention trims a heavy user to the newest 50', await chats(HEAVY) === 50, String(await chats(HEAVY)));
{
  // The survivors must be the NEWEST 50, not an arbitrary 50.
  const oldest = (await db.query(
    `select text from discord_chat_messages where user_id=$1 order by created_at asc limit 1`, [HEAVY])).rows[0].text;
  check('retention keeps the newest rows, not arbitrary ones', oldest === 'msg 50', oldest);
}
check('retention drops messages older than 90 days', await chats(OLD) === 3, String(await chats(OLD)));
check('retention leaves a light user untouched', await chats(LIGHT) === 4);
await db.query('select public.gg_discord_prune()');
check('retention is idempotent', await chats(HEAVY) === 50 && await chats(OLD) === 3 && await chats(LIGHT) === 4);

// -- /stats aggregate ---------------------------------------------------------
await db.exec(`insert into discord_usage_stats (user_id, total_calls, vision_calls)
               select 900000000000000000 + g, 3, 1 from generate_series(1, 1200) g`);
const gs = (await db.query('select public.gg_discord_global_stats() as s')).rows[0].s;
// 1200 rows: past the 1000-row PostgREST cap the old client-side sum hit.
check('global stats counts past 1000 users', Number(gs.users) >= 1200, JSON.stringify(gs));
check('global stats sums calls server-side', Number(gs.total) >= 3600 && Number(gs.vision) >= 1200, JSON.stringify(gs));

// Both functions are SECURITY DEFINER and must stay closed to the public roles.
for (const fn of ['gg_discord_prune()', 'gg_discord_global_stats()']) {
  const r = await db.query(
    `select has_function_privilege('anon', 'public.${fn}', 'execute') a,
            has_function_privilege('service_role', 'public.${fn}', 'execute') s`);
  check(`${fn} not executable by anon`, r.rows[0].a === false);
  check(`${fn} executable by service_role`, r.rows[0].s === true);
}

// -- Spoiler Shield storage ---------------------------------------------------
// Where someone is in a game is personal; the public anon key must not see it.
{
  const r = await db.query(`select relrowsecurity from pg_class where relname = 'discord_spoiler_prefs'`);
  check('discord_spoiler_prefs has RLS enabled', r.rows[0]?.relrowsecurity === true);
  const pol = await db.query(`select count(*)::int c from pg_policies where tablename = 'discord_spoiler_prefs'`);
  check('discord_spoiler_prefs has no policies (service role only)', pol.rows[0].c === 0);
  await db.exec(`insert into discord_spoiler_prefs (user_id, progress) values (111, '{"elden ring":"beat Margit"}')`);
  let rejected = false;
  try { await db.exec(`insert into discord_spoiler_prefs (user_id, mode) values (222, 'maybe')`); }
  catch { rejected = true; }
  check('mode is constrained to shield/off', rejected);
  const d = await db.query(`select mode from discord_spoiler_prefs where user_id = 111`);
  check('mode defaults to shield', d.rows[0]?.mode === 'shield');
}
// The standalone migration must apply cleanly on top of the full schema.
await db.exec(readFileSync(`${ROOT}/migrations/20260926_spoiler_prefs.sql`, 'utf8'));
check('spoiler migration is idempotent over schema-v3', true);

console.log(`\nSQL: ${pass} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
