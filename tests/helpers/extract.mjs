// Slices pure, dependency-free functions out of the chat-proxy edge function
// so they can be unit tested under Node.
//
// Why slicing rather than a plain import: `index.ts` is a Deno module — it
// imports `npm:@google/genai` and calls `Deno.serve()` at load time, so
// importing it under Node executes a server. The functions under test
// (classification, correction detection, follow-up suppression) are pure and
// have no imports of their own, so lifting them out is safe.
//
// The proper long-term fix is to move these into their own module (e.g.
// `queryCortex.ts`) and import them directly. Until then, this keeps them
// covered instead of untested.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..');
const SOURCE = join(REPO_ROOT, 'supabase', 'functions', 'chat-proxy', 'index.ts');
// Sits beside the test files (tests/.generated), not beside this helper —
// the suites import it as './.generated/...' relative to tests/.
const OUT_DIR = join(HERE, '..', '.generated');

/** Text between two markers; throws loudly if the source has drifted. */
function slice(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  const j = src.indexOf(endMarker);
  if (i < 0) throw new Error(`extract: start marker not found: ${startMarker}`);
  if (j < 0) throw new Error(`extract: end marker not found: ${endMarker}`);
  if (j <= i) throw new Error(`extract: markers out of order: ${startMarker}`);
  return src.slice(i, j);
}

/**
 * Writes the sliced modules and returns their paths.
 * Regenerated on every run, so a rename in index.ts fails the test rather
 * than silently testing a stale copy.
 */
export function generateModules() {
  const src = readFileSync(SOURCE, 'utf8');
  mkdirSync(OUT_DIR, { recursive: true });

  const detection =
    slice(src, 'const KNOWN_GAMES', 'function scoreComplexity') +
    '\nexport { detectGame, extendWithInstallment, guessUnknownTitle };\n';

  const behaviour =
    slice(src, 'const CORRECTION_LEAD_RX', 'function scoreComplexity') +
    '\n' +
    slice(src, 'const EMOTIONAL_RX', 'function ensureFollowUps') +
    '\nexport { isCorrection, shouldSkipAutoFollowUps, EMOTIONAL_RX };\n';

  const detectionPath = join(OUT_DIR, 'detection.ts');
  const behaviourPath = join(OUT_DIR, 'behaviour.ts');
  writeFileSync(detectionPath, detection);
  writeFileSync(behaviourPath, behaviour);
  return { detectionPath, behaviourPath };
}

// ── Tiny assertion helper (no test framework dependency) ───────────────────
export function makeChecker(name) {
  let pass = 0;
  const failures = [];
  return {
    check(label, got, want) {
      if (JSON.stringify(got) === JSON.stringify(want)) pass++;
      else failures.push(`  ${label}\n    expected ${JSON.stringify(want)}\n    got      ${JSON.stringify(got)}`);
    },
    report() {
      if (failures.length) {
        console.log(`\n${name} FAILURES:\n${failures.join('\n')}`);
      }
      console.log(`${name}: ${pass} passed, ${failures.length} failed`);
      return failures.length;
    },
  };
}
