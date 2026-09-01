import { describe, expect, it } from 'vitest'
import { normalizeActiveSession, sessionUnits, moveSessionUnit, remapCur } from './session.js'
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

  it('keeps sid out of history while retaining activity and rest fields in the active snapshot', () => {
    const activeEntry = entry('a', { sid: 'stable-a', activity: 3, rest: 90 })
    const history = copyHistoryEntry(activeEntry)
    expect(history).not.toHaveProperty('sid')
    expect(history).toMatchObject({ id: 'a', sets: activeEntry.sets })
    expect(activeEntry).toMatchObject({ sid: 'stable-a', activity: 3, rest: 90 })
  })
})
