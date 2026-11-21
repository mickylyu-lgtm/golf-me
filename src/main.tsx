import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Import via Vite so Fontsource’s relative URLs resolve inside its package.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { installPerfHud } from './lib/perfHud.ts'
import { installAppearance } from './lib/useAppearance.ts'
import { installTapFeedback } from './lib/tapFeedback.ts'

// Opt-in measurement overlay (localStorage.gmPerfHud = "1" or ?perfhud=1); no-op otherwise.
installPerfHud()
// Light / Dark / Match iPhone (Settings -> Appearance); index.html already
// applied it before first paint, this keeps it live.
installAppearance()
// Native-app tap haptics: one delegated click listener (lib/tapFeedback).
installTapFeedback()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
