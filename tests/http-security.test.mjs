// discord-bot/httpSecurity.js — the bot's public HTTP surface.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sec = require(join(dirname(fileURLToPath(import.meta.url)), '..', 'discord-bot', 'httpSecurity.js'));

let passed = 0, failed = 0;
const check = (name, cond) => { if (cond) { passed++; return; } failed++; console.error(`  FAIL: ${name}`); };

// Constant-time secret compare.
check('equal secrets match', sec.safeEqual('s3cret-value', 's3cret-value'));
check('different secrets do not', !sec.safeEqual('s3cret-value', 's3cret-valuX'));
check('a prefix does not', !sec.safeEqual('s3cret', 's3cret-value'));
check('missing header does not', !sec.safeEqual(undefined, 's3cret'));
check('empty secret never matches', !sec.safeEqual('', ''));

// Top.gg vote bodies.
const U = '123456789012345678', BOT = '149962256647271220';
check('valid vote', sec.parseTopggVote({ user: U, bot: BOT, type: 'upvote', isWeekend: true }, { botId: BOT }).userId === U);
check('weekend flag read strictly', sec.parseTopggVote({ user: U, isWeekend: 'yes' }).weekend === false);
check('test vote is flagged, not rewarded', sec.parseTopggVote({ user: U, type: 'test' }).test === true);
check('non-snowflake user rejected', !!sec.parseTopggVote({ user: 'abc' }).error);
check('injection-shaped user rejected', !!sec.parseTopggVote({ user: `${U}' or 1=1` }).error);
check('vote for another bot rejected', !!sec.parseTopggVote({ user: U, bot: '999999999999999999' }, { botId: BOT }).error);
check('unknown type rejected', !!sec.parseTopggVote({ user: U, type: 'refund' }).error);
check('no body rejected', !!sec.parseTopggVote(null).error);

// Rate limiter.
let t = 0;
const lim = sec.rateLimiter({ windowMs: 1000, max: 2, now: () => t });
const fake = () => {
  const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json() { return this; } };
  let nexted = false;
  lim({ ip: '1.2.3.4' }, res, () => { nexted = true; });
  return { res, nexted };
};
check('first call passes', fake().nexted);
check('second call passes', fake().nexted);
const third = fake();
check('third call in the window is refused', !third.nexted && third.res.code === 429 && third.res.headers['Retry-After']);
t = 1500;
check('window resets', fake().nexted);

// Security headers.
const h = {}; sec.secureHeaders({}, { setHeader: (k, v) => { h[k] = v; } }, () => {});
check('nosniff + deny framing + no-store', h['X-Content-Type-Options'] === 'nosniff' && h['X-Frame-Options'] === 'DENY' && h['Cache-Control'] === 'no-store');

console.log(`http-security: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
