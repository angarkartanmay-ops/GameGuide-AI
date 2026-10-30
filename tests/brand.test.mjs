// The GameGuide mark: one geometry (src/site/brandMark.js), many outputs.
// Fails if the shipped SVGs drift from that geometry (re-run
// `node brand/render.mjs`), if an icon the manifest or the page names is
// missing, or if a brand spot falls back to the old bare diamond.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { markSvg, BRAND } = await import(pathToFileURL(join(ROOT, 'src/site/brandMark.js')).href);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
const check = (name, cond) => { if (cond) passed++; else { failed++; console.error(`  FAIL: ${name}`); } };

check('favicon.svg is the rendered mark', read('public/favicon.svg').trim() === markSvg({ tile: 'rounded' }));
check('icon.svg is the rendered mark', read('public/icon.svg').trim() === markSvg({ tile: 'rounded' }));
check('maskable icon keeps the mark in the safe zone', read('public/icon-maskable.svg').trim() === markSvg({ tile: 'square', scale: 0.92 }));
check('brand/mark.svg is the bare mark', read('brand/mark.svg').trim() === markSvg({ tile: null }));
check('the light-background mark swaps ink for night', read('brand/mark-on-light.svg').includes(BRAND.night) && !read('brand/mark-on-light.svg').includes(BRAND.ink));
check('never pure black', !markSvg().includes('#000"') && !/#000000/i.test(markSvg()));

const manifest = JSON.parse(read('public/manifest.webmanifest'));
for (const icon of manifest.icons) check(`manifest icon ${icon.src} exists`, existsSync(join(ROOT, 'public', icon.src)));
const html = read('index.html');
for (const ref of ['/favicon.svg', '/apple-touch-icon.png', 'og.png']) check(`index.html links ${ref}`, html.includes(ref));
for (const f of ['public/og.png', 'public/apple-touch-icon.png', 'brand/discord-avatar.png', 'brand/discord-banner.png', 'launch/assets/logo-240.png']) {
  check(`${f} rendered`, existsSync(join(ROOT, f)));
}

for (const f of ['src/components/site/SiteNav.jsx', 'src/components/site/SiteFooter.jsx', 'src/components/codex/CodexShell.jsx', 'src/components/codex/SharedAnswer.jsx']) {
  check(`${f} shows the brand mark`, /<BrandMark size=\{\d+\} \/>/.test(read(f)));
}
check('no brand spot uses the old bare diamond', !/cx-mark cx-mark--lg/.test(read('src/components/codex/CodexShell.jsx') + read('src/components/codex/SharedAnswer.jsx')));

console.log(`brand: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
