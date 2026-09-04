/* Hforge service worker — versioned caching with a user-approved update handshake.
   Cache layout (all namespaced by SW_VERSION, so a new deploy never shares
   entries with the previous one):
     <v>-shell   — precached app shell: index.html, manifest, version, icons.
     <v>-rt      — runtime: hashed js/css/fonts, stale-while-revalidate.
     <v>-media   — exercise img/gif, cache-first with a bounded entry count.
   Update policy: the new worker installs in the background and WAITS. It only
   activates after the page asks (SKIP_WAITING message sent from the update
   banner the user confirmed), so an old client is never swapped for new assets
   mid-workout. Auth/data (/api/) and non-GET requests are never cached. */
// Bump together with frontend releases so old clients detect the new worker.
const SW_VERSION = 'hforge-pwa-v1'
const SHELL_CACHE = SW_VERSION + '-shell'
const RUNTIME_CACHE = SW_VERSION + '-rt'
const MEDIA_CACHE = SW_VERSION + '-media'
const ALL_CACHES = [SHELL_CACHE, RUNTIME_CACHE, MEDIA_CACHE]
const MAX_MEDIA_ENTRIES = 120

// Legacy compatibility identifier: keep the pre-existing runtime cache namespace
// readable so media already cached by older installs keeps working after update.
const LEGACY_CACHE = 'opengym-rt-v1'

// App shell: everything the app needs to reopen offline once loaded.
const SHELL = [
  'index.html',
  'manifest.json',
  'version.json',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
]

self.addEventListener('install', e => {
  // Precache the shell, then wait: activation happens only on user approval
  // (the page sends SKIP_WAITING after the user confirms the update banner).
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).catch(() => {}))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => !ALL_CACHES.includes(k) && k !== LEGACY_CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()))
})

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting()
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

function trimMedia() {
  caches.open(MEDIA_CACHE).then(c => c.keys().then(keys => {
    if (keys.length > MAX_MEDIA_ENTRIES) c.delete(keys[0]).catch(() => {})
  })).catch(() => {})
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return    // never cache auth/data

  const isMedia = url.pathname.includes('/img/') || url.pathname.includes('/gif/')
  if (isMedia) {
    e.respondWith(caches.open(MEDIA_CACHE).then(c => c.match(e.request).then(hit => {
      if (hit) return hit
      return fetch(e.request).then(res => {
        if (res.ok) { c.put(e.request, res.clone()).catch(() => {}); trimMedia() }
        return res
      })
    })))
    return
  }

  const isNavigation = e.request.mode === 'navigate' ||
    (e.request.headers.get('accept') || '').includes('text/html')
  if (isNavigation) {
    // Network-first so updates show up immediately; the precached shell keeps
    // an already-loaded app reopenable offline.
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone()
        caches.open(SHELL_CACHE).then(c => c.put('index.html', copy)).catch(() => {})
      }
      return res
    }).catch(() => caches.match('index.html', { cacheName: SHELL_CACHE }).then(hit => hit || caches.match('index.html'))))
    return
  }

  // Hashed js/css/fonts: stale-while-revalidate — instant paint, fresh next time.
  e.respondWith(caches.open(RUNTIME_CACHE).then(c => c.match(e.request).then(hit => {
    const network = fetch(e.request).then(res => {
      if (res.ok) c.put(e.request, res.clone()).catch(() => {})
      return res
    }).catch(() => hit)
    return hit || network
  })))
})
