import React, { useEffect, useState } from 'react';
import { ArrowRight, Paperclip } from 'lucide-react';
import { buildShelf, loadRecentGames, coverUrl } from '../../utils/recentGames';
import { loadSpoilerPrefs } from '../../utils/spoilerPrefs';
import { resolveGameArt } from '../../utils/gameArt';
import { SAMPLE_QUESTIONS } from '../../site/sampleQuestions';
import FollowUpChips from '../FollowUpChips';

/**
 * "What are you playing?" — the first screen of a conversation. The shelf is
 * the player's recent games (with where they are, from Spoiler Shield), then
 * curated picks, so a new player still sees real games to start from. Under
 * the lede, the same three sample questions the landing's hero offers; one
 * tap types it into the bar (never sends it), exactly as on the landing.
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

  // The game /missables will default to — the newest one with a saved position.
  const lastProgress = shelf.find((g) => g.progress) || null;

  const ask = (g) => onAsk(g.progress
    ? `I'm at ${g.progress} in ${g.name}. What should I do next?`
    : `What should a new ${g.name} player know first?`);

  return (
    <section className="cx-empty" aria-labelledby="cx-empty-title">
      <h2 id="cx-empty-title" className="cx-empty__title">What are you <em>playing</em>?</h2>
      <p className="cx-empty__lede">
        Ask about builds, bosses, patches or prices. Tell me where you are and I&apos;ll keep everything past it hidden.
      </p>

      <FollowUpChips followUps={SAMPLE_QUESTIONS} onChipClick={onDraft} label="Try asking" />

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
                {/* Under the art, and all there is when a game has none. */}
                <span className="cx-cover__fallback" aria-hidden="true">
                  <span className="cx-mark" />
                  <span className="cx-cover__fallback-name">{g.name}</span>
                </span>
              </span>
              <span className="cx-cover__name">{g.name}</span>
              {g.progress && <span className="cx-cover__meta">{g.progress}</span>}
            </button>
          </li>
        ))}
      </ul>

      <div className="cx-shelf-head">
        <span>Commands</span>
        <span className="cx-overline__rule" aria-hidden="true" />
      </div>
      <ul className="cx-cmds">
        {/* The question only a progress-aware guide can answer safely. With a
            saved position it runs straight away for that game; otherwise it
            waits for the player to name one. */}
        <li>
          <button
            type="button"
            className="cx-cmd"
            onClick={() => (lastProgress ? onAsk(`/missables ${lastProgress.name}`) : onDraft('/missables '))}
          >
            <code className="cx-cmd__trigger"><span className="cx-cmd__slash">/</span>missables</code>
            <span className="cx-cmd__desc">
              {lastProgress ? `What you can still miss in ${lastProgress.name}` : 'What you can still miss, spoiler-free'}
            </span>
            <ArrowRight size={15} aria-hidden="true" className="cx-cmd__go" />
          </button>
        </li>
        <li>
          <button type="button" className="cx-cmd" onClick={() => onDraft('/price ')}>
            <code className="cx-cmd__trigger"><span className="cx-cmd__slash">/</span>price</code>
            <span className="cx-cmd__desc">The best price across PC stores</span>
            <ArrowRight size={15} aria-hidden="true" className="cx-cmd__go" />
          </button>
        </li>
        <li>
          <button type="button" className="cx-cmd" onClick={() => onDraft('/progress ')}>
            <code className="cx-cmd__trigger"><span className="cx-cmd__slash">/</span>progress</code>
            <span className="cx-cmd__desc">Say where you are. Nothing past it is shown</span>
            <ArrowRight size={15} aria-hidden="true" className="cx-cmd__go" />
          </button>
        </li>
        <li>
          <button type="button" className="cx-cmd" onClick={onAttach}>
            <span className="cx-cmd__trigger"><Paperclip size={14} aria-hidden="true" />image</span>
            <span className="cx-cmd__desc">Read a screenshot, up to 3 at once</span>
            <ArrowRight size={15} aria-hidden="true" className="cx-cmd__go" />
          </button>
        </li>
      </ul>
    </section>
  );
}
