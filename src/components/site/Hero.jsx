import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pause, Play, CornerDownLeft } from 'lucide-react';
import { HERO_GAMES, heroArt, coverArt } from '../../site/showcase';
import { LINKS } from '../../site/links';
import { gsap, useScene } from '../../site/motion';
import { HudCorners, Overline } from './bits';

const MOBILE_MQ = '(max-width: 767px)';
const pad = (n) => String(n).padStart(2, '0');

function ArtLayer({ game, ready, onReady, priority }) {
  return (
    <picture className={`s-hero__layer${ready ? ' is-ready' : ''}`}>
      <source media={MOBILE_MQ} srcSet={coverArt(game.appid)} />
      <img
        src={heroArt(game.appid)}
        alt=""
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
        onLoad={onReady}
        onError={onReady}
      />
    </picture>
  );
}

/**
 * "Ask anything about {game}." — full-bleed Steam art cycling through six
 * games. The active tab's fill is a CSS animation and doubles as the timer:
 * when it ends, the next game comes in. It pauses off-screen, on request,
 * and never runs for calm pages.
 */
export default function Hero({ calm, onStart, onGame, arcade }) {
  const rootRef = useRef(null);
  const nameRef = useRef(null);
  const [idx, setIdx] = useState(0);
  const [prev, setPrev] = useState(null);
  const [ready, setReady] = useState({});
  const [paused, setPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const game = HERO_GAMES[idx];

  const go = (n) => {
    const next = (n + HERO_GAMES.length) % HERO_GAMES.length;
    if (next === idx) return;
    setPrev(idx);
    setIdx(next);
  };

  // The name is owned by GSAP (ScrambleText rewrites the node), so React
  // never renders it — it only seeds the first value.
  useLayoutEffect(() => {
    if (nameRef.current) nameRef.current.textContent = HERO_GAMES[0].name;
  }, []);

  const first = useRef(true);
  useEffect(() => {
    onGame?.(game);
    if (first.current) { first.current = false; return undefined; }
    const el = nameRef.current;
    if (!el) return undefined;
    if (calm) { el.textContent = game.name; return undefined; }
    const tween = gsap.to(el, {
      duration: 1,
      ease: 'none',
      scrambleText: { text: game.name, chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', revealDelay: 0.25, speed: 0.7 },
    });
    // Warm the cache for the game after this one.
    const t = setTimeout(() => {
      const after = HERO_GAMES[(idx + 1) % HERO_GAMES.length];
      const img = new Image();
      img.src = window.matchMedia(MOBILE_MQ).matches ? coverArt(after.appid) : heroArt(after.appid);
    }, 1500);
    return () => { tween.kill(); clearTimeout(t); el.textContent = game.name; };
  }, [idx, calm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pause while the hero is out of view.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useScene(rootRef, ({ calm: still }, root) => {
    if (still) return;
    const q = gsap.utils.selector(root);
    gsap.from(q('.s-line > span'), { yPercent: 110, duration: 1.1, ease: 'power4.out', stagger: 0.09, delay: 0.1 });
    gsap.from(q('[data-intro]'), { y: 22, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, delay: 0.35 });
    const st = { trigger: root, start: 'top top', end: 'bottom top', scrub: true };
    gsap.fromTo(q('.s-hero__art'), { scale: 1.08 }, { scale: 1, yPercent: 10, ease: 'none', scrollTrigger: st });
    gsap.to(q('.s-hero__inner'), { yPercent: -14, opacity: 0.15, ease: 'none', scrollTrigger: st });
    gsap.to(q('.s-hero__scrim'), { opacity: 1, ease: 'none', scrollTrigger: st });
  }, [calm]);

  const running = !calm && !paused && onScreen;

  return (
    <section ref={rootRef} className="s-hero" aria-labelledby="hero-title">
      <div className="s-hero__art" aria-hidden="true">
        {prev != null && prev !== idx && (
          <ArtLayer key={HERO_GAMES[prev].appid} game={HERO_GAMES[prev]} ready />
        )}
        <ArtLayer
          key={game.appid}
          game={game}
          priority={idx === 0}
          ready={!!ready[game.appid]}
          onReady={() => setReady(r => ({ ...r, [game.appid]: true }))}
        />
      </div>
      <div className="s-hero__scrim" aria-hidden="true" />
      <div className="s-grain" aria-hidden="true" />

      <div className="s-hero__frame">
        <HudCorners />
        <div className="s-hero__inner">
          <div data-intro><Overline>GameGuide · a guide for every game</Overline></div>
          <h1 id="hero-title" className="s-hero__title">
            <span className="sr-only">Ask anything about any game.</span>
            <span aria-hidden="true">
              <span className="s-line"><span>Ask anything about</span></span>
              <span className="s-line"><span><span className="s-hero__game" ref={nameRef} />.</span></span>
            </span>
          </h1>
          <p className="s-hero__sub" data-intro>
            Live answers from wikis, patch notes and the web — set like a strategy guide,
            and it won&rsquo;t spoil what you haven&rsquo;t reached.
          </p>
          <div className="s-hero__actions" data-intro>
            <button type="button" className="s-btn s-btn--primary s-btn--lg" onClick={onStart}>
              {arcade ? 'Insert coin' : 'Press Start'}
              <kbd className="s-kbd" aria-hidden="true"><CornerDownLeft size={13} /></kbd>
            </button>
            <a className="s-btn s-btn--ghost s-btn--lg" href={LINKS.discordInvite} target="_blank" rel="noopener noreferrer">
              Add to Discord
            </a>
          </div>
        </div>

        <div className="s-hero__hud" data-intro>
          <span className="s-hero__count" aria-hidden="true">{pad(idx + 1)} / {pad(HERO_GAMES.length)}</span>
          <div className="s-hero__tabs" role="group" aria-label="Showcased game">
            {HERO_GAMES.map((g, i) => (
              <button
                key={g.appid}
                type="button"
                className={`s-tab${i === idx ? ' is-active' : ''}${i < idx ? ' is-done' : ''}`}
                aria-label={`Show ${g.name}`}
                aria-pressed={i === idx}
                onClick={() => go(i)}
              >
                <span
                  key={i === idx ? `run-${idx}` : 'idle'}
                  className="s-tab__fill"
                  style={{ animationPlayState: running ? 'running' : 'paused' }}
                  onAnimationEnd={i === idx ? () => go(idx + 1) : undefined}
                />
              </button>
            ))}
          </div>
          <span className="s-hero__now" aria-live="off">Now showing · {game.name}</span>
          {!calm && (
            <button
              type="button"
              className="s-hero__pause"
              onClick={() => setPaused(p => !p)}
              aria-label={paused ? 'Play the showcase' : 'Pause the showcase'}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
