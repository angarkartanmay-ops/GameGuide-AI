import React, { useState, useRef, useEffect } from 'react';
import { SendHorizonal, Paperclip, X, ChevronRight, Square, AlertTriangle } from 'lucide-react';
import { preprocessImage } from '../utils/imagePreprocess';

const MAX_CHARS = 1500; // warn above this threshold

export default function ChatInput({ onSendMessage, onCancel, isLoading, SLASH_COMMANDS = [] }) {
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [showCommands, setShowCommands] = useState(false);
  const [showCharWarning, setShowCharWarning] = useState(false);
  const textAreaRef = useRef(null);
  const fileInputRef = useRef(null);

  const adjustTextareaHeight = () => {
    const el = textAreaRef.current;
    if (el) {
      el.style.height = '56px';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputText]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setShowCommands(false);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputText(val);
    setShowCommands(val.startsWith('/') && SLASH_COMMANDS.length > 0);
  };

  const handleSend = () => {
    if (isLoading) return; // blocked while loading (use Stop button instead)

    const trimmed = inputText.trim();
    if (!trimmed && attachments.length === 0) return;

    // ── Long message warning ─────────────────────────────────────────────────
    if (trimmed.length > MAX_CHARS && !showCharWarning) {
      setShowCharWarning(true);
      return; // show warning; user must click Send again to confirm
    }

    setShowCharWarning(false);
    const attachmentData = attachments.map(a => ({ data: a.data, mimeType: a.mimeType }));
    onSendMessage(trimmed || 'Analyze this image', attachmentData);
    setInputText('');
    setAttachments([]);
    setShowCommands(false);
    if (textAreaRef.current) textAreaRef.current.style.height = '56px';
  };

  const handleStop = () => {
    if (onCancel) onCancel();
  };

  const selectCommand = (trigger) => {
    setInputText(trigger);
    setShowCommands(false);
    onSendMessage(trigger, []);
    setInputText('');
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const newAttachments = [];
    const errors = [];

    for (const file of files.slice(0, 3)) {
      try {
        const processed = await preprocessImage(file);
        newAttachments.push({
          file,
          previewUrl: URL.createObjectURL(file),
          data: processed.data,
          mimeType: processed.mimeType,    // always image/jpeg now
          meta: { w: processed.width, h: processed.height, bytes: processed.bytes },
        });
      } catch (err) {
        errors.push(`${file.name}: ${err.code === 'TOO_LARGE' ? 'too large after compression' : err.code === 'UNSUPPORTED' ? 'not a supported image' : 'could not read'}`);
      }
    }

    if (errors.length) {
      // Use whatever toast/banner system the app already has; if none, console.warn is OK
      console.warn('[VISION] some files rejected:', errors);
    }

    setAttachments(prev => [...prev, ...newAttachments].slice(0, 3));
    e.target.value = '';
  };

  const removeAttachment = (index) => {
    setAttachments(prev => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].previewUrl);
      updated.splice(index, 1);
      return updated;
    });
  };

  const charCount = inputText.length;
  const isOverLimit = charCount > MAX_CHARS;

  return (
    <div className="input-area-wrapper">
      {/* Long-message warning banner */}
      {showCharWarning && (
        <div className="char-warning animate-fade-in">
          <AlertTriangle size={15} />
          <span>
            Your message is <strong>{charCount.toLocaleString()} characters</strong> — this uses more AI credits.
            &nbsp;<button className="char-warning-confirm" onClick={handleSend}>Send anyway</button>
            &nbsp;<button className="char-warning-cancel" onClick={() => setShowCharWarning(false)}>Edit</button>
          </span>
        </div>
      )}

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="attachment-previews animate-fade-in">
          {attachments.map((attachment, index) => (
            <div key={index} className="attachment-preview">
              <img src={attachment.previewUrl} alt={`Attachment ${index + 1}`} />
              <button className="attachment-remove" onClick={() => removeAttachment(index)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="input-area">
        <button
          className="upload-btn glass-panel"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading || attachments.length >= 3}
          title="Attach image (screenshot, error, etc.)"
        >
          <Paperclip size={20} />
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        <textarea
          ref={textAreaRef}
          className={`chat-input glass-panel ${isOverLimit ? 'chat-input--over-limit' : ''}`}
          placeholder={
            isLoading
              ? 'Generating response... (press Stop to cancel)'
              : attachments.length > 0
                ? 'Describe what you need help with, or just send the image...'
                : 'Ask anything about games, lore, or technical issues... (try /help)'
          }
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
        />

        {/* Character counter — shown when approaching limit */}
        {charCount > MAX_CHARS * 0.7 && !isLoading && (
          <div className={`char-counter ${isOverLimit ? 'char-counter--over' : ''}`}>
            {charCount}/{MAX_CHARS}
          </div>
        )}

        {/* Send / Stop button */}
        {isLoading ? (
          <button
            className="stop-btn glass-panel animate-pulse-stop"
            onClick={handleStop}
            title="Stop generating response"
          >
            <Square size={18} fill="currentColor" />
          </button>
        ) : (
          <button
            className="send-btn glass-panel"
            onClick={handleSend}
            disabled={(!inputText.trim() && attachments.length === 0) || isLoading}
          >
            <SendHorizonal size={24} />
          </button>
        )}
      </div>

      {/* Slash Command Palette */}
      {showCommands && (
        <div className="command-palette glass-panel animate-fade-in">
          <div className="command-palette-header">
            <span>⚡ Commands</span>
            <button className="command-palette-close" onClick={() => setShowCommands(false)}>✕</button>
          </div>
          {SLASH_COMMANDS
            .filter(cmd => {
              const typed = inputText.toLowerCase();
              return typed === '/' || cmd.trigger.startsWith(typed);
            })
            .map((cmd) => (
              <button
                key={cmd.trigger}
                className="command-item"
                onMouseDown={(e) => { e.preventDefault(); selectCommand(cmd.trigger); }}
              >
                <span className="command-emoji">{cmd.emoji}</span>
                <span className="command-trigger">{cmd.trigger}</span>
                <ChevronRight size={12} className="command-arrow" />
                <span className="command-desc">{cmd.description}</span>
              </button>
            ))
          }
        </div>
      )}
    </div>
  );
}
