import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { getLang, setLang } from './lib/i18n.js'
import { registerPwa } from './lib/pwa.js'
import './index.css'

async function bootstrap() {
  // Load the detected locale before React mounts so the login never paints English for one frame.
  // setLang has a bounded pack timeout and falls back to English on any loading error.
  try { await setLang(getLang()) } catch { await setLang('en') }

  createRoot(document.getElementById('root')).render(
    <StrictMode><App /></StrictMode>
  )

  // PWA registration (mobile-build and secure-origin guards live in registerPwa).
  // Update UX is user-approved: the banner in App.jsx offers the reload moment.
  registerPwa()
}

void bootstrap()
