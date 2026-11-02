// A new deploy removes the previous build's files. A tab still running the old
// build then fails to load the next view's chunk ("Failed to fetch dynamically
// imported module"), and Vite announces it as `vite:preloadError`. Reloading
// fetches the new build and fixes it, but only once a minute: a chunk that is
// really gone, or a phone that is really offline, then shows the error screen
// (components/RouteError) instead of reloading forever.

export const RELOAD_KEY = 'gg.chunkReload';
export const RELOAD_WINDOW_MS = 60_000;

/** True once per window. Without storage there is no way to stop a loop, so: false. */
export function shouldReload(storage, now = Date.now()) {
  try {
    const last = Number(storage.getItem(RELOAD_KEY) || 0);
    if (now - last < RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

export function installChunkReload(win = window) {
  win.addEventListener('vite:preloadError', () => {
    let store = null;
    try { store = win.sessionStorage; } catch { /* blocked */ }
    if (store && shouldReload(store)) win.location.reload();
  });
}
