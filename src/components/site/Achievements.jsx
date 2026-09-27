import React, { useEffect, useRef, useState } from 'react';
import { achievements } from '../../site/achievements';

const SHOW_MS = 3800;

/**
 * Steam-style "achievement unlocked" toasts, one at a time. The toast itself
 * is decoration; the polite status region beside it is what assistive tech
 * hears, once per unlock.
 */
export default function Achievements() {
  const [current, setCurrent] = useState(null);
  const [said, setSaid] = useState('');
  const queue = useRef([]);
  const showing = useRef(false);

  useEffect(() => {
    const store = achievements();
    let timer = null;
    const next = () => {
      const a = queue.current.shift();
      if (!a) { showing.current = false; setCurrent(null); return; }
      showing.current = true;
      setCurrent({ ...a, n: store.count(), total: store.total, key: `${a.id}-${Date.now()}` });
      setSaid(`Achievement unlocked: ${a.title}. ${a.text}`);
      timer = setTimeout(next, SHOW_MS);
    };
    const off = store.subscribe((a) => {
      queue.current.push(a);
      if (!showing.current) next();
    });
    return () => { off(); clearTimeout(timer); };
  }, []);

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">{said}</div>
      {current && (
        <div key={current.key} className="s-toast" aria-hidden="true">
          <span className="s-toast__badge"><span className="s-mark s-mark--md" /></span>
          <span className="s-toast__body">
            <span className="s-toast__kicker">Achievement unlocked · {current.n}/{current.total}</span>
            <span className="s-toast__title">{current.title}</span>
            <span className="s-toast__text">{current.text}</span>
          </span>
        </div>
      )}
    </>
  );
}
