import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pause, Play, CornerDownLeft, ArrowUpRight } from 'lucide-react';
import { LINKS } from '../../site/links';
import { heroStat } from '../../site/daily';
import { gsap, useScene } from '../../site/motion';
import { HudCorners } from './bits';
import LiveCount from './LiveCount';

const MOBILE_MQ = '(max-width: 767px)';

function ArtLayer({ game, ready, onReady, priority }) {
  return (
    <picture className={`s-hero__layer${ready ? ' is-ready' : ''}`}>
      <source media={MOBILE_MQ} srcSet={game.cover} />
      <img
        src={game.hero}
        alt=""
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
        onLoad={onReady}
        onError={onReady}
      />
    </picture>
  );
}

/** Steam's own numbers for the game on screen. Showcase games have none and show their name. */
function Stat({ game }) {
  const stat = heroStat(game);
  if (!stat) return <span className="s-hero__now">{game.name}</span>;
  return (
    <span className="s-hero__now s-hero__stat">
      <span><b>#{stat.rank}</b> most played on Steam</span>
      {stat.move && (
        <span className="s-hero__move">
          {stat.move.kind === 'new'
            ? 'New to the chart'
            : <><ArrowUpRight size={13} aria-hidden="true" /> {stat.move.by} places this week</>}
        </span>
      )}
      {stat.peak && <span className="s-hero__peak">{stat.peak} at peak</span>}
    </span>
  );
}

/**
 * "Ask anything about {game}." — full-bleed Steam art cycling through the
 * day's six games (src/site/daily.js). The active tab's fill is a CSS
 * animation and doubles as the timer: when it ends, the next game comes in.
 * It pauses off-screen, on request, and never runs for calm pages.
 */
export default function Hero({ games, calm, onStart, onGame, arcade }) {
  const rootRef = useRef(null);
  const nameRef = useRef(null);
  const lineRef = useRef(null);
  const measureRef = useRef(null);
  const [idx, setIdx] = useState(0);
  const [prev, setPrev] = useState(null);
  const [ready, setReady] = useState({});
  const [paused, setPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const game = games[idx] || games[0];

  const go = (n) => {
    const next = (n + games.length) % games.length;
    if (next === idx) return;
    setPrev(idx);
    setIdx(next);
  };

  // The name is owned by GSAP (ScrambleText rewrites the node), so React
  // never renders it — it only seeds the first value.
  useLayoutEffect(() => {
    if (nameRef.current) nameRef.current.textContent = games[0].name;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Long names ("Tom Clancy's Rainbow Six Siege") shrink to fit the line
  // instead of running off it. A hidden copy is measured at full size.
  useLayoutEffect(() => {
    const line = lineRef.current;
    const probe = measureRef.current;
    if (!line || !probe) return undefined;
    const fit = () => {
      const room = line.parentElement.clientWidth;
      const need = probe.scrollWidth;
      line.style.setProperty('--name-fit', need > room ? (room / need).toFixed(3) : '1');
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(line.parentElement);
    return () => ro?.disconnect();
  }, [game.name]);

  // The accent can arrive after the game does (it is sampled from the art).
  useEffect(() => { onGame?.(game); }, [game, onGame]);

  const first = useRef(true);
  useEffect(() => {
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
      const after = games[(idx + 1) % games.length];
      const img = new Image();
      img.src = window.matchMedia(MOBILE_MQ).matches ? after.cover : after.hero;
    }, 1500);
    return () => { tween.kill(); clearTimeout(t); el.textContent = game.name; };
  }, [idx, calm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop the outgoing art once the 1.2 s crossfade has finished. It used to
  // stay mounted under the current game for as long as the page was open:
  // a second full-screen image layer that only cost GPU memory, and whose
  // stale texture is what showed through when Chrome ran short while the
  // page was scrolled back up.
  // Only after the incoming art has loaded, or the hero would go blank.
  const currentReady = !!ready[game.appid];
  useEffect(() => {
    if (prev == null || !currentReady) return undefined;
    const t = setTimeout(() => setPrev(null), 1400);
    return () => clearTimeout(t);
  }, [prev, currentReady]);

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
  const outgoing = prev != null && prev !== idx ? games[prev] : null;

  return (
    <section ref={rootRef} className="s-hero" aria-labelledby="hero-title">
      <div className="s-hero__art" aria-hidden="true">
        {outgoing && <ArtLayer key={outgoing.appid} game={outgoing} ready />}
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
          <h1 id="hero-title" className="s-hero__title">
            <span className="sr-only">Ask anything about any game.</span>
            <span aria-hidden="true">
              <span className="s-line"><span>Ask anything about</span></span>
              <span className="s-line">
                <span ref={lineRef} className="s-hero__name-line">
                  <span className="s-hero__game" ref={nameRef} />.
                  <span ref={measureRef} className="s-hero__game s-hero__measure">{game.name}.</span>
                </span>
              </span>
            </span>
          </h1>
          <p className="s-hero__sub" data-intro>
            Live answers from wikis, patch notes and the web, set like a strategy guide.
            No spoilers past where you are.
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
          <div data-intro><LiveCount /></div>
        </div>

        <div className="s-hero__hud" data-intro>
          <div className="s-hero__tabs" role="group" aria-label="Showcased game">
            {games.map((g, i) => (
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
          <Stat game={game} />
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
