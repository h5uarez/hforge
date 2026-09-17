import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { getLang, setLang } from './lib/i18n.js'
import { registerPwa } from './lib/pwa.js'
import './index.css'

function removeSplash() {
  document.getElementById('splash')?.remove()
}

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
  // Mount React immediately so first paint comes from the localStorage cache.
  // The locale pack resolves async afterwards; useLang in App re-renders when
  // it lands. Accepted tradeoff: an `es` device may paint one frame of English
  // before the Spanish pack arrives — speed now wins over that single frame.
  // setLang keeps its 4s pack timeout and falls back to English on any error.
  // Start the pack request before scheduling React so the common case can settle
  // before the first login commit without delaying boot on a slow/offline device.
  setLang(getLang()).catch(() => setLang('en'))

  try {
    createRoot(document.getElementById('root')).render(
      <StrictMode><App /></StrictMode>
    )
  } catch {
    // A failed mount must never trap the user on the splash logo.
  } finally {
    removeSplash()
  }

  // PWA registration (mobile-build and secure-origin guards live in registerPwa).
  // Update UX is user-approved: the banner in App.jsx offers the reload moment.
  deferIdle(() => registerPwa())
}

bootstrap()
