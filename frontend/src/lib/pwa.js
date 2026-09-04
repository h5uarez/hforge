// PWA helpers: standalone detection, install prompt capture, and the
// service-worker update handshake. The update flow never reloads on its own:
// the page learns a waiting worker exists (onSwUpdate), shows the banner, and
// only after the user confirms does applyWaitingUpdate() activate it.
import { MOBILE } from './mobile.js'

let waitingWorker = null
const updateListeners = new Set()
let deferredInstallPrompt = null
const installListeners = new Set()

function notifyUpdates() {
  updateListeners.forEach(cb => { try { cb(waitingWorker) } catch { /* listener-owned */ } })
}

function notifyInstall() {
  installListeners.forEach(cb => { try { cb(deferredInstallPrompt) } catch { /* listener-owned */ } })
}

if (typeof window !== 'undefined') {
  // Chromium install prompt: captured once, fired later from Settings UX.
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferredInstallPrompt = e
    notifyInstall()
  })
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null
    notifyInstall()
  })
}

// Browser tab vs installed/full-screen surface (covers iOS Safari + Android/ desktop).
export function isStandalone(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win || !win.matchMedia) return (win?.navigator?.standalone === true) || false
  return win.matchMedia('(display-mode: standalone)').matches ||
    win.matchMedia('(display-mode: fullscreen)').matches ||
    win.navigator?.standalone === true
}

export function displayMode(win) {
  return isStandalone(win) ? 'standalone' : 'browser'
}

// Pure decision helper for the update banner: a pending update during an active
// workout must inform but never push a reload — the user reloads explicitly.
export function describeUpdateState({ hasUpdate, workoutActive }) {
  if (!hasUpdate) return 'none'
  return workoutActive ? 'deferred' : 'ready'
}

export function onSwUpdate(cb) {
  updateListeners.add(cb)
  if (waitingWorker) { try { cb(waitingWorker) } catch { /* listener-owned */ } }
  return () => updateListeners.delete(cb)
}

export function onCanInstall(cb) {
  installListeners.add(cb)
  if (deferredInstallPrompt) { try { cb(deferredInstallPrompt) } catch { /* listener-owned */ } }
  return () => installListeners.delete(cb)
}

export function canInstall() {
  return !!deferredInstallPrompt
}

// Fires the captured install prompt. Returns true when the user accepted.
export async function promptInstall() {
  if (!deferredInstallPrompt) return false
  const prompt = deferredInstallPrompt
  deferredInstallPrompt = null
  notifyInstall()
  prompt.prompt()
  try {
    const choice = await prompt.userChoice
    return choice?.outcome === 'accepted'
  } catch { return false }
}

// Activates the waiting worker and reloads exactly once it takes control.
// Never called without an explicit user confirmation in the banner.
export function applyWaitingUpdate() {
  const worker = waitingWorker
  if (!worker) return false
  let reloaded = false
  const reloadOnce = () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', reloadOnce, { once: true })
    // Safety net: if the controller never changes (worker failed), don't hang.
    setTimeout(reloadOnce, 4000)
  } else {
    setTimeout(reloadOnce, 0)
  }
  try { worker.postMessage({ type: 'SKIP_WAITING' }) } catch { reloadOnce() }
  return true
}

export function registerPwa({ onUpdate } = {}) {
  // Not in the mobile build: the native shell already serves everything from disk.
  if (MOBILE || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const localPushOrigin = location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  if (location.protocol !== 'https:' && !localPushOrigin) return
  const notify = worker => {
    waitingWorker = worker
    notifyUpdates()
    if (onUpdate) { try { onUpdate(worker) } catch { /* caller-owned */ } }
  }
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (reg.waiting) notify(reg.waiting)
    reg.addEventListener('updatefound', () => {
      const next = reg.installing
      if (!next) return
      next.addEventListener('statechange', () => {
        if (next.state === 'installed' && navigator.serviceWorker.controller) notify(next)
      })
    })
  }).catch(() => {})
}

export async function appVersion() {
  try {
    const res = await fetch('version.json', { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.version === 'string' ? data.version : null
  } catch { return null }
}
