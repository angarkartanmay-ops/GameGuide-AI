import React from 'react';
import { pathForView } from '../site/route';

/**
 * A link to one of the app's own pages. It is a real <a href="/about">, so a
 * crawler can follow it, "open in new tab" works and the address shows on
 * hover; an ordinary click is handled in the app instead of reloading.
 * Modified clicks (new tab, new window, download) are left to the browser.
 */
export default function NavLink({ view, onNavigate, onClick, children, ...rest }) {
  const handle = (e) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !onNavigate) return;
    e.preventDefault();
    onNavigate(view);
  };
  return <a href={pathForView(view) || '/'} onClick={handle} {...rest}>{children}</a>;
}
