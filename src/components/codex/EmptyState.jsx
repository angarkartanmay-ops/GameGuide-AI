import React, { useEffect, useState } from 'react';
import { Tag, MapPin, Image as ImageIcon } from 'lucide-react';
import { buildShelf, loadRecentGames, coverUrl } from '../../utils/recentGames';
import { loadSpoilerPrefs } from '../../utils/spoilerPrefs';
import { resolveGameArt } from '../../utils/gameArt';

/**
 * "What are you playing?" — the first screen of a conversation. The shelf is
 * the player's recent games (with where they are, from Spoiler Shield), then
 * curated picks, so a new player still sees real games to start from.
 */
export default function EmptyState({ onAsk, onDraft, onAttach, stealthMode }) {
  const [shelf] = useState(() => buildShelf(loadRecentGames(), loadSpoilerPrefs().progress || {}));
  const [covers, setCovers] = useState(() =>
    Object.fromEntries(shelf.filter((g) => g.appid).map((g) => [g.key, coverUrl(g.appid)])));

  // Recent games without a known appid: look their cover up (cached a week).
  // Never in stealth — a lookup names the game to the network.
  useEffect(() => {
    if (stealthMode) return undefined;
    let cancelled = false;
    (async () => {
      for (const g of shelf) {
        if (g.appid) continue;
        const match = await resolveGameArt(g.name);
        const url = match?.cover?.[0];
        if (!cancelled && url) setCovers((prev) => ({ ...prev, [g.key]: url }));
      }
    })();
    return () => { cancelled = true; };
  }, [shelf, stealthMode]);

  const ask = (g) => onAsk(g.progress
    ? `I'm at ${g.progress} in ${g.name}. What should I do next?`
    : `What should a new ${g.name} player know first?`);

  return (
    <section className="cx-empty" aria-labelledby="cx-empty-title">
      <span className="cx-empty__kicker">Live intel · Spoiler-safe</span>
      <h2 id="cx-empty-title" className="cx-empty__title">What are you <em>playing</em>?</h2>
      <p className="cx-empty__lede">
        Ask about builds, bosses, patches or prices. Tell me where you are and I&apos;ll keep everything past it hidden.
      </p>

      <div className="cx-shelf-head">
        <span>{shelf.some((g) => g.progress) ? 'Pick up where you left off' : 'Start with a game'}</span>
        <span className="cx-overline__rule" aria-hidden="true" />
      </div>
      <ul className="cx-shelf">
        {shelf.map((g) => (
          <li key={g.key}>
            <button type="button" className="cx-cover" onClick={() => ask(g)}>
              <span className="cx-cover__art">
                {covers[g.key]
                  ? <img src={covers[g.key]} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  : null}
                <span className="cx-cover__fallback" aria-hidden="true">{g.name}</span>
              </span>
              <span className="cx-cover__name">{g.name}</span>
              <span className="cx-cover__meta">{g.progress || 'Ask anything'}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="cx-starters">
        <button type="button" className="cx-starter" onClick={() => onDraft('/price ')}>
          <span className="cx-starter__icon" aria-hidden="true"><Tag size={17} /></span>
          <span className="cx-starter__text"><span>Check a price</span><code>/price elden ring</code></span>
        </button>
        <button type="button" className="cx-starter" onClick={() => onDraft('/progress ')}>
          <span className="cx-starter__icon" aria-hidden="true"><MapPin size={17} /></span>
          <span className="cx-starter__text"><span>Set where you are</span><code>/progress game : where</code></span>
        </button>
        <button type="button" className="cx-starter" onClick={onAttach}>
          <span className="cx-starter__icon" aria-hidden="true"><ImageIcon size={17} /></span>
          <span className="cx-starter__text"><span>Read my screenshot</span><code>PNG or JPG, up to 3</code></span>
        </button>
      </div>
    </section>
  );
}
