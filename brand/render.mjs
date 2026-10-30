#!/usr/bin/env node
// Renders every GameGuide brand asset from src/site/brandMark.js with
// headless Chrome (the fonts come from Google Fonts, as on the site).
//
//   node brand/render.mjs
//
// Writes: public/ (favicon, app icons, og.png), brand/ (mark SVGs, Discord
// avatar and banner, logo lockups) and launch/assets/ (listing logos).
// CHROME_PATH overrides where Chrome is looked for.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BRAND, markSvg } from '../src/site/brandMark.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(p => p && existsSync(p));
if (!CHROME) { console.error('No Chrome found; set CHROME_PATH.'); process.exit(1); }

const FONTS = '<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Geist:wght@300..900&family=Geist+Mono:wght@400..600&display=block" rel="stylesheet">';
const work = mkdtempSync(join(tmpdir(), 'gg-brand-'));

/** Render HTML to a PNG of exactly w×h CSS pixels (× scale). Transparent where the page is. */
function png(out, html, w, h, { scale = 1 } = {}) {
  const file = join(work, `p${Math.random().toString(36).slice(2)}.html`);
  writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:100%;height:100%}</style></head><body>${html}</body></html>`);
  mkdirSync(dirname(out), { recursive: true });
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--default-background-color=00000000', `--force-device-scale-factor=${scale}`,
    '--virtual-time-budget=6000', `--window-size=${w},${h}`, `--screenshot=${out}`, pathToFileURL(file).href,
  ], { stdio: 'ignore' });
  console.log(`  ${out.replace(ROOT, '').replace(/\\/g, '/')}  ${w * scale}×${h * scale}`);
}
const svgPng = (out, svg, size) => png(out, `<div style="width:${size}px;height:${size}px">${svg}</div>`, size, size);
const text = (out, svg) => { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, `${svg}\n`); console.log(`  ${out.replace(ROOT, '').replace(/\\/g, '/')}`); };

// Shared pieces for the wide images.
const markOnly = markSvg({ tile: null });
const hatch = 'background:radial-gradient(ellipse 55% 75% at 82% 18%, rgba(217,166,73,.13), transparent 70%), #07090d;';
// Diagonal hatching on the right, fading in rather than starting at an edge.
const stripes = '<i style="position:absolute;inset:0;background:repeating-linear-gradient(135deg, rgba(237,232,222,.05) 0 2px, transparent 2px 22px);'
  + '-webkit-mask-image:linear-gradient(90deg, transparent 38%, #000 78%);mask-image:linear-gradient(90deg, transparent 38%, #000 78%)"></i>';
const corners = (inset, len, color = 'rgba(237,232,222,.28)') => ['top:left', 'top:right', 'bottom:left', 'bottom:right'].map(c => {
  const [v, hz] = c.split(':');
  return `<i style="position:absolute;${v}:${inset}px;${hz}:${inset}px;width:${len}px;height:${len}px;border-${v}:2px solid ${color};border-${hz}:2px solid ${color}"></i>`;
}).join('');
const lockup = (markPx, fontPx, color = BRAND.ink, gap = 0.36) => `
  <div style="display:flex;align-items:center;gap:${Math.round(markPx * gap)}px;color:${color}">
    <div style="width:${markPx}px;height:${markPx}px">${color === BRAND.ink ? markOnly : markSvg({ tile: null, ink: color })}</div>
    <span style="font:760 ${fontPx}px 'Archivo';font-stretch:112%;letter-spacing:-0.025em;line-height:1">GameGuide</span>
  </div>`;

console.log('Rendering GameGuide brand assets');

// ── Website ──────────────────────────────────────────────────────────────
text(join(ROOT, 'public/favicon.svg'), markSvg({ tile: 'rounded' }));
text(join(ROOT, 'public/icon.svg'), markSvg({ tile: 'rounded' }));
text(join(ROOT, 'public/icon-maskable.svg'), markSvg({ tile: 'square', scale: 0.92 }));
svgPng(join(ROOT, 'public/icon-192.png'), markSvg({ tile: 'rounded' }), 192);
svgPng(join(ROOT, 'public/icon-512.png'), markSvg({ tile: 'rounded' }), 512);
svgPng(join(ROOT, 'public/icon-maskable-512.png'), markSvg({ tile: 'square', scale: 0.92 }), 512);
svgPng(join(ROOT, 'public/apple-touch-icon.png'), markSvg({ tile: 'square', scale: 0.92 }), 180);

png(join(ROOT, 'public/og.png'), `
  <div style="position:relative;width:1200px;height:630px;${hatch};color:${BRAND.ink};font-family:Geist">
    ${stripes}${corners(36, 28)}
    <div style="position:absolute;left:88px;top:78px">${lockup(44, 30)}</div>
    <h1 style="position:absolute;left:84px;top:150px;margin:0;font:400 104px/0.98 Fraunces;letter-spacing:-0.035em;color:${BRAND.ink}">
      Ask anything<br>about <em style="font-style:italic;color:${BRAND.gold}">any game.</em></h1>
    <p style="position:absolute;left:88px;top:388px;margin:0;width:800px;font:400 25px/1.6 Geist;color:rgba(237,232,222,.82)">
      Live answers, set like a strategy guide,<br>that stop where you are in the story.</p>
    <p style="position:absolute;left:88px;bottom:84px;margin:0;font:500 16px 'Geist Mono';letter-spacing:.2em;color:rgba(237,232,222,.6)">WEB · DISCORD · SPOILER-SAFE</p>
    <div style="position:absolute;right:88px;bottom:70px;padding:13px 22px;background:${BRAND.gold};color:#07090d;font:600 16px 'Geist Mono';letter-spacing:.2em;clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))">PRESS START</div>
  </div>`, 1200, 630);

// ── Brand kit ────────────────────────────────────────────────────────────
text(join(ROOT, 'brand/mark.svg'), markOnly);
text(join(ROOT, 'brand/mark-on-light.svg'), markSvg({ tile: null, ink: BRAND.night }));
text(join(ROOT, 'brand/icon.svg'), markSvg({ tile: 'rounded' }));
svgPng(join(ROOT, 'brand/icon-1024.png'), markSvg({ tile: 'rounded' }), 1024);
// Discord crops avatars to a circle: full-bleed square, mark well inside it.
svgPng(join(ROOT, 'brand/discord-avatar.png'), markSvg({ tile: 'square', scale: 0.92 }), 1024);
// Profile banner (17:6). The avatar circle covers the lower-left, so the
// lockup sits right of centre.
png(join(ROOT, 'brand/discord-banner.png'), `
  <div style="position:relative;width:680px;height:240px;${hatch};overflow:hidden">
    ${stripes}${corners(16, 16, 'rgba(237,232,222,.22)')}
    <div style="position:absolute;left:230px;top:66px">${lockup(64, 46)}</div>
    <p style="position:absolute;left:232px;top:156px;margin:0;font:500 11.5px 'Geist Mono';letter-spacing:.2em;color:rgba(237,232,222,.62)">ASK ANYTHING ABOUT ANY GAME · SPOILER-SAFE</p>
  </div>`, 680, 240, { scale: 2 });
png(join(ROOT, 'brand/lockup-on-dark.png'), `<div style="padding:0">${lockup(96, 70)}</div>`, 560, 96, { scale: 2 });
png(join(ROOT, 'brand/lockup-on-light.png'), `<div style="padding:0">${lockup(96, 70, BRAND.night)}</div>`, 560, 96, { scale: 2 });
png(join(ROOT, 'brand/lockup-card.png'), `
  <div style="position:relative;width:1200px;height:400px;${hatch};display:flex;align-items:center;justify-content:center">
    ${stripes}${corners(28, 24)}<div style="position:relative">${lockup(150, 108)}</div></div>`, 1200, 400);

// ── Listing logos (Product Hunt, Peerlist, LaunchBuff, bot lists) ───────
svgPng(join(ROOT, 'launch/assets/logo-240.png'), markSvg({ tile: 'square', scale: 0.92 }), 240);
svgPng(join(ROOT, 'launch/assets/logo-480.png'), markSvg({ tile: 'square', scale: 0.92 }), 480);
svgPng(join(ROOT, 'launch/assets/logo-512-rounded.png'), markSvg({ tile: 'rounded' }), 512);

rmSync(work, { recursive: true, force: true });
console.log('Done.');
