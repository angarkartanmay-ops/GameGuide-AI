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
  ['behaviour',     'behaviour.test.ts'],      // correction detection + follow-up suppression
  ['corroboration', 'corroboration.test.ts'],  // source-agreement scoring
  ['ssrf',          'ssrf.test.mjs'],          // wiki-proxy subdomain validation
  ['eval',          'eval/pipeline.test.mjs'], // golden-set retrieval + routing accuracy
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
