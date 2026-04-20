import React, { useState, useRef, useEffect } from 'react';
import { SendHorizonal, Paperclip, X, ChevronRight } from 'lucide-react';

export default function ChatInput({ onSendMessage, isLoading, SLASH_COMMANDS = [] }) {
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [showCommands, setShowCommands] = useState(false);
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
    // Show command palette only if text starts with / and nothing else yet
    setShowCommands(val.startsWith('/') && SLASH_COMMANDS.length > 0);
  };

  const handleSend = () => {
    if ((inputText.trim() || attachments.length > 0) && !isLoading) {
      const attachmentData = attachments.map(a => ({
        data: a.data,
        mimeType: a.mimeType,
      }));
      onSendMessage(inputText.trim() || 'Analyze this image', attachmentData);
      setInputText('');
      setAttachments([]);
      setShowCommands(false);
      if (textAreaRef.current) {
        textAreaRef.current.style.height = '56px';
      }
    }
  };

  const selectCommand = (trigger) => {
    setInputText(trigger);
    setShowCommands(false);
    // Auto-send immediately for instant magic
    onSendMessage(trigger, []);
    setInputText('');
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const newAttachments = [];

    for (const file of files.slice(0, 3)) { // Max 3 files
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 10 * 1024 * 1024) continue; // 10MB limit

      const base64 = await fileToBase64(file);
      newAttachments.push({
        file,
        previewUrl: URL.createObjectURL(file),
        data: base64,
        mimeType: file.type,
      });
    }

    setAttachments(prev => [...prev, ...newAttachments].slice(0, 3));
    // Reset the input so the same file can be selected again
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

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // Remove the data:mime;base64, prefix
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  return (
    <div className="input-area-wrapper">
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="attachment-previews animate-fade-in">
          {attachments.map((attachment, index) => (
            <div key={index} className="attachment-preview">
              <img src={attachment.previewUrl} alt={`Attachment ${index + 1}`} />
              <button
                className="attachment-remove"
                onClick={() => removeAttachment(index)}
              >
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
          className="chat-input glass-panel"
          placeholder={attachments.length > 0
            ? "Describe what you need help with, or just send the image..."
            : "Ask anything about games, lore, or technical issues... (try /help)"}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
        />
        <button
          className="send-btn glass-panel"
          onClick={handleSend}
          disabled={(!inputText.trim() && attachments.length === 0) || isLoading}
        >
          <SendHorizonal size={24} />
        </button>
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
              // Show all when just '/' typed; filter as more chars added
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
