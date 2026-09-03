import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const { api, beep, vibrate } = vi.hoisted(() => ({
  api: vi.fn(() => Promise.resolve({})), beep: vi.fn(), vibrate: vi.fn(),
}))
vi.mock('./api.js', () => ({ api }))
vi.mock('./sound.js', () => ({ beep, vibrate }))

const setNavigator = value =>
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })

function fakeBrowser() {
  // No serviceWorker / PushManager / Notification → pushSupported() is false, which is
  // exactly the failure path whose message must resolve through t().
  globalThis.window = {}
  setNavigator({ userAgent: 'node-test', languages: ['en-US'], language: 'en-US' })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  })
  globalThis.document = { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible' }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete globalThis.localStorage
  delete globalThis.document
  delete globalThis.navigator
  delete globalThis.window
})

describe('durable web inactivity push client API', () => {
  let subscription
  let registration

  beforeEach(() => {
    vi.resetModules()
    subscription = { endpoint: 'https://push.example/client', toJSON: () => ({ endpoint: 'https://push.example/client' }) }
    registration = { pushManager: { getSubscription: vi.fn(async () => subscription) } }
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(registration) } })
    vi.stubGlobal('window', { PushManager: function PushManager() {}, Notification: { permission: 'granted' } })
    vi.stubGlobal('Notification', { permission: 'granted' })
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'gym.example.com' })
    api.mockReset()
    api.mockResolvedValue({ ok: true, status: 'pending' })
  })

  it('allows HTTPS and localhost but not plain LAN HTTP', async () => {
    const { pushPathCapable } = await import('./push.js')
    expect(pushPathCapable()).toBe(true)
    location.protocol = 'http:'
    location.hostname = 'localhost'
    expect(pushPathCapable()).toBe(true)
    location.hostname = '192.168.1.20'
    expect(pushPathCapable()).toBe(false)
  })

  it('schedules only with an active browser subscription and sends bounded metadata', async () => {
    const { scheduleInactivityPush } = await import('./push.js')
    await scheduleInactivityPush({ sessionId: 'workout-a', deadline: 1_700_000_900_000, locale: 'es' })
    expect(api).toHaveBeenCalledWith('/api/push/inactivity/schedule', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ sessionId: 'workout-a', deadline: 1_700_000_900_000, locale: 'es' }),
    }))

    registration.pushManager.getSubscription.mockResolvedValue(null)
    api.mockClear()
    expect(await scheduleInactivityPush({ sessionId: 'workout-b', deadline: 1_700_000_900_000, locale: 'en' })).toEqual({ status: 'unavailable' })
    expect(api).not.toHaveBeenCalled()
  })

  it('exposes authenticated cancel and status/recovery calls for one session', async () => {
    const { cancelInactivityPush, recoverInactivityPush, statusInactivityPush } = await import('./push.js')
    await cancelInactivityPush('workout/a')
    await recoverInactivityPush('workout/a')
    await statusInactivityPush('workout/a')
    expect(api).toHaveBeenNthCalledWith(1, '/api/push/inactivity/cancel', expect.objectContaining({ method: 'POST' }))
    expect(api).toHaveBeenNthCalledWith(2, '/api/push/inactivity/recover', expect.objectContaining({ method: 'POST' }))
    expect(api).toHaveBeenNthCalledWith(3, '/api/push/inactivity/status?sessionId=workout%2Fa')
  })
})

// Localized push error contract: enablePush() throws t()-rendered text (English source
// strings as keys), so the Settings toast path shows Spanish under es and the source
// string under en. User-owned data stays verbatim; unknown third-party messages pass
// through raw after the keyed attempt. A source scan keeps bare toast(e.message) out.
describe('push notification errors resolve through t() keys', () => {
  beforeEach(() => {
    fakeBrowser()
    vi.resetModules()
    vi.useFakeTimers()
    api.mockReset()
    api.mockResolvedValue({})
  })

  it('rejects with Spanish text under es and surfaces a Spanish toast', async () => {
    const { setLang, t } = await import('./i18n.js')
    const { enablePush } = await import('./push.js')
    const { useUI } = await import('../store/useUI.js')
    await setLang('es')
    const err = await enablePush().catch(e => e)
    expect(err.message).toBe('Las notificaciones push no son compatibles con este navegador')
    // The Settings catch path: keyed attempt first, default fallback second — the
    // already-translated message passes through t() idempotently.
    useUI.getState().toast(t(err.message || 'Could not change notification settings'))
    expect(useUI.getState().toastMsg).toBe('Las notificaciones push no son compatibles con este navegador')
    vi.advanceTimersByTime(2500) // let the toast auto-clear timer elapse
  })

  it('keeps the English source string under en (identity fallback)', async () => {
    const { enablePush } = await import('./push.js')
    await expect(enablePush()).rejects.toThrow('Push notifications are not supported in this browser')
  })

  it('keeps user data verbatim inside translated toast strings', async () => {
    const { setLang, t } = await import('./i18n.js')
    await setLang('es')
    const filename = 'Mi Entrenamiento _Núñez 2026-09-03.json'
    const rendered = t('Import failed: {0}', filename)
    expect(rendered).toContain(filename)
    expect(rendered).toContain('Importación fallida')
  })

  it('falls back to the raw unknown message after a keyed attempt', async () => {
    const { setLang, t } = await import('./i18n.js')
    await setLang('es')
    const raw = 'Third-party: something exploded (code 42)'
    expect(t(raw)).toBe(raw)
    expect(t('a key absent from every locale')).toBe('a key absent from every locale')
  })

  it('keeps zero bare toast(e.message) leaks in the five changed files', () => {
    for (const file of ['views/Admin.jsx', 'views/Login.jsx', 'views/Settings.jsx', 'lib/push.js', 'sheets.jsx']) {
      const src = readFileSync(resolve(process.cwd(), 'src', file), 'utf8')
      expect(src).not.toMatch(/toast\(\s*e\.message/, `${file} must not toast a bare e.message`)
    }
  })
})
