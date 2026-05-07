import { useEffect, useRef, useState } from 'react';
import {
  // eslint-disable-next-line no-unused-vars
  motion,
  AnimatePresence, useScroll, useTransform, useSpring,
  useMotionValue, useMotionValueEvent
} from 'framer-motion';

/* =============================================================================
   GAMEGUIDE//AI  —  ARCADE PHANTOM landing
   Phosphor-lime + arcade-magenta + plasma-orange on deep void.
   Bungee × Anton × Sora × JetBrains Mono.
   ============================================================================= */

const EASE = [0.16, 1, 0.3, 1];
const SPRING = { type: 'spring', stiffness: 180, damping: 26, mass: 0.6 };

export default function LandingPage({ onEnter }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    document.body.classList.add('landing-mounted');
    return () => document.body.classList.remove('landing-mounted');
  }, []);

  const handleEnter = () => {
    if (exiting) return;
    setExiting(true);
    setTimeout(() => onEnter?.(), 750);
  };

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          className="arcade-cursor grain relative min-h-screen bg-void text-bone font-body overflow-x-clip selection:bg-phosphor selection:text-void"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04, filter: 'blur(24px)' }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <BootSplash />
          <CustomCursor />
          <Nav onEnter={handleEnter} />
          <Hero onEnter={handleEnter} />
          <MetricsBand />
          <Capabilities />
          <GamesMarquee />
          <Pipeline />
          <Testimonials />
          <FinalCTA onEnter={handleEnter} />
          <FootSlab />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ============================================================
   BOOT SPLASH — quick CRT power-on flash on first paint
   ============================================================ */
function BootSplash() {
  const [done, setDone] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDone(true), 900); return () => clearTimeout(t); }, []);
  if (done) return null;
  return (
    <motion.div
      className="fixed inset-0 z-[10000] bg-void flex items-center justify-center pointer-events-none"
      initial={{ opacity: 1 }}
      animate={{ opacity: [1, 1, 0] }}
      transition={{ duration: 0.9, times: [0, 0.7, 1], ease: 'easeOut' }}
    >
      <motion.div
        className="font-mono text-phosphor text-xs tracking-wider2"
        initial={{ scaleY: 0.02, opacity: 0 }}
        animate={{ scaleY: 1, opacity: 1 }}
        transition={{ duration: 0.35 }}
      >
        ▓▓ SIGNAL LOCKED ▓▓
      </motion.div>
    </motion.div>
  );
}

/* ============================================================
   CUSTOM CURSOR — phosphor crosshair w/ trailing ring
   ============================================================ */
function CustomCursor() {
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const ringX = useSpring(x, { stiffness: 220, damping: 24, mass: 0.4 });
  const ringY = useSpring(y, { stiffness: 220, damping: 24, mass: 0.4 });
  const [hot, setHot] = useState(false);

  useEffect(() => {
    const move = (e) => { x.set(e.clientX); y.set(e.clientY); };
    const overInteractive = (e) => {
      const t = e.target;
      const interactive = !!t.closest?.('[data-cursor="hot"], a, button, input');
      setHot(interactive);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseover', overInteractive);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseover', overInteractive);
    };
  }, [x, y]);

  // Hide on touch devices
  if (typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches) return null;

  return (
    <>
      <motion.div
        className="pointer-events-none fixed top-0 left-0 z-[9998] mix-blend-difference"
        style={{ x, y, translateX: '-50%', translateY: '-50%' }}
      >
        <div className="w-1.5 h-1.5 rounded-full bg-phosphor shadow-phosphor" />
      </motion.div>
      <motion.div
        className="pointer-events-none fixed top-0 left-0 z-[9997]"
        style={{ x: ringX, y: ringY, translateX: '-50%', translateY: '-50%' }}
        animate={{ scale: hot ? 1.6 : 1, opacity: hot ? 1 : 0.7 }}
        transition={{ duration: 0.18 }}
      >
        <div className="w-9 h-9 border border-phosphor/60 rotate-45" />
      </motion.div>
    </>
  );
}

/* ============================================================
   NAV — floating glass HUD
   ============================================================ */
function Nav({ onEnter }) {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, 'change', (v) => setScrolled(v > 24));

  const links = [
    { label: 'STACK',  href: '#stack' },
    { label: 'GRID',   href: '#grid' },
    { label: 'GAMES',  href: '#games' },
    { label: 'PIPE',   href: '#pipe' },
  ];

  return (
    <motion.header
      initial={{ y: -120, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-[padding,backdrop-filter] duration-500 ${scrolled ? 'pt-3' : 'pt-6'}`}
    >
      <div className={`mx-auto max-w-7xl px-4 transition-all duration-500 ${scrolled ? 'scale-[0.98]' : ''}`}>
        <div className={`flex items-center justify-between gap-4 px-5 py-3 rounded-sm border border-haze/80 ${scrolled ? 'bg-coal/85 backdrop-blur-xl' : 'bg-coal/40 backdrop-blur-md'} hud-corners`}>
          <span className="corner-tr" /><span className="corner-bl" />
          <a href="#top" className="flex items-center gap-3 group" data-cursor="hot">
            <DiamondMark />
            <span className="font-display text-bone text-[15px] leading-none tracking-tight">
              GAMEGUIDE<span className="text-phosphor">//</span>AI
            </span>
          </a>
          <nav className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                data-cursor="hot"
                className="relative px-3 py-2 font-mono text-[11px] tracking-wider2 text-ash hover:text-phosphor transition-colors group"
              >
                {l.label}
                <span className="absolute left-3 right-3 -bottom-0.5 h-px bg-phosphor scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-300" />
              </a>
            ))}
          </nav>
          <button
            onClick={onEnter}
            data-cursor="hot"
            className="group relative inline-flex items-center gap-2 px-4 py-2 bg-phosphor text-void font-display text-[12px] tracking-tight overflow-hidden hover:shadow-phosphor transition-shadow"
          >
            <span className="relative z-10">INSERT COIN</span>
            <span className="relative z-10 inline-block w-1.5 h-1.5 bg-void animate-blink-caret" />
            <span className="absolute inset-0 bg-magenta translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            <span className="absolute inset-0 z-10 mix-blend-screen opacity-0 group-hover:opacity-100 text-void transition-opacity">
              <span className="flex items-center gap-2 px-4 py-2 text-bone">INSERT COIN <span className="inline-block w-1.5 h-1.5 bg-bone" /></span>
            </span>
          </button>
        </div>
      </div>
    </motion.header>
  );
}

function DiamondMark() {
  return (
    <span className="relative inline-block w-6 h-6">
      <span className="absolute inset-0 bg-phosphor rotate-45 shadow-phosphor" />
      <span className="absolute inset-[5px] bg-void rotate-45" />
      <span className="absolute inset-[8px] bg-magenta rotate-45" />
    </span>
  );
}

/* ============================================================
   HERO — phosphor floor, massive type, HUD radial
   ============================================================ */
function Hero({ onEnter }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const yShift = useTransform(scrollYProgress, [0, 1], [0, 200]);
  const fade = useTransform(scrollYProgress, [0, 0.6], [1, 0]);

  // Parallax for HUD module from cursor
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const tx = useSpring(useTransform(mx, [-1, 1], [-12, 12]), SPRING);
  const ty = useSpring(useTransform(my, [-1, 1], [-12, 12]), SPRING);
  const handleMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width - 0.5) * 2);
    my.set(((e.clientY - r.top) / r.height - 0.5) * 2);
  };

  return (
    <section
      id="top"
      ref={ref}
      onMouseMove={handleMove}
      className="relative min-h-screen flex items-center pt-32 pb-24 overflow-hidden bg-void"
    >
      {/* Floor grid + fade */}
      <div className="floor-grid" />
      {/* Ambient orbs */}
      <div className="absolute -top-32 -left-24 w-[42rem] h-[42rem] rounded-full bg-magenta/20 blur-[140px]" />
      <div className="absolute top-24 right-0 w-[34rem] h-[34rem] rounded-full bg-phosphor/15 blur-[140px]" />
      <div className="absolute bottom-0 left-1/3 w-[28rem] h-[28rem] rounded-full bg-plasma/10 blur-[120px]" />
      {/* Vignette */}
      <div className="absolute inset-0 bg-radial-vignette pointer-events-none" />
      {/* CRT lines */}
      <div className="absolute inset-0 crt-lines opacity-50 pointer-events-none" />

      <motion.div
        style={{ y: yShift, opacity: fade }}
        className="relative z-10 mx-auto w-full max-w-7xl px-6 grid lg:grid-cols-[1.2fr_1fr] gap-12 items-center"
      >
        {/* LEFT — TYPE */}
        <div className="relative">
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.6 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-phosphor/40 bg-phosphor/5 mb-7"
          >
            <span className="relative inline-flex w-2 h-2">
              <span className="absolute inset-0 bg-phosphor rounded-full" />
              <span className="absolute inset-0 bg-phosphor rounded-full animate-pulse-ring" />
            </span>
            <span className="font-mono text-[11px] tracking-wider2 text-phosphor">
              v4.0 // OMNISCIENCE ENGINE ONLINE
            </span>
          </motion.div>

          <h1 className="font-display leading-[0.85] text-[clamp(3rem,9.5vw,8.5rem)] text-bone select-none">
            <RevealLine delay={0.3}>
              <span className="block">GAME</span>
            </RevealLine>
            <RevealLine delay={0.5}>
              <span className="block text-phosphor drop-shadow-[0_0_30px_rgba(204,255,0,0.45)]">GUIDE</span>
            </RevealLine>
            <RevealLine delay={0.7}>
              <span className="flex items-end gap-4">
                <span className="text-bone glitch" data-text="//AI">//AI</span>
                <span className="hidden sm:inline-block w-12 h-1 bg-magenta translate-y-[-1.6em] shadow-magenta" />
              </span>
            </RevealLine>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: 1.0 }}
            className="mt-7 max-w-xl font-body text-[16px] sm:text-[17px] leading-relaxed text-ash"
          >
            Six-layer real-time intelligence. Vision GODMODE decodes the screen,
            Cortex thinks, Pulse hits the live web. Built for ranked grinders,
            hardstuck climbers, and degenerates who refuse to lose.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: 1.15 }}
            className="mt-9 flex flex-wrap items-center gap-4"
          >
            <button
              onClick={onEnter}
              data-cursor="hot"
              className="group relative inline-flex items-center gap-3 px-7 py-4 bg-phosphor text-void font-display text-[14px] tracking-tight overflow-hidden hover:shadow-phosphor transition-shadow"
            >
              <span className="relative z-10">INSERT COIN TO BEGIN</span>
              <ArrowGlyph />
              <span className="absolute -inset-px bg-magenta translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              <span className="absolute inset-0 z-10 flex items-center gap-3 px-7 py-4 text-bone opacity-0 group-hover:opacity-100 transition-opacity">
                INSERT COIN TO BEGIN <ArrowGlyph />
              </span>
            </button>

            <a
              href="#stack"
              data-cursor="hot"
              className="group inline-flex items-center gap-3 px-7 py-4 border border-haze hover:border-phosphor/60 text-bone font-display text-[14px] tracking-tight transition-colors"
            >
              <span className="w-2 h-2 bg-magenta group-hover:bg-phosphor transition-colors" />
              VIEW STACK
            </a>
          </motion.div>

          {/* Live ticker */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.6, duration: 0.6 }}
            className="mt-10 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] tracking-wider2 text-ghost"
          >
            <Stat label="CORTEX" value="6 LAYERS" tone="phosphor" />
            <Stat label="LATENCY" value="◐ 240ms" />
            <Stat label="VISION" value="GODMODE" tone="magenta" />
            <Stat label="UPTIME" value="99.97%" />
          </motion.div>
        </div>

        {/* RIGHT — HUD radial module */}
        <motion.div
          style={{ x: tx, y: ty }}
          className="relative aspect-square max-w-[460px] mx-auto w-full"
        >
          <HudRadial />
        </motion.div>
      </motion.div>

      {/* Scroll cue */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.8, duration: 0.6 }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10"
      >
        <span className="font-mono text-[10px] tracking-wider2 text-ghost">SCROLL</span>
        <motion.span
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="block w-px h-8 bg-gradient-to-b from-phosphor to-transparent"
        />
      </motion.div>
    </section>
  );
}

function Stat({ label, value, tone }) {
  const valTone = tone === 'phosphor' ? 'text-phosphor' : tone === 'magenta' ? 'text-magenta' : 'text-bone';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-ghost">{label}</span>
      <span className="text-haze">::</span>
      <span className={valTone}>{value}</span>
    </span>
  );
}

function ArrowGlyph() {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" className="relative z-10">
      <path d="M0 5 H18 M14 1 L18 5 L14 9" stroke="currentColor" strokeWidth="1.6" fill="none" />
    </svg>
  );
}

function RevealLine({ children, delay = 0 }) {
  return (
    <span className="block overflow-hidden">
      <motion.span
        initial={{ y: '105%' }}
        animate={{ y: '0%' }}
        transition={{ duration: 0.9, ease: EASE, delay }}
        className="block"
      >
        {children}
      </motion.span>
    </span>
  );
}

/* HUD radial — concentric rings + spinning conic + center readout */
function HudRadial() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {/* Outer ring */}
      <div className="absolute inset-0 rounded-full border border-phosphor/30" />
      {/* Spinning conic */}
      <div className="absolute inset-3 rounded-full conic-ring animate-spin-slow" />
      {/* Inner ring */}
      <div className="absolute inset-10 rounded-full border border-magenta/30" />
      <div className="absolute inset-16 rounded-full border border-haze/80 animate-spin-slower" style={{ borderStyle: 'dashed' }} />
      {/* Tick marks */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200">
        {Array.from({ length: 60 }).map((_, i) => {
          const big = i % 5 === 0;
          return (
            <line
              key={i}
              x1="100" y1="6"
              x2="100" y2={big ? 14 : 10}
              stroke={big ? '#CCFF00' : '#5A5A6A'}
              strokeWidth={big ? 1.4 : 0.8}
              transform={`rotate(${i * 6} 100 100)`}
            />
          );
        })}
        {/* sweep */}
        <motion.line
          x1="100" y1="100" x2="100" y2="20"
          stroke="#FF1F8A" strokeWidth="1.2"
          animate={{ rotate: [0, 360] }}
          transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
          style={{ transformOrigin: '100px 100px' }}
        />
        <circle cx="100" cy="100" r="2" fill="#FF1F8A" />
      </svg>
      {/* Center readout */}
      <div className="relative z-10 text-center">
        <div className="font-mono text-[10px] tracking-wider2 text-phosphor">CORTEX::READY</div>
        <div className="font-display text-bone text-[40px] sm:text-[56px] leading-none mt-1">
          78<span className="text-phosphor">%</span>
        </div>
        <div className="font-mono text-[10px] tracking-wider2 text-ash mt-1">WIN PROBABILITY</div>
        <div className="mt-3 h-1 w-32 mx-auto bg-haze relative overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0 bg-phosphor shadow-phosphor"
            initial={{ width: 0 }}
            animate={{ width: '78%' }}
            transition={{ duration: 1.6, ease: EASE, delay: 1 }}
          />
        </div>
      </div>
      {/* Floating chips */}
      <FloatingChip className="-top-2 -left-4 bg-magenta text-void">THREAT: HIGH</FloatingChip>
      <FloatingChip className="-bottom-2 -right-2 bg-phosphor text-void" delay={0.5}>PATH OPTIMAL</FloatingChip>
      <FloatingChip className="top-1/2 -right-10 bg-coal border border-plasma text-plasma" delay={1}>↗ SECTOR 7G</FloatingChip>
    </div>
  );
}

function FloatingChip({ children, className = '', delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 1.2 + delay, duration: 0.6, ease: EASE }}
      className={`absolute font-mono text-[10px] tracking-wider2 px-2 py-1 ${className}`}
    >
      {children}
    </motion.div>
  );
}

/* ============================================================
   METRICS BAND
   ============================================================ */
function MetricsBand() {
  const items = [
    { v: '12,438', l: 'MATCHUPS DECODED' },
    { v: '6',      l: 'CORTEX LAYERS' },
    { v: '240ms',  l: 'AVG REACTION' },
    { v: '∞',      l: 'GAMES SUPPORTED', tone: 'magenta' },
  ];
  return (
    <section className="relative border-y border-haze bg-coal/60">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-phosphor to-transparent" />
      <div className="mx-auto max-w-7xl px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-6">
        {items.map((it, i) => (
          <motion.div
            key={it.l}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE, delay: i * 0.08 }}
            className="relative"
          >
            <div className={`font-display leading-none text-[clamp(2.2rem,4.6vw,3.6rem)] ${it.tone === 'magenta' ? 'text-magenta' : 'text-bone'}`}>
              {it.v}
            </div>
            <div className="mt-2 font-mono text-[11px] tracking-wider2 text-ghost">
              <span className="text-phosphor">▣</span> {it.l}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
   CAPABILITIES — Bento for 6-layer pipeline
   ============================================================ */
function Capabilities() {
  return (
    <section id="stack" className="relative py-28 overflow-hidden">
      <SectionHeader
        kicker="// 01 // STACK"
        title={<>SIX LAYERS,<br/><span className="text-phosphor">ZERO MERCY</span></>}
        sub="Each layer is a specialist. Together they form an omniscience engine that knows the game state better than the player holding the controller."
      />
      <div id="grid" className="mx-auto max-w-7xl px-6 mt-14 grid grid-cols-1 md:grid-cols-6 gap-4 auto-rows-[minmax(220px,auto)]">
        <BentoCard
          n="00" title="VISION GODMODE" tone="phosphor"
          desc="Frame-by-frame screen comprehension. Object detection, OCR, and tactical overlay generation in <120ms."
          className="md:col-span-3 md:row-span-2"
          big
        >
          <VisionVisual />
        </BentoCard>
        <BentoCard
          n="01" title="CORTEX REASONER" tone="magenta"
          desc="Multi-step reasoning over the parsed game-state. Decides, plans, and routes between specialists."
          className="md:col-span-3"
        >
          <CortexVisual />
        </BentoCard>
        <BentoCard
          n="02" title="PULSE ENGINE" tone="plasma"
          desc="Multi-source live web pulse. Patch notes, meta shifts, tournament results — under a second."
          className="md:col-span-3"
        >
          <PulseVisual />
        </BentoCard>
        <BentoCard
          n="03" title="WIKI/STEAM SCRAPER"
          desc="Server-side ingestion of canonical lore, stats, and patch history. Cached & cross-referenced."
          className="md:col-span-2"
        >
          <ScraperVisual />
        </BentoCard>
        <BentoCard
          n="04" title="YOUTUBE INTEL" tone="magenta"
          desc="Pulls top-rated guide content, transcribes, and distills the actually-useful 12 seconds."
          className="md:col-span-2"
        >
          <YoutubeVisual />
        </BentoCard>
        <BentoCard
          n="05" title="SUPERCELL LIVE" tone="phosphor"
          desc="Direct live-data feeds for Clash Royale, Brawl Stars, and friends. Real meta, real time."
          className="md:col-span-2"
        >
          <SupercellVisual />
        </BentoCard>
      </div>
    </section>
  );
}

function SectionHeader({ kicker, title, sub }) {
  return (
    <div className="mx-auto max-w-7xl px-6">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.7, ease: EASE }}
        className="max-w-3xl"
      >
        <div className="font-mono text-[11px] tracking-wider2 text-phosphor mb-3">{kicker}</div>
        <h2 className="font-display leading-[0.9] text-[clamp(2.4rem,6.5vw,5.4rem)] text-bone">{title}</h2>
        {sub && <p className="mt-5 max-w-xl text-ash text-[16px] leading-relaxed">{sub}</p>}
      </motion.div>
    </div>
  );
}

function BentoCard({ n, title, desc, tone = 'phosphor', children, className = '', big = false }) {
  const ref = useRef(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-1, 1], [4, -4]), SPRING);
  const ry = useSpring(useTransform(mx, [-1, 1], [-4, 4]), SPRING);
  const handleMove = (e) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    mx.set(((e.clientX - r.left) / r.width - 0.5) * 2);
    my.set(((e.clientY - r.top) / r.height - 0.5) * 2);
  };
  const handleLeave = () => { mx.set(0); my.set(0); };

  const accent =
    tone === 'magenta' ? 'text-magenta' :
    tone === 'plasma'  ? 'text-plasma'  : 'text-phosphor';

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{ transformPerspective: 1200, rotateX: rx, rotateY: ry }}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, ease: EASE }}
      className={`group relative bg-coal border border-haze hud-corners overflow-hidden ${className}`}
      data-cursor="hot"
    >
      <span className="corner-tr" /><span className="corner-bl" />
      {/* hover scanline reveal */}
      <span className="pointer-events-none absolute inset-x-0 -top-32 h-32 bg-gradient-to-b from-transparent via-phosphor/20 to-transparent group-hover:translate-y-[140%] transition-transform duration-[1200ms] ease-out" />
      {/* subtle inner grid */}
      <span className="absolute inset-0 opacity-[0.06] bg-grid-fine" style={{ backgroundSize: '24px 24px' }} />

      <div className="relative z-10 p-6 md:p-7 flex flex-col h-full">
        <div className="flex items-start justify-between">
          <div className={`font-display ${accent} text-[42px] md:text-[56px] leading-none`}>{n}</div>
          <span className={`font-mono text-[10px] tracking-wider2 ${accent}`}>LAYER · ACTIVE</span>
        </div>
        <h3 className={`mt-3 ${big ? 'text-3xl md:text-4xl' : 'text-xl md:text-2xl'} font-head tracking-tight text-bone`}>
          {title}
        </h3>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ash max-w-md">{desc}</p>
        <div className="mt-auto pt-5">{children}</div>
      </div>
    </motion.div>
  );
}

/* ===== Bento mini-visuals ===== */
function VisionVisual() {
  return (
    <div className="relative w-full h-44 md:h-56 border border-haze bg-void/60 overflow-hidden hud-corners">
      <span className="corner-tr" /><span className="corner-bl" />
      {/* fake pixel scene */}
      <div className="absolute inset-0 grid grid-cols-12 grid-rows-7 opacity-90">
        {Array.from({ length: 84 }).map((_, i) => {
          const c = (i * 37) % 9;
          const bg = c === 0 ? 'bg-phosphor/30' : c === 1 ? 'bg-magenta/30' : c === 2 ? 'bg-plasma/30' : c === 3 ? 'bg-ultra/20' : 'bg-haze/40';
          return <span key={i} className={bg} />;
        })}
      </div>
      {/* detection boxes */}
      <motion.div
        initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.4 }}
        className="absolute top-6 left-8 w-20 h-12 border-2 border-phosphor"
      >
        <span className="absolute -top-4 left-0 font-mono text-[9px] text-phosphor bg-void px-1">ENEMY · 0.94</span>
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.7 }}
        className="absolute bottom-4 right-6 w-24 h-14 border-2 border-magenta"
      >
        <span className="absolute -top-4 left-0 font-mono text-[9px] text-magenta bg-void px-1">PORTAL · 0.81</span>
      </motion.div>
      {/* sweep line */}
      <motion.div
        className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-phosphor to-transparent"
        animate={{ y: [0, 220, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

function CortexVisual() {
  return (
    <div className="relative w-full h-32 border border-haze bg-void/50 overflow-hidden">
      <svg viewBox="0 0 320 120" className="w-full h-full">
        <defs>
          <linearGradient id="link" x1="0" x2="1">
            <stop offset="0" stopColor="#CCFF00" stopOpacity="0.1" />
            <stop offset="0.5" stopColor="#FF1F8A" stopOpacity="0.7" />
            <stop offset="1" stopColor="#CCFF00" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        {[40, 100, 160, 220, 280].map((cx, i) => (
          <g key={cx}>
            {i < 4 && <line x1={cx} y1="60" x2={cx + 60} y2="60" stroke="url(#link)" strokeWidth="1" />}
            <circle cx={cx} cy="60" r="6" fill="#0E0E14" stroke="#CCFF00" strokeWidth="1.5" />
            <motion.circle
              cx={cx} cy="60" r="3" fill="#FF1F8A"
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.2 }}
            />
          </g>
        ))}
        {[20, 100].map((y) => (
          <g key={y}>
            <line x1="100" y1="60" x2="160" y2={y} stroke="url(#link)" strokeWidth="0.6" />
            <line x1="160" y1="60" x2="220" y2={y} stroke="url(#link)" strokeWidth="0.6" />
            <circle cx="160" cy={y} r="3" fill="#FF1F8A" />
          </g>
        ))}
      </svg>
    </div>
  );
}

function PulseVisual() {
  return (
    <div className="relative w-full h-32 border border-haze bg-void/50 overflow-hidden flex items-end gap-1 px-3 pb-2">
      {Array.from({ length: 40 }).map((_, i) => {
        const h = 20 + Math.abs(Math.sin(i * 0.6)) * 70 + (i % 5 === 0 ? 20 : 0);
        return (
          <motion.span
            key={i}
            className="flex-1 bg-plasma/70"
            initial={{ height: 0 }}
            whileInView={{ height: `${h}%` }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: i * 0.02, ease: EASE }}
          />
        );
      })}
      <span className="absolute top-2 left-3 font-mono text-[10px] text-plasma">⌁ LIVE FEED · 0.4s</span>
    </div>
  );
}

function ScraperVisual() {
  return (
    <div className="relative w-full h-32 border border-haze bg-void/60 overflow-hidden font-mono text-[10px] leading-snug p-3">
      <div className="text-ghost">$ scrape --src=wiki,steam</div>
      {[
        { t: '✓ wiki/clash_royale.json',     c: 'text-phosphor' },
        { t: '✓ steam/apex_legends.html',    c: 'text-phosphor' },
        { t: '· cache hit (12,438 entries)', c: 'text-ash' },
        { t: '⌁ index rebuilt in 0.31s',     c: 'text-magenta' },
      ].map((l, i) => (
        <motion.div
          key={l.t}
          initial={{ opacity: 0, x: -8 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 + i * 0.18, duration: 0.5 }}
          className={l.c}
        >{l.t}</motion.div>
      ))}
      <span className="absolute right-3 bottom-3 inline-block w-2 h-3 bg-phosphor animate-blink-caret" />
    </div>
  );
}

function YoutubeVisual() {
  return (
    <div className="relative w-full h-32 border border-haze bg-void/60 overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative">
          <div className="w-16 h-12 bg-magenta/90 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 12 12"><path d="M3 1 L10 6 L3 11 Z" fill="#06060A" /></svg>
          </div>
          <span className="absolute -inset-2 border border-magenta/50" />
        </div>
      </div>
      <div className="absolute bottom-2 left-3 right-3 space-y-1">
        <div className="h-1.5 bg-haze relative overflow-hidden">
          <motion.span className="absolute inset-y-0 left-0 bg-magenta"
            initial={{ width: 0 }} whileInView={{ width: '64%' }} viewport={{ once: true }}
            transition={{ duration: 1.4, ease: EASE }} />
        </div>
        <div className="flex justify-between font-mono text-[9px] text-ash">
          <span>02:48</span><span className="text-magenta">⌁ DISTILLED</span><span>04:21</span>
        </div>
      </div>
    </div>
  );
}

function SupercellVisual() {
  return (
    <div className="relative w-full h-32 border border-haze bg-void/60 overflow-hidden p-3 grid grid-cols-3 gap-2">
      {[
        { l: 'TROPHY', v: '6,842', c: 'text-phosphor' },
        { l: 'GEMS',   v: '14k',   c: 'text-magenta' },
        { l: 'WIN%',   v: '63',    c: 'text-plasma' },
        { l: 'META',   v: 'A+',    c: 'text-bone' },
        { l: 'TIER',   v: 'S',     c: 'text-phosphor' },
        { l: 'PING',   v: '42ms',  c: 'text-ash' },
      ].map((s, i) => (
        <motion.div
          key={s.l}
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.07, duration: 0.5 }}
          className="border border-haze p-1.5 text-center"
        >
          <div className={`font-display text-[18px] leading-none ${s.c}`}>{s.v}</div>
          <div className="font-mono text-[8.5px] tracking-wider2 text-ghost mt-0.5">{s.l}</div>
        </motion.div>
      ))}
    </div>
  );
}

/* ============================================================
   GAMES MARQUEE
   ============================================================ */
function GamesMarquee() {
  const row1 = ['CLASH ROYALE', 'BRAWL STARS', 'VALORANT', 'APEX LEGENDS', 'LEAGUE OF LEGENDS', 'DOTA 2', 'OVERWATCH', 'CSGO', 'FORTNITE', 'GENSHIN IMPACT'];
  const row2 = ['MINECRAFT', 'CALL OF DUTY', 'ROCKET LEAGUE', 'STARCRAFT 2', 'HEARTHSTONE', 'TEAMFIGHT TACTICS', 'RAINBOW SIX', 'PUBG', 'WARZONE', 'COC'];
  return (
    <section id="games" className="relative py-20 border-y border-haze bg-coal/40 overflow-hidden">
      <SectionHeader
        kicker="// 02 // GRID"
        title={<>EVERY GAME.<br/><span className="text-magenta">EVERY MATCH.</span></>}
      />
      <div className="mt-14 space-y-6">
        <Marquee items={row1} className="text-bone" />
        <Marquee items={row2} className="text-phosphor" reverse />
      </div>
    </section>
  );
}

function Marquee({ items, className = '', reverse = false }) {
  const doubled = [...items, ...items];
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-void to-transparent z-10" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-void to-transparent z-10" />
      <div className={`flex gap-12 whitespace-nowrap ${reverse ? 'animate-marquee-reverse' : 'animate-marquee'}`}>
        {doubled.map((g, i) => (
          <span
            key={`${g}-${i}`}
            className={`font-head text-[clamp(2.4rem,7vw,5.5rem)] leading-none tracking-tight ${className}`}
          >
            {g}
            <span className="inline-block mx-6 align-middle w-3 h-3 rotate-45 bg-magenta" />
          </span>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   PIPELINE — scroll-jacked 6-stage visual
   ============================================================ */
function Pipeline() {
  const stages = [
    { k: '00', t: 'CAPTURE',   d: 'Frame in.' },
    { k: '01', t: 'VISION',    d: 'Decode.' },
    { k: '02', t: 'CORTEX',    d: 'Reason.' },
    { k: '03', t: 'PULSE',     d: 'Cross-check.' },
    { k: '04', t: 'STRATEGY',  d: 'Plan.' },
    { k: '05', t: 'COMMAND',   d: 'Speak.' },
  ];
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const i = Math.min(stages.length - 1, Math.max(0, Math.floor(v * stages.length * 1.1)));
    setActive(i);
  });
  const lineWidth = useTransform(scrollYProgress, [0.05, 0.95], ['0%', '100%']);

  return (
    <section id="pipe" ref={ref} className="relative py-28 overflow-hidden">
      <SectionHeader
        kicker="// 03 // PIPE"
        title={<>FRAME IN. <span className="text-phosphor">PLAY OUT.</span></>}
        sub="Watch the pipeline light up. Scroll = signal. Each stage hands off to the next in under a second."
      />
      <div className="mx-auto max-w-7xl px-6 mt-16">
        {/* Top rail */}
        <div className="relative h-px bg-haze mb-10">
          <motion.div className="absolute inset-y-0 left-0 bg-phosphor shadow-phosphor" style={{ width: lineWidth }} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {stages.map((s, i) => {
            const on = i <= active;
            return (
              <motion.div
                key={s.k}
                animate={{ opacity: on ? 1 : 0.35, y: on ? 0 : 10 }}
                transition={{ duration: 0.5, ease: EASE }}
                className={`relative border ${on ? 'border-phosphor' : 'border-haze'} bg-coal p-4 hud-corners`}
              >
                <span className="corner-tr" /><span className="corner-bl" />
                <div className={`font-display text-[28px] leading-none ${on ? 'text-phosphor' : 'text-ghost'}`}>{s.k}</div>
                <div className="mt-2 font-head text-bone text-lg tracking-tight">{s.t}</div>
                <div className="mt-1 font-mono text-[10px] tracking-wider2 text-ash">{s.d}</div>
                {on && (
                  <motion.span
                    layoutId="pipe-cursor"
                    className="absolute -bottom-1 left-0 right-0 h-1 bg-magenta shadow-magenta"
                  />
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Active stage detail */}
        <div className="mt-12 grid md:grid-cols-3 gap-4">
          <div className="md:col-span-2 border border-haze bg-coal p-7 hud-corners relative">
            <span className="corner-tr" /><span className="corner-bl" />
            <div className="font-mono text-[11px] tracking-wider2 text-phosphor">NOW PROCESSING</div>
            <AnimatePresence mode="wait">
              <motion.h3
                key={stages[active].k}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="mt-2 font-display text-bone text-[2.6rem] leading-none"
              >
                {stages[active].k} · {stages[active].t}
              </motion.h3>
            </AnimatePresence>
            <p className="mt-3 text-ash">
              Stage {stages[active].k} of 06 — {stages[active].d} Hand-off in <span className="text-phosphor font-mono">~140ms</span>.
            </p>
            <div className="mt-6 h-1.5 bg-haze relative overflow-hidden">
              <motion.span
                className="absolute inset-y-0 left-0 bg-phosphor shadow-phosphor"
                animate={{ width: `${((active + 1) / stages.length) * 100}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>
          <div className="border border-haze bg-coal p-6 font-mono text-[12px] leading-relaxed text-ash hud-corners relative">
            <span className="corner-tr" /><span className="corner-bl" />
            <div className="text-phosphor mb-2">$ tail -f /var/cortex/pipe</div>
            <div>↳ frame_id: 0x{(active * 7919).toString(16)}</div>
            <div>↳ stage:    {stages[active].t.toLowerCase()}</div>
            <div>↳ tokens:   {1024 + active * 387}</div>
            <div>↳ status:   <span className="text-phosphor">OK</span></div>
            <div className="mt-3 text-magenta">▶ next: {stages[(active + 1) % stages.length].t.toLowerCase()}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   TESTIMONIALS — voices from the battlefield
   ============================================================ */
function Testimonials() {
  const quotes = [
    {
      q: 'Climbed from Diamond to Champion in nine days. The pulse engine called the meta shift before reddit did.',
      n: 'KaijuByte', r: 'CHAMPION', g: 'CLASH ROYALE', tone: 'phosphor',
    },
    {
      q: 'Vision GODMODE picked up the flank rotation I was missing every single match. Win rate +27%.',
      n: 'mochi.exe', r: 'IMMORTAL', g: 'VALORANT', tone: 'magenta',
    },
    {
      q: 'I run six tabs and yell at the screen. Now I run zero tabs and win.',
      n: 'lateNightAxel', r: 'GRANDMASTER', g: 'APEX', tone: 'plasma',
    },
  ];
  return (
    <section className="relative py-28 overflow-hidden">
      <SectionHeader
        kicker="// 04 // VOICES"
        title={<>QUOTES FROM<br/><span className="text-magenta">THE BATTLEFIELD</span></>}
      />
      <div className="mx-auto max-w-7xl px-6 mt-14 grid md:grid-cols-3 gap-5">
        {quotes.map((q, i) => (
          <motion.figure
            key={q.n}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.7, ease: EASE, delay: i * 0.1 }}
            className="relative bg-coal border border-haze p-7 hud-corners flex flex-col"
            data-cursor="hot"
          >
            <span className="corner-tr" /><span className="corner-bl" />
            <div className="font-display text-[60px] leading-none text-phosphor opacity-30 absolute -top-2 left-3">"</div>
            <blockquote className="relative font-body text-[15px] leading-relaxed text-bone mt-4">
              {q.q}
            </blockquote>
            <figcaption className="mt-6 pt-4 border-t border-haze flex items-center justify-between">
              <div>
                <div className="font-head text-bone text-lg tracking-tight">@{q.n}</div>
                <div className="font-mono text-[10px] tracking-wider2 text-ghost mt-0.5">{q.g}</div>
              </div>
              <div className={`px-2 py-1 font-mono text-[10px] tracking-wider2 border ${
                q.tone === 'magenta' ? 'text-magenta border-magenta' :
                q.tone === 'plasma'  ? 'text-plasma border-plasma' :
                                       'text-phosphor border-phosphor'}`}>
                {q.r}
              </div>
            </figcaption>
          </motion.figure>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
   FINAL CTA — arcade machine
   ============================================================ */
function FinalCTA({ onEnter }) {
  return (
    <section className="relative py-28 overflow-hidden">
      {/* Warning tape band */}
      <div className="absolute inset-x-0 top-0 h-3 warning-tape opacity-60" />
      <div className="absolute inset-x-0 bottom-0 h-3 warning-tape opacity-60" />

      <div className="mx-auto max-w-5xl px-6 text-center relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: EASE }}
          className="font-mono text-[11px] tracking-wider2 text-phosphor mb-4"
        >
          // 05 // BEGIN //
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
          className="font-display leading-[0.85] text-[clamp(3rem,11vw,9rem)] text-bone"
        >
          INSERT<br/>
          <span className="text-phosphor drop-shadow-[0_0_40px_rgba(204,255,0,0.55)]">COIN</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.25 }}
          className="mt-5 max-w-xl mx-auto text-ash"
        >
          The cortex is warm. The pipeline is live. One click to start asking.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.4 }}
          className="mt-12 inline-block"
        >
          <CoinSlot onEnter={onEnter} />
        </motion.div>

        <div className="mt-10 font-mono text-[11px] tracking-wider2 text-ghost">
          ↘ NO ACCOUNT REQUIRED · ↘ 100% FREE TO PLAY · ↘ 1 CREDIT = ∞ MATCHES
        </div>
      </div>
    </section>
  );
}

function CoinSlot({ onEnter }) {
  return (
    <button
      onClick={onEnter}
      data-cursor="hot"
      className="group relative inline-flex flex-col items-center"
    >
      {/* coin */}
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        className="relative w-16 h-16 mb-2"
      >
        <span className="absolute inset-0 rounded-full bg-phosphor shadow-phosphor" />
        <span className="absolute inset-1 rounded-full border-2 border-void/40 flex items-center justify-center">
          <span className="font-display text-void text-2xl leading-none">¢</span>
        </span>
      </motion.div>
      {/* slot */}
      <div className="relative px-14 py-7 bg-coal border-2 border-phosphor overflow-hidden hud-corners">
        <span className="corner-tr" /><span className="corner-bl" />
        <span className="absolute inset-x-6 top-3 h-1 bg-void shadow-[inset_0_2px_4px_rgba(0,0,0,0.9)] rounded-full" />
        <span className="font-display text-bone text-2xl tracking-tight relative z-10 group-hover:text-phosphor transition-colors">
          PRESS START
        </span>
        <span className="absolute inset-0 bg-phosphor/0 group-hover:bg-phosphor/10 transition-colors" />
      </div>
      <div className="mt-3 font-mono text-[10px] tracking-wider2 text-phosphor opacity-0 group-hover:opacity-100 transition-opacity">
        ▶ READY · 1P
      </div>
    </button>
  );
}

/* ============================================================
   FOOTER — terminal status slab
   ============================================================ */
function FootSlab() {
  return (
    <footer className="relative border-t border-haze bg-coal/70">
      <div className="mx-auto max-w-7xl px-6 py-10 grid md:grid-cols-3 gap-6 items-start">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <DiamondMark />
            <span className="font-display text-bone text-[15px] tracking-tight">
              GAMEGUIDE<span className="text-phosphor">//</span>AI
            </span>
          </div>
          <p className="font-mono text-[11px] tracking-wider2 text-ghost leading-relaxed">
            ARCADE-GRADE INTELLIGENCE.<br/>
            BUILT FOR PLAYERS WHO REFUSE TO LOSE.
          </p>
        </div>
        <div className="font-mono text-[11px] tracking-wider2 text-ghost space-y-1.5">
          <div><span className="text-phosphor">▣</span> SYSTEM ........... <span className="text-phosphor">ONLINE</span></div>
          <div><span className="text-phosphor">▣</span> CORTEX v4.0 ..... <span className="text-phosphor">ACTIVE</span></div>
          <div><span className="text-magenta">▣</span> VISION ........... <span className="text-magenta">GODMODE</span></div>
          <div><span className="text-plasma">▣</span> PULSE ............ <span className="text-plasma">240ms</span></div>
          <div><span className="text-ash">▣</span> SHARDS ........... <span className="text-ash">12,438</span></div>
        </div>
        <div className="flex md:justify-end">
          <ul className="font-mono text-[11px] tracking-wider2 space-y-2 text-right">
            {['PRIVACY', 'TERMINAL', 'API DOCS', 'SOURCE'].map((l) => (
              <li key={l}>
                <a href="#" data-cursor="hot" className="text-ash hover:text-phosphor transition-colors">↘ {l}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-haze">
        <div className="mx-auto max-w-7xl px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-2 font-mono text-[10px] tracking-wider2 text-ghost">
          <div>© 2026 GAMEGUIDE//AI · ALL CIRCUITS OPERATIONAL</div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-phosphor animate-pulse rounded-full" />
            LIVE · NO SLEEP MODE
          </div>
        </div>
      </div>
    </footer>
  );
}
