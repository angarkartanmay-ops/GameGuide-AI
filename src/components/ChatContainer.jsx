import React, { useLayoutEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import ResearchBlock from './codex/ResearchBlock';
import EmptyState from './codex/EmptyState';

const NEAR_BOTTOM_PX = 140;

/**
 * The transcript. Scroll follows new text only while the reader is already
 * near the bottom — scrolled up to re-read something, they stay put — and
 * always jumps down when they send. The old smooth scrollIntoView ran on every
 * streamed token, which both fought the reader and forced a layout per token.
 */
export default function ChatContainer({
  messages, isLoading, streamStage, onFollowUpClick, gameName, intel, onAsk, onDraft, onAttach, stealthMode,
}) {
  const scrollRef = useRef(null);
  const stick = useRef(true);
  const lastCount = useRef(messages.length);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };

  const last = messages[messages.length - 1];
  const streaming = messages.some((m) => m.streaming);
  // Research shows only between the question and the first token — never
  // while history loads (isLoading is also true then) or once text streams.
  const researching = isLoading && !streaming && last?.sender === 'user';
  const loadingHistory = isLoading && messages.length === 0;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sentNew = messages.length > lastCount.current && last?.sender === 'user';
    lastCount.current = messages.length;
    if (sentNew) stick.current = true;
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, researching, last?.sender]);

  return (
    <div className="cx-scroll" ref={scrollRef} onScroll={onScroll}>
      <div
        className="cx-column"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={streaming || undefined}
        aria-label="Conversation"
      >
        {messages.length === 0 && !isLoading && (
          <EmptyState onAsk={onAsk} onDraft={onDraft} onAttach={onAttach} stealthMode={stealthMode} />
        )}
        {loadingHistory && (
          <div className="cx-skeleton cx-skeleton--history" aria-label="Loading your conversation">
            <span style={{ width: '40%', marginLeft: 'auto' }} />
            <span style={{ width: '92%' }} />
            <span style={{ width: '76%' }} />
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onFollowUpClick={onFollowUpClick}
            followUpsDisabled={isLoading}
          />
        ))}
        {researching && (
          <ResearchBlock streamStage={streamStage} game={gameName} {...intel} />
        )}
      </div>
    </div>
  );
}
