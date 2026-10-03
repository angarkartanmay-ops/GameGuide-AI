// Test runner — `npm test`
//
// No framework on purpose: these suites are pure-function assertions with zero
// dependencies, and adding a runner would be more setup than the tests.
//
// Regenerates the sliced edge-function modules first, so a rename inside
// index.ts fails loudly here instead of silently testing a stale copy.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateModules } from './helpers/extract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  ['detection',     'detection.test.ts'],      // game-name parsing incl. installment numbers
  ['retrieval',     'retrieval.test.ts'],      // subject extraction, temporal hints, multi-game
  ['behaviour',     'behaviour.test.ts'],      // correction detection + follow-up suppression
  ['gemini',        'gemini.test.ts'],         // multi-model quota rotation
  ['reasoning',     'reasoning.test.ts'],      // strip <think> scratchpad from replies
  ['spoiler',       'spoiler.test.ts'],        // Spoiler Shield: progress, resolution, directives
  ['spoiler-guard', 'spoiler-guard.test.ts'],  // echo + chip backstop behind the shield
  ['spoiler-text',  'spoiler-text.test.mjs'],  // web ||spoiler|| rendering incl. streaming
  ['textsplit',     'textsplit.test.mjs'],     // Discord chunking never exposes a spoiler
  ['watchtower',    'watchtower.test.mjs'],    // patch/deal alerts: once per channel, no backfill
  ['watch-command', 'watch-command.test.mjs'], // the real /watch handler, fake Discord
  ['codex',         'codex.test.mjs'],         // chat UI: palette, game context, accent, shelf
  ['site',          'site.test.mjs'],          // landing + info: konami, achievements, showcase, honest copy
  ['steam-art',     'steam-art.test.mjs'],     // backdrop art lookup: strict match, fixed host
  ['price',         'price.test.mjs'],         // /price game+version detection, web/Discord parity
  ['price-proxy',   'price-proxy.test.mjs'],   // /api/price: narrow CheapShark proxy for filtered networks
  ['share',         'share.test.mjs'],         // spoiler-safe share links: round trip, hostile input, deflate bomb
  ['missables',     'missables.test.mjs'],     // /missables prompt + default game, web/Discord parity
  ['discord-format', 'discord-format.test.mjs'], // tables → phone-readable blocks, spoilers intact
  ['corroboration', 'corroboration.test.ts'],  // source-agreement scoring
  ['ssrf',          'ssrf.test.mjs'],          // wiki-proxy subdomain validation
  ['eval',          'eval/pipeline.test.mjs'], // golden-set retrieval + routing accuracy
  ['catalog',       'catalog.test.mjs'],       // live model discovery + filter safety
  ['quota',         'quota.test.mjs'],         // Discord freemium tiers + upsell copy
  ['search-health', 'search-health.test.ts'],  // /health must not relay vendor error text
  ['stream-cut',    'stream-cut.test.ts'],     // a model cut off part-way is never sent as a whole answer
  ['hydracept',     'hydracept.test.ts'],      // paid last-resort model: off by default, server-side key only
  ['billing',       'billing.test.mjs'],       // Stripe period-end + checkout ref linking
  ['discord-launch','discord-launch.test.mjs'],// invite perms, pings, intents, command wiring
  ['quota-sql',     'quota-sql.test.mjs'],     // the quota function, on real Postgres
  ['quota-contract','quota-contract.test.mjs'],// quota.js against that same SQL
  ['stats',         'stats.test.mjs'],         // landing live count: SQL on real Postgres + helpers
];

try {
  generateModules();
} catch (err) {
  console.error(`\nFAILED to extract test modules from index.ts:\n  ${err.message}\n`);
  console.error('The edge function was probably refactored. Update the markers in tests/helpers/extract.mjs.');
  process.exit(1);
}

let failed = 0;
for (const [name, file] of SUITES) {
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', join(HERE, file)],
    { encoding: 'utf8' },
  );
  const out = (res.stdout || '').trim();
  if (out) console.log(out);
  if (res.stderr && res.status !== 0) console.error(res.stderr.trim());
  if (res.status !== 0) {
    failed++;
    console.error(`  ↳ suite "${name}" FAILED`);
  }
}

console.log(failed ? `\n${failed} suite(s) failed.` : '\nAll suites passed.');
process.exit(failed ? 1 : 0);
