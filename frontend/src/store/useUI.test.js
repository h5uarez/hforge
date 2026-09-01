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
  globalThis.document = { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible' }
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
  it('carries the stable active-session sid through rest state', () => {
    useUI.getState().startRest(90, 'stable-entry')
    expect(useUI.getState().timer.sid).toBe('stable-entry')
    useUI.getState().stopRest()
  })
  it('persists validated rest resume metadata but never the derived left value', () => {
    useStore.getState().replaceState({ active: { entries: [{ sid: 'stable-entry', id: 'squat', sets: [] }] } })
    useUI.getState().startRest(90, 'stable-entry')
    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(saved.active.restResume).toMatchObject({ total: 90, sid: 'stable-entry' })
    expect(saved.active.restResume).not.toHaveProperty('left')
    useUI.getState().stopRest()
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).active).not.toHaveProperty('restResume')
  })
  it('persists rest extensions durably while keeping the work timer transient', () => {
    useStore.getState().replaceState({ active: { entries: [{ sid: 'stable-entry', id: 'squat', sets: [] }] } })
    useUI.getState().startRest(90, 'stable-entry')
    const started = JSON.parse(localStorage.getItem('gym_state_v1')).active.restResume

    useUI.getState().addRest(15)
    const extended = JSON.parse(localStorage.getItem('gym_state_v1')).active.restResume
    expect(extended).toEqual({ endsAt: started.endsAt + 15000, total: 105, sid: 'stable-entry' })
    expect(extended).not.toHaveProperty('left')

    useUI.getState().startWork(30, 'Plank', vi.fn())
    expect(useUI.getState().work).toMatchObject({ total: 30, label: 'Plank' })
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).active).not.toHaveProperty('work')
  })
  it('cleans invalid or mismatched rest resume metadata without dropping the session', () => {
    useStore.getState().replaceState({ active: { entries: [{ sid: 'stable-entry', id: 'squat', sets: [] }], restResume: { endsAt: Date.now() + 1000, total: 90, sid: 'other' } } })
    expect(useStore.getState().S.active).not.toHaveProperty('restResume')
    expect(useStore.getState().S.active.entries).toHaveLength(1)
    expect(useUI.getState().resumeRest()).toBe(false)
  })
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
  it('fires the existing enabled completion effects and clears the timer', () => {
    useStore.getState().replaceState({ restTimerEnabled: true, sound: true })
    useStore.getState().setUser({ id: 'u1' })
    useUI.getState().startRest(1)

    vi.advanceTimersByTime(1000)

    expect(useUI.getState().timer).toBeNull()
    expect(beep).toHaveBeenCalledTimes(3)
    expect(vibrate).toHaveBeenCalledWith([200, 100, 200])
    expect(api).toHaveBeenCalledWith('/api/push/rest-timer', expect.objectContaining({ method: 'POST' }))
    expect(api).toHaveBeenCalledWith('/api/push/rest-timer/cancel', expect.objectContaining({ method: 'POST' }))
  })

  it('cancels an enabled timer safely and removes its interval', () => {
    useUI.getState().startRest(90)
    useUI.getState().stopRest()
    vi.advanceTimersByTime(2000)
    expect(useUI.getState().timer).toBeNull()
  })
})
