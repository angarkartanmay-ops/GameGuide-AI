// The GameGuide mark: an angular "G" (chamfered like the site's game-UI
// buttons) holding the brand diamond — the waypoint that tells you where to
// go next. One source of truth for the site's <BrandMark> and for every
// rendered asset (brand/render.mjs): favicon, app icons, social card,
// Discord avatar and banner, listing logos.
//
// Geometry is on a 512 grid. The G is a stroked path (miter joins, butt
// caps); the diamond is a rotated square.

export const BRAND = Object.freeze({
  ink: '#EDE8DE',      // warm off-white, the codex ink
  gold: '#D9A649',     // the brand diamond
  night: '#0B0E14',    // tile background (near-black, never #000)
});

export const G_PATH = 'M316 120 L196 120 L120 196 L120 316 L196 392 L316 392 L392 316 L392 262 L330 262';
export const G_STROKE = 60;
// The diamond: a 72px square, 6px corner radius, turned 45° about (262, 262).
export const DIAMOND = Object.freeze({ x: 226, y: 226, size: 72, rx: 6, cx: 262, cy: 262 });
// The mark's own bounds (stroke included), for a tight viewBox.
export const MARK_VIEWBOX = '90 90 332 332';

/**
 * The mark as an SVG string.
 * @param tile        'rounded' (app icon), 'square' (full bleed: Discord,
 *                    Apple, maskable) or null (transparent, mark only)
 * @param scale       mark size inside a tile (1 = as drawn on the 512 grid)
 * @param ink, gold   colours (swap ink for night on light backgrounds)
 */
export function markSvg({ tile = 'rounded', scale = 1, ink = BRAND.ink, gold = BRAND.gold, night = BRAND.night } = {}) {
  const d = DIAMOND;
  const mark = `<path d="${G_PATH}" fill="none" stroke="${ink}" stroke-width="${G_STROKE}" stroke-linejoin="miter"/>`
    + `<rect x="${d.x}" y="${d.y}" width="${d.size}" height="${d.size}" rx="${d.rx}" fill="${gold}" transform="rotate(45 ${d.cx} ${d.cy})"/>`;
  if (!tile) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}">${mark}</svg>`;
  const bg = tile === 'rounded'
    ? `<rect width="512" height="512" rx="112" fill="${night}"/>`
    : `<rect width="512" height="512" fill="${night}"/>`;
  const inner = scale === 1 ? mark : `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${mark}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}${inner}</svg>`;
}
