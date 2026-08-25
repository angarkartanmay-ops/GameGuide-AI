// Model-catalog tests.
//
// The premise being defended: hardcoded model ids rot silently. Every
// OpenRouter id in v2 was dead by v3, and 3 of v3's 12 ids were dead 11 days
// later. These assert that discovery actually returns usable models from the
// LIVE catalog, and that the filters keep junk out.
//
// The live fetch is skipped automatically when offline so the suite stays
// runnable without network.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'supabase', 'functions', 'chat-proxy', 'modelCatalog.ts');
const src = readFileSync(SRC, 'utf8');

let pass = 0;
const failures = [];
const check = (label, cond) => { if (cond) pass++; else failures.push(`  ${label}`); };

// ── Static guarantees about the filters ───────────────────────────────────
// The exclude pattern, mirrored from modelCatalog.ts. Asserted below to be
// byte-identical to the source so this copy cannot silently drift.
const EXCLUDE_RX = /(content-safety|safeguard|guard|moderation|embed|rerank|tts|whisper|image-gen|-code(?::free)?$|note-preview)/i;
check('mirrored EXCLUDE_RX matches modelCatalog.ts', src.includes(EXCLUDE_RX.source));

// Safety/moderation/embedding models must never serve user chat.
for (const bad of [
  'nvidia/nemotron-3.5-content-safety:free',
  'openai/gpt-oss-safeguard-20b',
  'meta-llama/llama-prompt-guard-2-86m',
  'some/model-embed',
  'x/whisper-large-v3',
  'cohere/north-mini-code:free',
]) {
  check(`excludes ${bad}`, EXCLUDE_RX.test(bad));
}
// …and real chat models must survive the filter.
for (const good of ['z-ai/glm-5.2:free', 'google/gemma-4-31b-it:free', 'openai/gpt-oss-120b']) {
  check(`keeps ${good}`, !EXCLUDE_RX.test(good));
}

// Paid models must be opt-in. A missing env var must never spend money.
check('paid models gated behind ENABLE_PAID_FALLBACK',
  src.includes("Deno.env.get('ENABLE_PAID_FALLBACK') === '1'"));
check('paid models capped by price', src.includes('MAX_PAID_PROMPT_USD_PER_MTOK'));
check('unknown families are skipped', src.includes("if (!cls) continue;"));
check('falls back rather than throwing', src.includes("source: 'fallback'"));
check('prefers stale cache over static list', src.includes("if (cache) return { ...cache.result, source: 'cache' };"));

// ── Live catalog ──────────────────────────────────────────────────────────
let online = true;
let entries = [];
try {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: ctrl.signal });
    const body = await res.json();
    entries = body?.data || [];
  } finally {
    clearTimeout(timer);
  }
} catch {
  online = false;
}

if (!online || entries.length === 0) {
  console.log('catalog: live fetch unavailable — skipping live assertions');
} else {
  // Mirror the module's own filters so the test measures the real outcome.
  const QUALITY = [
    /^z-ai\/glm-[5-9]/i, /^deepseek\/deepseek-(v[4-9]|r[2-9])/i,
    /^nvidia\/nemotron-\d+(\.\d+)?-ultra/i, /^minimax\/minimax-m/i,
    /^qwen\/qwen3(\.\d+)?-(max|plus)/i, /^openai\/gpt-oss-120b/i,
    /^nvidia\/nemotron-\d+(\.\d+)?-super/i, /^thinkingmachines\/inkling$/i,
    /^google\/gemma-[4-9]/i, /^qwen\/qwen3(\.\d+)?-(flash|\d+b)/i,
    /^openai\/gpt-oss-20b/i, /^thinkingmachines\/inkling-small/i,
    /^poolside\/laguna-s/i, /^nvidia\/nemotron-\d+(\.\d+)?-nano/i,
    /^liquid\/lfm/i, /^poolside\/laguna-xs/i,
  ];
  const usable = entries.filter(e =>
    e?.id && e.id.endsWith(':free') && !EXCLUDE_RX.test(e.id) && QUALITY.some(rx => rx.test(e.id)));
  const vision = usable.filter(e => (e.architecture?.input_modalities || []).includes('image'));

  check(`discovery yields >=3 free chat models (got ${usable.length})`, usable.length >= 3);
  check(`discovery yields >=1 free vision model (got ${vision.length})`, vision.length >= 1);

  // The point of the exercise: report which STATIC ids are already dead.
  const live = new Set(entries.map(e => e.id));
  const staticIds = [...src.matchAll(/'([\w.\-]+\/[\w.\-:]+)'/g)].map(m => m[1]);
  const meshSrc = readFileSync(join(HERE, '..', 'supabase', 'functions', 'chat-proxy', 'meshRouter.ts'), 'utf8');
  const meshOR = [...meshSrc.matchAll(/id: '([^']*\/[^']*:free)'/g)].map(m => m[1]);
  const dead = meshOR.filter(id => !live.has(id));
  if (dead.length) {
    console.log(`catalog: NOTE ${dead.length}/${meshOR.length} static OpenRouter fallback ids are already dead upstream:`);
    dead.forEach(d => console.log(`    ${d}`));
    console.log('    (harmless — discovery supersedes them; this is exactly why it exists)');
  }
  console.log(`catalog: ${usable.length} usable free models live right now, ${vision.length} with vision`);
}

if (failures.length) console.log(`\nCATALOG FAILURES:\n${failures.join('\n')}`);
console.log(`catalog: ${pass} passed, ${failures.length} failed`);
process.exitCode = failures.length ? 1 : 0;
