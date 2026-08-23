import { safeFandomSubdomain, buildFandomUrl, isAllowedOrigin } from '../api/_wikiTarget.js';

// Every one of these previously produced a fetch to an attacker-chosen host,
// with the response body returned verbatim to the caller (full-read SSRF).
const mustReject = [
  'example.com#', 'example.com%23', 'example.com/#', 'attacker.com%2523',
  '169.254.169.254#', 'metadata.google.internal#', 'localhost:8080#',
  '127.0.0.1#', '[::1]#', 'evil.com?', 'evil.com/path', 'foo.bar',
  '../etc/passwd', 'a%2Eb', 'a.b', 'a/b', 'a:b', 'a@b', 'a#b', 'a?b',
  'UPPER.COM#', '', '-leading', 'trailing-', 'a'.repeat(64),
  'x'.repeat(300), 'www', 'api', null, undefined, 123, {}, '%',
  'minecraft.fandom.com.evil.com', 'minecraft%0d%0aX-Injected:1',
];

const mustAccept = [
  ['minecraft', 'minecraft'],
  ['elderscrolls', 'elderscrolls'],
  ['hollowknight', 'hollowknight'],
  ['zelda', 'zelda'],
  ['MINECRAFT', 'minecraft'],
  ['half-life', 'half-life'],
  ['a', 'a'],
  ['stardewvalleywiki', 'stardewvalleywiki'],
  // Surrounding whitespace is trimmed, which is safe: trimming runs BEFORE the
  // subdomain regex, so " example.com# " still fails the pattern gate.
  [' minecraft ', 'minecraft'],
  ['\tzelda\n', 'zelda'],
];

let pass = 0, fail = 0;
for (const bad of mustReject) {
  const got = safeFandomSubdomain(bad);
  if (got === null) pass++;
  else { fail++; console.log(`FAIL accepted dangerous input: ${JSON.stringify(bad)} -> ${JSON.stringify(got)}`); }
}
for (const [good, want] of mustAccept) {
  const got = safeFandomSubdomain(good);
  if (got === want) pass++;
  else { fail++; console.log(`FAIL rejected valid wiki: ${JSON.stringify(good)} -> ${JSON.stringify(got)}`); }
}

// The assembled URL must always be on fandom.com
const url = buildFandomUrl('minecraft', { action: 'opensearch', search: 'x' });
if (url && new URL(url).hostname === 'minecraft.fandom.com') pass++;
else { fail++; console.log(`FAIL url host: ${url}`); }

if (buildFandomUrl('example.com#', {}) === null) pass++;
else { fail++; console.log('FAIL buildFandomUrl allowed dangerous host'); }

// Query params must not be able to break out of the query string
const u2 = buildFandomUrl('minecraft', { search: 'a&action=delete#x' });
if (u2 && new URL(u2).searchParams.get('search') === 'a&action=delete#x') pass++;
else { fail++; console.log(`FAIL param encoding: ${u2}`); }


// ── CORS allowlist ────────────────────────────────────────────────────────
// vercel.app is a PUBLIC SUFFIX: anyone can deploy evil.vercel.app for free,
// so a suffix match is not an allowlist. These routes proxy outbound fetches
// on the caller's behalf, so a third-party origin must never get CORS headers.
const originsRejected = [
  'https://evil.vercel.app',
  'https://gameguide-ai-evil.vercel.app',
  'https://attacker.com',
  'https://gameguide-ai.vercel.app.evil.com',
  'http://gameguide-ai.vercel.app',        // plaintext for a remote host
  'https://sub.gameguide-ai.vercel.app',
  'null', '', null, undefined, 123, 'not a url',
];
const originsAllowed = [
  'https://gameguide-ai.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
for (const o of originsRejected) {
  if (isAllowedOrigin(o) === false) pass++;
  else { fail++; console.log(`FAIL origin should be rejected: ${JSON.stringify(o)}`); }
}
for (const o of originsAllowed) {
  if (isAllowedOrigin(o) === true) pass++;
  else { fail++; console.log(`FAIL origin should be allowed: ${JSON.stringify(o)}`); }
}

// Additional origins are opt-in via env, never inferred from a suffix.
process.env.ALLOWED_ORIGINS = 'gameguide.example.com';
if (isAllowedOrigin('https://gameguide.example.com') === true) pass++;
else { fail++; console.log('FAIL ALLOWED_ORIGINS env not honoured'); }
if (isAllowedOrigin('https://other.example.com') === false) pass++;
else { fail++; console.log('FAIL ALLOWED_ORIGINS over-permissive'); }
delete process.env.ALLOWED_ORIGINS;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
