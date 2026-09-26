import React, { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import FeedbackModal from './FeedbackModal';

/**
 * Floating feedback trigger button.
 * A pill fixed to the bottom-right of the viewport, or (inline) a quiet link
 * in the chat's footer row — the pill would sit on top of the command bar.
 * Clicking it opens the FeedbackModal.
 */
export default function FeedbackButton({ sessionId, inline = false }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        id="feedback-trigger-btn"
        type="button"
        className={inline ? 'cx-foot__feedback' : 'fb-trigger-btn'}
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        title="Send Feedback"
      >
        <MessageSquarePlus size={18} />
        <span className="fb-trigger-label">Feedback</span>
      </button>

      <FeedbackModal
        isOpen={open}
        onClose={() => setOpen(false)}
        sessionId={sessionId}
      />
    </>
  );
}
