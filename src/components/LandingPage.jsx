import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import useDailyGames from '../site/useDailyGames';
import usePageMeta from '../site/usePageMeta';
import { achievements } from '../site/achievements';
import { advance, isTypingTarget } from '../site/konami';
import { gsap, ScrollTrigger, scrollToId, useCalm, useLenis, useScene, scheduleRefresh } from '../site/motion';
import SiteNav from './site/SiteNav';
import SiteFooter from './site/SiteFooter';
import Achievements from './site/Achievements';
import Hero from './site/Hero';
import HowItWorks from './site/HowItWorks';
import AnswerAnatomy from './site/AnswerAnatomy';
import ShieldDemo from './site/ShieldDemo';
import LibraryWall from './site/LibraryWall';
import CapabilityMenu from './site/CapabilityMenu';
import WatchtowerDemo from './site/WatchtowerDemo';
import Closing from './site/Closing';
import ErrorBoundary from './ErrorBoundary';
import { track } from '../utils/analytics';
import '../styles/site.css';

const EXIT_MS = 560;
const WARM_DELAY_MS = 2500;
const GAME_KEY = 'gg.site.game.v2';
const DRAFT_KEY = 'gg.startDraft';
const INTERACTIVE = 'a, button, input, textarea, select, summary, [role="button"], [role="tab"], [contenteditable="true"]';

/** One landing section failing must not blank the page: it is left out and the rest still works. */
function Safe({ name, children, fallback = null }) {
  return <ErrorBoundary scope={`landing:${name}`} fallback={fallback}>{children}</ErrorBoundary>;
}

/** If the hero itself fails, the headline and the way in survive. */
function HeroFallback({ onStart }) {
  return (
    <section className="s-hero" aria-labelledby="hero-title">
      <div className="s-hero__frame">
        <div className="s-hero__inner">
          <h1 id="hero-title" className="s-hero__title">Ask anything about any game.</h1>
          <p className="s-hero__sub">Live answers from wikis, patch notes and the web. No spoilers past where you are.</p>
          <div className="s-hero__actions">
            <button type="button" className="s-btn s-btn--primary s-btn--lg" onClick={onStart}>Press Start</button>
          </div>
        </div>
      </div>
    </section>
  );
}

const store = achievements();
const subscribeCount = (fn) => store.subscribe(fn);
const readCount = () => store.count();

/**
 * "Press Start" — the landing page. A thin composition: each chapter owns
 * its own demo and animation; this owns the page-wide pieces (smooth scroll,
 * the game accent, Enter-to-start, the Konami code and the exit wipe).
 */
export default function LandingPage({ onEnter, onNavigate }) {
  const calm = useCalm();
  const rootRef = useRef(null);
  const [exiting, setExiting] = useState(false);
  const [arcade, setArcade] = useState(false);
  const count = useSyncExternalStore(subscribeCount, readCount, readCount);
  const daily = useDailyGames();

  // The first paint needs the hero and nothing else. Mounting every section in
  // that same commit made each layout read (the hero's text fit, the cover
  // wall's measuring, GSAP's) lay out the WHOLE page: about half a second of
  // forced reflow on a phone before anything showed. So the rest mounts right
  // after the hero has painted (idle, at most ~0.6 s later), and the nav can
  // still jump anywhere in the meantime (see `section`).
  const [rest, setRest] = useState(false);
  const restRef = useRef(false);
  useEffect(() => {
    if (!daily.ready || restRef.current) return undefined;
    const mount = () => { restRef.current = true; setRest(true); };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(mount, { timeout: 600 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(mount, 200);
    return () => clearTimeout(id);
  }, [daily.ready]);

  useLenis(!calm && rest);

  usePageMeta('landing');

  // Fonts change heights; re-measure once they land. And fetch the chat's
  // chunk while the visitor reads, so Press Start opens it at once, but only
  // once the landing itself is in (loaded, then a couple of seconds): started
  // earlier, those ~100 kB share a phone's connection with the page's own
  // scripts, fonts and art, and the landing is what arrives late.
  useEffect(() => {
    document.fonts?.ready.then(() => scheduleRefresh(0));
    let cancel = () => {};
    const warm = () => {
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));
      const stop = window.cancelIdleCallback || clearTimeout;
      const id = idle(() => {
        import('./codex/CodexShell').catch(() => {});
        import('./InfoPage').catch(() => {});
      });
      cancel = () => stop(id);
    };
    let timer;
    const afterLoad = () => { timer = setTimeout(warm, WARM_DELAY_MS); };
    if (document.readyState === 'complete') afterLoad();
    else window.addEventListener('load', afterLoad, { once: true });
    return () => {
      window.removeEventListener('load', afterLoad);
      clearTimeout(timer);
      cancel();
    };
  }, []);

  // Chapter headings rise in as they arrive. Built after the chapters' own
  // scenes (parents' effects run last), so any pins above already exist.
  useScene(rootRef, ({ calm: still }, root) => {
    if (still) return;
    root.querySelectorAll('[data-reveal]').forEach((el) => {
      gsap.from(el.children, {
        y: 28, opacity: 0, duration: 0.9, stagger: 0.08, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 85%', once: true },
      });
    });
  }, [calm, rest]);

  // The info pages open on the last game seen here, so they carry its art.
  const onGame = useCallback((game) => {
    rootRef.current?.style.setProperty('--s-game-accent', game.accent);
    if (game.accentReady === false) return; // saved once its colour is known
    try {
      sessionStorage.setItem(GAME_KEY, JSON.stringify({ appid: game.appid, name: game.name, accent: game.accent, hero: game.hero }));
    } catch { /* per-visit nicety only */ }
  }, []);

  // `draft` is a question to leave typed in the chat's bar; `source` says
  // which control it came from (only the source is tracked, never the text).
  const start = useCallback((draft, source = 'library') => {
    if (exiting) return;
    track('press_start', { from: typeof draft === 'string' ? source : 'button' });
    if (typeof draft === 'string') {
      try { sessionStorage.setItem(DRAFT_KEY, draft); } catch { /* the chat just opens empty */ }
    }
    if (calm) { onEnter(); return; }
    setExiting(true);
    setTimeout(onEnter, EXIT_MS);
  }, [calm, exiting, onEnter]);

  const pick = useCallback((game) => start(`What should I know before starting ${game.name}?`, 'library'), [start]);
  const ask = useCallback((question) => start(question, 'sample'), [start]);

  // Enter starts (when nothing else has focus); the Konami code toggles arcade mode.
  useEffect(() => {
    let pos = 0;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === 'Escape' && document.documentElement.hasAttribute('data-arcade')) {
        setArcade(false);
        return;
      }
      const r = advance(pos, e.key);
      pos = r.pos;
      if (r.done) {
        setArcade(a => !a);
        achievements().unlock('old-school');
        return;
      }
      // Enter on a focused control belongs to that control.
      const el = document.activeElement;
      const idle = !el || el === document.body || !el.matches(INTERACTIVE);
      if (e.key === 'Enter' && idle && !e.repeat) {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);

  useEffect(() => {
    document.documentElement.toggleAttribute('data-arcade', arcade);
    return () => document.documentElement.removeAttribute('data-arcade');
  }, [arcade]);

  // A jump before the rest of the page has mounted mounts it first, lets the
  // chapters measure (their pins move everything below them), then goes at
  // once: a smooth scroll started now would be cancelled when smooth scrolling
  // switches on a moment later, and the page would just stay put.
  const section = (id) => () => {
    if (restRef.current) { scrollToId(id); return; }
    flushSync(() => { restRef.current = true; setRest(true); });
    requestAnimationFrame(() => {
      ScrollTrigger.refresh();
      scrollToId(id, { instant: true });
    });
  };
  const links = [
    { label: 'How it works', onClick: section('how') },
    { label: 'Spoiler Shield', onClick: section('shield') },
    { label: 'Library', onClick: section('library') },
    { label: 'Discord', onClick: section('watchtower') },
    { label: 'About', onClick: () => onNavigate?.('about') },
  ];

  return (
    <div
      ref={rootRef}
      className={`site s-landing${exiting ? ' is-exiting' : ''}${calm ? ' is-calm' : ''}${daily.ready ? '' : ' is-booting'}`}
      style={{ '--s-game-accent': daily.hero[0].accent }}
    >
      <a className="s-skip" href="#main" onClick={(e) => { e.preventDefault(); scrollToId('main'); }}>Skip to content</a>
      <SiteNav
        links={links}
        onBrand={() => scrollToId('main')}
        cta={{ label: arcade ? 'Insert coin' : 'Press Start', onClick: () => start() }}
        counter={{ count, total: store.total }}
      />

      <main id="main">
        {/* The hero waits for today's list (instant from the day's cache, one
            edge-cached request otherwise) so it never opens on one set of
            games and swaps to another. */}
        {daily.ready
          ? (
            <Safe name="hero" fallback={<HeroFallback onStart={() => start()} />}>
              <Hero games={daily.hero} calm={calm} onStart={() => start()} onAsk={ask} onShield={section('how')} onGame={onGame} arcade={arcade} />
            </Safe>
          )
          : <section className="s-hero is-waiting" aria-busy="true" aria-label="Loading today's games" />}
        {rest && (
          <>
            <Safe name="how"><HowItWorks calm={calm} /></Safe>
            <Safe name="anatomy"><AnswerAnatomy calm={calm} /></Safe>
            <Safe name="shield"><ShieldDemo calm={calm} /></Safe>
            <Safe name="library"><LibraryWall calm={calm} onPick={pick} games={daily.wall} today={daily.source === 'steam'} /></Safe>
            <Safe name="loadout"><CapabilityMenu calm={calm} /></Safe>
            <Safe name="watchtower"><WatchtowerDemo calm={calm} /></Safe>
            <Safe name="closing"><Closing calm={calm} onStart={() => start()} arcade={arcade} /></Safe>
          </>
        )}
      </main>

      {rest && <SiteFooter onNavigate={onNavigate} onStart={() => start()} />}
      <Achievements />
      {arcade && <div className="s-arcade" aria-hidden="true"><span>Arcade mode · Esc to exit</span></div>}
      <div className="s-wipe" aria-hidden="true" />
    </div>
  );
}
