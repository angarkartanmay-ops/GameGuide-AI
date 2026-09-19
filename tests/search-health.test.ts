// /health must never relay third-party text.
//
// An earlier version of the backend-health block lifted the "message" field out
// of the upstream error body and stored it as `detail`, which /health then
// published. /health is gated only by the anon key, and that key ships inside
// the public frontend bundle — so vendor error text, from four different
// providers and outside our control, was being served to anyone who asked.
//
// These assertions pin the split: a fixed classification goes public, the full
// reason goes to the log, and anything credential-shaped is redacted even
// there.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'supabase', 'functions', 'chat-proxy', 'webSearch.ts'), 'utf8');
const INDEX = readFileSync(join(HERE, '..', 'supabase', 'functions', 'chat-proxy', 'index.ts'), 'utf8');

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}`);
}

// ── the public shape carries no vendor text ───────────────────────────────
{
  const m = SRC.match(/export interface BackendStatus \{([^}]*)\}/);
  const fields = m ? m[1] : '';
  check('BackendStatus exists', !!m);
  check('exposes a fixed code', /code:\s*BackendCode/.test(fields));
  check('exposes the numeric status', /status:\s*number/.test(fields));
  // `detail` was the leak: a free-text field fed from the upstream body.
  check('carries NO free-text detail field', !/\bdetail\s*:/.test(fields));
}

check('the old failReason helper is gone', !/function failReason/.test(SRC));
check('operator detail is a separate, log-only helper', /function failDetail/.test(SRC));
// The warn line interpolates `(${code}, HTTP ${status})`, so match the whole
// statement rather than stopping at the first bracket.
check('log path redacts before writing',
  /console\.warn\(`\[WEB-SEARCH\][^`]*redact\(logDetail\)/.test(SRC));
check('/health comment records why it is classification-only',
  /CLASSIFICATION only|never text from the vendor/i.test(INDEX));

// ── the redactor ──────────────────────────────────────────────────────────
// Rebuilt from source rather than re-typed, so the test exercises the real
// implementation (pattern text is sliced out and handed to new RegExp; no eval).
{
  const body = SRC.slice(SRC.indexOf('function redact'), SRC.indexOf('/**\n * Record an outcome'));
  const rules: Array<[RegExp, string]> = [];
  const rx = /\.replace\(\/(.+?)\/([gi]*),\s*'([^']*)'\)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(body)) !== null) rules.push([new RegExp(m[1], m[2]), m[3]]);
  const redact = (s: string) => rules.reduce((acc, [re, to]) => acc.replace(re, to), s);

  check('extracted every redaction rule', rules.length === 3);

  const KEY = 'AIzaSyD1234567890abcdefghijklmnopqrstuv';
  check('query-string key is redacted',
    !redact(`https://api.example.com/v1?key=${KEY}&q=test`).includes(KEY));
  check('api_key form is redacted',
    !redact(`GET /search?api_key=${KEY}`).includes(KEY));
  check('bearer token is redacted',
    !redact('authorization: bearer sk_live_abcdefghijklmnop123456').includes('sk_live_abcdefghijklmnop123456'));
  check('a bare long opaque token is redacted', !redact(`token ${KEY}`).includes(KEY));

  // Ordinary prose must survive, or the log stops being useful.
  const plain = 'API key not valid. Please pass a valid API key.';
  check('ordinary vendor prose is left readable', redact(plain) === plain);
  check('short words are not mangled', redact('HTTP 429 quota exceeded') === 'HTTP 429 quota exceeded');
}

// ── classification mapping ────────────────────────────────────────────────
{
  const body = SRC.slice(SRC.indexOf('function classify'), SRC.indexOf('// Anything shaped like a credential'));
  check('401 maps to auth_failed', /401.*403.*auth_failed/s.test(body));
  check('429 maps to rate_limited', /429.*rate_limited/s.test(body));
  check('everything else is upstream_error', /return 'upstream_error'/.test(body));
}

console.log(`search-health: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
