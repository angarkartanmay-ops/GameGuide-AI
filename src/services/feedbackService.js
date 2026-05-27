import { supabase } from './supabaseClient';

/**
 * Submit feedback to Supabase.
 * If Supabase is not configured (placeholder URL), falls back to localStorage
 * so development/demo mode still works without a backend.
 */
export async function submitFeedback({ rating, category, message, screenshotDataUrl, sessionId }) {
  const payload = {
    rating,
    category,
    message: message?.trim() || null,
    screenshot_data_url: screenshotDataUrl || null,
    session_id: sessionId || null,
    user_agent: navigator.userAgent,
    created_at: new Date().toISOString(),
    // A stable share ID so the feedback can be linked later
    share_id: generateShareId(),
  };

  // Detect placeholder / unconfigured Supabase — read directly from the env
  // var that was used to construct the client. supabase.supabaseUrl is not a
  // public API on all versions of the JS SDK.
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const isConfigured = supabaseUrl.length > 0 && !supabaseUrl.includes('placeholder.supabase.co');

  if (isConfigured) {
    const { data, error } = await supabase
      .from('feedback')
      .insert([payload])
      .select('id, share_id')
      .single();

    if (error) throw error;
    return { ...payload, id: data.id, share_id: data.share_id };
  }

  // ── Fallback: persist in localStorage for offline / dev use ────────────────
  const stored = JSON.parse(localStorage.getItem('gg_feedback') || '[]');
  const entry = { ...payload, id: `local_${Date.now()}` };
  stored.push(entry);
  localStorage.setItem('gg_feedback', JSON.stringify(stored));
  return entry;
}

/** Read all locally stored feedback (dev / offline mode). */
export function getLocalFeedback() {
  return JSON.parse(localStorage.getItem('gg_feedback') || '[]');
}

/** Generate a short alphanumeric share ID. */
function generateShareId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

/**
 * Build a shareable URL encoding the feedback share_id.
 * Opens as a deep-link: https://your-app.com/#feedback/<shareId>
 */
export function buildShareUrl(shareId) {
  const base = window.location.origin + window.location.pathname;
  return `${base}#feedback/${shareId}`;
}

/**
 * Capture the current visible viewport as a PNG data-URL using the
 * html2canvas-style Canvas API approach.
 * Falls back gracefully if browser blocks it.
 */
export async function captureScreenshot() {
  try {
    // Use the modern Screen Capture API if available
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { mediaSource: 'screen' },
      audio: false,
      preferCurrentTab: true,
    });
    const track = stream.getVideoTracks()[0];
    const imageCapture = new ImageCapture(track);
    const bitmap = await imageCapture.grabFrame();
    track.stop();

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    // User denied or API unavailable — return null (caller handles gracefully)
    return null;
  }
}
