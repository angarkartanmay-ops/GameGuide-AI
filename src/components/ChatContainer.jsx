import React, { useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble';

// Retrieval runs before the first token exists, so the wait is several seconds
// of nothing. Naming the stage turns a blank spinner into visible progress.
const STAGE_COPY = {
  'searching': 'Searching live sources…',
  'scanning-sources': 'Reading wikis, patch notes and community threads…',
  'reading-image': 'Reading your screenshot…',
  'identifying-game': 'Identifying the game…',
  'generating': 'Thinking…',
  'streaming': 'Writing…',
};

function stageLabel(streamStage) {
  if (!streamStage) return null;
  // The hook encodes an optional detail as "stage:detail" (e.g. the game name).
  const [stage, detail] = String(streamStage).split(':');
  const base = STAGE_COPY[stage];
  if (!base) return null;
  return detail ? `${base.replace(/…$/, '')} (${detail})…` : base;
}

export default function ChatContainer({ messages, isLoading, streamStage, onFollowUpClick }) {
  const endOfMessagesRef = useRef(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <div className="messages-area glass-panel">
      {messages.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '2rem' }}>
          <h2>Welcome to GameGuide-AI</h2>
          <p>The ultimate gamers support system. Ask your query below!</p>
        </div>
      ) : (
        messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onFollowUpClick={onFollowUpClick}
          />
        ))
      )}
      
      {/* isLoading stays true for the whole request, including while tokens are
          streaming — so once a streaming message exists this indicator would
          render a second time underneath the partial answer. Suppress it as
          soon as the first delta lands. */}
      {isLoading && !messages.some((m) => m.streaming) && (
        <div className="message-bubble-container ai animate-fade-in">
          <div className="message-bubble ai glass-panel">
            <div className="message-avatar">...</div>
            <div className="loading-indicator">
              <div className="loading-dot"></div>
              <div className="loading-dot"></div>
              <div className="loading-dot"></div>
            </div>
            {stageLabel(streamStage) && (
              <span className="loading-stage" aria-live="polite">
                {stageLabel(streamStage)}
              </span>
            )}
          </div>
        </div>
      )}
      
      <div ref={endOfMessagesRef} />
    </div>
  );
}
