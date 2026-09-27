import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, Copy, Mail, MessageSquare } from 'lucide-react';
import { LINKS, mailto } from '../site/links';
import { HERO_GAMES, heroArt } from '../site/showcase';
import { gsap, useCalm, useScene } from '../site/motion';
import SiteNav from './site/SiteNav';
import SiteFooter from './site/SiteFooter';
import { GitHubGlyph, LinkedInGlyph, Mark, Overline } from './site/bits';
import '../styles/site.css';

/** The game the visitor last saw on the landing, so the pages feel continuous. */
function lastGame() {
  try {
    const id = Number(sessionStorage.getItem('gg.site.game'));
    return HERO_GAMES.find(g => g.appid === id) || HERO_GAMES[0];
  } catch {
    return HERO_GAMES[0];
  }
}

const goto = (view) => (e) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('gg:navigate', { detail: view }));
};

// ─── About ─────────────────────────────────────────────────────────────────

const COMMANDS = [
  ['/progress', 'Tell it where you are — /progress Elden Ring: beat Margit. Story answers stay behind that line.'],
  ['/spoilers', 'Spoiler Shield on or off. On by default; /spoilers off once you have finished.'],
  ['/price', 'The best current price for a game across PC stores, and how it compares with its lowest ever.'],
  ['/discover', 'A random pro tip, hidden detail or piece of lore.'],
  ['/stealth', 'A throwaway conversation. Nothing saved, nothing remembered, no art looked up.'],
  ['/clear', 'Delete your chat history.'],
  ['/help', 'Every command, in the chat.'],
];

const PRINCIPLES = [
  ['No art beats wrong art.', 'If it isn’t sure which game you mean, the page keeps your theme rather than dressing up as the wrong one.'],
  ['Your story, your pace.', 'Spoiler Shield is on from the start. Nothing past where you are shows unless you click it.'],
  ['Stealth means stealth.', 'A Stealth conversation is never saved or remembered, and no game art is fetched for it.'],
  ['Guidance, not authority.', 'Answers cite their sources. When it matters — a purchase, a choice you can’t undo — check them.'],
];

function About() {
  return (
    <div className="s-prose">
      <section aria-labelledby="a-how">
        <h2 id="a-how" className="s-h3">How it works</h2>
        <ol className="s-numbered">
          <li><strong>It looks things up when you ask.</strong> Game wikis, official patch notes and web search are consulted when you ask, so answers follow the current patch rather than last year&rsquo;s.</li>
          <li><strong>It recognises the game.</strong> The chat takes on that game&rsquo;s Steam art and a colour sampled from it, and the answer is set out like a strategy-guide page.</li>
          <li><strong>It keeps your place.</strong> Tell it how far you have played and it answers up to there. Screenshots work too — up to three per message.</li>
        </ol>
      </section>

      <section aria-labelledby="a-ask">
        <h2 id="a-ask" className="s-h3">What you can ask</h2>
        <p>Anything, in plain words. A boss you are stuck on, a build, a quest, whether a game is on sale. These commands do specific jobs:</p>
        <dl className="s-defs">
          {COMMANDS.map(([cmd, text]) => (
            <div key={cmd}><dt><code>{cmd}</code></dt><dd>{text}</dd></div>
          ))}
        </dl>
        <p>
          In Discord, the bot answers @mentions and slash commands the same way, and <code>/watch</code> posts
          a game&rsquo;s patch notes and best deals into a channel.
        </p>
      </section>

      <section aria-labelledby="a-principles">
        <h2 id="a-principles" className="s-h3">Principles</h2>
        <ul className="s-principles">
          {PRINCIPLES.map(([head, text]) => (
            <li key={head}><Mark size="sm" /><div><strong>{head}</strong> {text}</div></li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="a-by">
        <h2 id="a-by" className="s-h3">Built by</h2>
        <p>
          GameGuide is designed and built independently by Tanmay Angarkar. Questions, ideas and bug
          reports are welcome — see the <a href="#contacts" className="s-a" onClick={goto('contacts')}>contact page</a>.
        </p>
        <p className="s-inline-links">
          <a className="s-a" href={LINKS.github} target="_blank" rel="noopener noreferrer"><GitHubGlyph size={16} /> GitHub</a>
          <a className="s-a" href={LINKS.linkedin} target="_blank" rel="noopener noreferrer"><LinkedInGlyph size={16} /> LinkedIn</a>
        </p>
      </section>
    </div>
  );
}

// ─── Terms ─────────────────────────────────────────────────────────────────

const Email = () => <a href={mailto()} className="s-a">{LINKS.email}</a>;

const TERMS = [
  {
    id: 't-acceptance', title: 'Acceptance of terms',
    body: (
      <p>
        By accessing or using GameGuide-AI (the &quot;Service&quot;), you agree to be bound by these Terms.
        If you do not agree, do not use the Service. We may update these Terms at any time; continued
        use after changes constitutes acceptance.
      </p>
    ),
  },
  {
    id: 't-copyright', title: 'Copyright & content protection',
    body: (
      <>
        <p>
          <strong>All content, design, code, branding, visualizations, prompts, and architecture of GameGuide-AI
          are © 2026 Tanmay Angarkar. All rights reserved.</strong>
        </p>
        <ul className="s-bullets">
          <li>The GameGuide-AI name, logo, &quot;Neural Mesh&quot;, &quot;PULSE Search&quot;, and &quot;Vision GODMODE&quot; are protected marks of the project.</li>
          <li>The source code, UI, animations, copy, and underlying prompt engineering are protected under copyright law and may not be copied, redistributed, mirrored, scraped, fine-tuned on, or used to train any model without prior written consent.</li>
          <li>Game titles, screenshots, artwork, lore, and patch notes belong to their respective publishers and are referenced under fair use for commentary, research, and player assistance.</li>
          <li>Reverse engineering, decompiling, or attempting to extract the system prompt, routing logic, or provider configuration is strictly prohibited.</li>
        </ul>
      </>
    ),
  },
  {
    id: 't-use', title: 'Acceptable use',
    body: (
      <>
        <p>You agree NOT to use the Service to:</p>
        <ul className="s-bullets">
          <li>Generate harassing, illegal, or harmful content.</li>
          <li>Attempt to bypass rate limits, abuse the AI mesh, or perform automated scraping.</li>
          <li>Resell, white-label, or sublicense responses without permission.</li>
          <li>Train competing AI models using GameGuide-AI&apos;s output.</li>
        </ul>
      </>
    ),
  },
  {
    id: 't-ai', title: 'AI-generated content disclaimer',
    body: (
      <p>
        Responses are generated by large language models combined with live web sources. While we
        optimize for accuracy, all output should be treated as <strong>guidance, not authority</strong>. Verify
        critical decisions (purchases, irreversible in-game choices, competitive plays) against
        primary sources. We are not liable for losses arising from reliance on Service output.
      </p>
    ),
  },
  {
    id: 't-sources', title: 'Third-party sources',
    body: (
      <p>
        The Service surfaces data from third parties (Steam, CheapShark, Wikipedia, Reddit, official
        wikis, RSS feeds). We do not control their accuracy, availability, or terms. Citations are
        provided for verification; clicking them takes you to the third party&apos;s domain.
      </p>
    ),
  },
  {
    id: 't-privacy', title: 'Privacy',
    body: (
      <>
        <p>
          Sign-in is optional and handled via Supabase Auth. Conversations are stored only for your own
          session continuity. Spoiler Shield keeps the game progress you tell it (for example
          “Elden Ring: beat Margit”) in your browser, and in your profile if you are signed in, so
          later answers stay spoiler-safe. We do not sell your data, and we do not use your prompts to train models.
          To answer a question, your prompt is sent to third-party AI model providers and search
          services, which process it under their own terms.
        </p>
        <p>
          When a game comes up, the chat fetches that game&rsquo;s artwork from Steam through our server; only the
          game&rsquo;s name is sent, and never in Stealth. The last few games you asked about are remembered in
          your browser, so the chat can offer them again.
        </p>
        <p><strong>Discord bot.</strong> When you use GameGuide-AI in Discord, the bot stores:</p>
        <ul className="s-bullets">
          <li>your Discord user ID, and the server ID when you use it in a server;</li>
          <li>the messages you send it and its replies, so it can remember the conversation;</li>
          <li>usage counts, to apply daily limits and show <strong>/stats</strong>;</li>
          <li>your Spoiler Shield setting and the game progress you tell it, so answers stay spoiler-safe;</li>
          <li>for servers using <strong>/watch</strong>: the server and channel IDs and the games to post patch notes or deals for — no user IDs. These are deleted with <strong>/watch remove</strong>, when the channel is deleted, or when the bot is removed from the server.</li>
        </ul>
        <p>
          The bot only reads messages that <strong>@mention it</strong>, direct messages sent to it, and its slash
          commands — never the rest of a server&apos;s chat. Stored conversation history is kept for at most
          <strong> 90 days</strong> and only your <strong>50 most recent</strong> messages are retained; per-message usage records
          are deleted after 3 days. Run <strong>/clear</strong> in Discord to delete your stored history and saved progress immediately,
          or email <Email /> to have any other data removed.
        </p>
      </>
    ),
  },
  {
    id: 't-dmca', title: 'DMCA & takedown',
    body: (
      <p>
        If you believe content on this Service infringes your copyright, contact <Email /> with the
        disputed material, your contact details, and a statement of good-faith belief. We respond
        within 7 business days.
      </p>
    ),
  },
  {
    id: 't-termination', title: 'Termination',
    body: (
      <p>
        We may suspend or terminate access for violations of these Terms without notice. You may stop
        using the Service at any time.
      </p>
    ),
  },
  {
    id: 't-contact', title: 'Contact',
    body: (
      <p>
        Questions about these Terms? Reach out via the{' '}
        <a href="#contacts" className="s-a" onClick={goto('contacts')}>contact page</a>.
      </p>
    ),
  },
];

function Terms() {
  const [active, setActive] = useState(TERMS[0].id);
  // Set when a contents entry is clicked. The last sections are too short to
  // reach the reading line, so the spy falls back to "the final one" at the
  // bottom of the page — which would otherwise overrule what you just picked.
  const picked = useRef(false);
  const pickedTimer = useRef(0);
  useEffect(() => () => clearTimeout(pickedTimer.current), []);

  // Scroll-spy: you are in the last section whose top has passed the reading
  // line. An IntersectionObserver band was tried first, but a short section
  // (§7 DMCA) could sit entirely inside it and never win, so clicking it
  // highlighted the section after. Offsets are measured once and re-measured
  // on resize, so scrolling itself never reads layout.
  useEffect(() => {
    const LINE = 140; // just below the sticky nav
    let frame = 0;
    let tops = [];
    const measure = () => {
      tops = TERMS.map(t => {
        const el = document.getElementById(t.id);
        return { id: t.id, top: el ? el.getBoundingClientRect().top + window.scrollY : 0 };
      });
    };
    const update = () => {
      frame = 0;
      if (!tops.length || picked.current) return;
      const line = window.scrollY + LINE;
      let current = tops[0].id;
      for (const s of tops) if (s.top <= line) current = s.id;
      // The last sections can be too short to ever reach the line, so at the
      // bottom of the page the final one is always the right answer.
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) current = tops[tops.length - 1].id;
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    measure();
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { measure(); update(); })
      : null;
    ro?.observe(document.body);
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      ro?.disconnect();
    };
  }, []);

  const jump = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    picked.current = true;
    clearTimeout(pickedTimer.current);
    pickedTimer.current = setTimeout(() => { picked.current = false; }, 1200);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
    setActive(id);
  };
  const n = TERMS.findIndex(t => t.id === active) + 1;

  return (
    <div className="s-terms">
      <nav className="s-toc" aria-label="Terms sections">
        <p className="s-toc__head">
          <span>Contents</span>
          <span className="s-toc__count" aria-hidden="true">§ {n} / {TERMS.length}</span>
        </p>
        <ol className="s-toc__list">
          {TERMS.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                className={`s-toc__link${t.id === active ? ' is-on' : ''}`}
                aria-current={t.id === active ? 'location' : undefined}
                onClick={() => jump(t.id)}
              >
                <span className="s-toc__num">{String(i + 1).padStart(2, '0')}</span>{t.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="s-prose">
        {TERMS.map((t, i) => (
          <section key={t.id} id={t.id} className="s-term" tabIndex={-1} aria-labelledby={`${t.id}-h`}>
            <h2 id={`${t.id}-h`} className="s-h3"><span className="s-term__num">{i + 1}.</span> {t.title}</h2>
            {t.body}
          </section>
        ))}
      </div>
    </div>
  );
}

// ─── Contact ───────────────────────────────────────────────────────────────

function Contact() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(LINKS.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch { /* clipboard blocked: the mailto link still works */ }
  };

  const rows = [
    {
      key: 'email', icon: <Mail size={22} />, label: 'Email · support', value: LINKS.email, href: mailto(),
      text: 'Support, partnerships, takedowns and anything else. Replies within about a day.',
      extra: (
        <button type="button" className="s-copy" onClick={copy} aria-label={copied ? 'Email address copied' : 'Copy email address'}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      ),
    },
    {
      key: 'discord', icon: <MessageSquare size={22} />, label: 'Discord · add the bot', value: 'GameGuide for your server',
      href: LINKS.discordInvite, external: true,
      text: 'The same guide in your server: @mention it, use its slash commands, or let Watchtower post patch notes.',
      extra: <a className="s-copy" href={LINKS.topgg} target="_blank" rel="noopener noreferrer"><span>top.gg</span><ArrowUpRight size={14} aria-hidden="true" /></a>,
    },
    {
      key: 'github', icon: <GitHubGlyph size={22} />, label: 'GitHub · code', value: '@angarkartanmay-ops',
      href: LINKS.github, external: true,
      text: 'Issues, ideas and pull requests.',
    },
    {
      key: 'linkedin', icon: <LinkedInGlyph size={22} />, label: 'LinkedIn · connect', value: 'Tanmay Angarkar',
      href: LINKS.linkedin, external: true,
      text: 'Collaboration, hiring conversations and engineering chats.',
    },
  ];

  return (
    <>
      <ul className="s-channels">
        {rows.map((r) => (
          <li key={r.key} className="s-channel">
            <a
              className="s-channel__main"
              href={r.href}
              {...(r.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              <span className="s-channel__icon" aria-hidden="true">{r.icon}</span>
              <span className="s-channel__body">
                <span className="s-channel__label">{r.label}</span>
                <span className="s-channel__value">{r.value}</span>
                <span className="s-channel__text">{r.text}</span>
              </span>
              <ArrowUpRight className="s-channel__arrow" size={20} aria-hidden="true" />
            </a>
            {r.extra && <span className="s-channel__extra">{r.extra}</span>}
          </li>
        ))}
      </ul>
      <p className="s-note">For DMCA requests, please use email.</p>
      <p className="s-note">Response times: support email ~24h · LinkedIn ~3 days · GitHub issues triaged weekly.</p>
      <span className="sr-only" role="status" aria-live="polite">{copied ? 'Email address copied' : ''}</span>
    </>
  );
}

// ─── Shell ─────────────────────────────────────────────────────────────────

const PAGES = {
  about: {
    title: 'About', label: 'About',
    heading: 'A game guide you can talk to.',
    lead: 'Ask about any game — a boss, a build, a quest, a sale — and GameGuide researches it live, sets the answer out like a strategy guide, and keeps the story you haven’t reached behind a bar.',
    Body: About,
  },
  terms: {
    title: 'Terms', label: 'Terms & copyright',
    heading: 'Terms of service & copyright.',
    lead: 'The rules for using GameGuide, what it stores and for how long, and how to reach us.',
    meta: 'Last updated: September 2026',
    Body: Terms,
  },
  contacts: {
    title: 'Contact', label: 'Contact',
    heading: 'Contact & connect.',
    lead: 'Questions, partnerships, bug reports or copyright concerns — pick a channel.',
    Body: Contact,
  },
};

export default function InfoPage({ kind, onBack, onLogo, onNavigate }) {
  const page = PAGES[kind] || PAGES.about;
  const calm = useCalm();
  const rootRef = useRef(null);
  const [game] = useState(lastGame);
  const { Body } = page;

  useEffect(() => {
    const prev = document.title;
    document.title = `GameGuide · ${page.title}`;
    window.scrollTo({ top: 0, behavior: 'instant' });
    return () => { document.title = prev; };
  }, [page.title]);

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
    { label: 'About', onClick: () => onNavigate?.('about'), current: kind === 'about' },
    { label: 'Terms', onClick: () => onNavigate?.('terms'), current: kind === 'terms' },
    { label: 'Contact', onClick: () => onNavigate?.('contacts'), current: kind === 'contacts' },
  ];

  return (
    <div ref={rootRef} className={`site s-info s-info--${kind}${calm ? ' is-calm' : ''}`} style={{ '--s-game-accent': game.accent }}>
      <a className="s-skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <SiteNav links={links} onBrand={onLogo} cta={{ label: 'Open GameGuide', onClick: () => onNavigate?.('chat') }} />

      <div className="s-page-head">
        <div className="s-page-head__art" aria-hidden="true">
          <img src={heroArt(game.appid)} alt="" decoding="async" />
        </div>
        <div className="s-wrap s-page-head__inner">
          <button type="button" className="s-back" onClick={onBack} data-intro>
            <ArrowLeft size={15} aria-hidden="true" /> Back
          </button>
          <div data-intro><Overline>Codex · {page.label}</Overline></div>
          <h1 className="s-h1" data-intro>{page.heading}</h1>
          <p className="s-lead" data-intro>{page.lead}</p>
          {page.meta && <p className="s-meta" data-intro>{page.meta}</p>}
        </div>
      </div>

      <main id="main" tabIndex={-1} className="s-wrap s-page">
        <Body />
      </main>

      <SiteFooter onNavigate={onNavigate} onStart={() => onNavigate?.('chat')} />
    </div>
  );
}
