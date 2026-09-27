import React, { useEffect, useId, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { ScrollTrigger } from '../../site/motion';
import { Mark } from './bits';

/**
 * The site's top bar: brand, section or page links, a call to action and —
 * on the landing — the achievement counter. Transparent over the hero, glass
 * once you scroll; a hairline along its bottom edge tracks reading progress.
 * Below 900px the links move into a full-screen sheet.
 */
export default function SiteNav({ links, onBrand, cta, counter }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const barRef = useRef(null);
  const menuBtnRef = useRef(null);
  const sheetRef = useRef(null);
  const sheetId = useId();

  // ScrollTrigger already measures the page on refresh and batches its reads
  // with everything else; reading scrollHeight on every scroll frame here
  // forced a full layout each time.
  useEffect(() => {
    const apply = (self) => {
      setScrolled(self.scroll() > 24);
      barRef.current?.style.setProperty('--s-progress', self.progress.toFixed(4));
    };
    const st = ScrollTrigger.create({ start: 0, end: 'max', onUpdate: apply, onRefresh: apply });
    return () => st.kill();
  }, []);

  // Sheet: Esc closes, focus moves in on open and back to the button on close.
  useEffect(() => {
    if (!open) return undefined;
    const trigger = menuBtnRef.current;
    sheetRef.current?.querySelector('button, a')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
      if (e.key === 'Tab' && sheetRef.current) {
        const items = [...sheetRef.current.querySelectorAll('button, a')];
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Only reclaim focus if it was lost with the sheet — a link that moved
      // focus to its section keeps it there.
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost) trigger?.focus({ preventScroll: true });
    };
  }, [open]);

  const run = (fn) => () => { setOpen(false); fn?.(); };

  return (
    <header ref={barRef} className={`s-nav${scrolled ? ' is-scrolled' : ''}${open ? ' is-open' : ''}`}>
      <div className="s-nav__inner">
        <button type="button" className="s-brand" onClick={onBrand} aria-label="GameGuide home">
          <Mark size="lg" />
          <span className="s-brand__name">GameGuide</span>
        </button>

        <nav className="s-nav__links" aria-label="Primary">
          {links.map((l) => (
            <button
              key={l.label}
              type="button"
              className="s-nav__link"
              onClick={l.onClick}
              aria-current={l.current ? 'page' : undefined}
            >
              {l.label}
            </button>
          ))}
        </nav>

        <div className="s-nav__end">
          {counter && (
            <span className="s-nav__counter" title="Achievements unlocked on this page">
              <Mark size="sm" />
              <span className="sr-only">Achievements: </span>
              {counter.count}/{counter.total}
            </span>
          )}
          {cta && (
            <button type="button" className="s-btn s-btn--sm s-btn--primary s-nav__cta" onClick={cta.onClick}>
              {cta.label}
            </button>
          )}
          <button
            ref={menuBtnRef}
            type="button"
            className="s-nav__menu"
            aria-expanded={open}
            aria-controls={sheetId}
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen(o => !o)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      <span className="s-nav__progress" aria-hidden="true" />

      {open && (
        <div ref={sheetRef} id={sheetId} className="s-sheet" role="dialog" aria-modal="true" aria-label="Menu">
          <ul className="s-sheet__list">
            {links.map((l, i) => (
              <li key={l.label}>
                <button type="button" className="s-sheet__link" onClick={run(l.onClick)} aria-current={l.current ? 'page' : undefined}>
                  <span className="s-sheet__num">{String(i + 1).padStart(2, '0')}</span>
                  {l.label}
                </button>
              </li>
            ))}
          </ul>
          {cta && (
            <button type="button" className="s-btn s-btn--primary s-sheet__cta" onClick={run(cta.onClick)}>
              {cta.label}
            </button>
          )}
          <button type="button" className="s-sheet__close" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </header>
  );
}
