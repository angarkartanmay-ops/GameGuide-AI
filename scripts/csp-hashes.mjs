// node scripts/csp-hashes.mjs [file.html]
// Print the script-src hash of each inline script in index.html (or another
// page), ready to paste into the Content-Security-Policy in vercel.json.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineScripts, scriptHash } from '../src/prerender/csp.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(process.argv[2] || join(ROOT, 'index.html'));
for (const text of inlineScripts(readFileSync(file, 'utf8'))) {
  console.log(`${scriptHash(text)}   ${text.trim().split('\n')[0].slice(0, 70)}`);
}
