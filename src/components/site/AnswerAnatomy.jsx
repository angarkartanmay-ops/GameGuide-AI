import React, { useRef, useState } from 'react';
import { ArrowUp, ShieldCheck } from 'lucide-react';
import { ANATOMY, heroArt } from '../../site/showcase';
import { STAGE_COPY } from '../../utils/gameContext';
import { achievements, unlockWhenSeen } from '../../site/achievements';
import { gsap, ScrollTrigger, useScene } from '../../site/motion';
import { ChapterHead, Mark } from './bits';

// Where each beat lands along the pinned scroll (0–1).
const AT = {
  typeFrom: 0.02, typeTo: 0.15,
  research: 0.18, stages: [0.18, 0.24, 0.3], chips: [0.24, 0.28, 0.32],
  recognise: 0.4,
  answer: 0.56, points: [0.6, 0.64, 0.68, 0.72],
  shield: 0.8,
  done: 0.95,
};
const STAGES = ['identifying-game', 'searching', 'scanning-sources'];
const CHIPS = ['Wikis', 'Patch notes', 'Web'];

/** Which beat a scroll progress corresponds to; pure so it scrubs both ways. */
function beatAt(p) {
  let step = 0;
  if (p >= AT.research) step = 1;
  if (p >= AT.recognise) step = 2;
  if (p >= AT.answer) step = 3;
  if (p >= AT.shield) step = 4;
  const stage = AT.stages.reduce((n, t, i) => (p >= t ? i : n), -1);
  const chips = AT.chips.filter(t => p >= t).length;
  const points = AT.points.filter(t => p >= t).length;
  return { step, stage, chips, points, key: `${step}.${stage}.${chips}.${points}` };
}

const FINAL = beatAt(1);

/**
 * Chapter 01. One answer, taken apart: the question types itself, research
 * lights up, the frame becomes the game, the answer sets, the spoiler waits.
 * Pinned and scrubbed on desktop; played once on phones; shown finished for
 * calm pages. Everything visual is CSS keyed off the beat, so scrolling back
 * simply un-plays it.
 */
export default function AnswerAnatomy({ calm }) {
  const rootRef = useRef(null);
  const qRef = useRef(null);
  const [beat, setBeat] = useState(calm ? FINAL : beatAt(0));
  const [revealed, setRevealed] = useState(false);
  const { question, game, title, points, spoiler, steps, progress } = ANATOMY;

  useScene(rootRef, ({ desktop, calm: still }, root) => {
    const q = qRef.current;
    let lastKey = '';
    const apply = (p) => {
      const b = beatAt(p);
      if (q) {
        const n = Math.round(gsap.utils.clamp(0, 1, (p - AT.typeFrom) / (AT.typeTo - AT.typeFrom)) * question.length);
        q.textContent = question.slice(0, n);
      }
      if (b.key !== lastKey) { lastKey = b.key; setBeat(b); }
      // Calm pages jump straight to the end, so they award the chapter when
      // it is actually scrolled into view instead (see below).
      if (!still && p >= AT.done) achievements().unlock('tutorial');
    };

    if (still) {
      apply(1);
      return unlockWhenSeen(root.querySelector('.s-frame'), 'tutorial');
    }
    if (desktop) {
      apply(0);
      ScrollTrigger.create({
        trigger: root.querySelector('.s-anatomy__pin'),
        start: 'top top',
        end: '+=230%',
        pin: true,
        anticipatePin: 1,
        onUpdate: (self) => apply(self.progress),
      });
      return undefined;
    }
    // Phones: play the whole thing once when it scrolls into view.
    apply(0);
    const proxy = { p: 0 };
    const tween = gsap.to(proxy, {
      p: 1, duration: 6, ease: 'none', paused: true,
      onUpdate: () => apply(proxy.p),
    });
    ScrollTrigger.create({ trigger: root.querySelector('.s-frame'), start: 'top 70%', once: true, onEnter: () => tween.play() });
    return () => tween.kill();
  }, [calm]);

  const stageText = beat.stage >= 0 ? STAGE_COPY[STAGES[beat.stage]] : '';

  return (
    <section ref={rootRef} id="anatomy" className="s-chapter s-anatomy" aria-labelledby="anatomy-title">
      <div className="s-wrap">
        <ChapterHead
          index="01"
          label="Anatomy of an answer"
          id="anatomy-title"
          title="Watch one answer come together."
          lead="Scroll to step through a real question, from the moment you ask to the part it keeps from you."
        />
      </div>

      <div className="s-anatomy__pin">
        <div className="s-wrap s-anatomy__grid">
          <ol className="s-steps">
            {steps.map((s, i) => (
              <li key={s.title} className={`s-step${i <= beat.step ? ' is-on' : ''}${i === beat.step ? ' is-now' : ''}`}>
                <span className="s-step__num">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3 className="s-step__title">{s.title}</h3>
                  <p className="s-step__text">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>

          <div
            className={`s-frame${beat.step >= 2 ? ' is-game' : ''}`}
            style={{ '--f-game': game.accent }}
            role="img"
            aria-label={`A GameGuide chat answering "${question}" for a player who has reached ${progress} in ${game.name}, with a later plot point hidden.`}
          >
            <div className="s-frame__art" aria-hidden="true">
              <img src={heroArt(game.appid)} alt="" loading="lazy" decoding="async" />
            </div>
            <div className="s-frame__scrim" aria-hidden="true" />

            <div className="s-frame__top" aria-hidden="true">
              <span className="s-frame__brand"><Mark size="sm" /> GameGuide</span>
              <span className={`s-pill${beat.step >= 2 ? ' is-on' : ''}`}>
                <span className="s-pill__dot" />
                <span className="s-pill__game">{beat.step >= 2 ? game.name : 'No game yet'}</span>
                {beat.step >= 2 && <span className="s-pill__meta"><ShieldCheck size={12} /> {progress}</span>}
              </span>
            </div>

            <div className="s-frame__body" aria-hidden="true">
              <div className="s-q">
                <span className="s-q__text" ref={qRef}>{calm ? question : ''}</span>
                {beat.step === 0 && <span className="s-caret" />}
              </div>

              <div className={`s-research${beat.step >= 1 ? ' is-in' : ''}${beat.step >= 3 ? ' is-done' : ''}`}>
                <p className="s-mini-over"><Mark size="xs" /> GameGuide · {beat.step >= 3 ? 'Researched' : 'Researching'}</p>
                <p className="s-research__line">{beat.step >= 3 ? `Read ${CHIPS.length} kinds of source` : stageText}</p>
                <div className="s-research__chips">
                  {CHIPS.map((c, i) => (
                    <span key={c} className={`s-chip${i < beat.chips ? ' is-on' : ''}`}><span className="s-chip__dot" />{c}</span>
                  ))}
                </div>
              </div>

              <div className={`s-ans${beat.step >= 3 ? ' is-in' : ''}`}>
                <p className="s-mini-over"><Mark size="xs" /> GameGuide · {game.name}</p>
                <h4 className="s-ans__title">{title}</h4>
                <ul className="s-ans__list">
                  {points.map(([lead, rest], i) => (
                    <li key={lead} className={i < beat.points ? 'is-in' : ''}><strong>{lead}</strong> {rest}</li>
                  ))}
                </ul>
                <p className={`s-ans__lore${beat.step >= 4 ? ' is-in' : ''}`}>
                  <span className="s-ans__lore-label">Lore</span>
                  <span className={`s-spoiler${revealed ? ' is-revealed' : ''}`}>
                    <span className="s-spoiler__text">{spoiler}</span>
                  </span>
                </p>
              </div>
            </div>

            <div className="s-frame__compose" aria-hidden="true">
              <span>Ask about {beat.step >= 2 ? game.name : 'any game'}…</span>
              <span className="s-frame__send"><ArrowUp size={14} /></span>
            </div>
          </div>
        </div>
        <p className="s-anatomy__note">
          <button
            type="button"
            className="s-link-btn"
            aria-pressed={revealed}
            onClick={() => setRevealed(r => !r)}
            disabled={beat.step < 4}
          >
            {revealed ? 'Hide the spoiler again' : 'Reveal the spoiler (Elden Ring, mid-game)'}
          </button>
        </p>
      </div>
    </section>
  );
}
