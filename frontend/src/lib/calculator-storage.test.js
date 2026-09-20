import { afterEach, describe, expect, it } from 'vitest'
import {
  HOME_1RM_STORAGE_KEY,
  HOME_WARMUP_STORAGE_KEY,
  STATS_PROGRESS_STORAGE_KEY,
  loadCalculatorState,
  saveCalculatorState,
  sanitizeHome1RMState,
  sanitizeHomeWarmupState,
  sanitizeStatsProgressState,
} from './calculator-storage.js'

const originalStorage = globalThis.localStorage

function installStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  return storage
}

afterEach(() => {
  if (originalStorage === undefined) delete globalThis.localStorage
  else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage })
})

describe('calculator storage', () => {
  it('round-trips each calculator through separate versioned keys', () => {
    installStorage()
    const oneRm = { open: true, kg: 100, reps: 5, rir: 2, res: null }
    const warmup = { open: false, exerciseId: '79D0BB3A', kg: 100, reps: 5, addedKg: 0, rir: null, res: null }

    expect(saveCalculatorState(HOME_1RM_STORAGE_KEY, oneRm)).toBe(true)
    expect(saveCalculatorState(HOME_WARMUP_STORAGE_KEY, warmup)).toBe(true)
    expect(loadCalculatorState(HOME_1RM_STORAGE_KEY, null, sanitizeHome1RMState)).toEqual(oneRm)
    expect(loadCalculatorState(HOME_WARMUP_STORAGE_KEY, null, sanitizeHomeWarmupState)).toEqual(warmup)
  })

  it('accepts a legacy warmup exercise ID but emits the current Hevy ID', () => {
    const state = sanitizeHomeWarmupState({ exerciseId: '0025', open: true, kg: 100, reps: 5, addedKg: 0, rir: null, res: null })
    expect(state.exerciseId).toBe('79D0BB3A')
  })

  it('falls back without throwing for malformed or unavailable storage', () => {
    const fallback = { open: false }
    installStorage({ [HOME_1RM_STORAGE_KEY]: '{not-json' })
    expect(loadCalculatorState(HOME_1RM_STORAGE_KEY, fallback, sanitizeHome1RMState)).toBe(fallback)

    delete globalThis.localStorage
    expect(loadCalculatorState(HOME_1RM_STORAGE_KEY, fallback, sanitizeHome1RMState)).toBe(fallback)
    expect(saveCalculatorState(HOME_1RM_STORAGE_KEY, fallback)).toBe(false)
  })

  it('swallows storage API errors during both reads and writes', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') } },
    })
    const fallback = { open: false }
    expect(loadCalculatorState(HOME_1RM_STORAGE_KEY, fallback, sanitizeHome1RMState)).toBe(fallback)
    expect(saveCalculatorState(HOME_1RM_STORAGE_KEY, fallback)).toBe(false)
  })

  it('sanitizes finite inputs and rejects invalid result shapes', () => {
    expect(sanitizeHome1RMState({
      open: 'yes', kg: '100', reps: 99.4, rir: Infinity,
      res: { est: 100, tier: 'not-a-tier', failureAssumed: false },
    })).toEqual({ open: false, kg: 0, reps: 10, rir: null, res: null })

    expect(sanitizeHomeWarmupState({
      open: true, exerciseId: 'unknown', kg: 80, reps: 5, addedKg: NaN, rir: 8,
      res: { sets: [{ kg: 20, reps: 10, pct: 20, label: 'Empty bar', restSec: 60 }], topLine: '80 × 5' },
    })).toEqual({
      open: true, exerciseId: '79D0BB3A', kg: 80, reps: 5, addedKg: 0, rir: 5,
      res: { sets: [{ kg: 20, reps: 10, pct: 20, label: 'Empty bar', restSec: 60 }], topLine: '80 × 5' },
    })
  })

  it('sanitizes the stats progress selection and falls back on invalid values', () => {
    expect(sanitizeStatsProgressState({
      range: 30, exId: '79D0BB3A', exMetric: 'e1rm',
    })).toEqual({ range: 30, exId: '79D0BB3A', exMetric: 'e1rm' })

    expect(sanitizeStatsProgressState({
      range: 7, exId: 42, exMetric: 'nope',
    })).toEqual({ range: 90, exId: null, exMetric: 'top' })

    expect(sanitizeStatsProgressState(null)).toBe(null)
    expect(sanitizeStatsProgressState('stored')).toBe(null)

    installStorage()
    const progress = { range: 365, exId: null, exMetric: 'effort' }
    expect(saveCalculatorState(STATS_PROGRESS_STORAGE_KEY, progress)).toBe(true)
    expect(loadCalculatorState(STATS_PROGRESS_STORAGE_KEY, null, sanitizeStatsProgressState)).toEqual(progress)
  })
})
