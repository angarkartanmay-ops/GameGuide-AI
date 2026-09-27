// The seven selectable themes, in one place.
//
// Each entry carries its primary + secondary accent so callers (App.jsx) can
// drive the transition overlay without re-reading CSS vars after the swap.
// Keep these hexes in sync with the [data-theme] blocks in index.css.
//
// They live outside ThemeSelector.jsx so that component file exports only a
// component — otherwise editing it drops React Fast Refresh in dev.

export const themes = [
  { id: 'nightblade', label: 'NIGHTBLADE',  tag: 'Synthwave',  accent: '#ff2d95', accent2: '#a855f7' },
  { id: 'redline',    label: 'REDLINE',     tag: 'Apex Racing', accent: '#dc2626', accent2: '#cbd5e1' },
  { id: 'blackice',   label: 'BLACK ICE',   tag: 'Tactical',   accent: '#0ea5e9', accent2: '#fbbf24' },
  { id: 'ghostline',  label: 'GHOSTLINE',   tag: 'Cosmic',     accent: '#67e8f9', accent2: '#c4b5fd' },
  { id: 'biohazard',  label: 'BIOHAZARD',   tag: 'Fallout',    accent: '#84cc16', accent2: '#facc15' },
  { id: 'warspire',   label: 'WARSPIRE',    tag: 'War Banner', accent: '#f59e0b', accent2: '#6366f1' },
  { id: 'dreadcore',  label: 'DREADCORE',   tag: 'Obsidian',   accent: '#8b5cf6', accent2: '#fef3c7' },
];

export const THEME_IDS = themes.map((t) => t.id);
