import { Component } from 'react';
import { reportError } from '../utils/analytics';

const changed = (a = [], b = []) => a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

// A render error unmounts everything under it. Boundaries exist at three
// sizes, so one failure costs only what it has to:
//   * no props    the last line of defence (main.jsx): the whole page is a
//                 plain "that page broke" screen. Styled inline on purpose:
//                 if the stylesheet or theme code is what broke, it must
//                 still read.
//   * `fallback`  one view, one answer, one landing section: whatever it
//                 returns is shown in place, and the rest keeps working.
//                 A function gets { error, reset }.
//   * `scope`     names the boundary in crash reports.
// `resetKeys` clears the failure when any value in it changes (a new view, a
// finished answer), so a boundary is not stuck once what broke it is gone.
export default class ErrorBoundary extends Component {
  state = { failed: false, error: null };

  static getDerivedStateFromError(error) {
    return { failed: true, error };
  }

  componentDidCatch(error) {
    reportError(error, this.props.scope);
  }

  componentDidUpdate(prev) {
    if (this.state.failed && changed(prev.resetKeys, this.props.resetKeys)) this.reset();
  }

  reset = () => this.setState({ failed: false, error: null });

  render() {
    if (!this.state.failed) return this.props.children;
    const { fallback } = this.props;
    if (typeof fallback === 'function') return fallback({ error: this.state.error, reset: this.reset });
    if (fallback !== undefined) return fallback;
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
