// "Install app" detection, kept pure so it can be tested without a browser.
// The manifest already exists (public/manifest.webmanifest); what is missing
// is knowing when to offer it, and what to say where the browser can't.

/** Already running as an installed app (home-screen icon, or a Chromium app window). */
export function isStandalone(win) {
  try {
    if (win?.navigator?.standalone === true) return true; // iOS home-screen apps
    return !!win?.matchMedia?.('(display-mode: standalone)')?.matches;
  } catch {
    return false;
  }
}

/** iPhone, iPad or iPod, including iPadOS, which calls itself a Mac. */
export function isIos(nav) {
  if (!nav) return false;
  if (/iphone|ipad|ipod/i.test(String(nav.userAgent || ''))) return true;
  return nav.platform === 'MacIntel' && Number(nav.maxTouchPoints) > 1;
}

/**
 * What to offer. Chromium hands over a prompt we can trigger (`hasPrompt`);
 * iOS has no such thing, so it gets a short how-to instead; anywhere else, or
 * once installed, nothing at all.
 * @returns {'prompt' | 'ios' | null}
 */
export function installMode({ hasPrompt, installed, ios }) {
  if (installed) return null;
  if (hasPrompt) return 'prompt';
  return ios ? 'ios' : null;
}
