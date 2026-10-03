// Hydracept — the paid model behind the free mesh (supabase/functions/chat-proxy/hydracept.ts).
//
// Off unless both secrets are set; text-only messages; never relays the
// response body in an error; reads the real invoke response shape
// ({ status: "Succeeded", typedOutput, resolvedModel, actualCost }).

const ENV: Record<string, string> = {};
(globalThis as any).Deno = { env: { get: (k: string) => ENV[k] } };

const { hydraceptConfig, toHydraceptMessages, callHydracept, HYDRACEPT_CAPABILITY } =
  await import('../supabase/functions/chat-proxy/hydracept.ts');

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}`);
}

// ── config ────────────────────────────────────────────────────────────────
check('off with no secrets', hydraceptConfig() === null);
ENV.HYDRACEPT_API_KEY = 'hk_test';
check('off with only the key', hydraceptConfig() === null);
ENV.HYDRACEPT_PROJECT_ID = 'cpr_test';
const cfg = hydraceptConfig();
check('on with key + project', !!cfg && cfg.projectId === 'cpr_test' && cfg.environment === 'development');
check('missables-first by default', cfg?.missablesFirst === true);
ENV.HYDRACEPT_MISSABLES_FIRST = '0';
check('missables-first can be turned off', hydraceptConfig()?.missablesFirst === false);
ENV.HYDRACEPT_MODE = 'off';
check('HYDRACEPT_MODE=off disables it', hydraceptConfig() === null);
delete ENV.HYDRACEPT_MODE;
delete ENV.HYDRACEPT_MISSABLES_FIRST;

// ── messages ──────────────────────────────────────────────────────────────
const msgs = toHydraceptMessages([
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'q1' },
  { role: 'model', content: 'a1' },
  { role: 'assistant', content: '' },
  { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:...' } }] },
]);
check('roles mapped, empties dropped', JSON.stringify(msgs.map(m => m.role)) === JSON.stringify(['system', 'user', 'assistant', 'user']));
check('image parts dropped, text kept', msgs[3].content === 'look');

// ── invoke ────────────────────────────────────────────────────────────────
let lastBody: any = null;
let lastUrl = '';
let lastAuth = '';
function stub(status: number, body: unknown) {
  globalThis.fetch = (async (url: string, init: any) => {
    lastUrl = String(url);
    lastAuth = init?.headers?.Authorization || '';
    lastBody = JSON.parse(init.body);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }) as unknown as typeof fetch;
}

stub(200, { status: 'Succeeded', typedOutput: 'Margit, the Fell Omen.', resolvedModel: 'gpt-6-luna', actualCost: 8.8e-6 });
{
  const r = await callHydracept(hydraceptConfig()!, msgs, { maxTokens: 9000 });
  check('returns the typed output', r.text === 'Margit, the Fell Omen.');
  check('reports the resolved model', r.model === 'gpt-6-luna' && r.provider === 'Hydracept');
  check('reports the cost', r.costUsd === 8.8e-6);
  check('calls the fast text capability', lastUrl === `https://api.hydracept.com/v1/capabilities/${HYDRACEPT_CAPABILITY}/invoke`);
  check('bearer auth with the key', lastAuth === 'Bearer hk_test');
  check('project context', lastBody.context.projectId === 'cpr_test' && lastBody.context.environment === 'development');
  check('managed billing', lastBody.execution.billingMode === 'managed');
  check('output capped at the invoke ceiling', lastBody.input.maxOutputTokens === 2048);
}

stub(402, { errorCode: 'FUNDING_REQUIRED', message: 'secret vendor detail' });
{
  let err: Error | null = null;
  try { await callHydracept(hydraceptConfig()!, msgs); } catch (e) { err = e as Error; }
  check('HTTP failure throws with status + code', !!err && err.message === 'HTTP_402:FUNDING_REQUIRED');
  check('body text is not relayed', !!err && !err.message.includes('secret vendor detail'));
}

// A 5xx is retried once (the route answered 500 intermittently); a 4xx is not.
{
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return calls === 1
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ status: 'Succeeded', typedOutput: 'second try', resolvedModel: 'm' }) };
  }) as unknown as typeof fetch;
  const r = await callHydracept(hydraceptConfig()!, msgs, { retryDelayMs: 1 });
  check('5xx retried once, then succeeds', r.text === 'second try' && calls === 2);
}
{
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return { ok: false, status: 402, json: async () => ({}) }; }) as unknown as typeof fetch;
  try { await callHydracept(hydraceptConfig()!, msgs, { retryDelayMs: 1 }); } catch { /* expected */ }
  check('4xx is not retried', calls === 1);
}

stub(200, { status: 'Failed', errorCode: 'ProviderError', typedOutput: '' });
{
  let err: Error | null = null;
  try { await callHydracept(hydraceptConfig()!, msgs); } catch (e) { err = e as Error; }
  check('a failed execution throws', !!err && /HYDRACEPT_ProviderError/.test(err.message));
}

stub(200, { status: 'Succeeded', typedOutput: '   ' });
{
  let err: Error | null = null;
  try { await callHydracept(hydraceptConfig()!, msgs); } catch (e) { err = e as Error; }
  check('an empty answer throws', !!err);
}

// ── the key never reaches the browser ─────────────────────────────────────
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const clientFiles = walk(join(import.meta.dirname, '..', 'src'));
check('no client code mentions HYDRACEPT_API_KEY', clientFiles.every(f => !readFileSync(f, 'utf8').includes('HYDRACEPT_API_KEY')));

console.log(`hydracept: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
