import React, { memo, useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, Shield } from 'lucide-react';
import FollowUpChips, { parseFollowUps } from './FollowUpChips';
import { toSpoilerMarkdown, SPOILER_HREF } from '../utils/spoilerText';
// Shared with the edge function so both apply exactly the same rule.
import { guardStreaming } from '../../supabase/functions/chat-proxy/spoilerGuard.ts';

/**
 * A hidden span the reader reveals on purpose (click, Enter or Space).
 * Rendered from [text](#spoiler), which toSpoilerMarkdown produces from the
 * server's Discord-style ||spoiler|| syntax.
 */
function Spoiler({ children }) {
  const [shown, setShown] = useState(false);
  const toggle = () => setShown(s => !s);
  return (
    <span
      className={`spoiler${shown ? ' is-revealed' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={shown}
      aria-label={shown ? undefined : 'Hidden spoiler — activate to reveal'}
      title={shown ? 'Click to hide' : 'Spoiler — click to reveal'}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      }}
    >
      <span className="spoiler__text" aria-hidden={!shown}>{children}</span>
    </span>
  );
}

const MARKDOWN_COMPONENTS = {
  a(props) {
    if (props.href === SPOILER_HREF) return <Spoiler>{props.children}</Spoiler>;
    // react-markdown passes its AST `node`; it must not reach the DOM.
    const rest = { ...props };
    delete rest.node;
    return <a {...rest} target="_blank" rel="noopener noreferrer" />;
  },
};

const SOURCE_LABELS = {
  'supercell-api': 'Official Supercell API',
  'wikipedia': 'Wikipedia (live revision)',
  'steam-news': 'Steam official news',
  'youtube': 'YouTube (recent uploads)',
  'rss': 'Gaming news (IGN, Polygon and others)',
  'fandom-wiki': 'Fandom wiki',
  'reddit': 'Reddit (live threads)',
  'cheapshark': 'CheapShark (current prices)',
  'official-api': 'Official game API',
  'official-news': 'Official news page',
  'web-search': 'Live web search',
  'agentic-websearch': 'Live web search',
};

// Browsers refuse to open a data: URL as a top-level page, so the old
// window.open(previewUrl) did nothing for attached screenshots.
async function openImage(url) {
  try {
    const target = url.startsWith('data:') ? URL.createObjectURL(await (await fetch(url)).blob()) : url;
    window.open(target, '_blank', 'noopener');
  } catch { /* nothing to open */ }
}

function MessageImages({ images, isUser }) {
  return (
    <div className={`cx-images${isUser ? ' is-user' : ''}`}>
      {images.map((img, index) => (
        <button key={index} type="button" className="cx-image" onClick={() => openImage(img.previewUrl)}
          aria-label={`Open ${isUser ? 'attached screenshot' : 'generated image'} ${index + 1} full size`}>
          <img
            src={img.previewUrl}
            alt={isUser ? `Attached screenshot ${index + 1}` : `Generated image ${index + 1}`}
            loading="lazy"
          />
          {!isUser && <span className="cx-image__badge">AI generated</span>}
        </button>
      ))}
    </div>
  );
}

function MessageBubble({ message, onFollowUpClick, followUpsDisabled = false }) {
  const isUser = message.sender === 'user';
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourcesId = useId();

  // Mid-stream the server's spoiler guard hasn't run yet (it runs on the final
  // text), so apply its passes here: a name the reply already hid stays
  // hidden when it comes up again. Chips wait for the final text — they are
  // plain buttons, and the server drops the ones that would spoil.
  const streaming = !isUser && !!message.streaming;
  const bodyText = streaming ? guardStreaming(message.text || '') : message.text;
  const { cleanText, followUps } = isUser
    ? { cleanText: message.text, followUps: [] }
    : parseFollowUps(bodyText);
  const hasImages = message.images && message.images.length > 0;

  if (isUser) {
    return (
      <div className="cx-entry cx-entry--user">
        <span className="cx-label">You</span>
        <div className="cx-query">
          {hasImages && <MessageImages images={message.images} isUser />}
          {cleanText && <p>{cleanText}</p>}
        </div>
      </div>
    );
  }

  const meta = message.meta && !message.meta.error ? message.meta : null;
  const uniqueSources = [...new Set((meta?.sources || []).filter(Boolean))];
  const persona = meta?.persona || null;

  // Spoiler Shield: what it held back, shown under the answer.
  const shield = meta?.spoiler;
  const shieldLabel = shield?.active
    ? (shield.mode === 'progress' && shield.progress
        ? `Hidden past: ${shield.progress}`
        : shield.mode === 'unknown'
          ? 'Spoiler Shield on — tell me where you are'
          : null)
    : null;

  return (
    <article className={`cx-entry cx-entry--ai${message.isCommand ? ' is-command' : ''}`} aria-busy={streaming || undefined}>
      <div className="cx-overline">
        <span className="cx-mark" aria-hidden="true" />
        <span>{persona ? `GameGuide · ${persona}` : 'GameGuide'}</span>
        <span className="cx-overline__rule" aria-hidden="true" />
      </div>

      {hasImages && <MessageImages images={message.images} isUser={false} />}

      <div className="cx-prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
          {toSpoilerMarkdown(cleanText)}
        </ReactMarkdown>
      </div>

      {meta && (shieldLabel || meta.vision || meta.cached || uniqueSources.length > 0) && (
        <div className="cx-meta">
          {shieldLabel && (
            <span className="cx-chip is-accent" title="Spoiler Shield: nothing past this point is shown unless you reveal it">
              <Shield size={12} aria-hidden="true" />{shieldLabel}
            </span>
          )}
          {meta.vision && <span className="cx-chip" title="Screenshot analysis">Vision</span>}
          {meta.cached && <span className="cx-chip" title="Served from a recent identical answer">Cached</span>}
          {uniqueSources.length > 0 && (
            <button
              type="button"
              className="cx-chip cx-chip--button"
              aria-expanded={sourcesOpen}
              aria-controls={sourcesId}
              onClick={() => setSourcesOpen(o => !o)}
            >
              {uniqueSources.length} live source{uniqueSources.length > 1 ? 's' : ''}
              <ChevronDown size={12} aria-hidden="true" className={sourcesOpen ? 'is-flipped' : undefined} />
            </button>
          )}
        </div>
      )}
      {sourcesOpen && (
        <ol className="cx-sources" id={sourcesId} aria-label="Live data used in this answer">
          {uniqueSources.map((src, i) => (
            <li key={src}><span className="cx-sources__n">{i + 1}</span>{SOURCE_LABELS[src] || src}</li>
          ))}
        </ol>
      )}

      {!streaming && followUps.length > 0 && (
        <FollowUpChips followUps={followUps} onChipClick={onFollowUpClick} disabled={followUpsDisabled} />
      )}
    </article>
  );
}

// Streaming re-renders the transcript on every token; memo keeps every
// finished answer (same message object, same props) out of that work.
export default memo(MessageBubble);
