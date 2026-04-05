import React, { useState, useRef, useEffect } from 'react';
import { SendIcon, Paperclip, X, Image as ImageIcon } from 'lucide-react';

export default function ChatInput({ onSendMessage, isLoading }) {
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState([]); // { file, previewUrl, data, mimeType }
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
      if (textAreaRef.current) {
        textAreaRef.current.style.height = '56px';
      }
    }
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
            : "Ask anything about games, lore, or technical issues..."}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
        />
        <button
          className="send-btn glass-panel"
          onClick={handleSend}
          disabled={(!inputText.trim() && attachments.length === 0) || isLoading}
        >
          <SendIcon size={24} />
        </button>
      </div>
    </div>
  );
}
