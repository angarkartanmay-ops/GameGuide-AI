import React, { useId, useRef, useState } from 'react';
import { EyeOff } from 'lucide-react';
import { SHIELD_LINES, SHIELD_MILESTONES, isVisibleAt } from '../../site/showcase';
import { achievements } from '../../site/achievements';
import { useScene, gsap } from '../../site/motion';
import { ChapterHead, Mark } from './bits';

/**
 * Chapter 02. Spoiler Shield as a toy: say where you are, and a lore page
 * hides everything past that point with the same hatched bars the chat uses.
 * Starts at the very beginning, so nothing is spoiled unless you move it.
 */
export default function ShieldDemo({ calm }) {
  const rootRef = useRef(null);
  const [at, setAt] = useState(0);
  const sliderId = useId();
  const milestone = SHIELD_MILESTONES[at];
  const hidden = SHIELD_LINES.filter(l => !isVisibleAt(l, at)).length;

  const set = (n) => {
    setAt(n);
    achievements().unlock('spoiler-safe');
  };

  useScene(rootRef, ({ calm: still }, root) => {
    if (still) return;
    gsap.from(root.querySelectorAll('.s-shield__line'), {
      opacity: 0, y: 14, duration: 0.7, stagger: 0.08, ease: 'power3.out',
      scrollTrigger: { trigger: root.querySelector('.s-shield__page'), start: 'top 75%', once: true },
    });
  }, [calm]);

  return (
    <section ref={rootRef} id="shield" className="s-chapter s-shield-ch" aria-labelledby="shield-title">
      <div className="s-wrap">
        <ChapterHead
          index="02"
          label="Spoiler Shield"
          id="shield-title"
          title="It stops where you are."
          lead="Tell it how far you've played. Story answers stay on your side of that line, and anything past it waits under a bar until you choose to look."
        />

        <div className="s-shield">
          <div className="s-shield__control">
            <label className="s-shield__label" htmlFor={sliderId}>Where are you in Elden Ring?</label>
            <input
              id={sliderId}
              className="s-range"
              type="range"
              min={0}
              max={SHIELD_MILESTONES.length - 1}
              step={1}
              value={at}
              onChange={(e) => set(Number(e.target.value))}
              aria-valuetext={`${milestone.label} — ${milestone.progress}`}
              style={{ '--s-range': `${(at / (SHIELD_MILESTONES.length - 1)) * 100}%` }}
            />
            <ol className="s-shield__ticks">
              {SHIELD_MILESTONES.map((m, i) => (
                <li key={m.label}>
                  <button
                    type="button"
                    className={`s-shield__tick${i === at ? ' is-now' : ''}${i < at ? ' is-past' : ''}`}
                    onClick={() => set(i)}
                    aria-label={`Set progress to ${m.label}`}
                  >
                    {m.label}
                  </button>
                </li>
              ))}
            </ol>
            <p className="s-shield__cmd">
              <span className="s-shield__prompt" aria-hidden="true">›</span>
              <code>/progress Elden Ring: {milestone.progress}</code>
            </p>
            <p className="s-shield__status" aria-live="polite">
              {hidden === 0
                ? 'Nothing hidden — you have seen it all.'
                : `${hidden} ${hidden === 1 ? 'line is' : 'lines are'} past your progress and hidden.`}
            </p>
          </div>

          <article className="s-shield__page" aria-label="Elden Ring lore, filtered by your progress">
            <p className="s-mini-over"><Mark size="xs" /> GameGuide · Elden Ring lore</p>
            {SHIELD_LINES.map((line, i) => {
              const show = isVisibleAt(line, at);
              return (
                <p key={i} className={`s-shield__line${show ? '' : ' is-hidden'}`}>
                  {show ? (
                    line.text
                  ) : (
                    <>
                      <span className="s-spoiler" aria-hidden="true"><span className="s-spoiler__text">{line.text}</span></span>
                      <span className="s-shield__why">
                        <EyeOff size={12} aria-hidden="true" /> Past {milestone.label} — hidden
                      </span>
                    </>
                  )}
                </p>
              );
            })}
          </article>
        </div>
      </div>
    </section>
  );
}
