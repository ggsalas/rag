import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { syncFaviconWithColorScheme } from './lib/favicon'
import './index.css'

syncFaviconWithColorScheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
