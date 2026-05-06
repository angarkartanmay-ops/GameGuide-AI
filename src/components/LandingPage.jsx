import React, { useRef, useState, useEffect } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, useScroll, useTransform, useSpring, useInView, AnimatePresence } from 'framer-motion';

const easeOut = [0.16, 1, 0.3, 1];

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: easeOut } },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

export default function LandingPage({ onEnter }) {
  const containerRef = useRef(null);
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
          className="dark bg-background text-on-surface font-body-md selection:bg-primary-container selection:text-on-primary-container min-h-screen"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.06, filter: 'blur(20px)' }}
          transition={{ duration: 0.7, ease: easeOut }}
        >
          <TopAppBar onEnter={handleEnter} />
          <main className="pt-20">
            <Hero onEnter={handleEnter} />
            <Features />
            <InteractiveDemo />
          </main>
          <Footer />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TopAppBar({ onEnter }) {
  return (
    <motion.header 
      className="fixed top-0 w-full z-50 bg-surface/70 backdrop-blur-xl border-b border-white/10 shadow-[0_8px_32px_rgba(6,15,21,0.5)]"
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, ease: easeOut }}
    >
      <div className="flex justify-between items-center px-container-margin h-20 w-full max-w-screen-2xl mx-auto">
        <div className="flex items-center gap-sm">
          <img alt="GameGuide AI Logo" className="w-10 h-10" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBiolu8c41TxdnfLcSqffri0D6wNIQYdisoYnv4wXh6nR-L6xAe0gSNPTbf3ixlZ7vc0QfVnce9IsTVB54fxaSsxIqsJp_buIQ0_wUxX9Ycgv6cmV_-RTO_TiYzPBNt8jTKCCm1cOR_oGg0XDhmDhIrRa2O-ASCYPDr_bzr1mGS-ymqPJHwGTfAhITC26jpN7P5VxwjMOXrLAs_xFNCq0w1pVfOA931YW3MHGAVe_ExrVNfXCcj3-D019e1QuV0gXTXF_yiBvwRavbo" />
          <span className="font-headline-md text-headline-md font-bold text-primary drop-shadow-[0_0_8px_rgba(220,184,255,0.8)]">GameGuide AI</span>
        </div>
        <nav className="hidden md:flex items-center gap-xl">
          <a className="text-secondary-container font-bold border-b-2 border-secondary-container pb-1 transition-all active:scale-95 duration-200 ease-out" href="#">Neural Mesh</a>
          <a className="text-on-surface-variant font-body-md hover:text-secondary-fixed hover:drop-shadow-[0_0_5px_rgba(0,219,233,0.5)] transition-all active:scale-95 duration-200 ease-out" href="#">Pulse</a>
          <a className="text-on-surface-variant font-body-md hover:text-secondary-fixed hover:drop-shadow-[0_0_5px_rgba(0,219,233,0.5)] transition-all active:scale-95 duration-200 ease-out" href="#">Vision Decoder</a>
          <a className="text-on-surface-variant font-body-md hover:text-secondary-fixed hover:drop-shadow-[0_0_5px_rgba(0,219,233,0.5)] transition-all active:scale-95 duration-200 ease-out" href="#">Intelligence</a>
        </nav>
        <motion.button 
          onClick={onEnter}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="bg-primary-container text-on-primary-container px-lg py-sm font-label-caps rounded-lg font-bold transition-all shadow-[0_0_15px_rgba(138,43,226,0.4)]"
        >
          Launch Cortex
        </motion.button>
      </div>
    </motion.header>
  );
}

function Hero({ onEnter }) {
  return (
    <section className="relative min-h-[90vh] flex items-center cyber-grid overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/50 to-background pointer-events-none"></div>
      <div className="max-w-screen-2xl mx-auto px-container-margin grid grid-cols-1 lg:grid-cols-2 gap-xl items-center relative z-10">
        
        <motion.div 
          className="space-y-lg"
          variants={stagger}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={fadeUp} className="inline-flex items-center gap-sm bg-surface-container-high border border-primary/30 px-md py-xs rounded-full">
            <span className="w-2 h-2 rounded-full bg-secondary-container animate-pulse shadow-[0_0_8px_#00eefc]"></span>
            <span className="font-label-caps text-secondary text-label-caps">v2.4 CORE ACTIVE</span>
          </motion.div>
          
          <motion.h1 variants={fadeUp} className="font-display-xl text-display-xl leading-none">
            Unleash <span className="text-primary drop-shadow-[0_0_15px_rgba(220,184,255,0.6)]">Vision</span><br/>
            <span className="bg-gradient-to-r from-secondary-container to-primary bg-clip-text text-transparent">GODMODE</span>
          </motion.h1>
          
          <motion.p variants={fadeUp} className="font-body-lg text-body-lg text-outline max-w-xl">
            The ultimate 6-stage AI pipeline for real-time game intelligence. Decipher patterns, orchestrate strategy, and dominate the neural mesh with millisecond latency.
          </motion.p>
          
          <motion.div variants={fadeUp} className="flex flex-wrap gap-md pt-md">
            <motion.button 
              onClick={onEnter}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="bg-gradient-to-r from-primary-container to-secondary-container text-white px-xl py-md font-label-caps rounded-lg hover:brightness-110 hover:shadow-[0_0_25px_rgba(0,238,252,0.4)] transition-all"
            >
              Get Started
            </motion.button>
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="border border-outline-variant/50 bg-surface/50 backdrop-blur-md px-xl py-md font-label-caps rounded-lg hover:border-secondary transition-all text-on-surface"
            >
              View Documentation
            </motion.button>
          </motion.div>
        </motion.div>

        <motion.div 
          className="relative lg:h-[600px] flex items-center justify-center"
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 1, ease: easeOut, delay: 0.4 }}
        >
          <div className="glass-card w-full max-w-lg aspect-video rounded-xl p-md neon-glow-cyan">
            <div className="hud-bracket-tl"></div>
            <div className="hud-bracket-br"></div>
            <div className="flex items-center justify-between border-b border-outline-variant/30 pb-sm mb-md">
              <span className="font-label-caps text-secondary-container">PULSE v2 ACTIVE</span>
              <span className="text-outline text-xs">STREAMING DATA...</span>
            </div>
            <div className="space-y-xs font-mono text-[10px] text-primary/70">
              <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay: 1.0}}>&gt; Initializing Neural Mesh...</motion.p>
              <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay: 1.5}}>&gt; Scanning Game Environment... [OK]</motion.p>
              <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay: 2.0}}>&gt; Object Detection: 12 Enemy Units Found</motion.p>
              <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay: 2.5}}>&gt; Pathfinding: Optimal Route Calculated</motion.p>
              <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay: 3.0}}>&gt; Pulse Engine: 120ms Analysis Lag</motion.p>
              <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay: 3.5}}>&gt; Intelligence Overlay: ENABLED</motion.p>
              <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay: 4.0}} className="text-secondary-container animate-pulse">&gt; WARNING: EXTREME THREAT DETECTED</motion.p>
            </div>
            <div className="mt-xl h-24 bg-surface-container-lowest/50 rounded border border-outline-variant/20 relative overflow-hidden flex items-end gap-1 px-sm pb-1">
               {[40,60,30,80,50,90,70,40].map((h, i) => (
                 <motion.div 
                   key={i} 
                   className="w-2 bg-secondary-container/50" 
                   initial={{ height: 0 }}
                   animate={{ height: `${h}%` }}
                   transition={{ duration: 1, ease: 'easeOut', delay: 1 + i*0.1 }}
                 />
               ))}
            </div>
          </div>
          <div className="absolute -top-10 -right-10 w-64 h-64 bg-primary/20 blur-[100px] -z-10 rounded-full"></div>
          <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-secondary-container/20 blur-[100px] -z-10 rounded-full"></div>
        </motion.div>

      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="py-xl bg-surface-container-lowest overflow-hidden">
      <div className="max-w-screen-2xl mx-auto px-container-margin">
        <motion.div 
          className="text-center mb-xl"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.8, ease: easeOut }}
        >
          <h2 className="font-headline-lg text-headline-lg mb-sm">Neural Capabilities</h2>
          <div className="w-20 h-1 bg-gradient-to-r from-primary to-secondary-container mx-auto"></div>
        </motion.div>

        <motion.div 
          className="grid grid-cols-1 md:grid-cols-3 gap-gutter auto-rows-[280px]"
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
        >
          <motion.div variants={fadeUp} className="md:col-span-2 md:row-span-2 glass-card rounded-xl p-xl group">
            <div className="flex h-full flex-col justify-between">
              <div>
                <span className="material-symbols-outlined text-primary text-4xl mb-md">hub</span>
                <h3 className="font-headline-md text-headline-md mb-md">Neural Mesh Orchestrator</h3>
                <p className="text-outline max-w-md">The core processor that connects all intelligence nodes. Our proprietary mesh handles over 1 million concurrent game-state vectors per second.</p>
              </div>
              <div className="relative h-48 mt-md rounded-lg bg-surface-container overflow-hidden">
                <img className="w-full h-full object-cover opacity-40 group-hover:opacity-60 transition-opacity duration-500" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAAU12jhhLbQkHqzvmX7Sg6pWRpNwJxKgUetzkTlSmLxbTG14Xe--5cSqV_Mz2J4X88BRz_gPXS5r1xNB5LwGCMfH9XY9bHoDrE-q6lnR1viobFTrFbuoE_PNqItDB-prNDIjvDOxBqhGwBIjYmLucr9GG4cljwblEdaeurHYyt-8_Hg7uIpGyNKf7-bMAb04MzXMMPyVCXK4r4L4H-6Z3AIZGrT0qAwjnbInGU6tFuIuwEgyQyTrnu2HoeH0-3HxUHPx7guSnTvAh9" alt="Mesh" />
                <div className="absolute inset-0 bg-gradient-to-t from-surface-container to-transparent"></div>
              </div>
            </div>
          </motion.div>

          <motion.div variants={fadeUp} className="glass-card rounded-xl p-lg group hover:border-secondary-container/50 transition-all duration-300">
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between mb-md">
                <span className="material-symbols-outlined text-secondary-container">speed</span>
                <span className="text-[10px] font-label-caps text-secondary-container">LIVE STATUS</span>
              </div>
              <h3 className="font-headline-md text-headline-md mb-sm text-sm">Real-time Pulse</h3>
              <div className="flex-grow flex items-center justify-center">
                <div className="w-full space-y-sm">
                  <div className="flex justify-between text-[10px] font-mono text-outline">
                    <span>LATENCY</span>
                    <span className="text-secondary-container">14ms</span>
                  </div>
                  <div className="h-1 bg-surface-container-highest rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} whileInView={{ width: '85%' }} transition={{ duration: 1.5, ease: easeOut, delay: 0.5 }} className="h-full bg-secondary-container neon-glow-cyan"></motion.div>
                  </div>
                  <div className="flex justify-between text-[10px] font-mono text-outline">
                    <span>BANDWIDTH</span>
                    <span className="text-primary">9.8 GB/s</span>
                  </div>
                  <div className="h-1 bg-surface-container-highest rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} whileInView={{ width: '92%' }} transition={{ duration: 1.5, ease: easeOut, delay: 0.7 }} className="h-full bg-primary neon-glow-purple"></motion.div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div variants={fadeUp} className="glass-card rounded-xl p-lg group hover:border-primary/50 transition-all duration-300">
            <div className="flex flex-col h-full">
              <span className="material-symbols-outlined text-primary mb-md">visibility</span>
              <h3 className="font-headline-md text-headline-md mb-sm text-sm">Vision Decoder</h3>
              <p className="text-xs text-outline mb-md">Scanning frames for tactical advantages and enemy positioning in real-time.</p>
              <div className="mt-auto relative rounded border border-outline-variant/30 overflow-hidden aspect-video">
                <img className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBFKu8AJlz-p1yjxjbsN_rxl_Zj7x6LjlMAAt4Ejiut9yyTCTxws63VgWiXNAGdcU_rR8ax2Z9AEeE7yhRvaCIEvRdWzAbYPJ07tb-q6DQOL-y54rDtj48y_x2G4-KuWfHxRSQfv3yYIvFwofBd6ktWDHw80hIcxuIPm4OIqoS_CvZaFS1FiGkpKApdUGWuGhYeVBKYlI3ksy1pB8QbrQnrYZbwGq2303uppwGck3b7Xc1GR1U9-71OenGUhhJ1VyB5GrohwDz6SiCa" alt="Vision" />
              </div>
            </div>
          </motion.div>

          <motion.div variants={fadeUp} className="md:col-span-3 glass-card rounded-xl p-lg flex items-center gap-xl border-l-4 border-l-primary">
            <div className="flex-1">
              <h4 className="font-headline-md text-headline-md mb-xs">Advanced Intelligence Protocol</h4>
              <p className="text-outline text-sm">Seamlessly integrate GameGuide AI into your stack via our low-latency gRPC interface.</p>
            </div>
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="bg-surface-container-high border border-outline-variant/50 px-lg py-md rounded font-label-caps hover:bg-primary/10 transition-all text-primary"
            >
              Explore API
            </motion.button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function InteractiveDemo() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });
  const [visibleMsgs, setVisibleMsgs] = useState(0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!inView) return;
    let t1, t2, t3;
    t1 = setTimeout(() => setVisibleMsgs(1), 600);
    t2 = setTimeout(() => setTyping(true), 1200);
    t3 = setTimeout(() => { setTyping(false); setVisibleMsgs(2); }, 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [inView]);

  return (
    <section className="py-xl overflow-hidden" ref={ref}>
      <div className="max-w-screen-2xl mx-auto px-container-margin">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-xl items-stretch">
          
          <motion.div 
            className="glass-card rounded-xl flex flex-col h-[500px]"
            initial={{ opacity: 0, x: -40 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8, ease: easeOut }}
          >
            <div className="px-lg py-md border-b border-outline-variant/30 flex items-center justify-between">
              <div className="flex items-center gap-sm">
                <div className="w-3 h-3 rounded-full bg-primary neon-glow-purple animate-pulse"></div>
                <span className="font-label-caps">CORTEX CHAT</span>
              </div>
              <span className="text-outline text-xs">ENCRYPTED CHANNEL</span>
            </div>
            <div className="flex-grow p-lg space-y-md overflow-y-auto">
              
              <AnimatePresence>
                {visibleMsgs > 0 && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-md">
                    <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-sm">person</span>
                    </div>
                    <div className="bg-surface-container-high p-md rounded-xl rounded-tl-none max-w-[80%]">
                      <p className="text-sm">Analyze my current match. What's the winning play?</p>
                    </div>
                  </motion.div>
                )}

                {typing && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="flex gap-md flex-row-reverse">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 border border-primary/50">
                      <span className="material-symbols-outlined text-primary text-sm">smart_toy</span>
                    </div>
                    <div className="bg-primary/10 p-md rounded-xl rounded-tr-none max-w-[80%] border border-primary/20 flex items-center gap-1">
                      <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0 }} className="w-2 h-2 rounded-full bg-primary"></motion.span>
                      <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-2 h-2 rounded-full bg-primary"></motion.span>
                      <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-2 h-2 rounded-full bg-primary"></motion.span>
                    </div>
                  </motion.div>
                )}

                {visibleMsgs > 1 && (
                  <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="flex gap-md flex-row-reverse">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 border border-primary/50">
                      <span className="material-symbols-outlined text-primary text-sm">smart_toy</span>
                    </div>
                    <div className="bg-primary/10 p-md rounded-xl rounded-tr-none max-w-[80%] border border-primary/20">
                      <p className="text-sm">Neural Mesh has identified a weakness in the enemy's left flank. Rotate your squadron to Sector 7G. Use 'Tactical Pulse' to disrupt their comms.</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </div>
            <div className="p-md border-t border-outline-variant/30">
              <div className="relative">
                <input disabled className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-md py-sm text-sm focus:border-secondary-container focus:ring-0 transition-all opacity-50" placeholder="Direct query to Neural Mesh..." type="text" />
                <button disabled className="absolute right-2 top-2 text-secondary-container opacity-50">
                  <span className="material-symbols-outlined">send</span>
                </button>
              </div>
            </div>
          </motion.div>

          <motion.div 
            className="glass-card rounded-xl p-lg flex flex-col justify-between border-r-4 border-r-secondary-container"
            initial={{ opacity: 0, x: 40 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8, ease: easeOut, delay: 0.2 }}
          >
            <div>
              <h3 className="font-headline-md text-headline-md mb-md">Real-time Vision HUD</h3>
              <p className="text-outline mb-lg">See the game world through the eyes of our AI. Vision Decoder highlights threats, predicts enemy movement, and suggests tactical paths.</p>
            </div>
            <div className="relative group cursor-crosshair overflow-hidden rounded-lg mt-8">
              <img className="w-full h-auto grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDfawQHrqC6Prdjs9FpEtRP6UHNzA8SE_of7j0EPo7YXjeaX2CvICmR1q-i3bF5PciF4NBdk7bwNZJQcJuzlyCw9Yia2SsZGYlkRiPnuEIofiPE6VvLvN7YZyPcu6pPBEbAsTRT1RKe9TUmIdxMOZSlDGdCCqZOtlyU-bzlDy0L_-cPmY8z4W_pgXeovoQykJJI86Joeac0MHibEqi_3IQHz0OT8Z0CyWIehdfk3R8CAwE2vKL5wpbq3ToznFaX_uKzZp0dQ6_HwIb-" alt="HUD Analysis" />
              <div className="absolute top-4 left-4 flex gap-xs">
                <motion.div initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }} className="px-sm py-xs bg-error-container/80 text-error font-label-caps text-[10px] rounded">THREAT: HIGH</motion.div>
                <motion.div initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} transition={{ delay: 0.7 }} className="px-sm py-xs bg-secondary-container/80 text-on-secondary-container font-label-caps text-[10px] rounded">WIN PROBABILITY: 78%</motion.div>
              </div>
              <div className="absolute inset-0 border border-secondary-container/20 pointer-events-none group-hover:border-secondary-container/50 transition-all"></div>
            </div>
          </motion.div>

        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-surface-container-lowest border-t border-outline-variant/30 w-full py-xl mt-xl">
      <div className="flex flex-col md:flex-row justify-between items-center px-container-margin gap-lg max-w-screen-2xl mx-auto">
        <div className="space-y-sm text-center md:text-left">
          <div className="flex items-center gap-sm justify-center md:justify-start">
            <img alt="Logo" className="w-6 h-6 grayscale" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBiolu8c41TxdnfLcSqffri0D6wNIQYdisoYnv4wXh6nR-L6xAe0gSNPTbf3ixlZ7vc0QfVnce9IsTVB54fxaSsxIqsJp_buIQ0_wUxX9Ycgv6cmV_-RTO_TiYzPBNt8jTKCCm1cOR_oGg0XDhmDhIrRa2O-ASCYPDr_bzr1mGS-ymqPJHwGTfAhITC26jpN7P5VxwjMOXrLAs_xFNCq0w1pVfOA931YW3MHGAVe_ExrVNfXCcj3-D019e1QuV0gXTXF_yiBvwRavbo" />
            <span className="font-headline-md text-headline-md font-bold text-primary">GameGuide AI</span>
          </div>
          <div className="flex items-center gap-xs font-label-caps text-outline text-[10px] justify-center md:justify-start">
            <span className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse"></span>
            SYSTEM STATUS: ONLINE
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-lg">
          <a className="text-label-caps tracking-widest text-outline font-label-caps hover:text-on-surface transition-colors cursor-pointer" href="#">Privacy Protocol</a>
          <a className="text-label-caps tracking-widest text-outline font-label-caps hover:text-on-surface transition-colors cursor-pointer" href="#">Terminal Access</a>
          <a className="text-label-caps tracking-widest text-outline font-label-caps hover:text-on-surface transition-colors cursor-pointer" href="#">API Docs</a>
          <a className="text-label-caps tracking-widest text-outline font-label-caps hover:text-on-surface transition-colors cursor-pointer" href="#">Support</a>
        </div>
        <div className="text-label-caps tracking-widest text-outline font-label-caps">
          © 2024 GAMEGUIDE AI. ALL SYSTEMS OPERATIONAL.
        </div>
      </div>
    </footer>
  );
}
