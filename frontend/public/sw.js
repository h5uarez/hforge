/* Hforge service worker — runtime caching (works with Vite's hashed asset names).
   Media (img/gif) cache-first; everything else network-first with offline fallback. */
// Legacy compatibility identifier: keep the existing cache namespace stable.
const CACHE = 'opengym-rt-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()))
})
self.addEventListener('push', e => {
  let data = {}
  try {
    const parsed = e.data ? e.data.json() : {}
    data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { data = {} }
  const activeInactivity = data && data.kind === 'active-inactivity'
  const broadcastDisplayedPush = async () => {
    if (!activeInactivity) return null
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    windows.forEach(client => client.postMessage({ type: 'hforge-push-displayed', payload: data }))
    return windows
  }
  e.waitUntil(broadcastDisplayedPush().then(() => self.registration.showNotification(typeof data.title === 'string' ? data.title : 'Hforge', {
      body: typeof data.body === 'string' ? data.body : '',
      icon: 'icon-512.png',
      badge: 'icon-180.png',
      // Legacy compatibility identifier: keep the existing notification tag stable.
      tag: data.tag || 'opengym',
      renotify: activeInactivity ? false : true,
      data: activeInactivity ? { kind: data.kind, sessionId: data.sessionId } : undefined
    })))
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    const c = clients.find(c => 'focus' in c)
    return c ? c.focus() : self.clients.openWindow('./')
  }))
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return    // never cache auth/data

  const isMedia = url.pathname.includes('/img/') || url.pathname.includes('/gif/')
  if (isMedia) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res })
    )))
  } else {
    e.respondWith(fetch(e.request).then(res => {
      // Clone before returning the response: the page may consume its body immediately.
      // Cache failures are best-effort and must not become unhandled service-worker errors.
      if (res.ok) {
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {})
      }
      return res
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html'))))
  }
})
