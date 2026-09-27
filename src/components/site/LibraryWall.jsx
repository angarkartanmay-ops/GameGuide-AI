import React, { useRef } from 'react';
import { LIBRARY, coverArt } from '../../site/showcase';
import { achievements } from '../../site/achievements';
import { gsap, ScrollTrigger, useScene } from '../../site/motion';
import { ChapterHead } from './bits';

const ROWS = [LIBRARY.slice(0, 8), LIBRARY.slice(8, 16), LIBRARY.slice(16, 24)];
const BASE_SPEED = 0.034; // px per ms

function Cover({ game, dup, onPick, onSeen }) {
  return (
    <button
      type="button"
      className="s-cover"
      onClick={() => onPick(game)}
      onPointerEnter={() => onSeen(game.appid)}
      onFocus={() => onSeen(game.appid)}
      aria-label={dup ? undefined : `Ask about ${game.name}`}
      aria-hidden={dup || undefined}
      tabIndex={dup ? -1 : undefined}
      data-dup={dup || undefined}
    >
      <img
        src={coverArt(game.appid)}
        alt=""
        width={600}
        height={900}
        loading="lazy"
        decoding="async"
        onError={(e) => { e.currentTarget.closest('.s-cover')?.classList.add('is-broken'); }}
      />
      <span className="s-cover__name">{game.name}</span>
    </button>
  );
}

/**
 * Chapter 03. A tilted wall of real Steam covers drifting in opposite
 * directions; scrolling fast pushes them faster, hovering a row slows it to a
 * stop. Picking a cover opens the chat with a question about it drafted.
 */
export default function LibraryWall({ calm, onPick }) {
  const rootRef = useRef(null);
  const seen = useRef(new Set());

  const onSeen = (appid) => {
    seen.current.add(appid);
    if (seen.current.size >= 5) achievements().unlock('collector');
  };

  useScene(rootRef, ({ calm: still }, root) => {
    if (still) return undefined;
    const rows = [...root.querySelectorAll('.s-wall__row')];
    const state = rows.map((row, i) => {
      const track = row.querySelector('.s-wall__track');
      return { row, track, dir: i % 2 ? 1 : -1, x: 0, half: 0, speed: 1, hover: false };
    });
    const measure = () => state.forEach((s, i) => {
      s.half = s.track.scrollWidth / 2;
      s.x = -s.half * (0.2 + i * 0.25);
    });
    measure();

    let boost = 0;
    let active = false;
    ScrollTrigger.create({
      trigger: root.querySelector('.s-wall'),
      start: 'top bottom',
      end: 'bottom top',
      onToggle: (self) => { active = self.isActive; },
      onUpdate: (self) => { boost = Math.max(boost, Math.min(7, Math.abs(self.getVelocity()) / 260)); },
      onRefresh: measure,
    });

    const tick = (_time, dt) => {
      if (!active) return;
      boost *= 0.93;
      for (const s of state) {
        if (!s.half) continue;
        s.speed += ((s.hover ? 0 : 1) - s.speed) * 0.08;
        s.x += s.dir * BASE_SPEED * Math.min(dt, 64) * s.speed * (1 + boost);
        if (s.x <= -s.half) s.x += s.half;
        if (s.x > 0) s.x -= s.half;
        s.track.style.transform = `translate3d(${s.x.toFixed(1)}px,0,0)`;
      }
    };
    gsap.ticker.add(tick);

    const offs = state.map((s) => {
      const on = () => { s.hover = true; };
      const off = () => { s.hover = false; };
      s.row.addEventListener('pointerenter', on);
      s.row.addEventListener('pointerleave', off);
      s.row.addEventListener('focusin', on);
      s.row.addEventListener('focusout', off);
      return () => {
        s.row.removeEventListener('pointerenter', on);
        s.row.removeEventListener('pointerleave', off);
        s.row.removeEventListener('focusin', on);
        s.row.removeEventListener('focusout', off);
        s.track.style.transform = '';
      };
    });

    gsap.from(root.querySelector('.s-wall__plane'), {
      opacity: 0, rotateX: 38, y: 80, duration: 1.4, ease: 'power3.out',
      scrollTrigger: { trigger: root.querySelector('.s-wall'), start: 'top 85%', once: true },
    });

    return () => { gsap.ticker.remove(tick); offs.forEach(fn => fn()); };
  }, [calm]);

  return (
    <section ref={rootRef} id="library" className={`s-chapter s-library${calm ? ' is-calm' : ''}`} aria-labelledby="library-title">
      <div className="s-wrap">
        <ChapterHead
          index="03"
          label="The library"
          id="library-title"
          title="Any game. Ask about it and the page becomes it."
          lead="Name a game and the chat dresses itself in that game's art and colour. Pick one below to start there."
        />
      </div>
      <div className="s-wall">
        <div className="s-wall__plane">
          {ROWS.map((row, r) => (
            <div key={r} className="s-wall__row">
              <div className="s-wall__track">
                {row.map(g => <Cover key={g.appid} game={g} onPick={onPick} onSeen={onSeen} />)}
                {!calm && row.map(g => <Cover key={`d${g.appid}`} game={g} dup onPick={onPick} onSeen={onSeen} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
