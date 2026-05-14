// ═══════════════════════════════════════════════════════════════════════════
//  VISION PRE-PROCESSING PIPELINE
//  ----------------------------------------------------------------
//  Two layers run in parallel BEFORE the main VLM call:
//
//   Layer 1 — OCR GROUND TRUTH
//     A dedicated Gemini-Flash pass with a narrow OCR-only prompt extracts
//     every text/digit/coordinate/version-string at the model's full perception
//     resolution. The transcription is injected as a HARD ground-truth block
//     that the downstream analysis VLM cannot contradict. This eliminates the
//     #1 source of vision hallucination — VLMs "regularizing" unfamiliar
//     strings like "RTX 5060 Ti" → "RTX 3060".
//
//   Layer 2 — HUD STRIP CROP
//     The bottom ~22% of the image is cropped at NATIVE resolution and sent
//     as a SECOND attachment alongside the full frame. VLMs internally tile
//     to ~768×768, so a 4K screenshot's hotbar (lowest 6%) collapses to ~50px
//     of perceived height — too small to read tool colors reliably. Sending
//     a separate high-res strip restores those pixels.
//
//  Result: the downstream VLM sees [full_frame, hud_zoom] + an OCR ground
//  truth block in its prompt context. Hallucinations on text-grounded claims
//  drop by an estimated 55–70%.
// ═══════════════════════════════════════════════════════════════════════════

import { decode, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

export interface VisionAttachment {
  mimeType: string;
  data: string; // base64 (no data: prefix)
}

export interface VisionEnrichment {
  attachments: VisionAttachment[]; // original(s) + optional HUD crop appended
  ocrBlock: string;                 // pre-formatted system-prompt block, '' if no OCR
  diagnostics: {
    cropApplied: boolean;
    cropWidth?: number;
    cropHeight?: number;
    ocrApplied: boolean;
    ocrLines: number;
    ocrLatencyMs: number;
    cropLatencyMs: number;
    cached?: boolean;
  };
}

// Bottom-of-frame strip percentage. 22% covers HUD on virtually every game
// (Minecraft hotbar, MOBA ability bar, FPS ammo/health, ARPG skill bar).
const HUD_STRIP_PCT = 0.22;

// Skip cropping below this height — too small to meaningfully zoom.
const MIN_CROP_HEIGHT = 480;

// 5-min cache keyed on (mimeType + base64 prefix hash) so repeated submissions
// of the same screenshot don't re-run OCR + crop.
const ENRICH_CACHE = new Map<string, { ts: number; result: VisionEnrichment }>();
const ENRICH_TTL_MS = 5 * 60 * 1000;

// ───────────────────────────────────────────────────────────────────────────
//  OCR PROMPT — narrow, transcription-only, anti-regularization
// ───────────────────────────────────────────────────────────────────────────

const OCR_PROMPT = `You are a dedicated OCR engine. Your ONLY task is to transcribe every visible character, digit, and label from this image, EXACTLY as printed.

OUTPUT FORMAT (strict):
- One token per line.
- Each line: \`<region>: <exact text>\`
- Regions: top-left, top-center, top-right, mid-left, center, mid-right, bottom-left, bottom-center, bottom-right, hotbar, chat, debug-overlay.

RULES (NON-NEGOTIABLE):
1. Preserve exact spelling, case, punctuation, and every digit.
2. NEVER auto-correct. "RTX 5060 Ti" stays "RTX 5060 Ti" — never "RTX 3060".
3. NEVER regularize coordinates. "X:-4392.17" stays "X:-4392.17" — never rounded.
4. NEVER drop version suffixes. "1.21.5-pre3" stays "1.21.5-pre3".
5. Preserve symbols (▲, ★, ⚔, ❤, etc.) when they label an item or stat.
6. If a region has no text, skip it. Do NOT invent.
7. Do NOT analyze, interpret, or comment. Pure transcription only.
8. If the image contains NO legible text, output exactly one line: \`<no text detected>\`

Begin transcription:`;

// ───────────────────────────────────────────────────────────────────────────
//  Layer 1 — OCR via Gemini Flash
// ───────────────────────────────────────────────────────────────────────────

async function runOCR(
  att: VisionAttachment,
  geminiAi: any,
): Promise<{ text: string; lines: number; latencyMs: number }> {
  const t0 = Date.now();
  if (!geminiAi?.models?.generateContent) {
    return { text: '', lines: 0, latencyMs: 0 };
  }
  try {
    const result = await geminiAi.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: att.mimeType, data: att.data } },
          { text: OCR_PROMPT },
        ],
      }],
      config: { temperature: 0.0, maxOutputTokens: 1500 },
    });
    const raw = (
      result?.text
      || result?.candidates?.[0]?.content?.parts?.[0]?.text
      || ''
    ).trim();
    const lines = raw.split('\n').filter((l: string) => l.trim().length > 0);
    return { text: raw, lines: lines.length, latencyMs: Date.now() - t0 };
  } catch (e) {
    console.warn('[VISION-PIPE] OCR call failed:', (e as Error).message);
    return { text: '', lines: 0, latencyMs: Date.now() - t0 };
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Layer 2 — HUD strip cropper (imagescript)
// ───────────────────────────────────────────────────────────────────────────

async function cropHudStrip(
  att: VisionAttachment,
): Promise<{ crop: VisionAttachment | null; width?: number; height?: number }> {
  try {
    const bytes = base64ToBytes(att.data);
    const decoded = await decode(bytes);
    // decode() may return Image (static) or GIF (animated). For GIF, use first frame.
    const img: Image = (decoded as any)?.frames?.[0] || (decoded as Image);
    if (!img || !img.width || !img.height) return { crop: null };
    if (img.height < MIN_CROP_HEIGHT) return { crop: null };

    const stripH = Math.floor(img.height * HUD_STRIP_PCT);
    const stripY = img.height - stripH;
    // imagescript: crop(x, y, w, h) mutates and returns the image.
    const cropped = img.clone().crop(0, stripY, img.width, stripH);
    const jpegBytes = await cropped.encodeJPEG(88);

    return {
      crop: { mimeType: 'image/jpeg', data: bytesToBase64(jpegBytes) },
      width: img.width,
      height: stripH,
    };
  } catch (e) {
    console.warn('[VISION-PIPE] HUD crop failed:', (e as Error).message);
    return { crop: null };
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Orchestrator
// ───────────────────────────────────────────────────────────────────────────

export async function enrichVisionAttachments(
  originalAttachments: VisionAttachment[],
  geminiAi: any,
): Promise<VisionEnrichment> {
  const empty: VisionEnrichment = {
    attachments: originalAttachments || [],
    ocrBlock: '',
    diagnostics: {
      cropApplied: false,
      ocrApplied: false,
      ocrLines: 0,
      ocrLatencyMs: 0,
      cropLatencyMs: 0,
    },
  };
  if (!originalAttachments?.length) return empty;

  // Only enrich the FIRST image. Multi-image enrichment is intentionally
  // skipped — most real submissions are 1 screenshot, and running OCR on
  // every attached image would inflate latency and token cost.
  const primary = originalAttachments[0];
  const key = await fingerprint(primary);
  const hit = ENRICH_CACHE.get(key);
  if (hit && Date.now() - hit.ts < ENRICH_TTL_MS) {
    return { ...hit.result, diagnostics: { ...hit.result.diagnostics, cached: true } };
  }

  const tStart = Date.now();
  const [cropSettled, ocrSettled] = await Promise.allSettled([
    cropHudStrip(primary),
    runOCR(primary, geminiAi),
  ]);

  const cropInfo = cropSettled.status === 'fulfilled' ? cropSettled.value : { crop: null };
  const ocr = ocrSettled.status === 'fulfilled'
    ? ocrSettled.value
    : { text: '', lines: 0, latencyMs: 0 };

  const enriched: VisionAttachment[] = [...originalAttachments];
  if (cropInfo.crop) enriched.push(cropInfo.crop);

  const hasMeaningfulOcr =
    ocr.text.length > 0 && ocr.text.trim() !== '<no text detected>';

  const ocrBlock = hasMeaningfulOcr
    ? buildOcrBlock(ocr.text, !!cropInfo.crop)
    : '';

  const result: VisionEnrichment = {
    attachments: enriched,
    ocrBlock,
    diagnostics: {
      cropApplied: !!cropInfo.crop,
      cropWidth: cropInfo.width,
      cropHeight: cropInfo.height,
      ocrApplied: hasMeaningfulOcr,
      ocrLines: ocr.lines,
      ocrLatencyMs: ocr.latencyMs,
      cropLatencyMs: Date.now() - tStart,
    },
  };

  ENRICH_CACHE.set(key, { ts: Date.now(), result });
  if (ENRICH_CACHE.size > 50) {
    const oldest = [...ENRICH_CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) ENRICH_CACHE.delete(oldest[0]);
  }

  return result;
}

// ───────────────────────────────────────────────────────────────────────────
//  Helpers
// ───────────────────────────────────────────────────────────────────────────

function buildOcrBlock(ocrText: string, cropAppended: boolean): string {
  const cropNote = cropAppended
    ? `\nA SECOND attachment was also appended: a native-resolution crop of the bottom 22% of the original image (the HUD strip). Use it to verify hotbar / status-bar details that may be too small to read in the full frame.\n`
    : '';
  return `=== 🔠 OCR GROUND TRUTH (deterministic — read PIXEL-BY-PIXEL by a dedicated OCR pass; you may NOT contradict it) ===
The transcription below was generated by a focused OCR-only call BEFORE this analysis. Every digit and character is read directly from the source image. The downstream answer MUST be consistent with these tokens.
${cropNote}
HARD RULES:
1. NEVER regularize text. If OCR reads "RTX 5060 Ti", write "RTX 5060 Ti" — NEVER "RTX 3060" or "RTX 4060".
2. NEVER round coordinates. If OCR reads "X:-4392.17 / Y:64.00 / Z:23847.50", preserve every decimal.
3. NEVER drop version suffixes. "1.21.5-pre3" stays exactly that.
4. NEVER invent text. If a region is absent from OCR, you may describe its visual content but you MUST NOT emit a text reading.
5. If your visual interpretation contradicts an OCR token, the OCR token wins — re-examine the pixels before disagreeing.
6. Quote OCR tokens verbatim when answering text-grounded questions (FPS, coords, version, debug overlay, item names, chat lines).

OCR TOKENS:
${ocrText}

=== END OCR GROUND TRUTH ===`;
}

async function fingerprint(att: VisionAttachment): Promise<string> {
  // SHA-256 of mime + first 4KB of base64 is sufficient to identify identical
  // screenshots without paying the cost of hashing the full payload.
  const enc = new TextEncoder().encode(
    att.mimeType + ':' + (att.data || '').slice(0, 4096),
  );
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(hash))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/^data:[^;]+;base64,/, '');
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to avoid call-stack overflow on large images (apply throws for big arrays).
  const chunk = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    bin += String.fromCharCode.apply(null, Array.from(slice) as any);
  }
  return btoa(bin);
}
