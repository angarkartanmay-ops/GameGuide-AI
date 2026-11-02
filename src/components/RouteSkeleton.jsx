import React from 'react';

/**
 * Shown for the moment a view's chunk is on its way (App.jsx). The shape of
 * a page (a top bar, a headline, two lines of text) rather than a spinner, so
 * the swap to the real view doesn't jump. Shapes only: nothing here can be
 * mistaken for content, and screen readers just hear "Loading".
 */
export default function RouteSkeleton() {
  return (
    <div className="route-skeleton" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="route-skeleton__bar" aria-hidden="true"><i style={{ width: 132 }} /><i style={{ width: 88 }} /></div>
      <div className="route-skeleton__body" aria-hidden="true">
        <span className="is-kicker" style={{ width: 'min(180px, 40%)' }} />
        <span className="is-title" style={{ width: 'min(640px, 90%)' }} />
        <span className="is-title" style={{ width: 'min(480px, 70%)' }} />
        <span style={{ width: 'min(520px, 80%)' }} />
        <span style={{ width: 'min(400px, 62%)' }} />
      </div>
    </div>
  );
}
