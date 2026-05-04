// Normalizes any user-uploaded image into a Gemini-friendly JPEG.
// - HEIC/AVIF/WebP/PNG/JPG → JPEG (image/jpeg)
// - Resizes long edge to MAX_EDGE (1568px = Gemini sweet spot)
// - Strips EXIF (canvas re-encode discards it)
// - Re-compresses to QUALITY (0.88) so most screenshots land 200KB-2MB
// - Hard rejects anything still > MAX_BYTES after compression
//
// Returns: { data: base64String, mimeType: 'image/jpeg', width, height, bytes }
// Throws:  Error with .code = 'TOO_LARGE' | 'DECODE_FAILED' | 'UNSUPPORTED'

const MAX_EDGE = 1568;
const QUALITY = 0.88;
const MAX_BYTES = 4 * 1024 * 1024;

export async function preprocessImage(file) {
  if (!file || !file.type?.startsWith('image/')) {
    const e = new Error('Not an image');
    e.code = 'UNSUPPORTED';
    throw e;
  }

  // Decode via createImageBitmap — handles HEIC on Safari, AVIF on Chrome,
  // and is much faster than <img> + onload dance.
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Fallback: try via <img> element (some browsers can't bitmap HEIC)
    bitmap = await loadViaImg(file);
  }
  if (!bitmap) {
    const e = new Error('Could not decode image');
    e.code = 'DECODE_FAILED';
    throw e;
  }

  // Compute target size
  const { width: w, height: h } = bitmap;
  const longEdge = Math.max(w, h);
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);

  // Re-encode via canvas
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, tw, th);
  bitmap.close?.();

  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', QUALITY));
  if (!blob) {
    const e = new Error('Re-encode failed');
    e.code = 'DECODE_FAILED';
    throw e;
  }
  if (blob.size > MAX_BYTES) {
    const e = new Error(`Image still ${(blob.size / 1024 / 1024).toFixed(1)}MB after compression`);
    e.code = 'TOO_LARGE';
    throw e;
  }

  const data = await blobToBase64(blob);
  return { data, mimeType: 'image/jpeg', width: tw, height: th, bytes: blob.size };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function loadViaImg(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
