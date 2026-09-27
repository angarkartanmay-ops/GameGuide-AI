import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HERO_GAMES } from '../site/showcase';
import { achievements } from '../site/achievements';
import { advance, isTypingTarget } from '../site/konami';
import { gsap, scrollToId, useCalm, useLenis, useScene, scheduleRefresh } from '../site/motion';
import SiteNav from './site/SiteNav';
import SiteFooter from './site/SiteFooter';
import Achievements from './site/Achievements';
import Hero from './site/Hero';
import AnswerAnatomy from './site/AnswerAnatomy';
import ShieldDemo from './site/ShieldDemo';
import LibraryWall from './site/LibraryWall';
import CapabilityMenu from './site/CapabilityMenu';
import WatchtowerDemo from './site/WatchtowerDemo';
import Closing from './site/Closing';
import '../styles/site.css';

const EXIT_MS = 560;
const GAME_KEY = 'gg.site.game';
const DRAFT_KEY = 'gg.startDraft';
const INTERACTIVE = 'a, button, input, textarea, select, summary, [role="button"], [role="tab"], [contenteditable="true"]';

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

  useLenis(!calm);

  useEffect(() => {
    const prev = document.title;
    document.title = 'GameGuide — ask anything about any game';
    return () => { document.title = prev; };
  }, []);

  // Fonts change heights; re-measure once they land. And fetch the chat's
  // chunk while the visitor reads, so Press Start opens it at once.
  useEffect(() => {
    document.fonts?.ready.then(() => scheduleRefresh(0));
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2500));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const id = idle(() => { import('./codex/CodexShell').catch(() => {}); });
    return () => cancel(id);
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
  }, [calm]);

  const onGame = useCallback((game) => {
    rootRef.current?.style.setProperty('--s-game-accent', game.accent);
    try { sessionStorage.setItem(GAME_KEY, String(game.appid)); } catch { /* per-visit nicety only */ }
  }, []);

  const start = useCallback((draft) => {
    if (exiting) return;
    if (typeof draft === 'string') {
      try { sessionStorage.setItem(DRAFT_KEY, draft); } catch { /* the chat just opens empty */ }
    }
    if (calm) { onEnter(); return; }
    setExiting(true);
    setTimeout(onEnter, EXIT_MS);
  }, [calm, exiting, onEnter]);

  const pick = useCallback((game) => start(`What should I know before starting ${game.name}?`), [start]);

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

  const section = (id) => () => scrollToId(id);
  const links = [
    { label: 'How it works', onClick: section('anatomy') },
    { label: 'Spoiler Shield', onClick: section('shield') },
    { label: 'Library', onClick: section('library') },
    { label: 'Discord', onClick: section('watchtower') },
    { label: 'About', onClick: () => onNavigate?.('about') },
  ];

  return (
    <div
      ref={rootRef}
      className={`site s-landing${exiting ? ' is-exiting' : ''}${calm ? ' is-calm' : ''}`}
      style={{ '--s-game-accent': HERO_GAMES[0].accent }}
    >
      <a className="s-skip" href="#main" onClick={(e) => { e.preventDefault(); scrollToId('main'); }}>Skip to content</a>
      <SiteNav
        links={links}
        onBrand={() => scrollToId('main')}
        cta={{ label: arcade ? 'Insert coin' : 'Press Start', onClick: () => start() }}
        counter={{ count, total: store.total }}
      />

      <main id="main">
        <Hero calm={calm} onStart={() => start()} onGame={onGame} arcade={arcade} />
        <AnswerAnatomy calm={calm} />
        <ShieldDemo calm={calm} />
        <LibraryWall calm={calm} onPick={pick} />
        <CapabilityMenu calm={calm} />
        <WatchtowerDemo calm={calm} />
        <Closing calm={calm} onStart={() => start()} arcade={arcade} />
      </main>

      <SiteFooter onNavigate={onNavigate} onStart={() => start()} />
      <Achievements />
      {arcade && <div className="s-arcade" aria-hidden="true"><span>Arcade mode · Esc to exit</span></div>}
      <div className="s-wipe" aria-hidden="true" />
    </div>
  );
}
