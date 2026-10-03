// A model that stops part-way must not be delivered as a whole answer.
//
// In production a /missables reply ended at "### 1. Right" and the server sent
// it as `final`, complete. The streaming adapters now throw StreamCutError for
// a stream that ends without finishing (no finish_reason, no [DONE]) or that
// the provider halted (content_filter; Gemini RECITATION / SAFETY), so the
// mesh can reset the client and try the next model.

import { streamOpenAICompat, streamGemini, StreamCutError } from '../supabase/functions/chat-proxy/streaming.ts';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}`);
}

const enc = new TextEncoder();
const frame = (obj: unknown) => `data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`;
const chunk = (text: string, finish: string | null = null) => ({ choices: [{ delta: { content: text }, finish_reason: finish }] });

// A bare { ok, body } — all the adapter reads — so the stream under test is
// exactly the one built here.
function mockFetch(frames: string[], { breakAfter = -1 } = {}) {
  globalThis.fetch = (async () => ({ ok: true, status: 200, body: new ReadableStream({
    start(ctrl) {
      frames.forEach((f, i) => {
        if (breakAfter >= 0 && i > breakAfter) return;
        ctrl.enqueue(enc.encode(f));
      });
      // Later, not now: error() discards anything still queued.
      if (breakAfter >= 0) setTimeout(() => ctrl.error(new TypeError('connection reset')), 20);
      else ctrl.close();
    },
  }) })) as unknown as typeof fetch;
}

async function run(frames: string[], opts = {}) {
  mockFetch(frames, opts);
  const deltas: string[] = [];
  try {
    const text = await streamOpenAICompat('https://example.test', 'k', 'm', [], { onDelta: (t) => deltas.push(t) });
    return { text, deltas, err: null as unknown };
  } catch (err) {
    return { text: null, deltas, err };
  }
}

// ── OpenAI-compatible ─────────────────────────────────────────────────────
{
  const r = await run([frame(chunk('Hello ')), frame(chunk('world', 'stop')), frame('[DONE]')]);
  check('complete stream returns its text', r.text === 'Hello world' && r.err === null);
}
{
  const r = await run([frame(chunk('Hello ')), frame(chunk('world', 'length'))]);
  check('finish_reason length (cap reached) still counts as finished', r.text === 'Hello world');
}
{
  const r = await run([frame(chunk('### 1. Right'))]);
  check('no finish_reason and no [DONE] → StreamCutError', r.err instanceof StreamCutError);
  check('the cut carries the partial text', r.err instanceof StreamCutError && r.err.partial === '### 1. Right');
  check('the partial text was still streamed', r.deltas.join('') === '### 1. Right');
}
{
  const r = await run([frame(chunk('Part one', 'content_filter')), frame('[DONE]')]);
  check('content_filter → StreamCutError', r.err instanceof StreamCutError && (r.err as StreamCutError).reason === 'content_filter');
}
{
  // Long enough to clear the reasoning filter's hold-back for a split <think> tag.
  const r = await run([frame(chunk('Part one of a longer answer')), frame(chunk(' and two'))], { breakAfter: 0 });
  check('network error after the first token → StreamCutError', r.err instanceof StreamCutError);
}
{
  mockFetch([]);
  globalThis.fetch = (async () => new Response('nope', { status: 503 })) as typeof fetch;
  let err: unknown = null;
  try { await streamOpenAICompat('https://example.test', 'k', 'm', [], { onDelta: () => {} }); } catch (e) { err = e; }
  check('failure before any token is a plain error (swap models silently)', err instanceof Error && !(err instanceof StreamCutError));
}

// ── Gemini ────────────────────────────────────────────────────────────────
function fakeGemini(chunks: Array<{ text?: string; finishReason?: string }>) {
  return {
    models: {
      generateContentStream: async () => (async function* () {
        for (const c of chunks) yield { text: c.text, candidates: [{ finishReason: c.finishReason }] };
      })(),
    },
  };
}
async function runGemini(chunks: Array<{ text?: string; finishReason?: string }>) {
  try {
    return { text: await streamGemini(fakeGemini(chunks), 'g', [], '', { onDelta: () => {} }), err: null as unknown };
  } catch (err) {
    return { text: null, err };
  }
}
{
  const r = await runGemini([{ text: 'All ' }, { text: 'done', finishReason: 'STOP' }]);
  check('Gemini STOP returns its text', r.text === 'All done');
}
{
  const r = await runGemini([{ text: 'Long', finishReason: 'MAX_TOKENS' }]);
  check('Gemini MAX_TOKENS is kept', r.text === 'Long');
}
{
  const r = await runGemini([{ text: 'Here is everything.\n\n### 1. Right' }, { finishReason: 'RECITATION' }]);
  check('Gemini RECITATION → StreamCutError', r.err instanceof StreamCutError && (r.err as StreamCutError).reason === 'recitation');
}
{
  const r = await runGemini([{ text: 'Half', finishReason: 'SAFETY' }]);
  check('Gemini SAFETY → StreamCutError', r.err instanceof StreamCutError);
}

console.log(`stream-cut: ${passed} passed, ${failed} failed`);
if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
