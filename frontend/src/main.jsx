import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { getLang, setLang } from './lib/i18n.js'
import { registerPwa } from './lib/pwa.js'
import { removeSplashOnNextFrame } from './lib/boot.js'
import './index.css'

// Deferred work (PWA registration, version prefetch) must never delay first
// paint: requestIdleCallback when available, setTimeout as the fallback.
function deferIdle(task) {
  const run = () => { try { task() } catch { /* deferred work never breaks boot */ } }
  try {
    if (typeof requestIdleCallback === 'function') { requestIdleCallback(run, { timeout: 2000 }); return }
  } catch { /* fall through to the timer fallback */ }
  setTimeout(run, 0)
}

function bootstrap() {
  // Start locale loading before scheduling React so the common case can settle
  // before the first login commit without delaying boot on a slow/offline device.
  // App still re-renders through useLang when the pack lands; setLang keeps its
  // 4s timeout and falls back to English on any error.
  setLang(getLang()).catch(() => setLang('en'))

  try {
    createRoot(document.getElementById('root')).render(
      <StrictMode><App /></StrictMode>
    )
  } catch {
    // A failed mount must never trap the user on the splash logo.
  } finally {
    removeSplashOnNextFrame()
  }

  // PWA registration (mobile-build and secure-origin guards live in registerPwa).
  // Update UX is user-approved: the banner in App.jsx offers the reload moment.
  deferIdle(() => registerPwa())
}

bootstrap()
