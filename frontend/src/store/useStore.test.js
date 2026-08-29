// Integration tests for the block lifecycle integration at the Zustand boundary.
//
// Lifecycle helpers (activateBlock / pauseBlock / resumeBlock / endBlock) are pure return-value
// functions: they take the full state S and return a NEW state with the lifecycle pointer updated.
// The Zustand `update(mut)` exposes a mutable draft cloned from S and persists it after `mut`
// returns — it discards the callback's return value. So the only way to apply the helper's
// replacement state is to copy its fields into the draft:
//
//   update(s => { Object.assign(s, activateBlock(s, id, today)) })
//
// Calling `update(s => activateBlock(s, id, today))` returns the new state but `update` throws
// it away — `S.activeBlock` stays null and nothing is persisted. These tests pin down the
// integration contract so the bug can't return silently.
//
// Strict TDD cycle for this file:
//   RED   — the four lifecycle tests use the broken pattern (`update(s => helper(s, ...))`)
//           and assert that state persists. They FAIL because update discards the helper's
//           return value.
//   GREEN — the test patterns are switched to `update(s => { Object.assign(s, helper(s, ...)) })`
//           and `sheets.jsx` lifecycle callbacks are fixed to the same Object.assign shape.
//           Tests then pass and prove state + localStorage `gym_state_v1` round-trip.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Node 24 exposes a read-only navigator getter; defineProperty makes the assignment safe across
// runtimes (cf. wakelock.test.js / i18n.test.js).
const setNavigator = value =>
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })

function fakeBrowser() {
  const values = new Map()
  globalThis.window = {}
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
      clear: () => values.clear(),
    },
  })
  // useStore.js registers a visibilitychange listener on document at module load. An empty
  // addEventListener stub is enough — the listener only acts when the document transitions to
  // hidden, which never happens in tests.
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  setNavigator({ userAgent: 'node-test', languages: ['en-US'], language: 'en-US' })
  return values
}

// useStore.js must be imported AFTER the fake browser is installed: it registers a
// visibilitychange listener on `document` and reads `localStorage` during the initial load.
// Dynamic import inside beforeEach (paired with vi.resetModules via top-level await) guarantees
// the module sees the stub globals.
const KEY = 'gym_state_v1'
const FULL_WEEK = { days: { 0: 'r-push', 1: 'r-pull', 2: 'rest', 3: 'r-legs', 4: 'r-push', 5: 'rest', 6: 'rest' } }
const BLOCK_ROUTINES = [
  { id: 'r-push', name: 'Push' },
  { id: 'r-pull', name: 'Pull' },
  { id: 'r-legs', name: 'Legs' },
]
const GOOD_BLOCK = { id: 'b1', name: 'Hypertrophy Block', weeks: [FULL_WEEK, FULL_WEEK, FULL_WEEK] }

let storage, useStore, activateBlock, pauseBlock, resumeBlock, endBlock

beforeEach(async () => {
  storage = fakeBrowser()
  const storeMod = await import('./useStore.js')
  const historyMod = await import('../lib/history.js')
  useStore = storeMod.useStore
  activateBlock = historyMod.activateBlock
  pauseBlock = historyMod.pauseBlock
  resumeBlock = historyMod.resumeBlock
  endBlock = historyMod.endBlock
  // Reset S to a known overlay with only the block fixture. replaceState persists immediately,
  // so each scenario starts from a clean slate regardless of what prior tests left behind.
  useStore.getState().replaceState({ blocks: [GOOD_BLOCK], activeBlock: null, routines: BLOCK_ROUTINES })
})

afterEach(() => {
  delete globalThis.localStorage
  delete globalThis.document
  delete globalThis.window
  delete globalThis.navigator
})

describe('useStore.update × activateBlock — persistence integration', () => {
  it('persists activeBlock in S and in gym_state_v1 after activate', () => {
    const { update } = useStore.getState()

    update(s => { Object.assign(s, activateBlock(s, 'b1', '2026-08-26')) })

    const S = useStore.getState().S
    expect(S.activeBlock).toEqual({
      blockId: 'b1', startedOn: '2026-08-26', status: 'active', pausedRanges: [],
    })
    const persisted = JSON.parse(storage.get(KEY))
    expect(persisted.activeBlock).toEqual({
      blockId: 'b1', startedOn: '2026-08-26', status: 'active', pausedRanges: [],
    })
  })

  it('lets the helper throw (unknown blockId) without leaving partial state', () => {
    const { update } = useStore.getState()

    expect(() => update(s => { Object.assign(s, activateBlock(s, 'no-such', '2026-08-26')) })).toThrow()
    expect(useStore.getState().S.activeBlock).toBeNull()
    expect(JSON.parse(storage.get(KEY)).activeBlock).toBeNull()
  })
})

describe('useStore.update × pauseBlock — persistence integration', () => {
  it('flips status to paused and stamps pausedOn in S and in gym_state_v1', () => {
    const { update } = useStore.getState()
    update(s => { Object.assign(s, activateBlock(s, 'b1', '2026-08-25')) })

    update(s => { Object.assign(s, pauseBlock(s, '2026-08-26')) })

    const S = useStore.getState().S
    expect(S.activeBlock.status).toBe('paused')
    expect(S.activeBlock.pausedOn).toBe('2026-08-26')
    expect(S.activeBlock.blockId).toBe('b1')
    const persisted = JSON.parse(storage.get(KEY))
    expect(persisted.activeBlock.status).toBe('paused')
    expect(persisted.activeBlock.pausedOn).toBe('2026-08-26')
  })
})

describe('useStore.update × resumeBlock — persistence integration', () => {
  it('closes the open pause range, appends to pausedRanges, flips status back to active', () => {
    const { update } = useStore.getState()
    update(s => { Object.assign(s, activateBlock(s, 'b1', '2026-08-25')) })
    update(s => { Object.assign(s, pauseBlock(s, '2026-08-26')) })

    update(s => { Object.assign(s, resumeBlock(s, '2026-08-28')) })

    const S = useStore.getState().S
    expect(S.activeBlock.status).toBe('active')
    expect(S.activeBlock.pausedRanges).toEqual([{ from: '2026-08-26', through: '2026-08-27' }])
    expect(S.activeBlock.pausedOn).toBeUndefined()
    const persisted = JSON.parse(storage.get(KEY))
    expect(persisted.activeBlock.status).toBe('active')
    expect(persisted.activeBlock.pausedRanges).toEqual([{ from: '2026-08-26', through: '2026-08-27' }])
  })
})

describe('useStore.update × endBlock — persistence integration', () => {
  it('clears activeBlock back to null in both S and gym_state_v1', () => {
    const { update } = useStore.getState()
    update(s => { Object.assign(s, activateBlock(s, 'b1', '2026-08-25')) })

    update(s => { Object.assign(s, endBlock(s)) })

    const S = useStore.getState().S
    expect(S.activeBlock).toBeNull()
    const persisted = JSON.parse(storage.get(KEY))
    expect(persisted.activeBlock).toBeNull()
  })
})

describe('restTimerEnabled compatibility', () => {
  it('defaults old profiles to enabled and persists a disabled choice', () => {
    useStore.getState().replaceState({ routines: [], workouts: [] })

    expect(useStore.getState().S.restTimerEnabled).toBe(true)
    useStore.getState().update(s => { s.restTimerEnabled = false }, false)

    expect(useStore.getState().S.restTimerEnabled).toBe(false)
    expect(JSON.parse(storage.get(KEY)).restTimerEnabled).toBe(false)
  })

  it('restores the persisted disabled choice while retaining defaults for other fields', async () => {
    useStore.getState().replaceState({ restTimerEnabled: false, routines: [], workouts: [] })
    expect(JSON.parse(storage.get(KEY)).restTimerEnabled).toBe(false)
    vi.resetModules()
    const { useStore: restored } = await import('./useStore.js')

    expect(restored.getState().S.restTimerEnabled).toBe(false)
    expect(restored.getState().S.restSec).toBe(90)
  })
})

describe('bodyweightCheckEnabled compatibility', () => {
  it('defaults missing and malformed values to enabled, while preserving explicit false', () => {
    useStore.getState().replaceState({ routines: [], workouts: [], bodyweightCheckEnabled: null })
    expect(useStore.getState().S.bodyweightCheckEnabled).toBe(true)
    useStore.getState().replaceState({ routines: [], workouts: [], bodyweightCheckEnabled: 'false' })
    expect(useStore.getState().S.bodyweightCheckEnabled).toBe(true)
    useStore.getState().replaceState({ routines: [], workouts: [], bodyweightCheckEnabled: false })
    expect(useStore.getState().S.bodyweightCheckEnabled).toBe(false)
    expect(JSON.parse(storage.get(KEY)).bodyweightCheckEnabled).toBe(false)
  })

  it('restores the persisted disabled choice and resets it to enabled', async () => {
    useStore.getState().replaceState({ bodyweightCheckEnabled: false, routines: [], workouts: [] })
    vi.resetModules()
    const { useStore: restored } = await import('./useStore.js')
    expect(restored.getState().S.bodyweightCheckEnabled).toBe(false)
    restored.getState().replaceState({ routines: [], workouts: [] })
    expect(restored.getState().S.bodyweightCheckEnabled).toBe(true)
  })

  it('preserves the disabled preference through backup replacement and server sync', async () => {
    const remote = { _ts: Date.now() + 1, routines: [], workouts: [], bodyweightCheckEnabled: false }
    globalThis.fetch = vi.fn(async (_path, options = {}) => {
      if (options.method === 'PUT') return { ok: true, json: async () => ({}) }
      return { ok: true, json: async () => ({ state: remote }) }
    })
    useStore.getState().replaceState({ routines: [], workouts: [], bodyweightCheckEnabled: false })
    useStore.getState().setUser({ id: 'server-user' })
    await useStore.getState().pushState()
    const pushed = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
    expect(pushed.state.bodyweightCheckEnabled).toBe(false)

    useStore.getState().replaceState({ routines: [], workouts: [], bodyweightCheckEnabled: true })
    await useStore.getState().pullState()
    expect(useStore.getState().S.bodyweightCheckEnabled).toBe(false)
  })

  it('clears the preference to the enabled default on sign-out and demo reset', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    useStore.getState().replaceState({ routines: [], workouts: [], bodyweightCheckEnabled: false })
    useStore.getState().setUser({ id: 'signout-user' })
    await useStore.getState().signOut()
    expect(useStore.getState().S.bodyweightCheckEnabled).toBe(true)

    useStore.getState().replaceState({ routines: [], workouts: [], bodyweightCheckEnabled: false })
    await useStore.getState().resetDemo()
    expect(useStore.getState().S.bodyweightCheckEnabled).toBe(true)
  })

  it('normalizes a disabled preference restored from the mobile native mirror', async () => {
    vi.resetModules()
    const nativeLoad = vi.fn(async () => ({ _ts: Date.now() + 1, routines: [], workouts: [], bodyweightCheckEnabled: false }))
    vi.doMock('../lib/mobile.js', () => ({ MOBILE: true, nativeLoad, nativeSave: vi.fn(), syncReminder: vi.fn() }))
    const { useStore: mobileStore } = await import('./useStore.js')
    await mobileStore.getState().boot()
    expect(nativeLoad).toHaveBeenCalledTimes(1)
    expect(mobileStore.getState().S.bodyweightCheckEnabled).toBe(false)
  })
})
