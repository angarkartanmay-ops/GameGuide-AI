import React from 'react';
import { stageLabel } from '../../utils/gameContext';
import { REDDIT_ENABLED } from '../../services/redditScraper';

/**
 * Replaces the three bouncing dots. Retrieval takes seconds before the first
 * token, so this names the stage the pipeline is in and shows which live
 * sources have come back — progress you can read instead of a spinner.
 */
export default function ResearchBlock({ streamStage, game, wiki, community, web }) {
  const label = stageLabel(streamStage) || 'Thinking…';
  // "Community" only while Reddit is actually queried (see REDDIT_ENABLED).
  const chips = [['Wiki intel', wiki], ...(REDDIT_ENABLED ? [['Community', community]] : []), ['Web intel', web]];
  return (
    <section className="cx-entry cx-entry--ai cx-research" aria-label="Research in progress">
      <div className="cx-overline">
        <span className="cx-mark" aria-hidden="true" />
        <span>{game ? `Researching · ${game}` : 'Researching'}</span>
        <span className="cx-overline__rule" aria-hidden="true" />
      </div>
      <p className="cx-research__stage" role="status" aria-live="polite">
        {label.replace(/…$/, '')}<span className="cx-accent">…</span>
      </p>
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
