// End-to-end contract check: the real quota.js talking to the real SQL.
// A shim stands in for supabase-js, mapping .rpc(fn, args) onto PGlite so the
// exact JSONB the function returns is consumed by the exact code that will
// consume it in production.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'discord-bot');
const require = createRequire(import.meta.url);
const quota = require(join(ROOT, 'quota.js'));

const db = await PGlite.create();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
await db.exec(readFileSync(`${ROOT}/schema.sql`, 'utf8'));
await db.exec(readFileSync(`${ROOT}/schema-v3.sql`, 'utf8'));

// Minimal stand-in for the supabase-js surface quota.js actually uses.
const supabase = {
  async rpc(fn, args) {
    try {
      const keys = Object.keys(args);
      const params = keys.map((_, i) => `$${i + 1}`).join(', ');
      const r = await db.query(
        `select public.${fn}(${params}) as d`,
        keys.map(k => args[k]),
      );
      return { data: r.rows[0].d, error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  },
};

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) pass++; else { fail++; console.error(`  FAIL: ${n}${x ? ' :: ' + x : ''}`); } };

const U = '111111111111111111';

// A fresh free user.
const first = await quota.checkQuota(supabase, { userId: U, guildId: null, kind: 'chat' });
check('RPC round-trips through quota.js', first.allowed === true, JSON.stringify(first).slice(0, 120));
check('not flagged degraded', first.degraded === false);
check('tier came back', first.tier === 'free');
check('limits came back', first.limits.context_turns === 6 && first.limits.history_len === 10);
check('footer quiet at 1/15', quota.quotaFooter(first, { userId: U }) === '');

// Push to the nudge threshold (12/15) using backdated events.
await db.exec(`insert into discord_usage_events (user_id, kind, created_at)
               select ${U}, 'chat', now() - interval '5 minutes' from generate_series(1,10)`);
const at12 = await quota.checkQuota(supabase, { userId: U, kind: 'chat' });
check('reaches 12/15', at12.messages.used === 12, String(at12.messages.used));
const footer = quota.quotaFooter(at12, { userId: U });
check('footer fires at 80%', footer.includes('3 messages left'), footer);

// Exhaust and confirm the blocked copy renders from live data.
await db.exec(`insert into discord_usage_events (user_id, kind, created_at)
               select ${U}, 'chat', now() - interval '5 minutes' from generate_series(1,3)  -- 12 -> 15, next call is refused`);
const blocked = await quota.checkQuota(supabase, { userId: U, kind: 'chat' });
check('blocked once spent', blocked.allowed === false);
const msg = quota.blockedMessage(blocked);
check('block copy quotes the real limit', msg.includes('15 messages'), msg);
check('block copy renders a live reset stamp', /<t:\d+:R>/.test(msg), msg);

// /quota rendering off a real dry-run decision.
const peek = await quota.checkQuota(supabase, { userId: U, kind: 'chat', dryRun: true });
const fields = quota.quotaFields(peek);
check('quota embed builds from live data', fields.length >= 4);
check('progress bar is full at the cap', fields[0].value.includes('15/15'), fields[0].value);

// Degraded path: a broken client must not throw or fail open silently.
const brokenDecision = await quota.checkQuota(
  { rpc: async () => { throw new Error('connection refused'); } },
  { userId: '999999999999999999', kind: 'chat' },
);
check('survives a dead database', typeof brokenDecision.allowed === 'boolean');
check('marks itself degraded', brokenDecision.degraded === true);
check('degraded suppresses the upsell', quota.quotaFooter(brokenDecision, { userId: 'x' }) === '');

console.log(`\ncontract: ${pass} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
