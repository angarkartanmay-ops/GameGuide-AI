import { useEffect, useState } from 'react';
import { sampleAccent } from '../utils/gameArt';
import {
  fetchDaily, parseDaily, readStored, showcaseDaily, withAccents, writeStored,
} from './daily';

const storage = () => {
  try { return window.localStorage; } catch { return null; }
};

function initial() {
  const stored = readStored(storage());
  if (stored) {
    return { ready: true, source: 'steam', date: stored.daily.date, hero: withAccents(stored.daily.hero, stored.accents), wall: stored.daily.wall };
  }
  return { ready: false, ...showcaseDaily() };
}

/**
 * Today's hero and wall: { ready, source: 'steam' | 'showcase', date, hero, wall }.
 * Ready at once from the day's cache; otherwise after one request (or the
 * timeout, with the showcase). Accents fill in afterwards and the page's
 * accent transition carries the change.
 */
export default function useDailyGames() {
  const [state, setState] = useState(initial);

  useEffect(() => {
    let alive = true;
    (async () => {
      const store = storage();
      const stored = readStored(store);
      const body = stored?.body || await fetchDaily();
      if (!alive) return;
      const daily = body && parseDaily(body);
      if (!daily) {
        setState({ ready: true, ...showcaseDaily() });
        return;
      }
      const accents = { ...(stored?.accents || {}) };
      if (!stored) writeStored(store, body, accents);
      setState({ ready: true, source: 'steam', date: daily.date, hero: withAccents(daily.hero, accents), wall: daily.wall });

      const missing = daily.hero.filter(g => !accents[g.appid]);
      if (!missing.length) return;
      await Promise.all(missing.map(async (g) => {
        const hex = await sampleAccent([g.header, g.cover].filter(Boolean));
        if (hex) accents[g.appid] = hex;
      }));
      writeStored(store, body, accents);
      if (alive) setState(s => (s.source === 'steam' ? { ...s, hero: withAccents(daily.hero, accents) } : s));
    })();
    return () => { alive = false; };
  }, []);

  return state;
}
