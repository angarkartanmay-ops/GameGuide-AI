// Constants for the theme-swap overlay, kept out of ThemeTransition.jsx so
// that file exports only a component (React Fast Refresh needs that).

export const VARIANTS = ['aurora', 'scan', 'focus', 'drift'];

// Cap covers the longest variant (PARTICLE DRIFT, ~1500ms) plus a margin.
export const THEME_TRANSITION_DURATION = 1600;
