import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, User } from 'lucide-react';
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
    return <a {...rest} />;
  },
};

const SOURCE_LABELS = {
  'supercell-api': '🛡️ Official Supercell API',
  'wikipedia': '📚 Wikipedia (live revision)',
  'steam-news': '🎮 Steam Official News',
  'youtube': '🎬 YouTube (recent uploads)',
  'rss': '📰 Gaming News (IGN/Polygon/etc.)',
  'fandom-wiki': '📖 Fandom Wiki',
  'reddit': '👥 Reddit (live threads)',
  'cheapshark': '💰 CheapShark (current prices)',
  'official-api': '🏛️ Official Game API',
  'official-news': '📰 Official News Page',
  'web-search': '🔍 Live Web Search',
};

export default function MessageBubble({ message, onFollowUpClick }) {
  const isUser = message.sender === 'user';
  const [sourcesOpen, setSourcesOpen] = useState(false);

  // Mid-stream the server's spoiler guard hasn't run yet (it runs on the final
  // text), so apply its passes here: a name the reply already hid stays
  // hidden when it comes up again. Chips wait for the final text — they are
  // plain buttons, and the server drops the ones that would spoil.
  const streaming = !isUser && !!message.streaming;
  const bodyText = streaming ? guardStreaming(message.text || '') : message.text;

  // For AI messages, parse out follow-up questions
  const { cleanText, followUps } = isUser
    ? { cleanText: message.text, followUps: [] }
    : parseFollowUps(bodyText);

  const hasImages = message.images && message.images.length > 0;
  const sources = (message.meta?.sources || []).filter(Boolean);
  const uniqueSources = [...new Set(sources)];

  // Spoiler Shield: what it held back, shown under the answer.
  const shield = message.meta?.spoiler;
  const shieldLabel = shield?.active
    ? (shield.mode === 'progress' && shield.progress
        ? `🛡️ Spoilers hidden past: ${shield.progress}`
        : shield.mode === 'unknown'
          ? '🛡️ Spoiler Shield on — tell me where you are'
          : null)
    : null;

  return (
    <div className={`message-bubble-container ${isUser ? 'user' : 'ai'} animate-fade-in`}>
      <div className={`message-bubble ${isUser ? 'user' : 'ai'} glass-panel`}>
        <div className="message-avatar">
          {isUser ? <User size={20} /> : <Bot size={20} />}
        </div>
        <div className="message-content">
          {/* Render attached/generated images */}
          {hasImages && (
            <div className={`message-images ${isUser ? 'user-images' : 'ai-images'}`}>
              {message.images.map((img, index) => (
                <div key={index} className="message-image-wrapper">
                  <img
                    src={img.previewUrl}
                    alt={isUser ? `Attached screenshot ${index + 1}` : `Generated image ${index + 1}`}
                    className="message-image"
                    loading="lazy"
                    onClick={() => window.open(img.previewUrl, '_blank')}
                  />
                  {!isUser && (
                    <div className="image-badge">🎨 AI Generated</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Render text content */}
          {isUser ? (
            <p>{message.text}</p>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {toSpoilerMarkdown(cleanText)}
            </ReactMarkdown>
          )}

          {/* Cortex telemetry badge — persona + GODMODE only (no backend model disclosure) */}
          {!isUser && message.meta && !message.meta.error && (message.meta.persona || message.meta.vision) && (
            <div className="cortex-badge-row">
              <div className="cortex-badge" title={message.meta.vision ? 'GameGuide-AI · Vision GODMODE active' : 'GameGuide-AI'}>
                {message.meta.personaEmoji || '🤖'} {message.meta.persona || 'GameGuide'}
                {message.meta.vision && <span className="cortex-vision">🔍 GODMODE</span>}
                {message.meta.cached && <span className="cortex-cached">⚡ cached</span>}
              </div>
              {shieldLabel && (
                <div className="shield-chip" title="Spoiler Shield: nothing past this point is shown unless you reveal it">
                  {shieldLabel}
                </div>
              )}
              {uniqueSources.length > 0 && (
                <div className="cortex-sources-wrapper">
                  <button
                    type="button"
                    className="cortex-sources-chip"
                    onClick={() => setSourcesOpen(o => !o)}
                    title="Click to see live data sources used in this response"
                  >
                    📡 {uniqueSources.length} live source{uniqueSources.length > 1 ? 's' : ''}
                    <span className="cortex-sources-caret">{sourcesOpen ? '▲' : '▼'}</span>
                  </button>
                  {sourcesOpen && (
                    <div className="cortex-sources-dropdown">
                      <div className="cortex-sources-header">Live data injected into this answer:</div>
                      {uniqueSources.map(src => (
                        <div key={src} className="cortex-sources-item">
                          {SOURCE_LABELS[src] || `🌐 ${src}`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {!isUser && !streaming && followUps.length > 0 && (
          <FollowUpChips followUps={followUps} onChipClick={onFollowUpClick} />
        )}
      </div>
    </div>
  );
}
