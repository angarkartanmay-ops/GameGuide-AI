import React, { useRef, useState } from 'react';
import { Hash, ArrowUpRight } from 'lucide-react';
import { LINKS } from '../../site/links';
import { achievements, unlockWhenSeen } from '../../site/achievements';
import { gsap, ScrollTrigger, useScene } from '../../site/motion';
import { ChapterHead, Mark } from './bits';

const COMMAND = 'Elden Ring';
const ALL = 5;

/**
 * Chapter 05. Watchtower inside a server: someone runs /watch, the bot
 * confirms, and the kind of posts it makes arrive. The reply and embeds copy
 * the real bot's wording and layout (addWatch, newsPost and dealPost in
 * discord-bot/); the posts are labelled as examples.
 */
export default function WatchtowerDemo({ calm }) {
  const rootRef = useRef(null);
  const cmdRef = useRef(null);
  const [shown, setShown] = useState(calm ? ALL : 0);

  useScene(rootRef, ({ calm: still }, root) => {
    const cmd = cmdRef.current;
    if (still) {
      setShown(ALL);
      if (cmd) cmd.textContent = COMMAND;
      return unlockWhenSeen(root.querySelector('.s-server'), 'watchman');
    }
    setShown(0);
    if (cmd) cmd.textContent = '';
    const typed = { n: 0 };
    const tl = gsap.timeline({ paused: true });
    tl.call(() => setShown(1))
      .to(typed, {
        n: COMMAND.length, duration: 0.9, ease: 'none',
        onUpdate: () => { if (cmd) cmd.textContent = COMMAND.slice(0, Math.round(typed.n)); },
      }, 0.3)
      .call(() => setShown(2), null, 1.5)
      .call(() => setShown(3), null, 2.6)
      .call(() => setShown(4), null, 3.8)
      .call(() => { setShown(5); achievements().unlock('watchman'); }, null, 5);
    ScrollTrigger.create({ trigger: root.querySelector('.s-server'), start: 'top 65%', once: true, onEnter: () => tl.play() });
    return () => tl.kill();
  }, [calm]);

  return (
    <section ref={rootRef} id="watchtower" className="s-chapter s-watch" aria-labelledby="watch-title">
      <div className="s-wrap s-watch__grid">
        <div className="s-watch__copy">
          <ChapterHead
            label="Watchtower for Discord"
            id="watch-title"
            title="Patch notes in your server, before anyone asks."
            lead="Add the bot, pick a channel, name a game. Watchtower posts its official patch notes, summarised, and its best deals as they happen."
          />
          <ul className="s-watch__facts">
            <li><span>/watch add</span> follows any Steam game in the channel you choose.</li>
            <li><span>Deals</span> post at an all-time low or 50%+ off, and never twice for the same price.</li>
            <li><span>Also</span> @mention it or use its slash commands for the same answers as the web.</li>
          </ul>
          <div className="s-watch__cta">
            <a className="s-btn s-btn--primary" href={LINKS.discordInvite} target="_blank" rel="noopener noreferrer">
              Add to Discord
            </a>
            <a className="s-btn s-btn--ghost" href={LINKS.topgg} target="_blank" rel="noopener noreferrer">
              top.gg <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
        </div>

        <div
          className="s-server"
          role="img"
          aria-label="Example: a server member runs /watch add for Elden Ring, the GameGuide bot confirms, then posts a patch-notes summary and a deal alert."
        >
          <aside className="s-server__rail" aria-hidden="true">
            <p className="s-server__name">Guild Hall</p>
            {['general', 'patch-notes', 'looking-for-group', 'clips'].map(c => (
              <p key={c} className={`s-server__chan${c === 'patch-notes' ? ' is-on' : ''}`}><Hash size={14} />{c}</p>
            ))}
          </aside>

          <div className="s-server__main" aria-hidden="true">
            <p className="s-server__head"><Hash size={16} /> patch-notes</p>
            <div className="s-server__feed">
              <div className={`s-msg${shown >= 1 ? ' is-in' : ''}`}>
                <span className="s-msg__avatar">M</span>
                <div>
                  <p className="s-msg__who">Mira <span>Today at 18:02</span></p>
                  <p className="s-msg__cmd"><span>/watch add</span> <span className="s-msg__opt">game</span> <span ref={cmdRef}>{calm ? COMMAND : ''}</span></p>
                </div>
              </div>

              {shown === 2 && (
                <p className="s-msg__thinking"><Mark size="xs" /> GameGuide is thinking…</p>
              )}

              <div className={`s-msg${shown >= 3 ? ' is-in' : ''}`}>
                <span className="s-msg__avatar is-bot"><Mark size="sm" /></span>
                <div>
                  <p className="s-msg__who">GameGuide <span className="s-msg__app">App</span> <span>Today at 18:02</span></p>
                  <p className="s-msg__text">📡 <b>Watching ELDEN RING</b> in <span className="s-msg__mention">#patch-notes</span> — patch notes + deals.</p>
                  <p className="s-msg__sub">Manage with <code>/watch list</code> · <code>/watch remove</code></p>
                </div>
              </div>

              <p className={`s-server__divider${shown >= 4 ? ' is-in' : ''}`}><span>Example posts</span></p>

              <div className={`s-msg${shown >= 4 ? ' is-in' : ''}`}>
                <span className="s-msg__avatar is-bot"><Mark size="sm" /></span>
                <div className="s-embed" style={{ '--bar': '#00FFD1' }}>
                  <p className="s-embed__title">🛠️ ELDEN RING: Patch Notes</p>
                  <ul className="s-embed__list">
                    <li>Balance changes to several weapon skills and Ashes of War.</li>
                    <li>Fixes for co-op summoning and matchmaking.</li>
                  </ul>
                  <p className="s-embed__link">Full notes on Steam</p>
                  <p className="s-embed__foot">Watchtower · official Steam news · /watch to manage</p>
                </div>
              </div>

              <div className={`s-msg${shown >= 5 ? ' is-in' : ''}`}>
                <span className="s-msg__avatar is-bot"><Mark size="sm" /></span>
                <div className="s-embed" style={{ '--bar': '#FFD700' }}>
                  <p className="s-embed__title">💸 ELDEN RING — all-time low</p>
                  <p className="s-embed__text"><b>$23.99</b> at <span className="s-embed__a">Fanatical</span> (usually $59.99)</p>
                  <p className="s-embed__text">🔥 Matches the lowest price it has ever had.</p>
                  <p className="s-embed__foot">Watchtower · prices via CheapShark · /watch to manage</p>
                </div>
              </div>
            </div>
            <p className="s-server__compose">Message #patch-notes</p>
          </div>
        </div>
      </div>
    </section>
  );
}
