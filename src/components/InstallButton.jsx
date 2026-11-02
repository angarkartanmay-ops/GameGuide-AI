import React, { useEffect, useId, useRef, useState } from 'react';
import { Share, X } from 'lucide-react';
import useInstallPrompt from '../hooks/useInstallPrompt';
import { track } from '../utils/analytics';

/**
 * "Install app" where the browser can do it, the same button opening the two
 * "Add to Home Screen" steps where it can't (iOS), and nothing where it can't
 * at all or the app is already installed. A quiet link, not a banner: it takes its look from the
 * footer row it sits in (the chat's, or the site's), through `className`.
 */
export default function InstallButton({ className = '' }) {
  const { mode, install } = useInstallPrompt();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const hintId = useId();

  // Esc and a press outside close the hint; focus goes back to the button.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointer = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  if (!mode) return null;

  const onClick = () => {
    if (mode === 'prompt') { install(); return; }
    setOpen((o) => {
      if (!o) track('install_hint');
      return !o;
    });
  };

  return (
    // A div, not a span: the chat's phone footer hides every span in it.
    <div ref={rootRef} className="gg-install">
      <button
        ref={triggerRef}
        type="button"
        className={className}
        onClick={onClick}
        aria-expanded={mode === 'ios' ? open : undefined}
        aria-controls={mode === 'ios' && open ? hintId : undefined}
      >
        Install app
      </button>
      {mode === 'ios' && open && (
        <div id={hintId} className="gg-install__hint" role="group" aria-label="How to add GameGuide to your Home Screen">
          <p className="gg-install__title">Add GameGuide to your Home Screen</p>
          <ol>
            <li>Tap <Share size={15} aria-hidden="true" /> <b>Share</b> in the browser bar.</li>
            <li>Choose <b>Add to Home Screen</b>.</li>
          </ol>
          <button type="button" className="gg-install__close" onClick={() => { setOpen(false); triggerRef.current?.focus(); }} aria-label="Close">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
