import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Palette } from 'lucide-react';

// Each entry carries its primary + secondary accent so callers (App.jsx) can
// drive the transition overlay without re-reading CSS vars after the swap.
// Keep these hexes in sync with index.css [data-theme] blocks.
const themes = [
  { id: 'nightblade', label: 'NIGHTBLADE',  tag: 'Synthwave',  accent: '#ff2d95', accent2: '#a855f7' },
  { id: 'redline',    label: 'REDLINE',     tag: 'Apex Racing', accent: '#dc2626', accent2: '#cbd5e1' },
  { id: 'blackice',   label: 'BLACK ICE',   tag: 'Tactical',   accent: '#0ea5e9', accent2: '#fbbf24' },
  { id: 'ghostline',  label: 'GHOSTLINE',   tag: 'Cosmic',     accent: '#67e8f9', accent2: '#c4b5fd' },
  { id: 'biohazard',  label: 'BIOHAZARD',   tag: 'Fallout',    accent: '#84cc16', accent2: '#facc15' },
  { id: 'warspire',   label: 'WARSPIRE',    tag: 'War Banner', accent: '#f59e0b', accent2: '#6366f1' },
  { id: 'dreadcore',  label: 'DREADCORE',   tag: 'Obsidian',   accent: '#8b5cf6', accent2: '#fef3c7' },
];
const THEME_IDS = themes.map((t) => t.id);
export { THEME_IDS, themes };

export default function ThemeSelector({ currentTheme, onThemeChange }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  const active = themes.find(t => t.id === currentTheme);
  const currentLabel = active?.label || 'THEME';

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Forward the pointer event so the parent can radiate the transition from
  // the actual click point. Keyboard / programmatic selection falls back to
  // viewport center in App.jsx.
  const handleSelect = (themeId, event) => {
    onThemeChange(themeId, event);
    setOpen(false);
  };

  return (
    <div className="theme-dropdown" ref={dropdownRef}>
      <button
        className="theme-dropdown-trigger glass-panel"
        onClick={() => setOpen(!open)}
      >
        <Palette size={16} />
        <span className="theme-dropdown-trigger__label">{currentLabel}</span>
        <ChevronDown size={14} className={`dropdown-chevron ${open ? 'rotated' : ''}`} />
      </button>

      {open && (
        <div className="theme-dropdown-menu glass-panel animate-fade-in">
          {themes.map((theme) => (
            <button
              key={theme.id}
              className={`theme-dropdown-item ${currentTheme === theme.id ? 'active' : ''}`}
              onClick={(e) => handleSelect(theme.id, e)}
              style={{ '--theme-accent': theme.accent, '--theme-accent-2': theme.accent2 }}
            >
              <span className="theme-dropdown-swatch" aria-hidden="true">
                <span className="theme-dropdown-swatch__a" style={{ background: theme.accent }} />
                <span className="theme-dropdown-swatch__b" style={{ background: theme.accent2 }} />
              </span>
              <span className="theme-dropdown-body">
                <span className="theme-dropdown-label">{theme.label}</span>
                <span className="theme-dropdown-tag">{theme.tag}</span>
              </span>
              {currentTheme === theme.id && <span className="theme-dropdown-check">●</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
