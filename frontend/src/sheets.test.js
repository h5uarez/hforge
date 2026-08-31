// Tests for `commitPickerSelection`, the pure helper exported from sheets.jsx that
// guarantees the picker only closes after the caller's insertion mutation returns.
// Closing too early makes a failed save look successful; closing nothing on failure
// leaves a recoverable picker. The helper exists to make that contract testable.
//
// sheets.jsx transitively imports the Zustand stores at module load, and the stores
// register a `visibilitychange` listener on `document`. The default node test
// environment has no `document`, so we stub the stores out — the helper itself
// touches none of them, so the stub is just an import-time enabler.

import { describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  openSheet: vi.fn(),
  stopRest: vi.fn(),
}))
vi.mock('./store/useStore.js', () => ({ useStore: { getState: mocks.getState } }))
vi.mock('./store/useUI.js', () => ({ useUI: { getState: () => ({ openSheet: mocks.openSheet, stopRest: mocks.stopRest }) } }))
vi.mock('./lib/nav.js', () => ({ nav: vi.fn() }))

const { commitPickerSelection, validTimedSeconds, clampTimedSeconds, weightBounds, clampWeight, adjustWeight, weightControlSteps, savedWeight, fmtWeight, startFlow } = await import('./sheets.jsx')
const { parseTimedSeconds, timedSecondsInput, defaultConfig, buildSets } = await import('./lib/history.js')

describe('commitPickerSelection', () => {
  it('calls commit() before closePicker() when the commit succeeds', () => {
    const order = []
    const commit = vi.fn(() => { order.push('commit') })
    const closePicker = vi.fn(() => { order.push('close') })

    commitPickerSelection(commit, closePicker)

    expect(order).toEqual(['commit', 'close'])
    expect(commit).toHaveBeenCalledTimes(1)
    expect(closePicker).toHaveBeenCalledTimes(1)
  })

  it('does not call closePicker() when commit() throws, so the picker stays recoverable', () => {
    const closePicker = vi.fn()
    const failing = () => { throw new Error('save failed') }

    expect(() => commitPickerSelection(failing, closePicker)).toThrow('save failed')
    expect(closePicker).not.toHaveBeenCalled()
  })

  it('only invokes the closer that was passed in, leaving any unrelated closer alone', () => {
    const thisCloser = vi.fn()
    const otherCloser = vi.fn()
    const commit = vi.fn()

    commitPickerSelection(commit, thisCloser)

    expect(thisCloser).toHaveBeenCalledTimes(1)
    expect(otherCloser).not.toHaveBeenCalled()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('passes the picker id invariant intact: a thrown commit leaves every closer untouched', () => {
    const thisCloser = vi.fn()
    const otherCloser = vi.fn()
    const failing = () => { throw new Error('boom') }

    expect(() => commitPickerSelection(failing, thisCloser)).toThrow('boom')
    expect(thisCloser).not.toHaveBeenCalled()
    expect(otherCloser).not.toHaveBeenCalled()
  })
})

describe('timed prescription validation', () => {
  it('initializes only a genuinely new timed config to 45 seconds', () => {
    expect(timedSecondsInput(undefined, '0001')).toBe('45')
    expect(defaultConfig('0001', 'time').sec).toBe(45)
  })
  it('keeps a missing existing value invalid instead of mutating it to 45', () => {
    const existing = { mode: 'time', sets: 3 }
    expect(timedSecondsInput(existing, '0001')).toBe('')
    expect(parseTimedSeconds(timedSecondsInput(existing, '0001'))).toBeNull()
    expect(existing.sec).toBeUndefined()
  })
  it('rejects missing input instead of producing NaN', () => {
    expect(parseTimedSeconds(undefined)).toBeNull()
    expect(parseTimedSeconds('')).toBeNull()
  })
  it('returns the validated value used for persistence', () => {
    expect(parseTimedSeconds('45')).toBe(45)
  })
  it.each(['1', '45', ' 90 '])('accepts positive whole seconds %j', raw => expect(validTimedSeconds(raw)).toBe(true))
  it.each(['', ' ', '0', '-1', '12.5', 'abc', '1e3', '9007199254740992'])('rejects unsafe seconds %j', raw => expect(validTimedSeconds(raw)).toBe(false))
  it('keeps stepper decrement at one second without a fallback', () => {
    expect(clampTimedSeconds(0)).toBe(1)
    expect(clampTimedSeconds(1 - 5)).toBe(1)
    expect(validTimedSeconds(String(clampTimedSeconds(1 - 5)))).toBe(true)
  })
  it('does not restore a malformed timed config with a 45-second fallback', () => {
    const S = { exWeights: {}, workouts: [] }
    expect(buildSets(S, { id: '0001', mode: 'time', sets: 1 }).at(0).sec).toBeUndefined()
  })
  it('persists a valid whole-second value exactly', () => {
    expect(parseTimedSeconds('75')).toBe(75)
    expect(parseTimedSeconds('12.5')).toBeNull()
  })
})

describe('weight bounds and precision modes', () => {
  it('uses equivalent 1–180 kg and 1–396 lb limits', () => {
    expect(weightBounds('kg')).toEqual({ min: 1, max: 180, step: 1 })
    expect(weightBounds('lb')).toEqual({ min: 1, max: 396, step: 1 })
    expect(clampWeight(1, 'kg')).toBe(1)
    expect(clampWeight(180, 'kg')).toBe(180)
    expect(clampWeight(396, 'lb')).toBe(396)
  })

  it('keeps the slider and primary controls on whole-kilogram values by default', () => {
    expect(clampWeight(181.27, 'kg')).toBe(180)
    expect(clampWeight(397, 'lb')).toBe(396)
    expect(clampWeight(72.34, 'kg')).toBe(72)
    expect(clampWeight(72.5, 'kg')).toBe(73)
    expect(clampWeight(72.5, 'lb')).toBe(73)
    expect(adjustWeight(72, -1, 'kg')).toBe(71)
    expect(adjustWeight(72, 1, 'kg')).toBe(73)
  })

  it('keeps the top-weight slider and primary controls at one kilogram', () => {
    expect(weightBounds('kg').step).toBe(1)
    expect(weightControlSteps(true)).toEqual({ primary: 1, chips: [-0.25, 0.25] })
    expect(adjustWeight(122.5, -weightControlSteps(true).primary, 'kg', true)).toBe(121.5)
    expect(adjustWeight(122.5, weightControlSteps(true).primary, 'kg', true)).toBe(123.5)
    expect(adjustWeight(7.25, -0.25, 'kg', true)).toBe(7)
    expect(adjustWeight(7.25, 0.25, 'kg', true)).toBe(7.5)
  })

  it('keeps whole-unit defaults for primary and chip controls', () => {
    expect(weightControlSteps(false)).toEqual({ primary: 1, chips: [-1, 1] })
    expect(adjustWeight(72, -weightControlSteps(false).primary, 'kg')).toBe(71)
    expect(adjustWeight(72, weightControlSteps(false).primary, 'kg')).toBe(73)
  })

  it.each([
    ['manual bodyweight', 'kg', 181.27, 180],
    ['goal weight', 'kg', 181.27, 180],
    ['top weight', 'lb', 397, 396],
  ])('clamps the %s save consumer through the shared helper', (_consumer, unit, value, expected) => {
    expect(savedWeight(value, unit)).toBe(expected)
  })

  it('rejects invalid save values without changing the whole-kilogram default', () => {
    expect(savedWeight('', 'kg')).toBeNull()
    expect(savedWeight('not-a-weight', 'lb')).toBeNull()
    expect(savedWeight(72.34, 'kg')).toBe(72)
  })

  it('keeps bodyweight and goal persistence whole-kilogram only', () => {
    expect(savedWeight(72.5, 'kg')).toBe(73)
    expect(savedWeight('72.5', 'kg')).toBe(73)
    expect(savedWeight(0.5, 'kg')).toBe(1)
  })

  it('preserves two decimals for the explicit top-weight save mode', () => {
    expect(clampWeight(122.544, 'kg', true)).toBe(122.54)
    expect(clampWeight(122.545, 'kg', true)).toBe(122.55)
    expect(clampWeight(122.556, 'kg', true)).toBe(122.56)
    expect(savedWeight('122.55', 'kg', true)).toBe(122.55)
    expect(savedWeight(122.556, 'kg', true)).toBe(122.56)
    expect(fmtWeight(7.25, true)).toBe('7.25')
  })

  it('accepts comma decimal input for explicit top-weight saves', () => {
    expect(clampWeight('7,25', 'kg', true)).toBe(7.25)
    expect(savedWeight('7,25', 'kg', true)).toBe(7.25)
  })

  it('applies fine top-weight adjustments without floating-point artifacts', () => {
    expect(adjustWeight(122.55, -0.5, 'kg', true)).toBe(122.05)
    expect(adjustWeight(122.55, 0.5, 'kg', true)).toBe(123.05)
    expect(adjustWeight(122.55, -0.1, 'kg', true)).toBe(122.45)
    expect(adjustWeight(122.55, 0.1, 'kg', true)).toBe(122.65)
    expect(adjustWeight(122.5, -0.5, 'kg', true)).toBe(122)
    expect(adjustWeight(122.5, 0.5, 'kg', true)).toBe(123)
    expect(adjustWeight(122.5, -0.1, 'kg', true)).toBe(122.4)
    expect(adjustWeight(122.5, 0.1, 'kg', true)).toBe(122.6)
    expect(adjustWeight(122.6, -0.1, 'kg', true)).toBe(122.5)
  })

  it('clamps fine top-weight adjustments to the same valid bounds', () => {
    expect(adjustWeight(1, -0.5, 'kg', true)).toBe(1)
    expect(adjustWeight(180, 0.1, 'kg', true)).toBe(180)
    expect(savedWeight(0.5, 'kg', true)).toBe(1)
  })
})

describe('centralized workout start flow', () => {
  const stateFor = bodyweightCheckEnabled => ({
    S: {
      bodyweightCheckEnabled,
      routines: [{ id: 'today-routine', name: 'Today', ex: [] }, { id: 'other-routine', name: 'Other', ex: [] }],
      exWeights: {}, workouts: [], bodyweight: [], activeBlock: null, blocks: [],
    },
    update(mut) { mut(this.S) },
  })

  it.each([
    ['Today', 'today-routine'],
    ['other routine', 'other-routine'],
    ['freestyle', null],
  ])('keeps the quick-check sheet for enabled %s starts', (_variant, routineId) => {
    mocks.getState.mockReturnValue(stateFor(true))
    mocks.openSheet.mockReset()
    startFlow(routineId)
    expect(mocks.openSheet).toHaveBeenCalledWith(expect.any(Function), { locked: true })
    const options = mocks.openSheet.mock.calls.at(-1)[0]
    expect(options({})).toHaveProperty('props.required', true)
  })

  it.each([
    ['Today', 'today-routine'],
    ['other routine', 'other-routine'],
    ['freestyle', null],
  ])('bypasses the sheet and starts %s with a null bodyweight when disabled', (_variant, routineId) => {
    const state = stateFor(false)
    mocks.getState.mockReturnValue(state)
    mocks.openSheet.mockReset()
    startFlow(routineId)
    expect(mocks.openSheet).not.toHaveBeenCalled()
    expect(state.S.active).toEqual(expect.objectContaining({ routineId, bw: null }))
  })
})
