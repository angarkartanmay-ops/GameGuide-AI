import { scrubUrl } from '../src/utils/privacy.js';

// POST /api/csp-report: where the browser sends Content-Security-Policy
// violation reports while the policy in vercel.json is report-only. Each report
// becomes one JSON line in the function's logs (Vercel > Logs, search "csp"),
// which is how the policy is checked against the real site before it is
// enforced. See launch/security-headers.md.
//
// Anyone can POST here, so it stores nothing, trusts nothing, keeps what it logs
// short, and logs a bounded number per minute. An address is logged without
// its query or fragment, and a share link's payload is blanked: the page a
// violation happened on may be /share/<the whole answer>.
const MAX_BODY = 8 * 1024;
const MAX_FIELD = 200;
const MAX_PER_MINUTE = 60;

let windowStart = 0;
let inWindow = 0;
const allow = (now = Date.now()) => {
  if (now - windowStart > 60_000) { windowStart = now; inWindow = 0; }
  inWindow += 1;
  return inWindow <= MAX_PER_MINUTE;
};

const short = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, MAX_FIELD);

/** An address with no query, no fragment and no share payload. Keywords like "inline" and "eval" pass through. */
const address = (v) => short(scrubUrl(String(v ?? '').split('?')[0]));

/**
 * Both report formats, one shape. `report-uri` sends { "csp-report": {...} };
 * the Reporting API sends [ { type: "csp-violation", body: {...} } ].
 * Returns [] for anything else.
 */
export function normalizeReports(body) {
  const items = [];
  if (Array.isArray(body)) {
    for (const r of body) {
      if (r && r.type === 'csp-violation' && r.body && typeof r.body === 'object') {
        const b = r.body;
        items.push({
          directive: b.effectiveDirective || b.violatedDirective,
          blocked: b.blockedURL,
          page: b.documentURL || r.url,
          source: b.sourceFile,
          line: b.lineNumber,
          disposition: b.disposition,
        });
      }
    }
  } else if (body && typeof body === 'object' && body['csp-report'] && typeof body['csp-report'] === 'object') {
    const b = body['csp-report'];
    items.push({
      directive: b['effective-directive'] || b['violated-directive'],
      blocked: b['blocked-uri'],
      page: b['document-uri'],
      source: b['source-file'],
      line: b['line-number'],
      disposition: b.disposition,
    });
  }
  return items.slice(0, 10).map((i) => ({
    directive: short(i.directive).split(' ')[0],
    blocked: address(i.blocked),
    page: address(i.page),
    source: address(i.source),
    line: Number.isFinite(Number(i.line)) ? Number(i.line) : undefined,
    disposition: short(i.disposition),
  }));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).end();
    return;
  }
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!/^application\/(csp-report|reports\+json|json)/.test(type)) {
    res.status(415).end();
    return;
  }
  let parsed = null;
  try {
    const text = await readBody(req);
    if (text === null) { res.status(413).end(); return; }
    parsed = JSON.parse(text);
  } catch {
    res.status(400).end();
    return;
  }
  for (const report of normalizeReports(parsed)) {
    if (!allow()) break;
    console.log(JSON.stringify({ csp: true, ...report }));
  }
  res.status(204).end();
}
