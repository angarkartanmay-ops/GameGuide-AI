import React, { useEffect, useState } from 'react';
import { DEEP_AFTER_SECONDS, parseStreamStage, stageLabel } from '../../utils/gameContext';
import { REDDIT_ENABLED } from '../../services/redditScraper';

/**
 * Replaces the three bouncing dots. Retrieval takes seconds before the first
 * token, so this names the stage the pipeline is in and shows which live
 * sources have come back — progress you can read instead of a spinner.
 *
 * When a turn takes the slow, careful path the server sends a `deep` stage;
 * past DEEP_AFTER_SECONDS without an answer the block says so on its own.
 * Either way the reader is told it is thinking in depth, with a running clock.
 */
export default function ResearchBlock({ streamStage, game, wiki, community, web }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const { stage } = parseStreamStage(streamStage);
  // The deep stage is the last one before the answer streams (which unmounts
  // this block), and the clock only grows, so this never flips back.
  const isDeep = stage === 'deep' || seconds >= DEEP_AFTER_SECONDS;

  const label = isDeep ? 'Thinking in depth…' : (stageLabel(streamStage) || 'Thinking…');
  // "Community" only while Reddit is actually queried (see REDDIT_ENABLED).
  const chips = [['Wiki intel', wiki], ...(REDDIT_ENABLED ? [['Community', community]] : []), ['Web intel', web]];
  const heading = isDeep ? 'Thinking in depth' : 'Researching';
  return (
    <section className="cx-entry cx-entry--ai cx-research" aria-label="Research in progress">
      <div className="cx-overline">
        <span className="cx-mark" aria-hidden="true" />
        <span>{game ? `${heading} · ${game}` : heading}</span>
        <span className="cx-overline__rule" aria-hidden="true" />
        {isDeep && <span className="cx-research__clock" aria-hidden="true">{seconds}s</span>}
      </div>
      <p className="cx-research__stage" role="status" aria-live="polite">
        {label.replace(/…$/, '')}<span className="cx-accent">…</span>
      </p>
      {isDeep && (
        <p className="cx-research__note">Checking the details so the answer is right. This one takes a little longer.</p>
      )}
      <div className="cx-skeleton" aria-hidden="true">
        <span style={{ width: '94%' }} />
        <span style={{ width: '80%' }} />
        <span style={{ width: '62%' }} />
      </div>
      <div className="cx-chips">
        {chips.map(([text, on]) => (
          <span key={text} className={`cx-chip${on ? ' is-on' : ''}`}>
            <span className="cx-dot__mark" aria-hidden="true" />{text}
          </span>
        ))}
      </div>
    </section>
  );
}
