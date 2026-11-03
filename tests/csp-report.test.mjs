// The Content-Security-Policy report endpoint (api/csp-report.js). Anyone can
// POST to it, so the contract is: bounded, nothing stored, and no address kept
// beyond its path (a share link's payload must never reach the logs).

import handler, { normalizeReports } from '../api/csp-report.js';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}${extra ? ' :: ' + extra : ''}`);
}

const PAYLOAD = 'zSECRET-ANSWER-PAYLOAD_abc';

// ── both report formats, one shape ─────────────────────────────────────────
{
  const [r] = normalizeReports({
    'csp-report': {
      'document-uri': `https://gameguide.online/share/${PAYLOAD}?utm=x#frag`,
      'violated-directive': 'script-src-elem',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.example/x.js?token=1',
      'source-file': 'https://gameguide.online/assets/index-abc.js',
      'line-number': 12,
      disposition: 'report',
    },
  });
  check('report-uri: the directive', r.directive === 'script-src-elem');
  check('report-uri: the blocked address, without its query', r.blocked === 'https://evil.example/x.js');
  check('report-uri: the page, with the share payload blanked and no query or fragment', r.page === 'https://gameguide.online/share/redacted', r.page);
  check('report-uri: nothing in the report carries the payload', !JSON.stringify(r).includes(PAYLOAD));
  check('report-uri: source, line and disposition', r.source.endsWith('/assets/index-abc.js') && r.line === 12 && r.disposition === 'report');
}
{
  const reports = normalizeReports([
    { type: 'csp-violation', url: 'https://gameguide.online/', body: { documentURL: 'https://gameguide.online/about', effectiveDirective: 'connect-src', blockedURL: 'https://x.example/api', disposition: 'report', lineNumber: 3, sourceFile: 'inline' } },
    { type: 'deprecation', body: { id: 'x' } },
  ]);
  check('reporting API: csp-violation reports are kept, other kinds dropped', reports.length === 1 && reports[0].directive === 'connect-src');
  check('reporting API: the same fields', reports[0].page === 'https://gameguide.online/about' && reports[0].blocked === 'https://x.example/api' && reports[0].source === 'inline');
}
check('keywords such as inline and eval pass through', normalizeReports({ 'csp-report': { 'blocked-uri': 'inline', 'effective-directive': 'script-src-elem' } })[0].blocked === 'inline');
check('junk is nothing', normalizeReports(null).length === 0 && normalizeReports('x').length === 0 && normalizeReports({}).length === 0 && normalizeReports([1, null, {}]).length === 0);
check('at most ten reports per request', normalizeReports(Array.from({ length: 50 }, () => ({ type: 'csp-violation', body: { effectiveDirective: 'img-src' } }))).length === 10);
check('fields are cut short', normalizeReports({ 'csp-report': { 'blocked-uri': 'https://x.example/' + 'a'.repeat(5000), 'effective-directive': 'img-src' } })[0].blocked.length <= 200);
check('control characters cannot break a log line', !/[\r\n\t]/.test(normalizeReports({ 'csp-report': { 'effective-directive': 'img-src\nfake', 'blocked-uri': 'a\r\nb' } })[0].directive + normalizeReports({ 'csp-report': { 'blocked-uri': 'a\r\nb' } })[0].blocked));

// ── the handler ────────────────────────────────────────────────────────────
function run({ method = 'POST', type = 'application/csp-report', body = '' } = {}) {
  const req = {
    method,
    headers: { 'content-type': type },
    async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); },
  };
  const out = { status: null, headers: {} };
  const res = {
    setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; },
    status(code) { out.status = code; return this; },
    end() { return this; },
  };
  return handler(req, res).then(() => out);
}
const logged = [];
const realLog = console.log;
console.log = (...a) => logged.push(a.join(' '));
try {
  const good = JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'https://x.example/a.png', 'document-uri': `https://gameguide.online/share/${PAYLOAD}` } });
  const ok = await run({ body: good });
  check('a report is accepted with 204', ok.status === 204 && ok.headers['cache-control'] === 'no-store');
  check('and logged as one JSON line', logged.length === 1 && JSON.parse(logged[0]).csp === true && JSON.parse(logged[0]).directive === 'img-src');
  check('the share payload never reaches the log', !logged.join('\n').includes(PAYLOAD));

  check('the Reporting API content type is accepted', (await run({ type: 'application/reports+json', body: JSON.stringify([{ type: 'csp-violation', body: { effectiveDirective: 'img-src' } }]) })).status === 204 && logged.length === 2);
  check('GET is refused', (await run({ method: 'GET' })).status === 405);
  check('other content types are refused', (await run({ type: 'text/html', body: good })).status === 415);
  check('invalid JSON is a 400', (await run({ body: '{nope' })).status === 400);
  check('an oversized body is a 413 and is not parsed', (await run({ body: JSON.stringify({ 'csp-report': { x: 'a'.repeat(20_000) } }) })).status === 413);
  check('a report about nothing is accepted and not logged', (await run({ body: '{}' })).status === 204 && logged.length === 2);

  // The per-minute cap: a flood stops being logged (and still gets 204).
  for (let i = 0; i < 100; i++) await run({ body: good });
  check('a flood is capped, not logged without limit', logged.length <= 62, String(logged.length));
  check('...and still answered', (await run({ body: good })).status === 204);
} finally {
  console.log = realLog;
}

console.log(`csp-report: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
