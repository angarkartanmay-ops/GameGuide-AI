import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { pathForView } from '../site/route';
import { lastSiteGame } from '../site/daily';
import { gsap, useCalm, useScene } from '../site/motion';
import usePageMeta from '../site/usePageMeta';
import SiteNav from './site/SiteNav';
import SiteFooter from './site/SiteFooter';
import { PAGES } from './infoPages';
import '../styles/site.css';

/** The game the visitor last saw on the landing, so the pages feel continuous. */
function lastGame() {
  try { return lastSiteGame(sessionStorage); } catch { return lastSiteGame(null); }
}

// ─── Shell ─────────────────────────────────────────────────────────────────

export default function InfoPage({ kind, onBack, onLogo, onNavigate }) {
  const page = PAGES[kind] || PAGES.about;
  const calm = useCalm();
  const rootRef = useRef(null);
  const [game] = useState(lastGame);
  const { Body } = page;

  // Title, description, canonical and (for a 404) noindex come from site/meta.js.
  usePageMeta(PAGES[kind] ? kind : 'about');
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [kind]);

  // Warm the routes reachable from here, so switching doesn't flash the
  // empty route fallback while the chunk downloads.
  useEffect(() => {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2000));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const id = idle(() => {
      import('./codex/CodexShell').catch(() => {});
      import('./LandingPage').catch(() => {});
    });
    return () => cancel(id);
  }, []);

  // Links inside page copy dispatch this rather than receiving props.
  useEffect(() => {
    const handler = (e) => { if (typeof e.detail === 'string') onNavigate?.(e.detail); };
    window.addEventListener('gg:navigate', handler);
    return () => window.removeEventListener('gg:navigate', handler);
  }, [onNavigate]);

  useScene(rootRef, ({ calm: still }, root) => {
    if (still) return;
    gsap.from(root.querySelectorAll('[data-intro]'), { y: 20, opacity: 0, duration: 0.8, stagger: 0.07, ease: 'power3.out' });
    gsap.fromTo(root.querySelector('.s-page-head__art'), { scale: 1.08, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.6, ease: 'power2.out' });
  }, [calm, kind]);

  const links = [
    { label: 'About', href: pathForView('about'), onClick: () => onNavigate?.('about'), current: kind === 'about' },
    { label: 'Terms', href: pathForView('terms'), onClick: () => onNavigate?.('terms'), current: kind === 'terms' || kind === 'privacy' },
    { label: 'Contact', href: pathForView('contacts'), onClick: () => onNavigate?.('contacts'), current: kind === 'contacts' },
  ];

  return (
    <div ref={rootRef} className={`site s-info s-info--${kind}${calm ? ' is-calm' : ''}`} style={{ '--s-game-accent': game.accent }}>
      <a className="s-skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <SiteNav links={links} onBrand={onLogo} cta={{ label: 'Open GameGuide', onClick: () => onNavigate?.('chat') }} />

      <div className="s-page-head">
        <div className="s-page-head__art" aria-hidden="true">
          <img src={game.hero} alt="" decoding="async" />
        </div>
        <div className="s-wrap s-page-head__inner">
          <button type="button" className="s-back" onClick={onBack} data-intro>
            <ArrowLeft size={15} aria-hidden="true" /> Back
          </button>
          <h1 className="s-h1" data-intro>{page.heading}</h1>
          <p className="s-lead" data-intro>{page.lead}</p>
          {page.meta && <p className="s-meta" data-intro>{page.meta}</p>}
        </div>
      </div>

      <main id="main" tabIndex={-1} className="s-wrap s-page">
        <Body start={page.start} />
      </main>

      <SiteFooter onNavigate={onNavigate} onStart={() => onNavigate?.('chat')} />
    </div>
  );
}
