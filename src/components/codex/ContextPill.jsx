import React, { memo } from 'react';
import { Shield } from 'lucide-react';

/**
 * What the chat is working with, at a glance: the game in context, what the
 * Spoiler Shield is holding back, and which live sources fed the last turn.
 * Not a live region — the research block announces progress.
 */
function ContextPill({ game, spoiler, wiki, community, web, price }) {
  const shield = spoiler?.active
    ? (spoiler.mode === 'progress' && spoiler.progress
        ? { label: 'Hidden past', value: spoiler.progress }
        : spoiler.mode === 'unknown' ? { label: 'Shield on', value: null } : null)
    : null;
  const sources = [
    ['Wiki', wiki],
    ['Community', community],
    ['Web', web],
    ...(price ? [['Prices', true]] : []),
  ];

  return (
    <div className="cx-context" role="group" aria-label="Chat context">
      <span className={`cx-context__game${game ? '' : ' is-empty'}`}>{game || 'No game yet'}</span>
      {shield && (
        <>
          <span className="cx-context__sep" aria-hidden="true" />
          <span className="cx-context__shield" title="Spoiler Shield: nothing past this point is shown unless you reveal it">
            <Shield size={14} aria-hidden="true" />
            <span className="cx-context__shield-label">{shield.label}</span>
            {shield.value && <strong>{shield.value}</strong>}
          </span>
        </>
      )}
      <span className="cx-context__sep" aria-hidden="true" />
      <span className="cx-context__sources">
        {sources.map(([label, on]) => (
          <span key={label} className={`cx-dot${on ? ' is-on' : ''}`}>
            <span className="cx-dot__mark" aria-hidden="true" />
            <span className="cx-dot__label">{label}</span>
            <span className="sr-only">{on ? '(used)' : '(idle)'}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

export default memo(ContextPill);
