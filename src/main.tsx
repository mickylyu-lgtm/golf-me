import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { installPerfHud } from './lib/perfHud.ts'

// Opt-in measurement overlay (localStorage.gmPerfHud = "1" or ?perfhud=1); no-op otherwise.
installPerfHud()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
