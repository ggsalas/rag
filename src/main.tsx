import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { syncFaviconWithColorScheme } from './lib/favicon'
import './index.css'

syncFaviconWithColorScheme()

// Dev-only diagnostic tools (exposes window.__rag for browser console)
if (import.meta.env.DEV) {
  import('./dev-tools').then((mod) => mod.registerDevTools())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
