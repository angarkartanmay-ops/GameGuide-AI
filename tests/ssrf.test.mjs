import { safeFandomSubdomain, buildFandomUrl } from '../api/_wikiTarget.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
