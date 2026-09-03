// Web Push subscribe/unsubscribe — requires a signed-in profile (subscriptions are stored
// server-side per user, same as everything else under /api).
import { api } from './api.js'
import { t } from './i18n.js'

export const pushSupported = () => typeof navigator !== 'undefined' && typeof window !== 'undefined'
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const pushPermission = () => (pushSupported() ? Notification.permission : 'unsupported')

// Web Push needs a secure context and a service-worker-capable browser. Localhost is the browser
// standard's development exception; every other HTTP origin stays foreground-only.
export const pushPathCapable = () => {
  if (!pushSupported()) return false
  const protocol = globalThis.location?.protocol
  const hostname = globalThis.location?.hostname
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  return protocol === 'https:' || (protocol === 'http:' && local)
}

const urlBase64ToUint8Array = b64 => {
  const padded = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export async function enablePush() {
  // Throws carry t()-rendered text (English source strings as keys) so the display site's
  // t(e.message) keeps them localized — Spanish under es, the source string under en.
  if (!pushSupported()) throw new Error(t('Push notifications are not supported in this browser'))
  if (!pushPathCapable()) throw new Error(t('Push notifications require HTTPS or localhost'))
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error(t('Notifications permission was not granted'))
  const reg = await navigator.serviceWorker.ready
  const { key } = await api('/api/push/public-key')
  const subscription = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key)
  })
  await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) })
  try { globalThis.dispatchEvent?.(new Event('hforge-push-changed')) } catch { /* optional browser event */ }
}

export async function disablePush() {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await sub.unsubscribe()
  await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
  try { globalThis.dispatchEvent?.(new Event('hforge-push-changed')) } catch { /* optional browser event */ }
}

export const sendTestPush = () => api('/api/push/test', { method: 'POST', body: '{}' })

export async function scheduleInactivityPush({ sessionId, deadline, locale }) {
  if (!pushPathCapable() || pushPermission() !== 'granted') return { status: 'unavailable' }
  const reg = await navigator.serviceWorker.ready
  if (!await reg.pushManager.getSubscription()) return { status: 'unavailable' }
  return api('/api/push/inactivity/schedule', {
    method: 'POST', body: JSON.stringify({ sessionId, deadline, locale })
  })
}

export const cancelInactivityPush = sessionId => api('/api/push/inactivity/cancel', {
  method: 'POST', body: JSON.stringify({ sessionId })
})

export const recoverInactivityPush = sessionId => api('/api/push/inactivity/recover', {
  method: 'POST', body: JSON.stringify({ sessionId })
})

export const statusInactivityPush = sessionId => api('/api/push/inactivity/status?sessionId=' + encodeURIComponent(sessionId))
