import { Component } from 'react';
import { reportError } from '../utils/analytics';

// Last line of defence: without this, one render error unmounts the whole app
// and the player is left with a blank page. Styled inline on purpose — if the
// stylesheet or theme code is what broke, this screen must still read.
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    reportError(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '0 20px',
          background: '#07090d', color: '#ece6da', font: '16px/1.6 system-ui, sans-serif',
        }}
      >
        <div style={{ maxWidth: 520 }}>
          <h1 style={{ fontWeight: 500, margin: '0 0 8px' }}>That page broke.</h1>
          <p style={{ margin: '0 0 20px', opacity: 0.8 }}>
            Your chats are safe. Reload and it should come back; if it keeps happening, tell us in Discord.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              font: 'inherit', color: '#07090d', background: '#ece6da', border: 0,
              borderRadius: 8, padding: '10px 18px', cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
