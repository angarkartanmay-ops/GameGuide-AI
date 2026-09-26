import { useEffect, useMemo, useState } from 'react';
import { parseStreamStage, latestGameFromMessages, normalizeGameKey, titleCase } from '../utils/gameContext';
import { resolveGameArt, firstLoadable, sampleAccent, rememberAccent } from '../utils/gameArt';
import { rememberGame } from '../utils/recentGames';

const EMPTY = { key: '', name: null, hero: null, accent: null };

/**
 * Which game the chat is about, and the art + accent that go with it.
 *
 * The game comes from the pipeline's stage detail ("searching:Elden Ring")
 * the moment research names it — so the backdrop changes while the answer is
 * still being researched — and otherwise from the newest answer's meta.game.
 * useChat clears the stage at the first streamed token, so the turn's game is
 * remembered until the request ends rather than read off the stage each time.
 *
 * Everything expensive keys off the game only: a streamed token re-renders
 * the chat, never re-runs a lookup. Stealth never looks anything up and never
 * records a recent game.
 */
export default function useGameAmbience({ messages, streamStage, isLoading, stealthMode }) {
  const { detail } = parseStreamStage(streamStage);
  const [turnGame, setTurnGame] = useState(null);
  // Adjust-state-during-render (React's documented pattern for deriving state
  // from props): no effect, no extra paint.
  if (detail && detail !== turnGame) setTurnGame(detail);
  if (!isLoading && turnGame) setTurnGame(null);

  const metaGame = useMemo(() => latestGameFromMessages(messages), [messages]);
  const rawName = turnGame || metaGame || '';
  const key = normalizeGameKey(rawName);

  const [ambience, setAmbience] = useState(EMPTY);

  useEffect(() => {
    if (!key || stealthMode) return undefined;
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      const match = await resolveGameArt(rawName, { signal: ctrl.signal });
      if (cancelled) return;
      if (!match) {
        setAmbience({ key, name: titleCase(rawName), hero: null, accent: null });
        return;
      }
      const hero = await firstLoadable([...(match.hero || []), ...(match.header || [])]);
      const accent = match.accent || await sampleAccent([...(match.header || []), ...(match.cover || [])]);
      if (cancelled) return;
      if (accent && !match.accent) rememberAccent(rawName, accent);
      // The player's wording reads better than Steam's ("ELDEN RING").
      setAmbience({ key, name: titleCase(rawName), hero, accent });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
    // rawName only differs from key in casing; keying on it would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stealthMode]);

  // Feed the empty state's shelf from finished answers only.
  useEffect(() => {
    if (!metaGame || stealthMode) return;
    rememberGame({ name: titleCase(metaGame) });
  }, [metaGame, stealthMode]);

  if (!key || stealthMode) return EMPTY;
  // Until the lookup for this game lands, show its name over the theme ambience.
  return ambience.key === key ? ambience : { ...EMPTY, key, name: titleCase(rawName) };
}
