import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import './styles/chrome.css';
import { THEME_IDS, themes as THEME_LIST } from './theme/palettes';
import useChat from './hooks/useChat';
import useAuth from './hooks/useAuth';
import ThemeTransition from './components/ThemeTransition';
import { THEME_TRANSITION_DURATION, VARIANTS as FX_VARIANTS } from './theme/transition';
import usePerfMode from './hooks/usePerfMode';
import ErrorBoundary from './components/ErrorBoundary';
import RouteSkeleton from './components/RouteSkeleton';
import RouteError from './components/RouteError';
import { ALL_VIEWS, INFO_VIEWS, pathForView, readShare, readViewFromLocation } from './site/route';

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
const UpgradePage = lazy(() => import('./components/site/UpgradePage'));

// Views live at real paths (site/route.js has the table: /about, /pricing, ...).
// "notfound" is a view too, but never one you navigate to: it is what an
// address that isn't ours shows, instead of quietly showing the landing page.
// A share is at /share/<payload>, or, for a link made before paths existed, in
// the fragment (#share/<payload>). The payload is case-sensitive base64url, so
// it is read raw: never lowercased, never rewritten.
const rawHash = () => (typeof window === 'undefined' ? '' : (window.location.hash || '').replace(/^#\/?/, ''));
const readView = () => (typeof window === 'undefined' ? null : readViewFromLocation(window.location));
const readSharePayload = () => (typeof window === 'undefined' ? null : readShare(window.location));

// The plans page arrives as /pricing#upgrade/<signed token> from /upgrade in
// Discord, or #upgrade/thanks back from a payment (the bot and the payment
// providers still send /#upgrade/..., which index.html moves to /pricing and
// keeps this fragment on). The token is kept for the visit (sessionStorage)
// and taken out of the address bar, so a reload still works and a copied URL
// does not carry it.
const UPGRADE_TOKEN_KEY = 'gg.upgradeToken';
function readUpgradeHash() {
  const raw = rawHash();
  let stored = '';
  try { stored = sessionStorage.getItem(UPGRADE_TOKEN_KEY) || ''; } catch { /* private mode */ }
  if (!raw.toLowerCase().startsWith('upgrade/')) return { token: stored, thanks: false };
  const rest = raw.slice('upgrade/'.length);
  if (rest === 'thanks') return { token: stored, thanks: true };
  try { sessionStorage.setItem(UPGRADE_TOKEN_KEY, rest); } catch { /* still works this load */ }
  return { token: rest, thanks: false };
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
  // Initial view: the address wins, else fall back to whether the user has
  // already entered the chat in this session.
  const [view, setView] = useState(() => {
    const fromUrl = readView();
    if (fromUrl) return fromUrl;
    return sessionStorage.getItem('gg_entered') === '1' ? 'chat' : 'landing';
  });
  const [share, setShare] = useState(readSharePayload);
  const [upgrade, setUpgrade] = useState(readUpgradeHash);
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

  // ── Address <-> view sync ──────────────────────────────────
  // Keep the address aligned with the view: the canonical path for a page
  // (/about, not /refund-policy or /#about), the bare root for the landing.
  // replaceState, so the sync itself never adds history entries; navigate()
  // is what pushes them.
  useEffect(() => {
    // A share's address IS its content; a 404 keeps the address that got it
    // there, so the person can see what was wrong with it.
    if (view === 'share' || view === 'notfound') return;
    const path = pathForView(view);
    if (path == null) return;
    const { pathname, search, hash } = window.location;
    // The only fragment worth keeping is the plans page's token, until it has
    // been read (readUpgradeHash ran when the page loaded, so it is safe to drop).
    if (pathname !== path || hash) {
      window.history.replaceState(window.history.state, '', `${path}${search}`);
    }
  }, [view]);

  // Browser back/forward, and an old-style #hash edited by hand. The share is
  // tracked too, so opening a second share link in the same tab shows the new
  // answer.
  useEffect(() => {
    const onPop = () => {
      setView(readView() || 'landing');
      setShare(readSharePayload());
      setUpgrade(readUpgradeHash());
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
    // A page's own path, so leaving a 404 for a bad address (/asdf) leaves the
    // bad address behind too.
    const url = `${pathForView(next)}${window.location.search}`;
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
        key={share?.encoded ?? ''}
        encoded={share?.encoded ?? ''}
        onAsk={askFromShare}
        onHome={goLanding}
      />
    );
  } else if (view === 'upgrade') {
    viewBody = (
      <UpgradePage
        token={upgrade.token}
        thanks={upgrade.thanks}
        onBack={() => {
          if (window.history.state?.view) window.history.back();
          else goLanding();
        }}
        onLogo={goLanding}
        onNavigate={navigate}
      />
    );
  } else if (view === 'landing') {
    viewBody = (
      <LandingPage
        onEnter={goChat}
        onNavigate={navigate}
      />
    );
  } else if (INFO_VIEWS.has(view) || view === 'notfound') {
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
      {/* A view that throws (or whose chunk fails to load) must not take the
          whole app down: this shows a small way out, and clears itself when
          the view changes. The root boundary in main.jsx is the last resort. */}
      <ErrorBoundary
        scope="route"
        resetKeys={[view]}
        fallback={({ reset }) => <RouteError onHome={() => { reset(); goLanding(); }} />}
      >
        <Suspense fallback={<RouteSkeleton />}>
          {viewBody}
        </Suspense>
      </ErrorBoundary>
      {fxOverlay}
    </>
  );
}

export default App;
