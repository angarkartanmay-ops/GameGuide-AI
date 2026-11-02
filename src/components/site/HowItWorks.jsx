import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EyeOff, RotateCcw, ShieldCheck } from 'lucide-react';
import { HOW_DEMO, isVisibleAt } from '../../site/showcase';
import { ChapterHead, Mark } from './bits';

// Beats only ever move forward, and every visual is a class keyed off the
// beat, so the finished state is simply "beat 3". Milliseconds after the
// section is first seen:
//   0  the question types itself
//   1  the answer with the Spoiler Shield off, late-game line and all
//   2  you say where you are
//   3  the same answer with the shield on: that line is held back
const BEAT_AT = [0, 1800, 4400, 5600];
const FINAL = BEAT_AT.length - 1;

const STEPS = [
  { title: 'Ask', text: 'Type it the way you would ask a friend. Nothing to set up first.' },
  { title: 'Say where you are', text: <>Once per game: <code>{HOW_DEMO.command}</code>. It remembers.</> },
  { title: 'Get an answer that stops there', text: 'Anything past your progress waits under a bar until you choose to look.' },
];

// The same rule the Spoiler Shield demo uses decides what the shield holds back.
const [OPENER, REVEAL] = HOW_DEMO.lines;
const HELD_BACK = !isVisibleAt(REVEAL, HOW_DEMO.milestone);

/**
 * The quick version of "how it works", straight under the hero: one question
 * about Elden Ring, answered twice. First as an unprotected answer would be,
 * late-game reveal included; then with the Spoiler Shield on at Stormveil,
 * where the same line waits under a bar. It plays once when it scrolls into
 * view, and calm pages (reduced motion, slow devices) get the finished state.
 * Nothing here is a canvas or a pin; the Shield chapter below is the
 * hands-on version.
 */
export default function HowItWorks({ calm }) {
  const rootRef = useRef(null);
  const timers = useRef([]);
  const [beat, setBeat] = useState(calm ? FINAL : -1); // -1: not seen yet
  const [typed, setTyped] = useState(calm ? HOW_DEMO.question : '');
  const [revealed, setRevealed] = useState(false);

  const clear = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const play = useCallback(() => {
    clear();
    setRevealed(false);
    setTyped('');
    setBeat(0);
    const later = (ms, fn) => timers.current.push(setTimeout(fn, ms));
    const q = HOW_DEMO.question;
    for (let i = 1; i <= q.length; i++) later(250 + i * 52, () => setTyped(q.slice(0, i)));
    BEAT_AT.slice(1).forEach((ms, i) => later(ms, () => setBeat(i + 1)));
  }, [clear]);

  useEffect(() => {
    const finish = () => { clear(); setBeat(FINAL); setTyped(HOW_DEMO.question); };
    const el = rootRef.current;
    if (calm || !el || typeof IntersectionObserver === 'undefined') {
      finish();
      return undefined;
    }
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      play();
    }, { threshold: 0.3 });
    io.observe(el);
    return () => { io.disconnect(); clear(); };
  }, [calm, play, clear]);

  const question = beat >= 1 ? HOW_DEMO.question : typed;
  const stepNow = beat <= 1 ? 0 : beat - 1;
  const typing = beat === 0 || beat === -1;

  return (
    <section ref={rootRef} id="how" className="s-chapter s-how" aria-labelledby="how-title">
      <div className="s-wrap s-how__grid">
        <div className="s-how__copy">
          <ChapterHead
            id="how-title"
            title={(
              <>
                <span className="s-how__beat">Ask.</span>
                <span className="s-how__beat">Say where you are.</span>
                <span className="s-how__beat">Keep the surprise.</span>
              </>
            )}
            lead="One Elden Ring question, answered twice: Spoiler Shield off, then on."
          />
          <ol className="s-how__steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className={`s-how__step${i <= stepNow ? ' is-on' : ''}${i === stepNow ? ' is-now' : ''}`}>
                <Mark size="sm" />
                <div>
                  <h3 className="s-how__step-title">{s.title}</h3>
                  <p className="s-how__step-text">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <figure className="s-how__frame" aria-label={`The same ${HOW_DEMO.game} question, answered without the Spoiler Shield and then with it`}>
          <div className="s-how__ask">
            <span className="s-q s-how__q">
              <span className="sr-only">{HOW_DEMO.question}</span>
              <span aria-hidden="true">{question}{typing && <span className="s-caret" />}</span>
            </span>
          </div>

          <article className={`s-how__take s-how__take--off${beat >= 1 ? ' is-in' : ''}`} aria-label="Spoiler Shield off">
            <p className="s-mini-over">Shield off</p>
            <p className="s-how__line">{OPENER.text}</p>
            <p className="s-how__line">
              {REVEAL.text}
              {HELD_BACK && <span className="s-how__tag">Spoiler</span>}
            </p>
          </article>

          <article className={`s-how__take s-how__take--on${beat >= 2 ? ' is-in' : ''}`} aria-label="Spoiler Shield on">
            <p className="s-mini-over s-how__state">
              <ShieldCheck size={14} aria-hidden="true" />
              <span>Spoiler-safe: <b>ON</b></span>
              <span className={`s-how__where${beat >= 2 ? ' is-in' : ''}`}>at {HOW_DEMO.where}</span>
            </p>
            <p className={`s-shield__cmd s-how__cmd${beat >= 2 ? ' is-in' : ''}`}>
              <span className="s-shield__prompt" aria-hidden="true">›</span>
              <code>{HOW_DEMO.command}</code>
            </p>
            <div className={`s-how__answer${beat >= 3 ? ' is-in' : ''}`}>
              <p className="s-how__line">{OPENER.text}</p>
              <button
                type="button"
                className="s-how__bar"
                aria-expanded={revealed}
                onClick={() => setRevealed((r) => !r)}
              >
                <span className={`s-spoiler${revealed ? ' is-revealed' : ''}`} aria-hidden={revealed ? undefined : 'true'}>
                  <span className="s-spoiler__text">{REVEAL.text}</span>
                </span>
                <span className="s-shield__why">
                  <EyeOff size={12} aria-hidden="true" />
                  {revealed ? 'Showing it. Press to hide it again.' : `Held back, past ${HOW_DEMO.where}. Press to look.`}
                </span>
              </button>
            </div>
          </article>

          {!calm && beat >= FINAL && (
            <button type="button" className="s-link-btn s-how__replay" onClick={play}>
              <RotateCcw size={12} aria-hidden="true" /> Replay
            </button>
          )}
        </figure>
      </div>
    </section>
  );
}
