import React, { useState, useRef, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import ThemeSelector from './ThemeSelector';
import UserProfile from './UserProfile';

/**
 * MobileMenu — hamburger-triggered bottom drawer for mobile nav controls.
 * Renders ThemeSelector + UserProfile inside a slide-up sheet.
 */
export default function MobileMenu({ currentTheme, onThemeChange }) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef(null);

  // Close on outside tap
  useEffect(() => {
    if (!open) return;
    const handleTap = (e) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleTap);
    document.addEventListener('touchstart', handleTap);
    return () => {
      document.removeEventListener('mousedown', handleTap);
      document.removeEventListener('touchstart', handleTap);
    };
  }, [open]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      <button
        className="mobile-menu-btn glass-panel"
        onClick={() => setOpen(v => !v)}
        aria-label="Open menu"
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>

      {/* Backdrop */}
      {open && <div className="mobile-menu-backdrop" onClick={() => setOpen(false)} />}

      {/* Bottom Sheet */}
      <div className={`mobile-menu-sheet glass-panel ${open ? 'open' : ''}`} ref={sheetRef}>
        <div className="mobile-menu-handle" />
        <div className="mobile-menu-section">
          <p className="mobile-menu-label">Theme</p>
          <ThemeSelector currentTheme={currentTheme} onThemeChange={(t) => { onThemeChange(t); setOpen(false); }} />
        </div>
        <div className="mobile-menu-section">
          <p className="mobile-menu-label">Account</p>
          <UserProfile />
        </div>
      </div>
    </>
  );
}
