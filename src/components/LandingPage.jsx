import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion, useReducedMotion, useSpring, useMotionValue } from 'framer-motion';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './LandingPage.css';

const HoloCanvas = lazy(() => import('./HoloCanvas'));

gsap.registerPlugin(ScrollTrigger);

/* ============================================================
   SECTION: device-capability hook
   Disables WebGL on small viewports / reduced motion / low RAM
   ============================================================ */
function useCapability() {
  const reduce = useReducedMotion();
  const [caps, setCaps] = useState(() => {
    if (typeof window === 'undefined') return { webgl: false, magnetic: false };
    const small = window.matchMedia('(max-width: 767px)').matches;
    const lowMem = (navigator.deviceMemory || 8) < 4;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    return {
      webgl: !small && !lowMem,
      magnetic: !small && !coarse,
    };
  });
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = () => {
      const small = mq.matches;
      const lowMem = (navigator.deviceMemory || 8) < 4;
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      setCaps({ webgl: !small && !lowMem, magnetic: !small && !coarse });
    };
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);
  return {
    webgl: caps.webgl && !reduce,
    magnetic: caps.magnetic && !reduce,
    reduce: !!reduce,
  };
}

/* ============================================================
   SECTION: Lenis smooth scroll bridge
   ============================================================ */
function useLenis(enabled) {
  useEffect(() => {
    if (!enabled) return;
    let lenis;
    let rafId;
    let mounted = true;
    (async () => {
      const Lenis = (await import('lenis')).default;
      if (!mounted) return;
      lenis = new Lenis({ duration: 1.05, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      const tick = (time) => {
        lenis?.raf(time * 1000);
      };
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      const raf = (t) => {
        rafId = requestAnimationFrame(raf);
      };
      rafId = requestAnimationFrame(raf);
    })();
    return () => {
      mounted = false;
      cancelAnimationFrame(rafId);
      try { lenis?.destroy(); } catch {}
    };
  }, [enabled]);
}

/* ============================================================
   SECTION: Magnetic cursor
   ============================================================ */
function MagneticCursor({ enabled }) {
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const sx = useSpring(x, { stiffness: 180, damping: 22, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 180, damping: 22, mass: 0.4 });
  const [hot, setHot] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const move = (e) => { x.set(e.clientX); y.set(e.clientY); };
    const over = (e) => {
      if (e.target?.closest?.('[data-magnetic]')) setHot(true);
    };
    const out = (e) => {
      if (e.target?.closest?.('[data-magnetic]')) setHot(false);
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerover', over);
    window.addEventListener('pointerout', out);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerover', over);
      window.removeEventListener('pointerout', out);
    };
  }, [enabled, x, y]);

  if (!enabled) return null;
  return (
    <motion.div
      className={`hg-cursor ${hot ? 'is-hot' : ''}`}
      style={{ x: sx, y: sy }}
      aria-hidden="true"
    />
  );
}

/* ============================================================
   SECTION: Starfield (decorative)
   ============================================================ */
function Starfield({ count = 200 }) {
  const stars = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 100,
      size: Math.random() * 1.6 + 0.4,
      delay: Math.random() * 12,
      dur: 14 + Math.random() * 18,
      o: 0.3 + Math.random() * 0.6,
    }));
  }, [count]);
  return (
    <div className="hg-starfield" aria-hidden="true">
      {stars.map(s => (
        <span
          key={s.id}
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            opacity: s.o,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.dur}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ============================================================
   SECTION: Nav
   ============================================================ */
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header className={`hg-nav ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="hg-nav__inner">
        <a className="hg-logo" href="#top" data-magnetic>
          <span className="hg-logo__mark" aria-hidden="true" />
          <span>GameGuide-AI</span>
        </a>
        <nav className="hg-nav__links" aria-label="Primary">
          <a href="#manifesto" data-magnetic>Manifesto</a>
          <a href="#pipeline" data-magnetic>Pipeline</a>
          <a href="#features" data-magnetic>Capabilities</a>
          <a href="#demo" data-magnetic>Demo</a>
        </nav>
      </div>
    </header>
  );
}

/* ============================================================
   SECTION: Hero
   ============================================================ */
function Hero({ webgl, onEnter }) {
  const tiltRef = useRef({ x: 0, y: 0 });
  const dollyRef = useRef(false);
  const [exiting, setExiting] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!webgl) return;
    const onMove = (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      tiltRef.current.x = nx;
      tiltRef.current.y = ny;
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [webgl]);

  const handleEnter = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    if (webgl) dollyRef.current = true;
    setTimeout(() => onEnter?.(), 800);
  }, [exiting, webgl, onEnter]);

  // Char-stagger reveal
  const headline = 'Built for the moment before you press play.';
  const chars = useMemo(() => headline.split(''), []);

  return (
    <section className="hg-hero" id="top">
      <div className="hg-hero__bg" aria-hidden="true">
        {webgl ? (
          <Suspense fallback={<div className="hg-hero__fallback" />}>
            <HoloCanvas tiltRef={tiltRef} dollyRef={dollyRef} />
          </Suspense>
        ) : (
          <div className="hg-hero__fallback" />
        )}
      </div>

      <div className="hg-hero__content">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="hg-eyebrow"
        >
          <span className="hg-dot" /> v4.0 · neural-mesh online
        </motion.div>

        <h1 className="hg-hero__headline" aria-label={headline}>
          {chars.map((c, i) => (
            <span key={i} className="hg-char" aria-hidden="true">
              <span
                className="hg-char__inner"
                style={{
                  animationDelay: reduce ? '0s' : `${0.25 + i * 0.022}s`,
                }}
              >
                {c === ' ' ? ' ' : c}
              </span>
            </span>
          ))}
        </h1>

        <motion.p
          className="hg-hero__sub"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2, duration: 0.6 }}
        >
          GameGuide-AI is the gaming co-pilot built on a self-healing 4-provider
          neural mesh. 200+ titles. Live intel. Sub-400ms calls.
        </motion.p>

        <motion.div
          className="hg-hero__ctas"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.4, duration: 0.5 }}
        >
          <button
            type="button"
            className="hg-btn hg-btn--primary"
            data-magnetic
            onClick={handleEnter}
          >
            <span>Enter</span>
            <span className="hg-btn__arrow" aria-hidden="true">→</span>
          </button>
          <a className="hg-btn hg-btn--ghost" href="#manifesto" data-magnetic>
            Read the manifesto
          </a>
        </motion.div>

        <div className="hg-hero__stats" aria-label="Key statistics">
          <div><b>4</b><span>provider mesh</span></div>
          <div><b>200+</b><span>titles indexed</span></div>
          <div><b>&lt;400ms</b><span>P50 latency</span></div>
        </div>
      </div>

      <div className={`hg-flash ${exiting ? 'is-active' : ''}`} aria-hidden="true" />
    </section>
  );
}

/* ============================================================
   SECTION: Manifesto strip
   ============================================================ */
function Manifesto() {
  const lines = [
    "We don't write guides.",
    'We compute them — live, every query, from six sources.',
    'And we hand them to you in 0.4 seconds.',
  ];
  return (
    <section className="hg-manifesto" id="manifesto" aria-label="Manifesto">
      {lines.map((line, i) => (
        <motion.div
          key={i}
          className="hg-manifesto__row"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 0.5, delay: i * 0.05 }}
        >
          <span className="hg-manifesto__num">0{i + 1}</span>
          <motion.p
            className="hg-manifesto__line"
            initial={{ clipPath: 'inset(0 100% 0 0)' }}
            whileInView={{ clipPath: 'inset(0 0% 0 0)' }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.05 + i * 0.08 }}
          >
            {line}
          </motion.p>
        </motion.div>
      ))}
    </section>
  );
}

/* ============================================================
   SECTION: Pinned horizontal pipeline
   ============================================================ */
const STAGES = [
  { id: 1, name: 'Intent', body: 'Slash commands, natural language, vision uploads — all parsed in parallel.', accent: '#67E8F9' },
  { id: 2, name: 'Mesh route', body: '4 providers. Load-aware. Self-healing fallback at the token level.', accent: '#A5B4FC' },
  { id: 3, name: 'PULSE search', body: 'Multi-source live web search. Wikipedia, Steam, Reddit, RSS — fused.', accent: '#C084FC' },
  { id: 4, name: 'Vision GODMODE', body: 'Screenshot-grade scene understanding for builds, fits, comps.', accent: '#F0ABFC' },
  { id: 5, name: 'Persona blend', body: 'Tone, depth, voice — adapted to the player at the keyboard.', accent: '#FB7185' },
  { id: 6, name: 'Stream', body: 'Tokens land in <400ms. Sources, follow-ups, prices — all attached.', accent: '#FDBA74' },
];

function PinnedPipeline({ pinned }) {
  const wrapRef = useRef(null);
  const trackRef = useRef(null);

  useLayoutEffect(() => {
    if (!pinned) return;
    const ctx = gsap.context(() => {
      const track = trackRef.current;
      const wrap = wrapRef.current;
      if (!track || !wrap) return;
      const distance = () => track.scrollWidth - window.innerWidth;
      gsap.to(track, {
        x: () => -distance(),
        ease: 'none',
        scrollTrigger: {
          trigger: wrap,
          pin: true,
          start: 'top top',
          end: () => `+=${distance() + window.innerHeight}`,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      });
    }, wrapRef);
    return () => ctx.revert();
  }, [pinned]);

  if (!pinned) {
    // Mobile / reduced-motion fallback: vertical stack
    return (
      <section className="hg-pipeline hg-pipeline--stacked" id="pipeline" aria-label="Pipeline">
        <div className="hg-section__head">
          <span className="hg-section__kicker">PIPELINE</span>
          <h2>Six stages. One round-trip.</h2>
        </div>
        <div className="hg-pipeline__stack">
          {STAGES.map((s) => (
            <article key={s.id} className="hg-stage hg-stage--stacked" style={{ '--stage-accent': s.accent }}>
              <div className="hg-stage__bg" aria-hidden="true" />
              <div className="hg-stage__num">0{s.id}</div>
              <h3>{s.name}</h3>
              <p>{s.body}</p>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="hg-pipeline" id="pipeline" ref={wrapRef} aria-label="Pipeline">
      <div className="hg-pipeline__viewport">
        <div className="hg-pipeline__track" ref={trackRef}>
          <div className="hg-pipeline__intro">
            <span className="hg-section__kicker">PIPELINE</span>
            <h2>Six stages.<br/>One round-trip.</h2>
            <p>Scroll horizontally — each stage activates as it enters the focus axis.</p>
          </div>
          {STAGES.map((s, i) => (
            <article
              key={s.id}
              className="hg-stage"
              style={{ '--stage-accent': s.accent, '--stage-i': i }}
            >
              <div className="hg-stage__bg" aria-hidden="true" />
              <div className="hg-stage__num">0{s.id}</div>
              <h3>{s.name}</h3>
              <p>{s.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   SECTION: Feature grid
   ============================================================ */
const FEATURES = [
  { name: 'Neural Mesh', body: '4-provider routing with self-healing fallback. No single LLM is a single point of failure.' },
  { name: 'PULSE Web Search', body: 'Live multi-source intel — Wikipedia, Steam, Reddit, RSS — fused into your answer.' },
  { name: 'Vision GODMODE', body: 'Screenshot-grade visual analysis for builds, kit fits, and comp reads.' },
  { name: 'Persona Engine', body: 'Tone and depth adapt to the player. Tactical, casual, or competitive — your call.' },
  { name: 'Slash Commands', body: 'Direct verbs for power users: /build, /counter, /price, /lore, and more.' },
  { name: 'Discord Bot', body: 'Same brain, in your server. Voice, threads, and inline price + lore lookups.' },
];

function FeatureGrid() {
  return (
    <section className="hg-features" id="features" aria-label="Capabilities">
      <div className="hg-section__head">
        <span className="hg-section__kicker">CAPABILITIES</span>
        <h2>Everything wired into one loop.</h2>
      </div>
      <div className="hg-features__grid">
        {FEATURES.map((f, i) => (
          <motion.article
            key={f.name}
            className="hg-feat"
            data-magnetic
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.55, delay: (i % 3) * 0.06, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="hg-feat__sheen" aria-hidden="true" />
            <div className="hg-feat__num">{String(i + 1).padStart(2, '0')}</div>
            <h3>{f.name}</h3>
            <p>{f.body}</p>
            <div className="hg-feat__edge" aria-hidden="true" />
          </motion.article>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
   SECTION: Live demo card
   ============================================================ */
const DEMO_QUERY = 'Best Reaver build in PoE 3.26 for max single-target?';
const DEMO_RESPONSE_LINES = [
  '**Reaver · Single-Target · 3.26**',
  '',
  '• **Skill:** Sunder of Glaciation — converted phys → cold scaling',
  '• **Gear pillar:** Replica Restless Ward + Mahuxotl shield',
  '• **Damage:** ~14.2M sustained DPS at endgame conf',
  '• **Why:** elemental cap > 90%, no map-mod blockers',
  '',
  'Sources: poe.ninja · Reddit r/PathOfExile · Steam patch notes',
];

function LiveDemo() {
  const [phase, setPhase] = useState('idle'); // idle | typing | thinking | answering | done
  const [typed, setTyped] = useState('');
  const [revealed, setRevealed] = useState(0);
  const ref = useRef(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && phase === 'idle') setPhase('typing');
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [phase]);

  useEffect(() => {
    if (reduce && phase === 'typing') {
      setTyped(DEMO_QUERY);
      setPhase('answering');
      return;
    }
    if (phase !== 'typing') return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setTyped(DEMO_QUERY.slice(0, i));
      if (i >= DEMO_QUERY.length) {
        clearInterval(id);
        setTimeout(() => setPhase('thinking'), 200);
        setTimeout(() => setPhase('answering'), 900);
      }
    }, 28);
    return () => clearInterval(id);
  }, [phase, reduce]);

  useEffect(() => {
    if (phase !== 'answering') return;
    if (revealed >= DEMO_RESPONSE_LINES.length) { setPhase('done'); return; }
    const id = setTimeout(() => setRevealed(r => r + 1), reduce ? 0 : 110);
    return () => clearTimeout(id);
  }, [phase, revealed, reduce]);

  return (
    <section className="hg-demo" id="demo" aria-label="Live demo" ref={ref}>
      <div className="hg-section__head">
        <span className="hg-section__kicker">LIVE DEMO</span>
        <h2>Type. Stream. Done.</h2>
      </div>
      <div className="hg-demo__card" data-magnetic>
        <div className="hg-demo__chrome">
          <span /> <span /> <span />
          <span className="hg-demo__title">gameguide://chat</span>
        </div>
        <div className="hg-demo__io">
          <div className="hg-demo__row hg-demo__row--user">
            <span className="hg-demo__label">YOU</span>
            <p>
              {typed}
              {phase === 'typing' && <span className="hg-caret" />}
            </p>
          </div>
          <div className="hg-demo__row hg-demo__row--ai">
            <span className="hg-demo__label">GAMEGUIDE</span>
            <div className="hg-demo__ai-body">
              {phase === 'thinking' && (
                <div className="hg-demo__think">
                  <span /> <span /> <span />
                </div>
              )}
              {(phase === 'answering' || phase === 'done') && (
                <div className="hg-demo__answer">
                  {DEMO_RESPONSE_LINES.slice(0, revealed).map((line, i) => (
                    <p key={i} className={line.startsWith('Sources') ? 'hg-demo__src' : ''}>
                      {renderInline(line)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function renderInline(line) {
  if (!line) return ' ';
  // tiny **bold** parser
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{p}</React.Fragment>
  );
}

/* ============================================================
   SECTION: Final CTA + Footer
   ============================================================ */
function FinalCTA({ onEnter, exiting }) {
  return (
    <section className="hg-cta" aria-label="Enter the app">
      <div className="hg-cta__inner">
        <h2>The moment before you press play.</h2>
        <p>Open the app. Ask anything. Watch it think.</p>
        <button
          type="button"
          className="hg-cta__btn"
          data-magnetic
          onClick={onEnter}
          disabled={exiting}
        >
          <span className="hg-cta__btn-face">
            <span>Enter</span>
            <span aria-hidden="true">→</span>
          </span>
          <span className="hg-cta__btn-edge" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="hg-footer">
      <span>GameGuide-AI · © 2026 — built on a self-healing neural mesh.</span>
    </footer>
  );
}

/* ============================================================
   SECTION: LandingPage main
   ============================================================ */
export default function LandingPage({ onEnter }) {
  const caps = useCapability();
  const [exiting, setExiting] = useState(false);
  const heroDollyRef = useRef(false);

  useLenis(!caps.reduce);

  // Refresh ScrollTrigger after layout stabilizes (fonts, lazy R3F)
  useEffect(() => {
    const id = setTimeout(() => ScrollTrigger.refresh(), 400);
    return () => clearTimeout(id);
  }, []);

  const handleEnter = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    setTimeout(() => onEnter?.(), 800);
  }, [exiting, onEnter]);

  return (
    <div className={`hg-root ${exiting ? 'is-exiting' : ''}`}>
      <div className="hg-noise" aria-hidden="true" />
      <Starfield />
      <MagneticCursor enabled={caps.magnetic} />
      <Nav />
      <main>
        <Hero webgl={caps.webgl} onEnter={handleEnter} />
        <Manifesto />
        <PinnedPipeline pinned={caps.webgl /* same threshold = desktop+motion */} />
        <FeatureGrid />
        <LiveDemo />
        <FinalCTA onEnter={handleEnter} exiting={exiting} />
      </main>
      <Footer />
      <div className={`hg-exit-flash ${exiting ? 'is-active' : ''}`} aria-hidden="true" />
    </div>
  );
}
