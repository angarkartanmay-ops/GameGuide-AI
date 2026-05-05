import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, User } from 'lucide-react';
import FollowUpChips, { parseFollowUps } from './FollowUpChips';

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

  // For AI messages, parse out follow-up questions
  const { cleanText, followUps } = isUser
    ? { cleanText: message.text, followUps: [] }
    : parseFollowUps(message.text);

  const hasImages = message.images && message.images.length > 0;
  const sources = (message.meta?.sources || []).filter(Boolean);
  const uniqueSources = [...new Set(sources)];

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
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanText}</ReactMarkdown>
          )}

          {/* Cortex telemetry badge — persona + GODMODE only (no backend model disclosure) */}
          {!isUser && message.meta && !message.meta.error && (message.meta.persona || message.meta.vision) && (
            <div className="cortex-badge-row">
              <div className="cortex-badge" title={message.meta.vision ? 'GameGuide-AI · Vision GODMODE active' : 'GameGuide-AI'}>
                {message.meta.personaEmoji || '🤖'} {message.meta.persona || 'GameGuide'}
                {message.meta.vision && <span className="cortex-vision">🔍 GODMODE</span>}
                {message.meta.cached && <span className="cortex-cached">⚡ cached</span>}
              </div>
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
        {!isUser && followUps.length > 0 && (
          <FollowUpChips followUps={followUps} onChipClick={onFollowUpClick} />
        )}
      </div>
    </div>
  );
}
