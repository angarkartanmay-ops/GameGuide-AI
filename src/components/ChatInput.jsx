import React, { useState, useRef, useEffect, useImperativeHandle, useId } from 'react';
import { ArrowUp, Paperclip, X, Square, AlertTriangle } from 'lucide-react';
import { preprocessImage } from '../utils/imagePreprocess';
import { paletteState, nextIndex, selectionAction } from '../utils/slashPalette';
import CommandPalette from './codex/CommandPalette';

const MAX_CHARS = 1500; // warn above this threshold
const MAX_HEIGHT = 200;

/**
 * The command bar. `ref` exposes { setDraft, focus, openFilePicker } so the
 * empty state's starters can fill it (React 19: ref is a plain prop).
 */
export default function ChatInput({
  ref, onSendMessage, onCancel, isLoading, SLASH_COMMANDS = [], stealthMode = false, gameName = null,
}) {
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [showCharWarning, setShowCharWarning] = useState(false);
  const [rejected, setRejected] = useState([]);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const textAreaRef = useRef(null);
  const fileInputRef = useRef(null);
  const paletteId = useId();

  const palette = dismissed ? { mode: 'closed', items: [] } : paletteState(inputText, SLASH_COMMANDS);
  const activeIndex = Math.min(active, Math.max(0, palette.items.length - 1));

  useImperativeHandle(ref, () => ({
    setDraft(text) {
      setInputText(text);
      setDismissed(false);
      setActive(0);
      requestAnimationFrame(() => {
        const el = textAreaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(text.length, text.length);
      });
    },
    focus() { textAreaRef.current?.focus(); },
    openFilePicker() { fileInputRef.current?.click(); },
  }), []);

  useEffect(() => {
    const el = textAreaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    // Scroll only once the box has hit its cap — before that the text fits.
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [inputText]);

  const reset = () => {
    setInputText('');
    setAttachments([]);
    setDismissed(false);
    setActive(0);
  };

  const handleSend = () => {
    if (isLoading) return; // blocked while loading (use Stop instead)
    const trimmed = inputText.trim();
    if (!trimmed && attachments.length === 0) return;

    // Long-message warning: first press warns, "Send anyway" confirms.
    if (trimmed.length > MAX_CHARS && !showCharWarning) {
      setShowCharWarning(true);
      return;
    }
    setShowCharWarning(false);
    const attachmentData = attachments.map(a => ({ data: a.data, mimeType: a.mimeType }));
    onSendMessage(trimmed || 'Analyze this image', attachmentData);
    reset();
  };

  const pick = (cmd) => {
    const action = selectionAction(cmd, inputText);
    if (action.type === 'send') {
      onSendMessage(action.text, []);
      reset();
      return;
    }
    setInputText(action.text);
    setActive(0);
    textAreaRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (palette.mode === 'browse') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(nextIndex(activeIndex, palette.items.length, e.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(palette.items[activeIndex]);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (palette.mode !== 'closed') setDismissed(true);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e) => {
    setInputText(e.target.value);
    setDismissed(false);
    setActive(0);
    if (showCharWarning) setShowCharWarning(false);
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const room = 3 - attachments.length;
    const newAttachments = [];
    const errors = [];
    for (const file of files.slice(0, Math.max(0, room))) {
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
    if (files.length > room) errors.push(`Only 3 screenshots per message — ${files.length - Math.max(0, room)} skipped.`);
    // Rejections used to be console-only, so a dropped file vanished silently.
    setRejected(errors);
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
  const canSend = !!(inputText.trim() || attachments.length);
  const placeholder = isLoading
    ? 'Researching — press Stop to cancel'
    : attachments.length > 0
      ? 'Describe what you need help with, or just send the screenshot'
      : stealthMode
        // Reinforce the incognito cue where the typing happens — the banner
        // can scroll out of view, this never does.
        ? 'Stealth — nothing here is saved'
        : gameName
          ? `Ask about ${gameName}…`
          : 'Ask about any game — try /help';

  return (
    <div className={`cx-compose${stealthMode ? ' is-stealth' : ''}`}>
      {palette.mode !== 'closed' && (
        <CommandPalette
          id={paletteId}
          mode={palette.mode}
          items={palette.items}
          active={activeIndex}
          onPick={pick}
          onHover={setActive}
        />
      )}

      {showCharWarning && (
        <div className="cx-notice" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>
            Your message is <strong>{charCount.toLocaleString()} characters</strong> — long messages use more of your daily limit.
          </span>
          <button type="button" className="cx-notice__action" onClick={handleSend}>Send anyway</button>
          <button type="button" className="cx-notice__action is-quiet" onClick={() => setShowCharWarning(false)}>Edit</button>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="cx-notice" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{rejected.join(' · ')}</span>
          <button type="button" className="cx-notice__action is-quiet" onClick={() => setRejected([])}>Dismiss</button>
        </div>
      )}

      {attachments.length > 0 && (
        <ul className="cx-attachments" aria-label="Attached screenshots">
          {attachments.map((attachment, index) => (
            <li key={attachment.previewUrl} className="cx-attachment">
              <img src={attachment.previewUrl} alt={`Screenshot ${index + 1}`} />
              <button
                type="button"
                className="cx-attachment__remove"
                onClick={() => removeAttachment(index)}
                aria-label={`Remove screenshot ${index + 1}`}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="cx-bar">
        <button
          type="button"
          className="cx-bar__icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading || attachments.length >= 3}
          aria-label={attachments.length >= 3 ? 'Three screenshots attached (the maximum)' : 'Attach screenshots'}
          title="Attach screenshots"
        >
          <Paperclip size={18} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          hidden
          tabIndex={-1}
        />

        <label className="sr-only" htmlFor={`${paletteId}-input`}>Message GameGuide</label>
        <textarea
          id={`${paletteId}-input`}
          ref={textAreaRef}
          className={`cx-bar__input${isOverLimit ? ' is-over' : ''}`}
          rows={1}
          placeholder={placeholder}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          aria-autocomplete="list"
          aria-controls={palette.mode === 'browse' ? paletteId : undefined}
          aria-activedescendant={palette.mode === 'browse' ? `${paletteId}-${activeIndex}` : undefined}
        />

        {charCount > MAX_CHARS * 0.7 && !isLoading && (
          <span className={`cx-bar__count${isOverLimit ? ' is-over' : ''}`} aria-live="polite">
            {charCount}/{MAX_CHARS}
          </span>
        )}
        {!isLoading && !inputText && (
          <span className="cx-bar__hint" aria-hidden="true"><kbd>/</kbd>commands</span>
        )}

        {isLoading ? (
          <button type="button" className="cx-bar__stop" onClick={onCancel} aria-label="Stop generating" title="Stop generating">
            <Square size={15} fill="currentColor" />
          </button>
        ) : (
          <button type="button" className="cx-bar__send" onClick={handleSend} disabled={!canSend} aria-label="Send message" title="Send">
            <ArrowUp size={18} strokeWidth={2.4} />
          </button>
        )}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {palette.mode === 'browse' ? `${palette.items.length} command${palette.items.length === 1 ? '' : 's'}` : ''}
      </span>
    </div>
  );
}
