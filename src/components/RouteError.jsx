import React from 'react';

/**
 * What a view shows when it could not load or crashed while drawing: a way
 * out instead of a blank page. App.jsx puts it in place of just that view,
 * so the app around it (and any chat in progress) is untouched.
 */
export default function RouteError({ onHome }) {
  return (
    <main className="route-error" role="alert">
      <div className="route-error__box">
        <h1>That page didn&rsquo;t load.</h1>
        <p>
          It may be your connection, or a new version of GameGuide went live while this tab was open.
          Reloading usually fixes it.
        </p>
        <div className="route-error__actions">
          <button type="button" className="is-primary" onClick={() => window.location.reload()}>Reload</button>
          <button type="button" onClick={onHome}>Go to the home page</button>
        </div>
      </div>
    </main>
  );
}
