import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { api, beep, vibrate } = vi.hoisted(() => ({
  api: vi.fn(() => Promise.resolve({})), beep: vi.fn(), vibrate: vi.fn(),
}))
vi.mock('../lib/api.js', () => ({ api }))
vi.mock('../lib/sound.js', () => ({ beep, vibrate }))

const setNavigator = value =>
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })

function fakeBrowser() {
  const values = new Map()
  globalThis.window = {}
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    },
  })
  globalThis.document = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
  setNavigator({ userAgent: 'node-test', languages: ['en-US'], language: 'en-US' })
}

let useStore, useUI

beforeEach(async () => {
  fakeBrowser()
  vi.resetModules()
  ;({ useStore } = await import('./useStore.js'))
  ;({ useUI } = await import('./useUI.js'))
  useStore.getState().replaceState({ restTimerEnabled: true, sound: true })
  useUI.getState().stopRest()
  beep.mockClear(); vibrate.mockClear(); api.mockClear()
  vi.useFakeTimers()
})

afterEach(() => {
  useUI?.getState().stopRest()
  vi.useRealTimers()
  delete globalThis.localStorage
  delete globalThis.document
  delete globalThis.window
  delete globalThis.navigator
})

describe('rest timer setting gate', () => {
  it('does nothing for automatic or manual entry when disabled', () => {
    useStore.getState().setUser({ id: 'u1', name: 'Test' })
    useStore.getState().update(s => { s.restTimerEnabled = false }, false)

    useUI.getState().startRest(90)
    expect(useUI.getState().timer).toBeNull()
    useUI.getState().addRest(15)
    vi.advanceTimersByTime(2000)

    expect(beep).not.toHaveBeenCalled()
    expect(vibrate).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
    expect(useUI.getState().toastMsg).toBe('')
  })

  it('cancels active rest and authenticated push when disabled', () => {
    useStore.getState().setUser({ id: 'u1', name: 'Test' })
    useUI.getState().startRest(90)
    expect(useUI.getState().timer).not.toBeNull()
    api.mockClear()

    useStore.getState().update(s => { s.restTimerEnabled = false }, false)
    useUI.getState().stopRest()

    expect(useUI.getState().timer).toBeNull()
    expect(api).toHaveBeenCalledWith('/api/push/rest-timer/cancel', expect.objectContaining({ method: 'POST' }))
  })

  it('preserves enabled duration, ±15 adjustments, skip, and authenticated push', () => {
    useStore.getState().setUser({ id: 'u1', name: 'Test' })
    useUI.getState().startRest(90)
    expect(useUI.getState().timer.total).toBe(90)
    useUI.getState().addRest(15)
    expect(useUI.getState().timer.left).toBe(105)
    useUI.getState().addRest(-15)
    expect(useUI.getState().timer.left).toBe(90)
    expect(api).toHaveBeenCalledWith('/api/push/rest-timer', expect.objectContaining({ method: 'POST' }))

    useUI.getState().stopRest()
    expect(useUI.getState().timer).toBeNull()
    expect(api).toHaveBeenCalledWith('/api/push/rest-timer/cancel', expect.objectContaining({ method: 'POST' }))
  })
})
