import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Palette } from 'lucide-react';

const themes = [
  { id: 'default', label: 'Cyberpunk 2077', emoji: '🌆' },
  { id: 'matrix', label: 'Fallout', emoji: '☢️' },
  { id: 'stealth', label: 'Valorant', emoji: '🎯' },
  { id: 'neon-tokyo', label: 'Subway Surfers', emoji: '🛹' },
  { id: 'arctic', label: 'Halo', emoji: '🪖' },
  { id: 'minecraft', label: 'Minecraft', emoji: '⛏️' },
  { id: 'rocket-league', label: 'Rocket League', emoji: '🚀' },
];

export default function ThemeSelector({ currentTheme, onThemeChange }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  const currentLabel = themes.find(t => t.id === currentTheme)?.label || 'Theme';
  const currentEmoji = themes.find(t => t.id === currentTheme)?.emoji || '🎨';

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

  const handleSelect = (themeId) => {
    onThemeChange(themeId);
    setOpen(false);
  };

  return (
    <div className="theme-dropdown" ref={dropdownRef}>
      <button
        className="theme-dropdown-trigger glass-panel"
        onClick={() => setOpen(!open)}
      >
        <Palette size={16} />
        <span>{currentEmoji} {currentLabel}</span>
        <ChevronDown size={14} className={`dropdown-chevron ${open ? 'rotated' : ''}`} />
      </button>

      {open && (
        <div className="theme-dropdown-menu glass-panel animate-fade-in">
          {themes.map((theme) => (
            <button
              key={theme.id}
              className={`theme-dropdown-item ${currentTheme === theme.id ? 'active' : ''}`}
              onClick={() => handleSelect(theme.id)}
            >
              <span className="theme-dropdown-emoji">{theme.emoji}</span>
              <span className="theme-dropdown-label">{theme.label}</span>
              {currentTheme === theme.id && <span className="theme-dropdown-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
