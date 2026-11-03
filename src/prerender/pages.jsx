// The text of every page, as components, for crawlers, link previews and
// readers without JavaScript. plan.js renders them to HTML and scripts/prerender.mjs
// puts that in each page's #root. Used at build time only; nothing here ships in
// the app's JS.
//
// Two kinds of page:
//   · text pages (about, terms, privacy, refunds, delivery, contacts) render the
//     same components the app does (InfoContent.jsx), so the words cannot differ
//   · pages that are mostly interface (the landing, the plans, the chat) get a
//     static fallback written from the same constants the interface reads
//
// The landing's real headline is "Ask anything about {today's game}.", which
// needs Steam's chart at run time. The static one cannot, so it uses the line
// the live headline already carries for screen readers: "Ask anything about
// any game." Same words minus the game.

import React from 'react';
import { PAGES } from '../components/infoPages';
import { PLANS, money } from '../site/pricing';
import { CAPABILITIES } from '../site/capabilities';
import { HOW_DEMO } from '../site/showcase';
import { LINKS } from '../site/links';
import { pathForView } from '../site/route';
import { VIEW_META } from '../site/meta';
import { CRUMB_NAMES } from '../site/seo';

/** The pages every page links to, in the order a reader would look for them. */
const NAV = ['landing', 'about', 'upgrade', 'terms', 'privacy', 'refunds', 'delivery', 'contacts'];
const NAV_LABEL = { landing: 'Home', ...CRUMB_NAMES };

function Links({ label }) {
  return (
    <nav aria-label={label}>
      <ul>
        {NAV.map((view) => (
          <li key={view}><a href={pathForView(view)}>{NAV_LABEL[view]}</a></li>
        ))}
      </ul>
    </nav>
  );
}

function Chrome({ children }) {
  return (
    <>
      <header>
        <p><a href="/">GameGuide</a></p>
        <Links label="Pages" />
      </header>
      <main>{children}</main>
      <footer>
        <Links label="Footer" />
        <p>
          <a href={LINKS.discordInvite}>Add GameGuide to Discord</a>
          {' · '}
          <a href={LINKS.github}>GitHub</a>
          {' · '}
          <a href={`mailto:${LINKS.email}`}>{LINKS.email}</a>
        </p>
        <p>&copy; 2026 Tanmay Angarkar. All rights reserved. Game art and names belong to their publishers, shown via Steam.</p>
      </footer>
    </>
  );
}

// ── The landing ────────────────────────────────────────────────────────────

// The three steps of the "How it works" strip (components/site/HowItWorks.jsx).
const HOW_STEPS = [
  ['Ask', 'Type it the way you would ask a friend. Nothing to set up first.'],
  ['Say where you are', `Once per game: ${HOW_DEMO.command}. It remembers.`],
  ['Get an answer that stops there', 'Anything past your progress waits under a bar until you choose to look.'],
];

export function Landing() {
  return (
    <Chrome>
      <h1>Ask anything about any game.</h1>
      <p>Live answers from wikis, patch notes and the web, set like a strategy guide. No spoilers past where you are.</p>
      <p>
        <a href="/chat">Open GameGuide</a>
        {' · '}
        <a href={LINKS.discordInvite}>Add to Discord</a>
      </p>

      <section aria-labelledby="p-how">
        <h2 id="p-how">How it works</h2>
        <ol>
          {HOW_STEPS.map(([title, text]) => (
            <li key={title}><strong>{title}.</strong> {text}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="p-does">
        <h2 id="p-does">What it does</h2>
        <dl>
          {CAPABILITIES.map((c) => (
            <div key={c.id}>
              <dt>{c.label}</dt>
              <dd>{c.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="p-discord">
        <h2 id="p-discord">Patch notes in your server, before anyone asks.</h2>
        <p>
          Add the bot, pick a channel, name a game. Watchtower posts its official patch notes, summarised, and
          its best deals as they happen. You can also @mention it or use its slash commands for the same answers
          as the web.
        </p>
      </section>

      <section aria-labelledby="p-more">
        <h2 id="p-more">More</h2>
        <p>
          Questions people ask first are on the <a href="/about">About page</a>. Plans and prices are on
          the <a href="/pricing">plans page</a>. GameGuide is designed and built independently by Tanmay Angarkar.
        </p>
      </section>
    </Chrome>
  );
}

// ── Text pages ─────────────────────────────────────────────────────────────

export function TextPage({ view }) {
  const page = PAGES[view];
  const { Body } = page;
  return (
    <Chrome>
      <h1>{page.heading}</h1>
      <p>{page.lead}</p>
      {page.meta && <p>{page.meta}</p>}
      <Body start={page.start} />
    </Chrome>
  );
}

// ── Plans ──────────────────────────────────────────────────────────────────

function priceLine(plan) {
  const parts = [];
  if (plan.offers?.month) parts.push(`${money(plan.offers.month.usd, 'usd')} (${money(plan.offers.month.inr, 'inr')}) a month`);
  if (plan.offers?.year) parts.push(`${money(plan.offers.year.usd, 'usd')} (${money(plan.offers.year.inr, 'inr')}) a year`);
  if (plan.lifetime) parts.push(`${money(plan.lifetime.usd, 'usd')} (${money(plan.lifetime.inr, 'inr')}) once, for life`);
  return parts.length ? parts.join(', or ') : 'Free';
}

export function Plans() {
  return (
    <Chrome>
      <h1>Plans and pricing</h1>
      <p>{VIEW_META.upgrade.description}</p>
      {PLANS.map((plan) => (
        <section key={plan.id} aria-labelledby={`plan-${plan.id}`}>
          <h2 id={`plan-${plan.id}`}>{plan.name}</h2>
          <p>{plan.tagline}</p>
          <p><strong>{priceLine(plan)}</strong></p>
          <ul>
            {plan.features.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </section>
      ))}
      <p>
        Plans are bought in Discord, with a link from the bot&rsquo;s /upgrade command. Read the{' '}
        <a href="/refunds">refund and cancellation policy</a> and the <a href="/delivery">delivery policy</a> first.
      </p>
    </Chrome>
  );
}

// ── Shells without a page of their own ─────────────────────────────────────

export function ChatShell() {
  return (
    <Chrome>
      <h1>GameGuide</h1>
      <p>
        Ask about any game: a boss, a build, a quest or a sale. The chat needs JavaScript. Until you turn it
        on, the <a href="/">home page</a> says what GameGuide does.
      </p>
    </Chrome>
  );
}

export function NotFoundShell() {
  return (
    <Chrome>
      <h1>No page here.</h1>
      <p>The link may be old, or mistyped. These all work: <a href="/">the home page</a>, <a href="/chat">the chat</a>, <a href="/about">About</a>.</p>
    </Chrome>
  );
}

export function ShareShell() {
  return (
    <Chrome>
      <h1>Shared answer</h1>
      <p>An answer someone shared from GameGuide. It opens with JavaScript, and its spoilers stay hidden until you press them.</p>
    </Chrome>
  );
}
