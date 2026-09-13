import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Node 24 exposes a read-only navigator getter; defineProperty makes the assignment safe across
// runtimes (cf. wakelock.test.js / i18n.test.js).
const setNavigator = value =>
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })

function fakeBrowser() {
  const values = new Map()
  const listeners = new Map()
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
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name) },
    listeners,
  }
  setNavigator({ userAgent: 'node-test', languages: ['en-US'], language: 'en-US' })
  return values
}

// useStore.js must be imported AFTER the fake browser is installed: it registers a
// visibilitychange listener on `document` and reads `localStorage` during the initial load.
// Dynamic import inside beforeEach (paired with vi.resetModules via top-level await) guarantees
// the module sees the stub globals.
const KEY = 'gym_state_v1'

let storage, useStore

beforeEach(async () => {
  storage = fakeBrowser()
  vi.resetModules()
  vi.doUnmock('../lib/mobile.js')
  const storeMod = await import('./useStore.js')
  useStore = storeMod.useStore
  // Reset S to a known generic overlay. replaceState persists immediately, so each scenario
  // starts from a clean slate regardless of what prior tests left behind.
  useStore.getState().replaceState({ routines: [], workouts: [] })
})

afterEach(() => {
  delete globalThis.localStorage
  delete globalThis.document
  delete globalThis.window
  delete globalThis.navigator
})

describe('legacy state normalization', () => {
  it('migrates legacy fields from local storage during load', async () => {
    storage.set(KEY, JSON.stringify({
      routines: [],
      workouts: [{ d: '2026-08-31', entries: [], block: { id: 'legacy' } }],
      blocks: [{ id: 'legacy' }],
      activeBlock: { blockId: 'legacy' },
    }))
    vi.resetModules()
    const { useStore: restored } = await import('./useStore.js')

    expect(restored.getState().S).not.toHaveProperty('blocks')
    expect(restored.getState().S).not.toHaveProperty('activeBlock')
    expect(restored.getState().S.workouts[0]).not.toHaveProperty('block')
    expect(JSON.parse(storage.get(KEY))).not.toHaveProperty('blocks')
  })

  it('removes legacy schedule fields and workout snapshots on replacement', () => {
    useStore.getState().replaceState({
      routines: [],
      workouts: [{ d: '2026-08-31', entries: [], block: { id: 'legacy' } }],
      blocks: [{ id: 'legacy' }],
      activeBlock: { blockId: 'legacy' },
      active: { id: 'current', block: { id: 'legacy' } },
    })

    const { S } = useStore.getState()
    expect(S).not.toHaveProperty('blocks')
    expect(S).not.toHaveProperty('activeBlock')
    expect(S.workouts[0]).not.toHaveProperty('block')
    expect(S.active).toEqual({ id: 'current' })

    const persisted = JSON.parse(storage.get(KEY))
    expect(persisted).not.toHaveProperty('blocks')
    expect(persisted).not.toHaveProperty('activeBlock')
    expect(persisted.workouts[0]).not.toHaveProperty('block')
  })

  it('normalizes active legacy entries without touching saved routines or day plans', () => {
    const routines = [{ id: 'r1', ex: [{ id: 'squat' }] }]
    const dayPlan = { '2026-09-01': 'r1' }
    useStore.getState().replaceState({ routines, dayPlan, active: { cur: 1, entries: [entry('squat'), entry('squat')] } })
    const { S } = useStore.getState()
    expect(S.active.entries.map(e => e.sid)).toEqual(['session-squat-0', 'session-squat-1'])
    expect(S.routines).toEqual(routines)
    expect(S.dayPlan).toEqual(dayPlan)
  })
})

const entry = id => ({ id, sets: [{ done: true, w: 40, r: 8 }] })

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

describe('active-session persistence recovery', () => {
  it('keeps a failed active draft available for retry and leaves plans unchanged', () => {
    const routines = [{ id: 'r1', ex: [{ id: 'squat' }] }]
    useStore.getState().replaceState({ routines, dayPlan: { tue: 'r1' }, active: { entries: [entry('squat')] } })
    const originalSetItem = localStorage.setItem
    let fail = true
    localStorage.setItem = (key, value) => {
      if (fail && key === 'gym_state_v1') throw new Error('quota')
      return originalSetItem(key, value)
    }
    useStore.getState().update(s => { s.active.entries[0].sets[0].r = 12 })
    expect(useStore.getState().persistence.status).toBe('failed')
    expect(useStore.getState().S.active.entries[0].sets[0].r).toBe(12)
    expect(useStore.getState().S.routines).toEqual(routines)
    fail = false
    expect(useStore.getState().retryPersistence()).toBe(true)
    expect(useStore.getState().persistence).toBeNull()
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).active.entries[0].sets[0].r).toBe(12)
    localStorage.setItem = originalSetItem
  })

  it('supports undo and cancel without changing saved plans after a failed edit', () => {
    const routines = [{ id: 'r1', ex: [{ id: 'squat' }] }]
    const dayPlan = { tue: 'r1' }
    useStore.getState().replaceState({ routines, dayPlan, active: { entries: [entry('squat')] } })
    const originalSetItem = localStorage.setItem
    localStorage.setItem = (key, value) => { if (key === KEY) throw new Error('quota'); return originalSetItem(key, value) }

    useStore.getState().update(s => { s.active.entries[0].sets[0].r = 12 })
    expect(useStore.getState().persistence.status).toBe('failed')
    localStorage.setItem = originalSetItem
    expect(useStore.getState().cancelPersistence()).toBe(true)
    expect(useStore.getState().S.active.entries[0].sets[0].r).toBe(8)
    expect(useStore.getState().S.routines).toEqual(routines)
    expect(useStore.getState().S.dayPlan).toEqual(dayPlan)

    localStorage.setItem = (key, value) => { if (key === KEY) throw new Error('quota'); return originalSetItem(key, value) }
    useStore.getState().update(s => { s.active.entries[0].sets[0].r = 13 })
    localStorage.setItem = originalSetItem
    expect(useStore.getState().undoPersistence()).toBe(true)
    expect(useStore.getState().S.active.entries[0].sets[0].r).toBe(8)
  })
})

describe('remote persistence snapshots', () => {
  it('pushes an explicit snapshot without replacing the locally visible state', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    const active = { id: 'local-session', entries: [entry('squat')] }
    useStore.getState().replaceState({ routines: [], workouts: [], active })
    useStore.getState().setUser({ id: 'server-user' })

    const local = structuredClone(useStore.getState().S.active)
    const snapshot = structuredClone(useStore.getState().S)
    snapshot.active = null
    expect(await useStore.getState().pushState(snapshot)).toBe(true)

    const pushed = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
    expect(pushed.state.active).toBeNull()
    expect(useStore.getState().S.active).toEqual(local)
  })

  it('keeps the local draft available when an explicit snapshot cannot be pushed', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') })
    useStore.getState().replaceState({ routines: [], workouts: [], active: { id: 'historical-view', entries: [entry('squat')] } })
    useStore.getState().setUser({ id: 'server-user' })

    const local = structuredClone(useStore.getState().S)
    const snapshot = structuredClone(local)
    snapshot.active = null
    expect(await useStore.getState().pushState(snapshot)).toBe(false)

    expect(useStore.getState().S).toEqual(local)
    expect(useStore.getState().persistence.status).toBe('failed')
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

describe('server boot and synchronization boundaries', () => {
  it('boots an authenticated profile and accepts a newer remote state', async () => {
    const remote = { _ts: Date.now() + 10_000, unit: 'lb', routines: [{ id: 'remote', ex: [] }], workouts: [] }
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: 'u1', name: 'Remote User' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: remote }) })

    await useStore.getState().boot()

    expect(useStore.getState().ready).toBe(true)
    expect(useStore.getState().user).toEqual({ id: 'u1', name: 'Remote User' })
    expect(useStore.getState().S.unit).toBe('lb')
    expect(useStore.getState().S.routines).toEqual(remote.routines)
    expect(globalThis.fetch.mock.calls.map(call => call[0])).toEqual(['/api/me', '/api/data'])
  })

  it('finishes boot after a 401, clears stale identity, and keeps local training data', async () => {
    useStore.getState().replaceState({ routines: [{ id: 'local', ex: [] }], workouts: [] })
    useStore.getState().setUser({ id: 'stale' })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ error: 'not signed in' }),
    })

    await useStore.getState().boot()

    expect(useStore.getState().ready).toBe(true)
    expect(useStore.getState().user).toBeNull()
    expect(useStore.getState().S.routines).toEqual([{ id: 'local', ex: [] }])
  })

  it('keeps dirty local data and pushes it instead of applying an older remote snapshot', async () => {
    useStore.getState().replaceState({ _ts: 200, routines: [{ id: 'local', ex: [] }], workouts: [] })
    useStore.getState().setUser({ id: 'u1' })
    localStorage.setItem('gym_dirty', '1')
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: { _ts: 300, routines: [{ id: 'remote', ex: [] }], workouts: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })

    await useStore.getState().pullState()

    expect(useStore.getState().S.routines[0].id).toBe('local')
    expect(globalThis.fetch.mock.calls[1][0]).toBe('/api/data')
    expect(globalThis.fetch.mock.calls[1][1].method).toBe('PUT')
    expect(localStorage.getItem('gym_dirty')).toBeNull()
  })

  it('preserves the local session when sign-out-all fails and clears it after success', async () => {
    useStore.getState().replaceState({ routines: [{ id: 'local', ex: [] }], workouts: [] })
    useStore.getState().setUser({ id: 'u1' })
    globalThis.fetch = vi.fn(async path => ({
      ok: path !== '/api/logout/all', status: 503,
      json: async () => path === '/api/logout/all' ? ({ error: 'unavailable' }) : ({ ok: true }),
    }))

    await expect(useStore.getState().signOutAll()).rejects.toMatchObject({ status: 503 })
    expect(useStore.getState().user).toEqual({ id: 'u1' })
    expect(useStore.getState().S.routines[0].id).toBe('local')

    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    await useStore.getState().signOutAll()
    expect(useStore.getState().user).toBeNull()
    expect(useStore.getState().S.routines).toEqual([])
    expect(localStorage.getItem('gym_guest')).toBeNull()
    expect(localStorage.getItem('gym_dirty')).toBeNull()
  })

  it('flushes a pending authenticated state push when the document becomes hidden', async () => {
    useStore.getState().setUser({ id: 'u1' })
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    useStore.getState().update(state => { state.unit = 'lb' })
    document.visibilityState = 'hidden'

    document.listeners.get('visibilitychange')()
    await Promise.resolve()
    await Promise.resolve()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/data')
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).state.unit).toBe('lb')
  })
})

describe('history persistence transaction', () => {
  it('rolls both local persistence keys back when the second write fails', () => {
    useStore.getState().replaceState({ routines: [], workouts: [] })
    const before = localStorage.getItem('gym_state_v1')
    const original = localStorage.setItem
    localStorage.setItem = (key, value) => {
      if (key === 'gym_state_last_valid_v1') throw new Error('quota')
      return original.call(localStorage, key, value)
    }
    useStore.getState().update(state => { state.workouts = [{ id: 'w1', d: '2026-09-01', entries: [] }] }, false)
    expect(useStore.getState().persistence.status).toBe('failed')
    expect(localStorage.getItem('gym_state_v1')).toBe(before)
    expect(localStorage.getItem('gym_state_last_valid_v1')).toBe(before)
    localStorage.setItem = original
  })

  it('keeps a server-rejected candidate available for retry and restores it on cancel', async () => {
    useStore.getState().replaceState({ routines: [], workouts: [] })
    useStore.getState().setUser({ id: 'history-user' })
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: 'invalid history' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    useStore.getState().update(state => { state.workouts = [{ id: 'w1', d: '2026-09-01', entries: [] }] })
    await useStore.getState().pushState()
    expect(useStore.getState().persistence).toMatchObject({ status: 'failed', error: { status: 422 } })
    expect(useStore.getState().retryPersistence()).toBe(true)
    expect(useStore.getState().persistence).toBeNull()
  })

  it('undoes a failed local history edit without touching active or routines', () => {
    const routines = [{ id: 'routine', ex: [] }]
    const active = { id: 'active', entries: [] }
    useStore.getState().replaceState({ routines, active, workouts: [] })
    const protectedActive = structuredClone(useStore.getState().S.active)
    const original = localStorage.setItem
    localStorage.setItem = (key, value) => { if (key === KEY) throw new Error('quota'); return original.call(localStorage, key, value) }
    useStore.getState().update(state => { state.workouts = [{ id: 'w1', d: '2026-09-01', entries: [] }] })
    localStorage.setItem = original
    expect(useStore.getState().undoPersistence()).toBe(true)
    expect(useStore.getState().S.workouts).toEqual([])
    expect(useStore.getState().S.routines).toEqual(routines)
    expect(useStore.getState().S.active).toEqual(protectedActive)
  })

  it('keeps the original rollback baseline across failed retries', () => {
    useStore.getState().replaceState({ routines: [], workouts: [] })
    const original = localStorage.setItem
    let failures = 4
    localStorage.setItem = (key, value) => {
      if (key === KEY && failures-- > 0) throw new Error('quota')
      return original.call(localStorage, key, value)
    }
    useStore.getState().update(state => { state.workouts = [{ id: 'candidate', d: '2026-09-01', entries: [] }] }, false)
    expect(useStore.getState().retryPersistence()).toBe(false)
    localStorage.setItem = original
    expect(useStore.getState().undoPersistence()).toBe(true)
    expect(useStore.getState().S.workouts).toEqual([])
  })
})
