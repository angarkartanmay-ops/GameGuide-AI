import React, { useRef, useState } from 'react';
import { achievements } from '../../site/achievements';
import { useScene, gsap } from '../../site/motion';
import { ChapterHead } from './bits';

// Only things the product does today — each "try" is a real command or a
// question that works as written.
const ITEMS = [
  {
    id: 'research', label: 'Live research', hint: 'Wikis · patch notes · web',
    body: 'Every answer is researched when you ask. It reads game wikis, official patch notes and the web, weighs them against each other, and lists the sources so you can check.',
    tries: ['What changed in the latest Helldivers 2 patch?'],
  },
  {
    id: 'shield', label: 'Spoiler Shield', hint: 'Answers stop where you are',
    body: 'Say how far you have played and story answers stay on your side of that line. Anything past it sits under a bar until you choose to look.',
    tries: ['/progress Elden Ring: beat Margit', '/spoilers off'],
  },
  {
    id: 'missables', label: 'Missables', hint: 'Before the point of no return',
    body: 'What can you still lose for good — items, questlines, trophies, one-time choices — listed in the order you will reach them, starting from where you are and spoiling nothing after it.',
    tries: ['/missables Elden Ring'],
  },
  {
    id: 'vision', label: 'Screenshot reading', hint: 'Up to three per message',
    body: 'Drop in a build screen, a map or a puzzle and ask about what is in it. Up to three screenshots in one message.',
    tries: ['Attach a screenshot, then: "What should I upgrade next?"'],
  },
  {
    id: 'price', label: 'Deals', hint: '/price',
    body: 'Checks PC storefronts for the best current price on a game and how it compares with its lowest ever.',
    tries: ['/price Hades II'],
  },
  {
    id: 'discover', label: 'Discover', hint: '/discover',
    body: 'A random pro tip, a hidden detail or a piece of lore, for the minutes between matches.',
    tries: ['/discover'],
  },
  {
    id: 'stealth', label: 'Stealth', hint: 'Nothing saved',
    body: 'A throwaway conversation: nothing saved, nothing remembered, no art looked up. Leave it and it is gone.',
    tries: ['/stealth'],
  },
  {
    id: 'share', label: 'Share it', hint: 'Spoilers stay hidden',
    body: 'Send an answer to a friend who is behind you. The link opens it with every spoiler still under its bar — and it is carried in the link itself, so nothing is stored on our side.',
    tries: ['Share under any answer'],
  },
];

/**
 * Chapter 04. The feature list as a pause menu: a diamond selector slides
 * between entries (↑/↓ work, it's a vertical tab list), and the entry's
 * detail sits beside it.
 */
export default function CapabilityMenu({ calm }) {
  const rootRef = useRef(null);
  const tabRefs = useRef([]);
  const opened = useRef(new Set([ITEMS[0].id]));
  const [sel, setSel] = useState(0);
  const item = ITEMS[sel];

  const select = (i, focus = false) => {
    setSel(i);
    opened.current.add(ITEMS[i].id);
    if (opened.current.size >= 4) achievements().unlock('menu-diver');
    if (focus) tabRefs.current[i]?.focus();
  };

  const onKeyDown = (e) => {
    const last = ITEMS.length - 1;
    const map = { ArrowDown: sel === last ? 0 : sel + 1, ArrowUp: sel === 0 ? last : sel - 1, Home: 0, End: last };
    if (e.key in map) { e.preventDefault(); select(map[e.key], true); }
  };

  useScene(rootRef, ({ calm: still }, root) => {
    if (still) return;
    gsap.from(root.querySelectorAll('.s-menu__item'), {
      opacity: 0, x: -24, duration: 0.6, stagger: 0.05, ease: 'power3.out',
      scrollTrigger: { trigger: root.querySelector('.s-menu'), start: 'top 75%', once: true },
    });
  }, [calm]);

  return (
    <section ref={rootRef} id="loadout" className="s-chapter" aria-labelledby="loadout-title">
      <div className="s-wrap">
        <ChapterHead index="04" label="Loadout" id="loadout-title" title="Everything it can do, one menu away." />
        <div className="s-menu">
          <div className="s-menu__list" role="tablist" aria-orientation="vertical" aria-label="Capabilities" onKeyDown={onKeyDown} style={{ '--sel': sel }}>
            <span className="s-menu__selector" aria-hidden="true" />
            {ITEMS.map((it, i) => (
              <button
                key={it.id}
                ref={el => { tabRefs.current[i] = el; }}
                type="button"
                role="tab"
                id={`cap-tab-${it.id}`}
                aria-selected={i === sel}
                aria-controls="cap-panel"
                tabIndex={i === sel ? 0 : -1}
                className={`s-menu__item${i === sel ? ' is-sel' : ''}`}
                onClick={() => select(i)}
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') select(i); }}
              >
                <span className="s-menu__num">{String(i + 1).padStart(2, '0')}</span>
                <span className="s-menu__label">{it.label}</span>
                <span className="s-menu__hint">{it.hint}</span>
              </button>
            ))}
          </div>

          <div className="s-menu__panel" role="tabpanel" id="cap-panel" aria-labelledby={`cap-tab-${item.id}`}>
            <div key={item.id} className="s-menu__detail">
              <span className="s-menu__big" aria-hidden="true">{String(sel + 1).padStart(2, '0')}</span>
              <h3 className="s-menu__title">{item.label}</h3>
              <p className="s-menu__body">{item.body}</p>
              <p className="s-menu__try-label">Try</p>
              <ul className="s-menu__tries">
                {item.tries.map(t => <li key={t}><code>{t}</code></li>)}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
