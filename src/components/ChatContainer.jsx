import React, { useLayoutEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import ResearchBlock from './codex/ResearchBlock';
import EmptyState from './codex/EmptyState';
import ErrorBoundary from './ErrorBoundary';

const NEAR_BOTTOM_PX = 140;

/**
 * The nearest player message before index `i`, as a question a stranger
 * would read on a share page — "/missables elden ring" reads as a command,
 * so it's spelled out.
 */
function questionBefore(messages, i) {
  for (let j = i - 1; j >= 0; j--) {
    if (messages[j]?.sender !== 'user') continue;
    const text = messages[j].text || '';
    const m = /^\/missables\b\s*(.*)$/i.exec(text.trim());
    if (m) return m[1] ? `What can I still miss in ${m[1]}?` : 'What can I still miss?';
    return text;
  }
  return '';
}

/**
 * What stands in for one message that failed while drawing. Never the raw
 * text: Spoiler Shield works in the renderer, so showing the source here
 * could show what the player asked to have held back. A fresh answer is one
 * tap away instead.
 */
function MessageFailed({ sender, question, onAsk, disabled }) {
  if (sender === 'user') {
    return <div className="cx-entry cx-entry--user"><div className="cx-query"><p>This message could not be displayed.</p></div></div>;
  }
  return (
    <article className="cx-entry cx-entry--ai" role="alert">
      <div className="cx-overline">
        <span className="cx-mark" aria-hidden="true" />
        <span>GameGuide</span>
        <span className="cx-overline__rule" aria-hidden="true" />
      </div>
      <p className="cx-prose">This answer could not be displayed.</p>
      {question && (
        <div className="cx-actions">
          <button type="button" className="cx-action" onClick={() => onAsk(question)} disabled={disabled}>Ask again</button>
        </div>
      )}
    </article>
  );
}

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
    // The empty state reads top-down; pinning it to the bottom hid its
    // heading and first row of games on a phone.
    if (messages.length === 0) {
      lastCount.current = 0;
      el.scrollTop = 0;
      return;
    }
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
          <ErrorBoundary scope="empty-state" fallback={<p className="cx-empty__lede">Ask about any game below.</p>}>
            <EmptyState onAsk={onAsk} onDraft={onDraft} onAttach={onAttach} stealthMode={stealthMode} />
          </ErrorBoundary>
        )}
        {loadingHistory && (
          <div className="cx-skeleton cx-skeleton--history" aria-label="Loading your conversation">
            <span style={{ width: '40%', marginLeft: 'auto' }} />
            <span style={{ width: '92%' }} />
            <span style={{ width: '76%' }} />
          </div>
        )}
        {messages.map((msg, i) => {
          const question = msg.sender === 'ai' ? questionBefore(messages, i) : '';
          return (
            // One answer that fails to draw is replaced by a short note and a
            // way to ask again; the rest of the conversation stays. It gets one
            // more try when the answer finishes streaming, not on every token.
            <ErrorBoundary
              key={msg.id}
              scope="message"
              resetKeys={[!!msg.streaming]}
              fallback={() => <MessageFailed sender={msg.sender} question={question} onAsk={onFollowUpClick} disabled={isLoading} />}
            >
              <MessageBubble
                message={msg}
                // The question an answer replies to, for its share link.
                question={question}
                onFollowUpClick={onFollowUpClick}
                followUpsDisabled={isLoading}
              />
            </ErrorBoundary>
          );
        })}
        {researching && (
          <ResearchBlock streamStage={streamStage} game={gameName} {...intel} />
        )}
      </div>
    </div>
  );
}
