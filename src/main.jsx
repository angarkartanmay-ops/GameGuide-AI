import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { initAnalytics } from './utils/analytics'
import { installChunkReload } from './utils/chunkReload'

// Inert until VITE_ANALYTICS / VITE_POSTHOG_KEY / VITE_SENTRY_DSN are set
// (see utils/analytics.js).
initAnalytics()
// A tab left open across a deploy: reload once to pick up the new build.
installChunkReload()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
