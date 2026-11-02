import { useCallback, useEffect, useState } from 'react';
import { isIos, isStandalone, installMode } from '../utils/install';
import { track } from '../utils/analytics';

/**
 * The browser's "install this app" prompt, held until the player asks for it.
 *
 * Chromium fires `beforeinstallprompt` once and expects the page to keep the
 * event; a listener in index.html catches it before React has mounted and
 * parks it on window.__ggInstall. Calling preventDefault there stops the
 * browser's own mini-infobar, so the only invitation is our button.
 *
 * Returns { mode, install }: mode is 'prompt' (call install()), 'ios' (show
 * the Add to Home Screen steps), or null (nothing to offer: already
 * installed, or a browser that cannot).
 */
export default function useInstallPrompt() {
  const [event, setEvent] = useState(() => (typeof window === 'undefined' ? null : window.__ggInstall || null));
  const [installed, setInstalled] = useState(() => typeof window !== 'undefined' && isStandalone(window));

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); window.__ggInstall = e; setEvent(e); };
    const onInstalled = () => { window.__ggInstall = null; setEvent(null); setInstalled(true); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    // It may have arrived between the first render and now.
    if (window.__ggInstall) setEvent(window.__ggInstall);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!event) return null;
    try {
      event.prompt();
      const { outcome } = await event.userChoice; // 'accepted' | 'dismissed'
      track('install', { outcome });
      return outcome;
    } catch {
      return null;
    } finally {
      // A prompt event can be used once; Chromium sends a new one if it will allow another.
      window.__ggInstall = null;
      setEvent(null);
    }
  }, [event]);

  const mode = installMode({
    hasPrompt: !!event,
    installed,
    ios: typeof navigator !== 'undefined' && isIos(navigator),
  });
  return { mode, install };
}
