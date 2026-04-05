import React, { useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble';

export default function ChatContainer({ messages, isLoading, onFollowUpClick }) {
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
      
      {isLoading && (
        <div className="message-bubble-container ai animate-fade-in">
          <div className="message-bubble ai glass-panel">
            <div className="message-avatar">...</div>
            <div className="loading-indicator">
              <div className="loading-dot"></div>
              <div className="loading-dot"></div>
              <div className="loading-dot"></div>
            </div>
          </div>
        </div>
      )}
      
      <div ref={endOfMessagesRef} />
    </div>
  );
}
