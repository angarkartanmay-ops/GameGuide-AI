import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Star, Camera, Share2, Upload, CheckCircle, AlertCircle, Loader2, Copy, ExternalLink, MessageSquare, Zap, Bug, Lightbulb, Heart } from 'lucide-react';
import { submitFeedback, buildShareUrl, captureScreenshot } from '../services/feedbackService';

const CATEGORIES = [
  { id: 'bug',       label: 'Bug Report',       icon: Bug,           color: '#ef4444' },
  { id: 'feature',   label: 'Feature Request',  icon: Lightbulb,     color: '#f59e0b' },
  { id: 'ux',        label: 'UX / Design',       icon: Heart,         color: '#ec4899' },
  { id: 'ai',        label: 'AI Response',       icon: Zap,           color: '#8b5cf6' },
  { id: 'general',   label: 'General',           icon: MessageSquare, color: '#0ea5e9' },
];

const RATING_LABELS = ['', 'Terrible', 'Bad', 'Okay', 'Good', 'Excellent'];

export default function FeedbackModal({ isOpen, onClose, sessionId }) {
  // Form state
  const [rating, setRating]         = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [category, setCategory]     = useState('general');
  const [message, setMessage]       = useState('');
  const [screenshot, setScreenshot] = useState(null); // base64 dataUrl
  const [screenshotName, setScreenshotName] = useState('');

  // UI state
  const [phase, setPhase]     = useState('form'); // 'form' | 'submitting' | 'success' | 'error'
  const [shareUrl, setShareUrl]   = useState('');
  const [copyDone, setCopyDone]   = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [dragOver, setDragOver]   = useState(false);
  const [errorMsg, setErrorMsg]   = useState('');

  const fileInputRef   = useRef(null);
  const textareaRef    = useRef(null);
  const overlayRef     = useRef(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setRating(0);
      setHoverRating(0);
      setCategory('general');
      setMessage('');
      setScreenshot(null);
      setScreenshotName('');
      setPhase('form');
      setShareUrl('');
      setCopyDone(false);
      setErrorMsg('');
    }
  }, [isOpen]);

  // Focus textarea when form mounts
  useEffect(() => {
    if (isOpen && phase === 'form') {
      setTimeout(() => textareaRef.current?.focus(), 120);
    }
  }, [isOpen, phase]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && isOpen) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // ── Screenshot handling ──────────────────────────────────────────────────
  const handleFileSelect = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setScreenshot(e.target.result);
      setScreenshotName(file.name);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleCapture = useCallback(async () => {
    setCapturing(true);
    try {
      const dataUrl = await captureScreenshot();
      if (dataUrl) {
        setScreenshot(dataUrl);
        setScreenshotName('screen-capture.png');
      }
    } finally {
      setCapturing(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (rating === 0) { textareaRef.current?.focus(); return; }
    setPhase('submitting');
    try {
      const result = await submitFeedback({
        rating,
        category,
        message,
        screenshotDataUrl: screenshot,
        sessionId,
      });
      const url = buildShareUrl(result.share_id);
      setShareUrl(url);
      setPhase('success');
    } catch (err) {
      console.error('Feedback error:', err);
      setErrorMsg(err.message || 'Something went wrong. Please try again.');
      setPhase('error');
    }
  }, [rating, category, message, screenshot, sessionId]);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    });
  }, [shareUrl]);

  if (!isOpen) return null;

  const displayRating = hoverRating || rating;
  const activeCategory = CATEGORIES.find(c => c.id === category);

  return (
    <div
      className="fb-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Send Feedback"
    >
      <div className="fb-modal animate-fade-in">
        {/* Header */}
        <div className="fb-header">
          <div className="fb-header-left">
            <div className="fb-header-icon">💬</div>
            <div>
              <h2 className="fb-title">Send Feedback</h2>
              <p className="fb-subtitle">Help us build a better GameGuide-AI</p>
            </div>
          </div>
          <button className="fb-close" onClick={onClose} aria-label="Close feedback">
            <X size={18} />
          </button>
        </div>

        {/* ── Form Phase ── */}
        {phase === 'form' && (
          <form className="fb-body" onSubmit={handleSubmit}>
            {/* Rating */}
            <div className="fb-section">
              <label className="fb-label">How would you rate your experience?</label>
              <div className="fb-stars">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`fb-star ${n <= displayRating ? 'fb-star--lit' : ''}`}
                    onClick={() => setRating(n)}
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(0)}
                    aria-label={`Rate ${n} star${n > 1 ? 's' : ''}`}
                  >
                    <Star size={28} fill={n <= displayRating ? 'currentColor' : 'none'} />
                  </button>
                ))}
                {displayRating > 0 && (
                  <span className="fb-star-label animate-fade-in">{RATING_LABELS[displayRating]}</span>
                )}
              </div>
              {rating === 0 && (
                <span className="fb-required-hint">⚠ Please select a rating to submit</span>
              )}
            </div>

            {/* Category */}
            <div className="fb-section">
              <label className="fb-label">What type of feedback is this?</label>
              <div className="fb-categories">
                {CATEGORIES.map(cat => {
                  const Icon = cat.icon;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      className={`fb-cat-chip ${category === cat.id ? 'fb-cat-chip--active' : ''}`}
                      style={{ '--cat-color': cat.color }}
                      onClick={() => setCategory(cat.id)}
                    >
                      <Icon size={14} />
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Message */}
            <div className="fb-section">
              <label className="fb-label" htmlFor="fb-message">
                Describe the issue or suggestion
                <span className="fb-optional"> (optional)</span>
              </label>
              <textarea
                id="fb-message"
                ref={textareaRef}
                className="fb-textarea"
                placeholder={`Tell us more about your ${activeCategory?.label?.toLowerCase() || 'feedback'}…`}
                value={message}
                onChange={e => setMessage(e.target.value)}
                maxLength={2000}
                rows={4}
              />
              <span className="fb-char-count">{message.length}/2000</span>
            </div>

            {/* Screenshot */}
            <div className="fb-section">
              <label className="fb-label">Attach a screenshot <span className="fb-optional">(optional)</span></label>

              {screenshot ? (
                <div className="fb-screenshot-preview">
                  <img src={screenshot} alt="Screenshot preview" className="fb-screenshot-img" />
                  <div className="fb-screenshot-overlay">
                    <span className="fb-screenshot-name">📎 {screenshotName}</span>
                    <button
                      type="button"
                      className="fb-screenshot-remove"
                      onClick={() => { setScreenshot(null); setScreenshotName(''); }}
                    >
                      <X size={14} /> Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`fb-drop-zone ${dragOver ? 'fb-drop-zone--active' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <Upload size={22} className="fb-drop-icon" />
                  <span className="fb-drop-text">Drag & drop an image here</span>
                  <span className="fb-drop-or">or</span>
                  <div className="fb-screenshot-actions">
                    <button
                      type="button"
                      className="fb-action-btn"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload size={14} /> Upload File
                    </button>
                    <button
                      type="button"
                      className="fb-action-btn fb-action-btn--capture"
                      onClick={handleCapture}
                      disabled={capturing}
                    >
                      {capturing
                        ? <><Loader2 size={14} className="fb-spin" /> Capturing…</>
                        : <><Camera size={14} /> Capture Screen</>
                      }
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    aria-label="Upload screenshot image file"
                    tabIndex={-1}
                    onChange={e => handleFileSelect(e.target.files?.[0])}
                  />
                </div>
              )}
            </div>

            {/* ShareChat hint */}
            <div className="fb-sharechat-hint">
              <Share2 size={13} />
              A shareable link will be generated after submission so you can share or track this feedback.
            </div>

            {/* Footer */}
            <div className="fb-footer">
              <button type="button" className="fb-btn-secondary" onClick={onClose}>Cancel</button>
              <button
                type="submit"
                className="fb-btn-primary"
                disabled={rating === 0}
              >
                Send Feedback ✦
              </button>
            </div>
          </form>
        )}

        {/* ── Submitting Phase ── */}
        {phase === 'submitting' && (
          <div className="fb-state-screen">
            <div className="fb-spinner-ring">
              <Loader2 size={40} className="fb-spin" />
            </div>
            <p className="fb-state-title">Sending your feedback…</p>
            <p className="fb-state-sub">Uploading screenshot & generating your share link</p>
          </div>
        )}

        {/* ── Success Phase ── */}
        {phase === 'success' && (
          <div className="fb-state-screen">
            <div className="fb-success-ring">
              <CheckCircle size={44} />
            </div>
            <p className="fb-state-title">Feedback received! 🎉</p>
            <p className="fb-state-sub">
              Thanks for helping us improve. Your feedback directly shapes the next version of GameGuide-AI.
            </p>

            {shareUrl && (
              <div className="fb-share-box">
                <p className="fb-share-label">
                  <Share2 size={13} /> Your feedback share link
                </p>
                <div className="fb-share-row">
                  <code className="fb-share-url">{shareUrl}</code>
                  <button className="fb-copy-btn" onClick={handleCopyLink}>
                    {copyDone ? <CheckCircle size={15} /> : <Copy size={15} />}
                    {copyDone ? 'Copied!' : 'Copy'}
                  </button>
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="fb-open-btn"
                  >
                    <ExternalLink size={15} />
                  </a>
                </div>
              </div>
            )}

            <button className="fb-btn-primary" style={{ marginTop: '1.5rem' }} onClick={onClose}>
              Done
            </button>
          </div>
        )}

        {/* ── Error Phase ── */}
        {phase === 'error' && (
          <div className="fb-state-screen">
            <div className="fb-error-ring">
              <AlertCircle size={44} />
            </div>
            <p className="fb-state-title">Submission failed</p>
            <p className="fb-state-sub">{errorMsg}</p>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button className="fb-btn-secondary" onClick={onClose}>Cancel</button>
              <button className="fb-btn-primary" onClick={() => setPhase('form')}>Try Again</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
