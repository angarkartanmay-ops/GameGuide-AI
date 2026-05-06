import React, { useRef, useState, useEffect } from 'react';
// eslint-disable-next-line no-unused-vars -- `motion` is used as JSX namespace (motion.div etc.)
import { motion, useScroll, useTransform, useSpring, useInView, AnimatePresence } from 'framer-motion';
import {
  Gamepad2, Sparkles, Eye, Zap, Brain, Globe, MessageSquare,
  ArrowRight, Send, Bot, Activity, Layers, Cpu, Radio, ChevronDown,
} from 'lucide-react';
import './LandingPage.css';

const easeOut = [0.16, 1, 0.3, 1];

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: easeOut } },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

const CAPABILITIES = [
  { icon: Eye, title: 'Vision GODMODE', desc: 'Drop a screenshot — three-tier vision mesh identifies cards, heroes, weapons, HUD elements with pixel-grounded confidence.', color: '#a855f7' },
  { icon: Activity, title: 'Project PULSE', desc: 'Recency-first live search. Catches "newest hero", "latest patch", "current meta" and grounds answers in publisher-dated sources.', color: '#06b6d4' },
  { icon: Brain, title: '6-Layer Cortex', desc: 'Query → Persona → Route → Mesh → Quality. Self-healing waterfall across Gemini, Groq, OpenRouter, Cerebras.', color: '#f59e0b' },
  { icon: Globe, title: 'Omni-Scrape', desc: 'Wikipedia, Steam News, YouTube, Reddit, Fandom, gaming RSS — all parallel-fetched and authority-ranked at request time.', color: '#10b981' },
  { icon: Sparkles, title: '9 Expert Personas', desc: 'Strategist, Lore Master, Speedrunner, Critic, Collector, Coach, Theorist, Hype Beast, and Roastmaster — auto-selected by intent.', color: '#ec4899' },
  { icon: Zap, title: 'Sub-2s Live Data', desc: 'Tightened 1.6s parallel scrape budget. Most temporal queries resolve in under two seconds with full source attribution.', color: '#ef4444' },
];

const PIPELINE_STAGES = [
  { num: '01', name: 'Query Cortex', desc: 'Intent · game · complexity' },
  { num: '02', name: 'Persona Engine', desc: 'Picks the right expert voice' },
  { num: '03', name: 'PULSE Detector', desc: 'Temporal? Live-search fires' },
  { num: '04', name: 'Route Optimizer', desc: 'Best provider × best model' },
  { num: '05', name: 'Neural Mesh', desc: 'Self-healing fallback chain' },
  { num: '06', name: 'Quality Gate', desc: 'Cache · validate · ship' },
];

const DEMO_MESSAGES = [
  { role: 'user', text: "Who's the newest Clash Royale hero?" },
  { role: 'ai', text: "🌊 PULSE intel — per Supercell's official feed (May 2026): **Hero Bowler** and **Hero Dark Prince** dropped in **Season 83**. Want a deck breakdown?" },
];

export default function LandingPage({ onEnter }) {
  const containerRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: containerRef });
  const heroY = useTransform(scrollYProgress, [0, 0.3], ['0%', '40%']);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.25], [1, 0]);
  const progressBar = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 });

  const [exiting, setExiting] = useState(false);

  const handleEnter = () => {
    setExiting(true);
    setTimeout(() => onEnter(), 700);
  };

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          ref={containerRef}
          className="lp-root"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.06, filter: 'blur(20px)' }}
          transition={{ duration: 0.7, ease: easeOut }}
        >
          <motion.div className="lp-progress-bar" style={{ scaleX: progressBar }} />

          <LandingNav onEnter={handleEnter} />
          <Hero heroY={heroY} heroOpacity={heroOpacity} onEnter={handleEnter} />
          <Marquee />
          <Capabilities />
          <Pipeline />
          <ChatDemo />
          <CTA onEnter={handleEnter} />
          <Footer />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function LandingNav({ onEnter }) {
  return (
    <motion.nav
      className="lp-nav"
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: easeOut, delay: 0.2 }}
    >
      <div className="lp-nav-brand">
        <motion.div whileHover={{ rotate: -15, scale: 1.1 }} transition={{ type: 'spring', stiffness: 300 }}>
          <Gamepad2 size={28} className="lp-nav-icon" />
        </motion.div>
        <span>GameGuide-AI</span>
      </div>
      <button className="lp-nav-cta" onClick={onEnter}>
        Try it now <ArrowRight size={16} />
      </button>
    </motion.nav>
  );
}

function Hero({ heroY, heroOpacity, onEnter }) {
  const title = 'GameGuide-AI';
  return (
    <section className="lp-hero">
      <div className="lp-mesh-bg">
        <motion.div className="lp-mesh-blob lp-blob-1" animate={{ x: [0, 50, -30, 0], y: [0, -40, 30, 0], scale: [1, 1.1, 0.95, 1] }} transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="lp-mesh-blob lp-blob-2" animate={{ x: [0, -60, 40, 0], y: [0, 50, -20, 0], scale: [1, 0.9, 1.15, 1] }} transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="lp-mesh-blob lp-blob-3" animate={{ x: [0, 30, -50, 0], y: [0, 60, 20, 0], scale: [1, 1.2, 0.85, 1] }} transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }} />
      </div>

      <motion.div className="lp-hero-grid" />

      <motion.div className="lp-hero-content" style={{ y: heroY, opacity: heroOpacity }}>
        <motion.div
          className="lp-eyebrow"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: easeOut, delay: 0.4 }}
        >
          <span className="lp-eyebrow-dot" />
          Cortex v4.2 · PULSE live-data engine
        </motion.div>

        <h1 className="lp-hero-title" aria-label={title}>
          {title.split('').map((c, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 80, rotateX: -90 }}
              animate={{ opacity: 1, y: 0, rotateX: 0 }}
              transition={{ duration: 0.8, ease: easeOut, delay: 0.5 + i * 0.04 }}
              style={{ display: 'inline-block', whiteSpace: 'pre' }}
            >
              {c}
            </motion.span>
          ))}
        </h1>

        <motion.p
          className="lp-hero-sub"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: easeOut, delay: 1.1 }}
        >
          The ultimate gamer's support system. Vision-grounded, recency-first, persona-driven.
          Drop a screenshot, ask "what's the newest hero", get answers backed by live publisher data.
        </motion.p>

        <motion.div
          className="lp-hero-cta-row"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: easeOut, delay: 1.3 }}
        >
          <motion.button
            className="lp-cta-primary"
            onClick={onEnter}
            whileHover={{ scale: 1.04, y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          >
            <span className="lp-cta-shine" />
            Try GameGuide-AI <ArrowRight size={20} />
          </motion.button>
          <motion.a className="lp-cta-secondary" href="#capabilities" whileHover={{ x: 4 }}>
            See what it does <ChevronDown size={16} />
          </motion.a>
        </motion.div>

        <motion.div
          className="lp-hero-orbit"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, ease: easeOut, delay: 1.5 }}
        >
          <motion.div className="lp-orbit-ring lp-orbit-1" animate={{ rotate: 360 }} transition={{ duration: 30, repeat: Infinity, ease: 'linear' }} />
          <motion.div className="lp-orbit-ring lp-orbit-2" animate={{ rotate: -360 }} transition={{ duration: 45, repeat: Infinity, ease: 'linear' }} />
          <motion.div className="lp-orbit-core" animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}>
            <Cpu size={32} />
          </motion.div>
        </motion.div>
      </motion.div>

      <motion.div
        className="lp-scroll-hint"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, y: [0, 8, 0] }}
        transition={{ opacity: { delay: 2, duration: 1 }, y: { duration: 2, repeat: Infinity, ease: 'easeInOut' } }}
      >
        <ChevronDown size={20} />
        <span>Scroll</span>
      </motion.div>
    </section>
  );
}

function Marquee() {
  const items = ['47 Games Supported', 'Vision GODMODE', '6-Layer Cortex', 'PULSE Live Search', '9 Expert Personas', 'Sub-2s Responses', 'Self-Healing Mesh', 'Source-Cited Answers'];
  return (
    <section className="lp-marquee">
      <motion.div
        className="lp-marquee-track"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 35, repeat: Infinity, ease: 'linear' }}
      >
        {[...items, ...items].map((it, i) => (
          <span className="lp-marquee-item" key={i}>
            <Sparkles size={14} /> {it}
          </span>
        ))}
      </motion.div>
    </section>
  );
}

function Capabilities() {
  return (
    <section className="lp-section" id="capabilities">
      <SectionHeader eyebrow="Capabilities" title="Built for gamers who want real answers" />
      <motion.div
        className="lp-cap-grid"
        variants={stagger}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-100px' }}
      >
        {CAPABILITIES.map((cap) => (
          <motion.div
            key={cap.title}
            className="lp-cap-card"
            variants={fadeUp}
            whileHover={{ y: -8, transition: { type: 'spring', stiffness: 300 } }}
            style={{ '--accent': cap.color }}
          >
            <div className="lp-cap-icon-wrap">
              <cap.icon size={26} />
            </div>
            <h3>{cap.title}</h3>
            <p>{cap.desc}</p>
            <div className="lp-cap-glow" aria-hidden />
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

function Pipeline() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-150px' });
  return (
    <section className="lp-section lp-pipeline-section" ref={ref}>
      <SectionHeader eyebrow="Under the hood" title="A 6-stage reasoning pipeline" />
      <div className="lp-pipeline">
        {PIPELINE_STAGES.map((stage, i) => (
          <React.Fragment key={stage.num}>
            <motion.div
              className="lp-pipeline-node"
              initial={{ opacity: 0, scale: 0.6, y: 30 }}
              animate={inView ? { opacity: 1, scale: 1, y: 0 } : {}}
              transition={{ duration: 0.6, ease: easeOut, delay: i * 0.15 }}
            >
              <div className="lp-pipeline-num">{stage.num}</div>
              <div className="lp-pipeline-name">{stage.name}</div>
              <div className="lp-pipeline-desc">{stage.desc}</div>
            </motion.div>
            {i < PIPELINE_STAGES.length - 1 && (
              <motion.div
                className="lp-pipeline-line"
                initial={{ scaleX: 0 }}
                animate={inView ? { scaleX: 1 } : {}}
                transition={{ duration: 0.5, ease: easeOut, delay: i * 0.15 + 0.3 }}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

function ChatDemo() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });
  const [visibleMsgs, setVisibleMsgs] = useState(0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!inView) return;
    let t1, t2, t3;
    t1 = setTimeout(() => setVisibleMsgs(1), 400);
    t2 = setTimeout(() => setTyping(true), 1400);
    t3 = setTimeout(() => { setTyping(false); setVisibleMsgs(2); }, 2900);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [inView]);

  return (
    <section className="lp-section" ref={ref}>
      <SectionHeader eyebrow="Live preview" title="See PULSE in action" />
      <motion.div
        className="lp-chat-demo"
        initial={{ opacity: 0, y: 60, rotateX: 8 }}
        animate={inView ? { opacity: 1, y: 0, rotateX: 0 } : {}}
        transition={{ duration: 1, ease: easeOut }}
      >
        <div className="lp-chat-header">
          <div className="lp-chat-dots">
            <span /><span /><span />
          </div>
          <div className="lp-chat-title">
            <Bot size={14} /> GameGuide-AI · Strategist mode
          </div>
          <div className="lp-chat-pulse">
            <Activity size={12} /> PULSE
          </div>
        </div>
        <div className="lp-chat-body">
          <AnimatePresence>
            {DEMO_MESSAGES.slice(0, visibleMsgs).map((m, i) => (
              <motion.div
                key={i}
                className={`lp-chat-msg lp-chat-msg-${m.role}`}
                initial={{ opacity: 0, y: 20, x: m.role === 'user' ? 30 : -30 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                transition={{ duration: 0.5, ease: easeOut }}
              >
                <div className="lp-chat-bubble" dangerouslySetInnerHTML={{ __html: formatBubble(m.text) }} />
              </motion.div>
            ))}
            {typing && (
              <motion.div
                key="typing"
                className="lp-chat-msg lp-chat-msg-ai"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="lp-chat-bubble lp-chat-typing">
                  <span /><span /><span />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="lp-chat-input-fake">
          <input placeholder="Ask anything about your game…" disabled />
          <button disabled><Send size={16} /></button>
        </div>
      </motion.div>
    </section>
  );
}

function formatBubble(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/🌊/g, '<span class="lp-emoji">🌊</span>');
}

function CTA({ onEnter }) {
  return (
    <section className="lp-section lp-cta-section">
      <motion.div
        className="lp-cta-card"
        initial={{ opacity: 0, y: 60, scale: 0.95 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.9, ease: easeOut }}
      >
        <motion.div
          className="lp-cta-aura"
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <h2 className="lp-cta-title">Ready to play smarter?</h2>
        <p className="lp-cta-sub">Free to try. No signup wall. Just ask.</p>
        <motion.button
          className="lp-cta-primary lp-cta-big"
          onClick={onEnter}
          whileHover={{ scale: 1.05, y: -3 }}
          whileTap={{ scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        >
          <span className="lp-cta-shine" />
          Try GameGuide-AI <ArrowRight size={22} />
        </motion.button>
      </motion.div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-row">
        <span><Gamepad2 size={16} /> GameGuide-AI</span>
        <span>Vision · PULSE · Cortex v4.2</span>
      </div>
    </footer>
  );
}

function SectionHeader({ eyebrow, title }) {
  return (
    <motion.div
      className="lp-section-header"
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-100px' }}
      transition={{ duration: 0.7, ease: easeOut }}
    >
      <div className="lp-eyebrow"><span className="lp-eyebrow-dot" />{eyebrow}</div>
      <h2 className="lp-section-title">{title}</h2>
    </motion.div>
  );
}
