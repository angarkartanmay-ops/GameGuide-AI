import React, { useRef } from 'react';
import { CornerDownLeft } from 'lucide-react';
import { LINKS } from '../../site/links';
import { gsap, SplitText, useScene } from '../../site/motion';
import { HudCorners, Overline } from './bits';

/**
 * The last screen: a title-card "PRESS START" whose letters fly in from
 * scattered positions as you scroll, then the two ways in.
 */
export default function Closing({ calm, onStart, arcade }) {
  const rootRef = useRef(null);

  useScene(rootRef, ({ calm: still }, root) => {
    if (still) return undefined;
    const title = root.querySelector('.s-closing__title');
    const split = SplitText.create(title, { type: 'words,chars', aria: 'none' });
    const rand = gsap.utils.random;
    gsap.from(split.chars, {
      x: () => rand(-240, 240),
      y: () => rand(-160, 160),
      rotate: () => rand(-50, 50),
      opacity: 0,
      ease: 'power2.out',
      stagger: { each: 0.02, from: 'random' },
      scrollTrigger: { trigger: root, start: 'top 85%', end: 'center 60%', scrub: 0.8 },
    });
    gsap.from(root.querySelectorAll('[data-reveal-late]'), {
      opacity: 0, y: 18, duration: 0.8, stagger: 0.1, ease: 'power3.out',
      scrollTrigger: { trigger: root, start: 'center 70%', once: true },
    });
    return () => split.revert();
  }, [calm]);

  return (
    <section ref={rootRef} id="start" className="s-chapter s-closing" aria-labelledby="start-title">
      <div className="s-wrap s-closing__inner">
        <HudCorners />
        <Overline>06 · Continue?</Overline>
        <h2 id="start-title" className="s-closing__title" aria-label="Press Start">Press <em>Start</em></h2>
        <p className="s-closing__sub" data-reveal-late>
          Free on the web. No account needed to ask — sign in only if you want your history kept.
        </p>
        <div className="s-closing__actions" data-reveal-late>
          <button type="button" className="s-btn s-btn--primary s-btn--lg" onClick={onStart}>
            {arcade ? 'Insert coin' : 'Press Start'}
            <kbd className="s-kbd" aria-hidden="true"><CornerDownLeft size={13} /></kbd>
          </button>
          <a className="s-btn s-btn--ghost s-btn--lg" href={LINKS.discordInvite} target="_blank" rel="noopener noreferrer">
            Add to Discord
          </a>
        </div>
        <p className="s-closing__hint" data-reveal-late aria-hidden="true">
          <span className="s-blink">▮</span> or just press Enter
        </p>
      </div>
    </section>
  );
}
