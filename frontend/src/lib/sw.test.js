import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

function loadWorker(windows, cacheMocks = {}) {
  const listeners = {}
  const showNotification = vi.fn(async () => {})
  const skipWaiting = vi.fn()
  const store = new Map()
  const cache = {
    addAll: vi.fn(async entries => { entries.forEach(u => store.set(String(u), true)) }),
    match: vi.fn(async req => (store.has(String(req && req.url || req)) ? { ok: true } : undefined)),
    put: vi.fn(async (req, res) => { store.set(String(req && req.url || req), res) }),
    keys: vi.fn(async () => [...store.keys()]),
    delete: vi.fn(async req => store.delete(String(req && req.url || req))),
    ...cacheMocks,
  }
  const caches = {
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
    open: vi.fn(async () => cache),
  }
  const sandbox = {
    self: {
      addEventListener: (type, handler) => { listeners[type] = handler },
      skipWaiting,
      clients: { matchAll: vi.fn(async () => windows), claim: vi.fn(async () => {}) },
      registration: { showNotification },
    },
    caches,
    location: { origin: 'https://gym.example.com' },
    URL,
  }
  runInNewContext(source, sandbox)
  return { listeners, showNotification, skipWaiting, caches, cache, store }
}

const pushEvent = payload => {
  let promise
  return { data: { json: () => payload }, waitUntil: value => { promise = value }, get promise() { return promise } }
}

describe('service worker active inactivity ownership', () => {
  it('displays once even when an unrelated window is visible and informs all clients', async () => {
    const unrelated = { visibilityState: 'visible', postMessage: vi.fn() }
    const workout = { visibilityState: 'hidden', postMessage: vi.fn() }
    const worker = loadWorker([unrelated, workout])
    const event = pushEvent({
      kind: 'active-inactivity', sessionId: 'workout-a', tag: 'active-inactivity',
      title: 'Hforge', body: '¿Sigues ahí? Tu entrenamiento te espera.',
    })
    worker.listeners.push(event)
    await event.promise
    expect(unrelated.postMessage).toHaveBeenCalledWith({ type: 'hforge-push-displayed', payload: expect.objectContaining({ sessionId: 'workout-a' }) })
    expect(workout.postMessage).toHaveBeenCalledWith({ type: 'hforge-push-displayed', payload: expect.objectContaining({ sessionId: 'workout-a' }) })
    expect(worker.showNotification).toHaveBeenCalledTimes(1)
  })

  it('precaches the app shell on install without force-activating', async () => {
    const worker = loadWorker([])
    let promise
    worker.listeners.install({ waitUntil: value => { promise = value } })
    await promise
    const added = worker.cache.addAll.mock.calls[0][0].map(String)
    for (const entry of ['index.html', 'manifest.json', 'version.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
      expect(added).toContain(entry)
    }
    // Waiting is the default: activation needs explicit user approval.
    expect(worker.skipWaiting).not.toHaveBeenCalled()
  })

  it('activates only on an explicit SKIP_WAITING message', () => {
    const worker = loadWorker([])
    worker.listeners.message({ data: { type: 'SKIP_WAITING' } })
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1)
    worker.listeners.message({ data: { type: 'something-else' } })
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('clears unknown caches on activate but keeps the versioned set', async () => {
    const worker = loadWorker([])
    worker.caches.keys.mockResolvedValue(['hforge-pwa-v1-shell', 'hforge-pwa-v1-rt', 'hforge-pwa-v1-media', 'random-old'])
    let promise
    worker.listeners.activate({ waitUntil: value => { promise = value } })
    await promise
    expect(worker.caches.delete).toHaveBeenCalledTimes(1)
    expect(worker.caches.delete).toHaveBeenCalledWith('random-old')
  })

  it('never intercepts writes or API traffic', () => {
    const worker = loadWorker([])
    const fetchEvent = (method, url) => {
      const respondWith = vi.fn()
      worker.listeners.fetch({ request: { method, url, mode: 'cors', headers: { get: () => '' } }, respondWith })
      return respondWith
    }
    expect(fetchEvent('POST', 'https://gym.example.com/api/workouts')).not.toHaveBeenCalled()
    expect(fetchEvent('GET', 'https://gym.example.com/api/state')).not.toHaveBeenCalled()
    expect(fetchEvent('GET', 'https://cdn.example.com/img/x.gif')).not.toHaveBeenCalled()
  })

  it('shows the received localized copy verbatim only when no client is visible', async () => {
    const worker = loadWorker([{ visibilityState: 'hidden', postMessage: vi.fn() }])
    const event = pushEvent({
      kind: 'active-inactivity', sessionId: 'workout-a', tag: 'active-inactivity',
      title: 'Hforge', body: 'Still there? Your workout awaits.',
    })
    worker.listeners.push(event)
    await event.promise
    expect(worker.showNotification).toHaveBeenCalledWith('Hforge', expect.objectContaining({
      body: 'Still there? Your workout awaits.', renotify: false,
    }))
  })
})
