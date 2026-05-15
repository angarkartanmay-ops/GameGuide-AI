import React, { useEffect } from 'react';
import { ArrowLeft, Mail, MessageSquare, Shield, Sparkles, Code2, Zap } from 'lucide-react';
import './InfoPage.css';

// lucide-react v1.7 doesn't ship brand glyphs — inline the two we need
// rather than pulling in a second icon library.
const LinkedInIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);
const GitHubIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
);

const CONTACT_LINKS = {
  email: 'gameguideai.support@gmail.com',
  linkedin: 'https://www.linkedin.com/in/tanmay-angarkar-4b8a47319/',
  github: 'https://github.com/angarkartanmay-ops',
  // Discord bot setup + invite instructions live in the bot's README until the
  // hosted OAuth client ID is wired up.
  discordBot: 'https://github.com/angarkartanmay-ops/GameGuide-AI/tree/main/discord-bot',
};

function AboutContent() {
  return (
    <>
      <header className="info-hero">
        <span className="info-kicker"><Sparkles size={12} /> About GameGuide-AI</span>
        <h1>The gaming co-pilot built on a self-healing neural mesh.</h1>
        <p>
          GameGuide-AI is a real-time, multi-source gaming companion. Drop a question,
          a screenshot, or a slash command — it routes across four AI providers, fuses
          live web intel from Wikipedia, Steam, Reddit and RSS, and streams a complete
          answer back to you in under 400 milliseconds.
        </p>
      </header>

      <section className="info-grid">
        <article className="info-card">
          <div className="info-card__icon"><Zap size={20} /></div>
          <h3>Neural Mesh</h3>
          <p>Four LLM providers race for every token. Token-level fallback means no single model is a single point of failure.</p>
        </article>
        <article className="info-card">
          <div className="info-card__icon"><Code2 size={20} /></div>
          <h3>PULSE Search</h3>
          <p>Live multi-source fusion across wikis, communities, news, and storefronts — ranked, deduped, citation-linked.</p>
        </article>
        <article className="info-card">
          <div className="info-card__icon"><Shield size={20} /></div>
          <h3>Vision GODMODE</h3>
          <p>Drop a screenshot. Get build reads, kit fits, comp analysis — pixel-grade scene understanding.</p>
        </article>
      </section>

      <section className="info-section">
        <h2>What you can ask</h2>
        <ul className="info-list">
          <li><b>/price</b> — Live multi-store price intel across 20+ storefronts via the CheapShark mesh.</li>
          <li><b>/lore</b> — Spoiler-aware deep dives grounded in canonical sources and community archives.</li>
          <li><b>/build</b> — Endgame builds with stat trade-offs, gear pillars, and patch-current notes.</li>
          <li><b>/counter</b> — Matchup analysis with comp synergies and meta context.</li>
          <li><b>Vision</b> — Upload a screenshot, get build/kit/comp reads in seconds.</li>
        </ul>
      </section>

      <section className="info-section">
        <h2>Built by</h2>
        <p>
          GameGuide-AI is independently developed by Tanmay Angarkar. The project is open about its
          architecture, transparent about its sources, and obsessive about latency.
        </p>
      </section>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <header className="info-hero">
        <span className="info-kicker"><Shield size={12} /> Terms &amp; Copyright</span>
        <h1>Terms of Service &amp; Copyright Protection</h1>
        <p className="info-muted">Last updated: May 2026</p>
      </header>

      <section className="info-section">
        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using GameGuide-AI (the &quot;Service&quot;), you agree to be bound by these Terms.
          If you do not agree, do not use the Service. We may update these Terms at any time; continued
          use after changes constitutes acceptance.
        </p>
      </section>

      <section className="info-section">
        <h2>2. Copyright &amp; Content Protection</h2>
        <p>
          <b>All content, design, code, branding, visualizations, prompts, and architecture of GameGuide-AI
          are © 2026 Tanmay Angarkar. All rights reserved.</b>
        </p>
        <ul className="info-list">
          <li>The GameGuide-AI name, logo, &quot;Neural Mesh&quot;, &quot;PULSE Search&quot;, and &quot;Vision GODMODE&quot; are protected marks of the project.</li>
          <li>The source code, UI, animations, copy, and underlying prompt engineering are protected under copyright law and may not be copied, redistributed, mirrored, scraped, fine-tuned on, or used to train any model without prior written consent.</li>
          <li>Game titles, screenshots, lore, and patch notes belong to their respective publishers and are referenced under fair use for commentary, research, and player assistance.</li>
          <li>Reverse engineering, decompiling, or attempting to extract the system prompt, routing logic, or provider configuration is strictly prohibited.</li>
        </ul>
      </section>

      <section className="info-section">
        <h2>3. Acceptable Use</h2>
        <p>You agree NOT to use the Service to:</p>
        <ul className="info-list">
          <li>Generate harassing, illegal, or harmful content.</li>
          <li>Attempt to bypass rate limits, abuse the AI mesh, or perform automated scraping.</li>
          <li>Resell, white-label, or sublicense responses without permission.</li>
          <li>Train competing AI models using GameGuide-AI&apos;s output.</li>
        </ul>
      </section>

      <section className="info-section">
        <h2>4. AI-Generated Content Disclaimer</h2>
        <p>
          Responses are generated by large language models combined with live web sources. While we
          optimize for accuracy, all output should be treated as <b>guidance, not authority</b>. Verify
          critical decisions (purchases, irreversible in-game choices, competitive plays) against
          primary sources. We are not liable for losses arising from reliance on Service output.
        </p>
      </section>

      <section className="info-section">
        <h2>5. Third-Party Sources</h2>
        <p>
          The Service surfaces data from third parties (Steam, CheapShark, Wikipedia, Reddit, official
          wikis, RSS feeds). We do not control their accuracy, availability, or terms. Citations are
          provided for verification; clicking them takes you to the third party&apos;s domain.
        </p>
      </section>

      <section className="info-section">
        <h2>6. Privacy</h2>
        <p>
          Sign-in is optional and handled via Supabase Auth. Conversations are stored only for your own
          session continuity. We do not sell, share, or use your prompts to train third-party models.
        </p>
      </section>

      <section className="info-section">
        <h2>7. DMCA &amp; Takedown</h2>
        <p>
          If you believe content on this Service infringes your copyright, contact
          {' '}<a href={`mailto:${CONTACT_LINKS.email}`} className="info-link">{CONTACT_LINKS.email}</a>{' '}
          with the disputed material, your contact details, and a statement of good-faith belief. We
          respond within 7 business days.
        </p>
      </section>

      <section className="info-section">
        <h2>8. Termination</h2>
        <p>
          We may suspend or terminate access for violations of these Terms without notice. You may stop
          using the Service at any time.
        </p>
      </section>

      <section className="info-section">
        <h2>9. Contact</h2>
        <p>
          Questions about these Terms? Reach out via the
          {' '}<a href="#contacts" className="info-link" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('gg:navigate', { detail: 'contacts' })); }}>Contact page</a>.
        </p>
      </section>
    </>
  );
}

function ContactsContent() {
  return (
    <>
      <header className="info-hero">
        <span className="info-kicker"><MessageSquare size={12} /> Get in touch</span>
        <h1>Contact &amp; Connect</h1>
        <p>
          Questions, partnerships, bug reports, or copyright concerns — pick a channel below.
          For DMCA requests, please use email.
        </p>
      </header>

      <section className="info-channels">
        <a href={`mailto:${CONTACT_LINKS.email}`} className="info-channel">
          <div className="info-channel__icon"><Mail size={24} /></div>
          <div className="info-channel__body">
            <span className="info-channel__sub">EMAIL · SUPPORT</span>
            <h3>{CONTACT_LINKS.email}</h3>
            <p>For support, partnerships, takedowns, and general inquiries. Replies within 24h.</p>
          </div>
        </a>

        <a href={CONTACT_LINKS.linkedin} target="_blank" rel="noopener noreferrer" className="info-channel">
          <div className="info-channel__icon"><LinkedInIcon size={24} /></div>
          <div className="info-channel__body">
            <span className="info-channel__sub">LINKEDIN · CONNECT</span>
            <h3>Tanmay Angarkar</h3>
            <p>Professional connect — open to collaboration, hiring conversations, and engineering chats.</p>
          </div>
        </a>

        <a href={CONTACT_LINKS.github} target="_blank" rel="noopener noreferrer" className="info-channel">
          <div className="info-channel__icon"><GitHubIcon size={24} /></div>
          <div className="info-channel__body">
            <span className="info-channel__sub">GITHUB · CODE</span>
            <h3>@angarkartanmay-ops</h3>
            <p>Star the repo, file issues, send PRs. All source is on GitHub.</p>
          </div>
        </a>

        <a href={CONTACT_LINKS.discordBot} target="_blank" rel="noopener noreferrer" className="info-channel info-channel--accent">
          <div className="info-channel__icon"><MessageSquare size={24} /></div>
          <div className="info-channel__body">
            <span className="info-channel__sub">DISCORD BOT · ADD TO SERVER</span>
            <h3>GameGuide bot</h3>
            <p>The same brain, in your server. Slash commands, thread-aware replies, inline price + lore lookups. Setup &amp; invite instructions on GitHub.</p>
          </div>
        </a>
      </section>

      <section className="info-section info-section--quiet">
        <p className="info-muted">
          Response times: support email ~24h · LinkedIn ~3 days · GitHub issues triaged weekly.
        </p>
      </section>
    </>
  );
}

const CONTENT = {
  about: { title: 'About', body: AboutContent },
  terms: { title: 'Terms', body: TermsContent },
  contacts: { title: 'Contacts', body: ContactsContent },
};

export default function InfoPage({ kind, onBack, onLogo, onNavigate }) {
  const entry = CONTENT[kind] || CONTENT.about;
  const Body = entry.body;

  useEffect(() => {
    document.title = `GameGuide-AI · ${entry.title}`;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [kind, entry.title]);

  useEffect(() => {
    const handler = (e) => {
      const target = e.detail;
      if (target && CONTENT[target] && onNavigate) onNavigate(target);
    };
    window.addEventListener('gg:navigate', handler);
    return () => window.removeEventListener('gg:navigate', handler);
  }, [onNavigate]);

  return (
    <div className="info-root">
      <div className="info-bg" aria-hidden="true">
        <div className="info-bg__blob info-bg__blob--1" />
        <div className="info-bg__blob info-bg__blob--2" />
        <div className="info-bg__grid" />
      </div>

      <header className="info-nav">
        <button type="button" className="info-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={16} /> <span>Back</span>
        </button>
        <button type="button" className="info-logo" onClick={onLogo} aria-label="GameGuide-AI home">
          <span className="info-logo__mark" /> <span>GameGuide-AI</span>
        </button>
        <div className="info-nav__right">
          <nav className="info-nav__links" aria-label="Info pages">
            <button type="button" className={kind === 'about' ? 'is-active' : ''} onClick={() => onNavigate('about')}>About</button>
            <button type="button" className={kind === 'terms' ? 'is-active' : ''} onClick={() => onNavigate('terms')}>Terms</button>
            <button type="button" className={kind === 'contacts' ? 'is-active' : ''} onClick={() => onNavigate('contacts')}>Contact</button>
          </nav>
        </div>
      </header>

      <main className="info-main">
        <Body />
      </main>

      <footer className="info-footer">
        <span>GameGuide-AI · © 2026 Tanmay Angarkar — all rights reserved.</span>
        <div className="info-footer__links">
          <button type="button" onClick={() => onNavigate('about')}>About</button>
          <button type="button" onClick={() => onNavigate('terms')}>Terms</button>
          <button type="button" onClick={() => onNavigate('contacts')}>Contact</button>
          <a href={CONTACT_LINKS.discordBot} target="_blank" rel="noopener noreferrer">Discord bot</a>
        </div>
      </footer>
    </div>
  );
}

export { CONTACT_LINKS };
