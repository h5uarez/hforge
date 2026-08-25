import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { getLang, setLang } from './lib/i18n.js'
import './index.css'

async function bootstrap() {
  // Load the detected locale before React mounts so the login never paints English for one frame.
  // setLang has a bounded pack timeout and falls back to English on any loading error.
  try { await setLang(getLang()) } catch { await setLang('en') }

  createRoot(document.getElementById('root')).render(
    <StrictMode><App /></StrictMode>
  )

  // Not in the mobile build: the native shell already serves everything from disk.
  if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {})
  }
}

void bootstrap()
