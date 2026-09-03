// Localized push error contract: enablePush() throws t()-rendered text (English source
// strings as keys), so the Settings toast path shows Spanish under es and the source
// string under en. User-owned data stays verbatim; unknown third-party messages pass
// through raw after the keyed attempt. A source scan keeps bare toast(e.message) out.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const { api, beep, vibrate } = vi.hoisted(() => ({
  api: vi.fn(() => Promise.resolve({})), beep: vi.fn(), vibrate: vi.fn(),
}))
vi.mock('../lib/api.js', () => ({ api }))
vi.mock('../lib/sound.js', () => ({ beep, vibrate }))

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

beforeEach(() => { fakeBrowser(); vi.resetModules(); vi.useFakeTimers() })
afterEach(() => {
  vi.useRealTimers()
  delete globalThis.localStorage
  delete globalThis.document
  delete globalThis.navigator
  delete globalThis.window
})

describe('push notification errors resolve through t() keys', () => {
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