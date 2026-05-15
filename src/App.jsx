import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { Gamepad2, Radio, BookOpen, DollarSign, Globe } from 'lucide-react';
import ThemeSelector, { THEME_IDS, themes as THEME_LIST } from './components/ThemeSelector';
import UserProfile from './components/UserProfile';
import ChatContainer from './components/ChatContainer';
import ChatInput from './components/ChatInput';
import PriceBadge from './components/PriceBadge';
import useChat from './hooks/useChat';
import useAuth from './hooks/useAuth';
import LoadingScreen from './components/LoadingScreen';
import LandingPage from './components/LandingPage';
import InfoPage from './components/InfoPage';
import ThemeTransition, { THEME_TRANSITION_DURATION, VARIANTS as FX_VARIANTS } from './components/ThemeTransition';

// Hash-routable static views. Anything outside this set falls back to landing
// (so a stale or unknown hash never strands the user on a blank page).
const INFO_VIEWS = new Set(['about', 'terms', 'contacts']);
const ALL_VIEWS = new Set(['landing', 'chat', ...INFO_VIEWS]);
function readViewFromHash() {
  if (typeof window === 'undefined') return null;
  const hash = (window.location.hash || '').replace(/^#\/?/, '').toLowerCase();
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

function App() {
  // Initial view: explicit hash wins, else fall back to whether the user has
  // already entered the chat in this session.
  const [view, setView] = useState(() => {
    const fromHash = readViewFromHash();
    if (fromHash) return fromHash;
    return sessionStorage.getItem('gg_entered') === '1' ? 'chat' : 'landing';
  });
  const [theme, setTheme] = useState(readStoredTheme);
  // Active theme-swap effect. `null` while idle. The `key` (timestamp) forces
  // React to fully remount the overlay on each successive swap so staggered
  // animation delays don't carry over from the previous run.
  const [themeFx, setThemeFx] = useState(null);
  // Round-robin cursor across the 4 transition variants. A ref (not state)
  // because we only need it to mutate between renders, never to drive a
  // re-render itself.
  const variantCursor = useRef(0);
  const { user, loading: authLoading } = useAuth();
  const { messages, isLoading, sendMessage, cancelRequest, redditActive, wikiActive, webActive, priceActive, priceData, SLASH_COMMANDS } = useChat(user);

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
    localStorage.setItem('theme', theme);
    if (themeFirstRunRef.current) {
      themeFirstRunRef.current = false;
      return undefined;
    }
    // Apply the morph class for ~750ms so every themed element interpolates
    // colors smoothly while the new palette comes in. Slightly longer than
    // the 700ms transition so the class never falls off mid-animation.
    document.body.classList.add('is-theme-morphing');
    const t = setTimeout(() => document.body.classList.remove('is-theme-morphing'), 750);
    return () => clearTimeout(t);
  }, [theme]);

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
    setThemeFx({
      variant,
      accent: meta.accent,
      accent2: meta.accent2,
      origin,
      key: Date.now(),
    });
  }, [theme]);

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
    const expected = view === 'landing' ? '' : `#${view}`;
    if (window.location.hash !== expected) {
      const url = `${window.location.pathname}${window.location.search}${expected}`;
      window.history.replaceState(window.history.state, '', url);
    }
  }, [view]);

  // Browser back/forward + manual hash edits.
  useEffect(() => {
    const onPop = () => setView(readViewFromHash() || 'landing');
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  const navigate = useCallback((next) => {
    if (!ALL_VIEWS.has(next)) return;
    setView((prev) => {
      if (prev === next) return prev;
      const hash = next === 'landing' ? '' : `#${next}`;
      const url = `${window.location.pathname}${window.location.search}${hash}`;
      window.history.pushState({ view: next }, '', url);
      return next;
    });
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

  if (view === 'landing') {
    return (
      <>
        <LandingPage
          onEnter={goChat}
          onNavigate={navigate}
        />
        {fxOverlay}
      </>
    );
  }

  if (INFO_VIEWS.has(view)) {
    return (
      <>
        <InfoPage
          kind={view}
          onBack={() => {
            // Prefer real history (back-from-info returns to chat or landing,
            // whichever the user came from). Fall back to landing if history
            // is empty (e.g. direct deep link).
            if (window.history.length > 1) window.history.back();
            else goLanding();
          }}
          onLogo={goLanding}
          onNavigate={navigate}
        />
        {fxOverlay}
      </>
    );
  }

  return (
    <div className="app-container">
      {showLoader && <LoadingScreen isExiting={exitingLoader} />}
      <header className="main-header">
        <button
          type="button"
          className="brand brand--button"
          onClick={goLanding}
          aria-label="Return to home"
          title="Return to home"
        >
          <Gamepad2 className="brand-icon" size={32} />
          <h1>GameGuide-AI</h1>
          <div className="intel-badges">
            {redditActive && (
              <div className="community-badge animate-fade-in">
                <Radio size={14} />
                <span>Community Intel</span>
              </div>
            )}
            {wikiActive && (
              <div className="community-badge wiki-badge animate-fade-in">
                <BookOpen size={14} />
                <span>Wiki Intel</span>
              </div>
            )}
            {webActive && (
              <div className="community-badge web-badge animate-fade-in">
                <Globe size={14} />
                <span>Web Intel</span>
              </div>
            )}
            {priceActive && (
              <div className="community-badge price-badge animate-fade-in">
                <DollarSign size={14} />
                <span>Live Prices</span>
              </div>
            )}
          </div>
        </button>
        <div className="header-controls">
          <ThemeSelector currentTheme={theme} onThemeChange={handleThemeChange} />
          <UserProfile />
        </div>
      </header>

      <main className="chat-wrapper">
        
        <ChatContainer
          messages={messages}
          isLoading={isLoading}
          onFollowUpClick={(question) => sendMessage(question, [])}
        />
        {priceActive && <PriceBadge priceData={priceData} />}
        <ChatInput onSendMessage={sendMessage} onCancel={cancelRequest} isLoading={isLoading} SLASH_COMMANDS={SLASH_COMMANDS} />
      </main>

      <footer className="chat-footer">
        <button type="button" onClick={() => navigate('about')}>About</button>
        <span className="chat-footer__sep">·</span>
        <button type="button" onClick={() => navigate('terms')}>Terms</button>
        <span className="chat-footer__sep">·</span>
        <button type="button" onClick={() => navigate('contacts')}>Contact</button>
        <span className="chat-footer__sep">·</span>
        <span className="chat-footer__copy">© 2026 GameGuide-AI</span>
      </footer>
      {fxOverlay}
    </div>
  );
}

export default App;
