import { describe, expect, it } from 'vitest'
import { normalizeActiveSession, sessionUnits, moveSessionUnit, remapCur, removeSessionEntry, nextSet, restoreFocusedEntry } from './session.js'
import { copyHistoryEntry } from './history.js'
import { isBw, isTimed, modeOf } from './history.js'

const entry = (id, extra = {}) => ({ id, sets: [{ w: 40, r: 8, done: false }], ...extra })

describe('active session identity and units', () => {
  it('keeps all supported session modes and bodyweight flags explicit', () => {
    expect(modeOf({ mode: 'reps', id: 'bench' })).toBe('reps')
    expect(modeOf({ mode: 'time', id: 'plank' })).toBe('time')
    expect(modeOf({ mode: 'cardio', id: 'run' })).toBe('cardio')
    expect(isTimed({ mode: 'time' })).toBe(true)
    expect(isBw({ mode: 'reps', bodyweight: true })).toBe(true)
    expect(isBw({ mode: 'reps', bodyweight: false })).toBe(false)
  })

  it('normalizes legacy entries once while preserving duplicate exercises and state', () => {
    const active = { cur: 1, entries: [entry('squat', { sets: [{ done: true }] }), entry('squat', { rest: 12 })] }
    const normalized = normalizeActiveSession(active)
    expect(normalized).not.toBe(active)
    expect(normalized.entries.map(e => e.sid)).toEqual(['session-squat-0', 'session-squat-1'])
    expect(normalized.entries[0].sets[0].done).toBe(true)
    expect(normalized.entries[1].rest).toBe(12)
    expect(normalizeActiveSession(normalized)).toEqual(normalized)
  })

  it('groups two and three consecutive superset members without changing singleton boundaries', () => {
    const entries = [entry('a', { sg: 'x' }), entry('b', { sg: 'x' }), entry('c'), entry('d', { sg: 'y' }), entry('e', { sg: 'y' }), entry('f', { sg: 'y' })]
    expect(sessionUnits(entries)).toEqual([[0, 1], [2], [3, 4, 5]])
  })

  it('moves a complete superset, retaining completed values and internal order', () => {
    const entries = [entry('a', { sid: 'a' }), entry('b', { sid: 'b', sg: 'pair' }), entry('c', { sid: 'c', sg: 'pair', sets: [{ done: true, w: 99 }] }), entry('d', { sid: 'd' })]
    const result = moveSessionUnit(entries, 1, 1)
    expect(result.changed).toBe(true)
    expect(result.entries.map(e => e.id)).toEqual(['a', 'd', 'b', 'c'])
    expect(result.entries[3].sets[0]).toEqual({ done: true, w: 99 })
    expect(entries.map(e => e.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('rejects unit boundary and invalid moves without mutation', () => {
    const entries = [entry('a', { sid: 'a' }), entry('b', { sid: 'b' })]
    for (const args of [[0, -1], [1, 1], [-1, 1], [4, -1], [0, 0]]) {
      const result = moveSessionUnit(entries, ...args)
      expect(result.changed).toBe(false)
      expect(result.entries).toBe(entries)
    }
  })

  it('remaps the compatibility cursor by stable identity after reorder', () => {
    const before = [entry('a', { sid: 'a' }), entry('b', { sid: 'b' })]
    const after = [before[1], before[0]]
    expect(remapCur(before, 0, after)).toBe(1)
    expect(remapCur(before, 99, after)).toBe(1)
  })

  it('removes a normal entry without mutating the source and keeps the selected SID focused', () => {
    const before = [entry('a', { sid: 'a' }), entry('b', { sid: 'b' }), entry('c', { sid: 'c' })]
    const result = removeSessionEntry(before, 2, 0)
    expect(result.changed).toBe(true)
    expect(result.entries.map(e => e.sid)).toEqual(['b', 'c'])
    expect(result.cur).toBe(1)
    expect(result.focusSid).toBe('c')
    expect(before.map(e => e.sid)).toEqual(['a', 'b', 'c'])
  })

  it('clamps focus when removing the current or only entry', () => {
    const current = [entry('a', { sid: 'a' }), entry('b', { sid: 'b' })]
    const last = removeSessionEntry(current, 1, 1)
    expect(last.entries.map(e => e.sid)).toEqual(['a'])
    expect(last.cur).toBe(0)
    expect(last.focusSid).toBe('a')

    const only = removeSessionEntry([entry('a', { sid: 'a' })], 0, 0)
    expect(only.entries).toEqual([])
    expect(only.cur).toBe(0)
    expect(only.focusSid).toBeNull()
  })

  it('keeps a remaining superset together and clears a singleton marker', () => {
    const pair = [entry('a', { sid: 'a', sg: 'pair' }), entry('b', { sid: 'b', sg: 'pair' })]
    expect(removeSessionEntry(pair, 0, 0).entries[0]).not.toHaveProperty('sg')

    const trio = [entry('a', { sid: 'a', sg: 'trio' }), entry('b', { sid: 'b', sg: 'trio' }), entry('c', { sid: 'c', sg: 'trio' })]
    expect(removeSessionEntry(trio, 1, 1).entries.map(e => e.sg)).toEqual(['trio', 'trio'])
  })

  it('keeps sid out of history while retaining activity and rest fields in the active snapshot', () => {
    const activeEntry = entry('a', { sid: 'stable-a', activity: 3, rest: 90 })
    const history = copyHistoryEntry(activeEntry)
    expect(history).not.toHaveProperty('sid')
    expect(history).toMatchObject({ id: 'a', sets: activeEntry.sets })
    expect(activeEntry).toMatchObject({ sid: 'stable-a', activity: 3, rest: 90 })
  })
})

describe('next active-session set', () => {
  it('preserves mode-specific carry-forward and defaults without mutating entries', () => {
    const cases = [
      {
        source: entry('run', { target: { mode: 'cardio', min: 20, speed: 8 }, sets: [{ min: 32, speed: 7.5, done: true }] }),
        expected: { min: 32, speed: 7.5, done: false },
      },
      {
        source: entry('run', { target: { mode: 'cardio', min: 0, speed: 0 }, sets: [] }),
        expected: { min: 20, speed: 8, done: false },
      },
      {
        source: entry('plank', { target: { mode: 'time', sec: 45, weight: 20 }, sets: [{ sec: 60, w: 0, done: true }] }),
        expected: { sec: 60, w: 0, done: false },
      },
      {
        source: entry('plank', { target: { mode: 'time', sec: 45, weight: 0 }, sets: [] }),
        expected: { sec: 45, w: 0, done: false },
      },
      {
        source: entry('carry', {
          target: { mode: 'reps', side: true, weight: 40, reps: 12 },
          sets: [{ left: { w: 35, r: 6, done: true }, right: { w: 30, r: 6, done: true }, w: 35, r: 12, done: true }],
          historicalEdit: { workoutId: 'history-1' },
        }),
        expected: { left: { w: 35, r: 6, done: false }, right: { w: 30, r: 6, done: false }, w: 40, r: 12, done: false },
      },
      {
        source: entry('bench', { target: { mode: 'reps', reps: 8, weight: 40 }, sets: [{ w: 50, r: 6, done: true }] }),
        expected: { w: 50, r: 6, done: false },
      },
    ]

    for (const { source, expected } of cases) {
      const before = structuredClone(source)
      expect(nextSet(source)).toEqual(expected)
      expect(source).toEqual(before)
    }
  })
})

describe('focused entry restoration visibility', () => {
  const withViewportHeight = (height, fn) => {
    const hadViewportHeight = Object.prototype.hasOwnProperty.call(globalThis, 'innerHeight')
    const previousHeight = globalThis.innerHeight
    globalThis.innerHeight = height
    try {
      fn()
    } finally {
      if (hadViewportHeight) globalThis.innerHeight = previousHeight
      else delete globalThis.innerHeight
    }
  }

  const targetWith = (top, calls) => ({
    getBoundingClientRect: () => ({ top }),
    focus: options => calls.push(['focus', options]),
    scrollIntoView: options => calls.push(['scroll', options]),
  })

  it('does not scroll a visible target when scroll is requested', () => {
    withViewportHeight(800, () => {
      const calls = []
      expect(restoreFocusedEntry(targetWith(120, calls))).toBe(true)
      expect(calls.map(([kind]) => kind)).toEqual(['focus', 'focus'])
    })
  })

  it('scrolls a target whose header is above or below the viewport', () => {
    withViewportHeight(800, () => {
      for (const top of [-1, 801]) {
        const calls = []
        expect(restoreFocusedEntry(targetWith(top, calls))).toBe(true)
        expect(calls.map(([kind]) => kind)).toEqual(['focus', 'scroll', 'focus'])
      }
    })
  })

  it('keeps scrolling when target geometry is unavailable', () => {
    const calls = []
    const target = {
      focus: options => calls.push(['focus', options]),
      scrollIntoView: options => calls.push(['scroll', options]),
    }
    expect(restoreFocusedEntry(target)).toBe(true)
    expect(calls.map(([kind]) => kind)).toEqual(['focus', 'scroll', 'focus'])
  })
})
