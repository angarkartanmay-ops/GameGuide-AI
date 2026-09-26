// ═══════════════════════════════════════════════════════════════════════════
//  Accent colour from game art — pure maths, no DOM.
//
//  The chat takes one accent from the game you're asking about. It must be
//  the art's character (Elden Ring's gold, Cyberpunk's yellow), yet always
//  readable as text on the dark surface — so the dominant saturated hue is
//  picked, then lightness is raised until it clears WCAG AA against the
//  background. Greyscale art returns null and the theme accent stays.
// ═══════════════════════════════════════════════════════════════════════════

export function rgbToHsl({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0));
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToRgb({ h, s, l }) {
  const C = (1 - Math.abs(2 * l - 1)) * s;
  const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - C / 2;
  const [r, g, b] =
    h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X]
      : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function relativeLuminance({ r, g, b }) {
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const BINS = 24;

/**
 * Dominant colourful hue of an RGBA pixel buffer, or null when the art is
 * essentially grey. Each pixel votes for its hue bin, weighted by saturation
 * and by how far it is from black or white, so a big dark sky loses to the
 * small bright sigil that gives the art its character.
 */
export function pickAccent(pixels) {
  const weight = new Float64Array(BINS);
  const sum = Array.from({ length: BINS }, () => ({ r: 0, g: 0, b: 0, w: 0 }));
  let total = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const px = { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] };
    const { h, s, l } = rgbToHsl(px);
    if (l < 0.12 || l > 0.94) continue;
    const w = s * s * (1 - Math.abs(l - 0.55) * 1.4);
    if (w <= 0.02) continue;
    const bin = Math.min(BINS - 1, Math.floor(h / (360 / BINS)));
    weight[bin] += w;
    const acc = sum[bin];
    acc.r += px.r * w; acc.g += px.g * w; acc.b += px.b * w; acc.w += w;
    total += w;
  }
  if (total < 0.5) return null;
  let best = 0;
  for (let i = 1; i < BINS; i++) if (weight[i] > weight[best]) best = i;
  const a = sum[best];
  return { r: Math.round(a.r / a.w), g: Math.round(a.g / a.w), b: Math.round(a.b / a.w) };
}

/** Clamp saturation, then lighten until the colour reads on `bg` at `min`:1. */
export function ensureContrast(rgb, bg = { r: 7, g: 9, b: 13 }, min = 4.5) {
  const hsl = rgbToHsl(rgb);
  hsl.s = Math.min(hsl.s, 0.78);
  hsl.l = Math.min(Math.max(hsl.l, 0.5), 0.78);
  let out = hslToRgb(hsl);
  while (contrastRatio(out, bg) < min && hsl.l < 0.9) {
    hsl.l += 0.02;
    out = hslToRgb(hsl);
  }
  return out;
}

export function toHex({ r, g, b }) {
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
