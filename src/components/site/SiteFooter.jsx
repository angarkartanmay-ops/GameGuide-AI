import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { LINKS, mailto } from '../../site/links';
import { Mark } from './bits';

function Ext({ href, children }) {
  return (
    <a className="s-foot__link" href={href} target="_blank" rel="noopener noreferrer">
      {children}<ArrowUpRight size={13} aria-hidden="true" />
    </a>
  );
}

/** The "Featured on" badges the launch platforms ask for, kept at their native sizes. */
function Featured() {
  return (
    <div className="s-foot__featured">
      <p className="s-foot__head">Featured on</p>
      <div className="s-foot__badges">
        <a href={LINKS.launchbuff} target="_blank" rel="noopener noreferrer" title="Featured on LaunchBuff">
          <img src={LINKS.launchbuffBadge} alt="Featured on LaunchBuff" width="256" height="80" loading="lazy" />
        </a>
        <a href={LINKS.productHunt} target="_blank" rel="noopener noreferrer">
          <img
            src={LINKS.productHuntBadge}
            alt="GameGuide-AI - Ask any game anything, minus the spoilers | Product Hunt"
            width="250" height="54" loading="lazy"
          />
        </a>
      </div>
    </div>
  );
}

/** Shared footer for the landing and the info pages. */
export default function SiteFooter({ onNavigate, onStart }) {
  const go = (view) => () => onNavigate?.(view);
  return (
    <footer className="s-foot">
      <div className="s-foot__inner">
        <div className="s-foot__brand">
          <p className="s-foot__logo"><Mark size="lg" /> GameGuide</p>
          <p className="s-foot__tag">
            A game guide you can talk to. Live answers, set like a strategy guide, that stop where you are in the story.
          </p>
          {onStart && (
            <button type="button" className="s-btn s-btn--primary s-btn--sm" onClick={onStart}>Press Start</button>
          )}
          <Featured />
        </div>

        <nav className="s-foot__cols" aria-label="Footer">
          <div>
            <p className="s-foot__head">Project</p>
            <button type="button" className="s-foot__link" onClick={go('about')}>About</button>
            <button type="button" className="s-foot__link" onClick={go('upgrade')}>Plans</button>
            <button type="button" className="s-foot__link" onClick={go('terms')}>Terms &amp; copyright</button>
            <button type="button" className="s-foot__link" onClick={go('privacy')}>Privacy</button>
            <button type="button" className="s-foot__link" onClick={go('refunds')}>Refunds &amp; cancellation</button>
            <button type="button" className="s-foot__link" onClick={go('delivery')}>Delivery</button>
            <button type="button" className="s-foot__link" onClick={go('contacts')}>Contact</button>
          </div>
          <div>
            <p className="s-foot__head">Connect</p>
            <a className="s-foot__link" href={mailto()}>Email support</a>
            <Ext href={LINKS.github}>GitHub</Ext>
            <Ext href={LINKS.linkedin}>LinkedIn</Ext>
          </div>
          <div>
            <p className="s-foot__head">Discord</p>
            <Ext href={LINKS.discordInvite}>Add to Discord</Ext>
            <Ext href={LINKS.topgg}>top.gg page</Ext>
          </div>
        </nav>
      </div>

      <div className="s-foot__base">
        <p>© 2026 Tanmay Angarkar. All rights reserved.</p>
        <p>Game art and names belong to their publishers, shown via Steam.</p>
        <p className="s-foot__secret" aria-hidden="true">↑ ↑ ↓ ↓ ← → ← → B A</p>
      </div>
    </footer>
  );
}
