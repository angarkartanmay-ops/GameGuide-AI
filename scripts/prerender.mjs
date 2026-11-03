// Write every page as its own HTML file, after `vite build`.
//
//   node scripts/prerender.mjs                 dist/ in place (what `npm run build` does)
//   node scripts/prerender.mjs --out some/dir  read dist/index.html, write somewhere else
//   node scripts/prerender.mjs --template index.html --out tmp   use the source shell (tests)
//
// The app is a single-page app: one index.html, with the page chosen by
// JavaScript. A crawler, a link preview or a reader without JavaScript got the
// home page's tags and none of the text, whatever the address. This gives each
// address its own file: its own title, description, canonical, structured data
// and text (see src/prerender/shell.js for exactly what, and why it is invisible
// to anyone running JavaScript).
//
// Written:
//   index.html, about/index.html, terms/index.html, ...   one per page
//   404.html                  what the host serves, with a 404 status, for any other address
//   share-shell.html          the shell api/share.js dresses with a shared answer's tags
//   sitemap.xml               the pages worth listing (src/site/seo.js)
//
// The text is rendered from the app's own components through Vite's SSR
// loader, so JSX, CSS imports and import.meta.env behave as they do in the app.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { buildPage } from '../src/prerender/shell.js';
import { sitemapXml } from '../src/site/seo.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {{ template?: string, outDir?: string, root?: string }} [options]
 *   template  path of the shell to start from (default: dist/index.html, the built one)
 *   outDir    where to write (default: dist)
 * @returns {Promise<{ file: string, view: string, bytes: number }[]>}
 */
export async function prerender({ template, outDir, root = ROOT } = {}) {
  const out = resolve(outDir || join(root, 'dist'));
  const shell = readFileSync(resolve(template || join(out, 'index.html')), 'utf8');

  const server = await createServer({
    root,
    configFile: false,
    plugins: [react()],
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  let plan;
  try {
    const content = await server.ssrLoadModule('/src/prerender/plan.js');
    plan = content.pagePlan();
  } finally {
    await server.close();
  }

  const written = [];
  for (const page of plan) {
    const html = buildPage(shell, page.head, page.body);
    const target = join(out, page.file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, html);
    written.push({ file: page.file, view: page.view, bytes: Buffer.byteLength(html) });
  }
  writeFileSync(join(out, 'sitemap.xml'), sitemapXml());
  written.push({ file: 'sitemap.xml', view: null, bytes: Buffer.byteLength(sitemapXml()) });
  return written;
}

// Run as a script, not when a test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const written = await prerender({ template: arg('template'), outDir: arg('out') });
  for (const w of written) console.log(`prerender  ${w.file.padEnd(28)} ${(w.bytes / 1024).toFixed(1)} kB`);
  console.log(`prerender  ${written.length} files`);
}
