// The Content-Security-Policy's view of index.html: which inline scripts it
// has, and the hash a policy must carry for each to be allowed to run.
//
// A hash is over the script's text exactly as the browser sees it, and the HTML
// parser turns CRLF into LF before a script is ever hashed, so a checkout with
// Windows line endings and one with Unix ones agree. Only scripts that run count:
// a data block (application/json, application/ld+json) is never executed, so
// the policy does not govern it.
//
// Run `node scripts/csp-hashes.mjs` to print the hashes after editing an inline
// script; tests/security-headers.test.mjs fails until vercel.json has them.

import { createHash } from 'node:crypto';

const INLINE = /<script(?<attrs>[^>]*)>(?<text>[\s\S]*?)<\/script>/gi;

/** The text of every classic inline script in an HTML document. */
export function inlineScripts(html) {
  const found = [];
  for (const m of String(html).matchAll(INLINE)) {
    const attrs = m.groups.attrs || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && type !== 'text/javascript' && type !== 'module') continue;
    found.push(m.groups.text.replace(/\r\n?/g, '\n'));
  }
  return found;
}

/** 'sha256-…' as a CSP source expression. */
export const scriptHash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

/** Every inline script's source expression, de-duplicated. */
export const inlineScriptHashes = (html) => [...new Set(inlineScripts(html).map(scriptHash))];
