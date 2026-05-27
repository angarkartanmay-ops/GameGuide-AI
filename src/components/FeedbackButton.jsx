import React, { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import FeedbackModal from './FeedbackModal';

/**
 * Floating feedback trigger button.
 * Renders a pill button fixed to the bottom-right of the viewport.
 * Clicking it opens the FeedbackModal.
 */
export default function FeedbackButton({ sessionId }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        id="feedback-trigger-btn"
        type="button"
        className="fb-trigger-btn"
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
