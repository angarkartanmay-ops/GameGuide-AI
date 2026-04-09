import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, User } from 'lucide-react';
import FollowUpChips, { parseFollowUps } from './FollowUpChips';

export default function MessageBubble({ message, onFollowUpClick }) {
  const isUser = message.sender === 'user';

  // For AI messages, parse out follow-up questions
  const { cleanText, followUps } = isUser
    ? { cleanText: message.text, followUps: [] }
    : parseFollowUps(message.text);

  const hasImages = message.images && message.images.length > 0;

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
        </div>
        {!isUser && followUps.length > 0 && (
          <FollowUpChips followUps={followUps} onChipClick={onFollowUpClick} />
        )}
      </div>
    </div>
  );
}
