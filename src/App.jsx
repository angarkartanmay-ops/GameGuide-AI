import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import './styles/chrome.css';
import { THEME_IDS, themes as THEME_LIST } from './theme/palettes';
import useChat from './hooks/useChat';
import useAuth from './hooks/useAuth';
import ThemeTransition from './components/ThemeTransition';
import { THEME_TRANSITION_DURATION, VARIANTS as FX_VARIANTS } from './theme/transition';
import usePerfMode from './hooks/usePerfMode';

// Each view is its own chunk: the landing no longer ships the chat's markdown
// and streaming code, and the chat no longer ships GSAP.
const LandingPage = lazy(() => import('./components/LandingPage'));
const InfoPage = lazy(() => import('./components/InfoPage'));
const CodexShell = lazy(() => import('./components/codex/CodexShell'));
// The reticle (and framer-motion with it) only ever shows on the landing,
// and only for a mouse — touch devices never download it.
const Crosshair = lazy(() => import('./components/Crosshair'));
const FINE_POINTER = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

const SharedAnswer = lazy(() => import('./components/codex/SharedAnswer'));

// Hash-routable static views. Anything outside this set falls back to landing
// (so a stale or unknown hash never strands the user on a blank page).
const INFO_VIEWS = new Set(['about', 'terms', 'privacy', 'contacts']);
const ALL_VIEWS = new Set(['landing', 'chat', ...INFO_VIEWS]);
// Shared answers live at #share/<payload>. The payload is case-sensitive
// base64url, so it's read raw — never lowercased, never rewritten.
const SHARE_PREFIX = 'share/';
const rawHash = () => (typeof window === 'undefined' ? '' : (window.location.hash || '').replace(/^#\/?/, ''));
function readViewFromHash() {
  if (typeof window === 'undefined') return null;
  const raw = rawHash();
  if (raw.startsWith(SHARE_PREFIX)) return 'share';
  const hash = raw.toLowerCase();
  return ALL_VIEWS.has(hash) ? hash : null;
}

// All selectable themes are dark. Any stored value outside this set (e.g.
// from a prior theme list) is migrated to the new default.
const DEFAULT_THEME = 'blackice';
function readStoredTheme() {
  const stored = localStorage.getItem('theme');
  if (stored && THEME_IDS.includes(stored)) return stored;
  return DEFAULT_THEME;
}
// Tracks whether the user has *explicitly* picked a theme (vs the implicit
// default applied on first load). Static pages (Info / About / Terms /
// Contacts) read this to decide whether to mirror the active theme or
// remain on the canonical neon-blue landing palette. Persists across
// reloads — once the user picks, all info pages follow forever.
const THEME_CHOSEN_KEY = 'gg_theme_chosen';
function readThemeChosen() {
  try { return localStorage.getItem(THEME_CHOSEN_KEY) === '1'; }
  catch { return false; }
}

function App() {
  // Initial view: explicit hash wins, else fall back to whether the user has
  // already entered the chat in this session.
  const [view, setView] = useState(() => {
    const fromHash = readViewFromHash();
    if (fromHash) return fromHash;
    return sessionStorage.getItem('gg_entered') === '1' ? 'chat' : 'landing';
  });
  const [shareHash, setShareHash] = useState(rawHash);
  const [theme, setTheme] = useState(readStoredTheme);
  const [themeChosen, setThemeChosen] = useState(readThemeChosen);
  // Active theme-swap effect. `null` while idle. The `key` (timestamp) forces
  // React to fully remount the overlay on each successive swap so staggered
  // animation delays don't carry over from the previous run.
  const [themeFx, setThemeFx] = useState(null);
  // Round-robin cursor across the 4 transition variants. A ref (not state)
  // because we only need it to mutate between renders, never to drive a
  // re-render itself.
  const variantCursor = useRef(0);
  // Global perf-mode probe. Sets <html data-low-power> when the device
  // can't keep 48fps so every page can strip heavy effects via CSS.
  usePerfMode();
  const { user, loading: authLoading } = useAuth();
  const chat = useChat(user);

  const [showLoader, setShowLoader] = useState(true);
  const [exitingLoader, setExitingLoader] = useState(false);
  // Splash plays exactly ONCE on initial app load — not on tab refocus,
  // token refresh, or any other auth state change.
  const splashShownRef = useRef(false);

  // First-render guard so the morph class doesn't engage on initial mount —
  // we only want the smooth interpolation when the user actively swaps.
  const themeFirstRunRef = useRef(true);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // Mirror the "explicitly chosen" flag onto <html> as a separate
    // attribute so CSS (InfoPage etc.) can branch on it without React.
    document.documentElement.toggleAttribute('data-theme-chosen', themeChosen);
    localStorage.setItem('theme', theme);
    if (themeFirstRunRef.current) {
      themeFirstRunRef.current = false;
      return undefined;
    }
    // Apply the morph class for ~520ms so every themed element interpolates
    // colors smoothly while the new palette comes in. Slightly longer than
    // the 480ms transition in index.css so the class never falls off
    // mid-animation. (Shortened from the original 750ms — the trimmed
    // transition list lets us finish faster without losing the cross-fade.)
    document.body.classList.add('is-theme-morphing');
    const t = setTimeout(() => document.body.classList.remove('is-theme-morphing'), 520);
    return () => clearTimeout(t);
  }, [theme, themeChosen]);

  // Theme-swap handler. Cycles round-robin through the 4 transition variants
  // so consecutive selections never play the same animation twice. The click
  // event is forwarded so origin-aware variants (hex, lance, pulse) radiate
  // from the actual click point; keyboard / programmatic selection falls
  // back to viewport center.
  const handleThemeChange = useCallback((nextId, event) => {
    if (nextId === theme) return;
    const meta = THEME_LIST.find((t) => t.id === nextId);
    if (!meta) return;
    const origin = event && typeof event.clientX === 'number'
      ? { x: event.clientX, y: event.clientY }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const variant = FX_VARIANTS[variantCursor.current % FX_VARIANTS.length];
    variantCursor.current = (variantCursor.current + 1) % FX_VARIANTS.length;
    setTheme(nextId);
    if (!themeChosen) {
      setThemeChosen(true);
      try { localStorage.setItem(THEME_CHOSEN_KEY, '1'); } catch { /* storage quota / private mode — non-fatal */ }
    }
    setThemeFx({
      variant,
      accent: meta.accent,
      accent2: meta.accent2,
      origin,
      key: Date.now(),
    });
  }, [theme, themeChosen]);

  // Auto-unmount the overlay after the cascade finishes so it never sticks
  // around eating compositor cycles.
  useEffect(() => {
    if (!themeFx) return undefined;
    const t = setTimeout(() => setThemeFx(null), THEME_TRANSITION_DURATION);
    return () => clearTimeout(t);
  }, [themeFx]);

  // ── Hash <-> view sync ─────────────────────────────────────
  // Keep the URL hash aligned with the current view (bare URL for landing,
  // `#about`/`#terms`/`#contacts`/`#chat` otherwise). We use replaceState
  // here so the sync itself never adds history entries — actual navigation
  // (navigate()) does pushState.
  useEffect(() => {
    // The share payload IS the hash; syncing would erase it.
    if (view === 'share') return;
    const expected = view === 'landing' ? '' : `#${view}`;
    if (window.location.hash !== expected) {
      const url = `${window.location.pathname}${window.location.search}${expected}`;
      window.history.replaceState(window.history.state, '', url);
    }
  }, [view]);

  // Browser back/forward + manual hash edits. The raw hash is tracked too, so
  // opening a second share link in the same tab shows the new answer.
  useEffect(() => {
    const onPop = () => {
      setView(readViewFromHash() || 'landing');
      setShareHash(rawHash());
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  // The push happens outside setView: React may run an updater twice
  // (StrictMode does), which pushed duplicate entries and made Back look
  // like it did nothing.
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const navigate = useCallback((next) => {
    if (!ALL_VIEWS.has(next) || viewRef.current === next) return;
    const hash = next === 'landing' ? '' : `#${next}`;
    const url = `${window.location.pathname}${window.location.search}${hash}`;
    window.history.pushState({ view: next }, '', url);
    viewRef.current = next;
    setView(next);
  }, []);

  const goLanding = useCallback(() => {
    // Drop the "already entered chat" flag so a hard reload from landing
    // doesn't skip the landing page.
    sessionStorage.removeItem('gg_entered');
    navigate('landing');
  }, [navigate]);

  const goChat = useCallback(() => {
    sessionStorage.setItem('gg_entered', '1');
    navigate('chat');
  }, [navigate]);

  // From a shared answer into the chat, optionally with a question drafted
  // (a follow-up chip); the chat consumes gg.startDraft once on mount.
  const askFromShare = useCallback((question) => {
    if (typeof question === 'string' && question.trim()) {
      try { sessionStorage.setItem('gg.startDraft', question.trim().slice(0, 200)); } catch { /* opens empty */ }
    }
    goChat();
  }, [goChat]);

  // Show the splash exactly once — on the first time auth resolves.
  useEffect(() => {
    if (authLoading) return;        // still bootstrapping — keep loader on
    if (splashShownRef.current) return; // already played the splash this session

    splashShownRef.current = true;
    const exitTimer = setTimeout(() => {
      setExitingLoader(true);
      const unmountTimer = setTimeout(() => setShowLoader(false), 500);
      return () => clearTimeout(unmountTimer);
    }, 1500);

    return () => clearTimeout(exitTimer);
  }, [authLoading]);

  // Overlay is fixed-position + pointer-events:none, so it can coexist with
  // any view underneath. Mount once at the top of whichever branch renders.
  const fxOverlay = themeFx && (
    <ThemeTransition
      key={themeFx.key}
      variant={themeFx.variant}
      accent={themeFx.accent}
      accent2={themeFx.accent2}
      origin={themeFx.origin}
    />
  );

  // View body is computed first, then wrapped with the long-lived Crosshair
  // + fxOverlay siblings — so view transitions (landing → chat → info) don't
  // remount the reticle and lose its spring/position state.
  let viewBody;
  if (view === 'share') {
    viewBody = (
      <SharedAnswer
        // Keyed by the link: opening a second share in the same tab starts
        // clean instead of showing the first one's art while it decodes.
        key={shareHash}
        encoded={shareHash.startsWith(SHARE_PREFIX) ? shareHash.slice(SHARE_PREFIX.length) : ''}
        onAsk={askFromShare}
        onHome={goLanding}
      />
    );
  } else if (view === 'landing') {
    viewBody = (
      <LandingPage
        onEnter={goChat}
        onNavigate={navigate}
      />
    );
  } else if (INFO_VIEWS.has(view)) {
    viewBody = (
      <InfoPage
        kind={view}
        onBack={() => {
          // Prefer real history (back-from-info returns to chat or landing,
          // whichever the user came from) — but only when the previous entry
          // is ours. navigate() stamps its entries with { view }; a deep link
          // has no stamp, and history.back() there would leave the site.
          if (window.history.state?.view) window.history.back();
          else goLanding();
        }}
        onLogo={goLanding}
        onNavigate={navigate}
      />
    );
  } else {
    viewBody = (
      <CodexShell
        user={user}
        chat={chat}
        theme={theme}
        onThemeChange={handleThemeChange}
        onHome={goLanding}
        navigate={navigate}
        showLoader={showLoader}
        exitingLoader={exitingLoader}
      />
    );
  }

  return (
    <>
      {/* The reticle suits the landing; the chat and the info pages are for
          reading and selecting text, so they keep the normal cursor. */}
      {view === 'landing' && FINE_POINTER && <Suspense fallback={null}><Crosshair /></Suspense>}
      <Suspense fallback={<div className="route-fallback" aria-hidden="true" />}>
        {viewBody}
      </Suspense>
      {fxOverlay}
    </>
  );
}

export default App;
