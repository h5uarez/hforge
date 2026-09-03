import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

function loadWorker(windows) {
  const listeners = {}
  const showNotification = vi.fn(async () => {})
  const sandbox = {
    self: {
      addEventListener: (type, handler) => { listeners[type] = handler },
      skipWaiting: vi.fn(),
      clients: { matchAll: vi.fn(async () => windows), claim: vi.fn(async () => {}) },
      registration: { showNotification },
    },
    caches: { keys: vi.fn(async () => []), delete: vi.fn(async () => true), open: vi.fn() },
    location: { origin: 'https://gym.example.com' },
    URL,
  }
  runInNewContext(source, sandbox)
  return { listeners, showNotification }
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
