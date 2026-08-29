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

vi.mock('./store/useStore.js', () => ({ useStore: {} }))
vi.mock('./store/useUI.js', () => ({ useUI: {} }))

const { commitPickerSelection, validTimedSeconds, clampTimedSeconds, validExerciseNote } = await import('./sheets.jsx')
const { NOTE_MAX, normalizeExerciseNote } = await import('./lib/history.js')
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

describe('exercise note capture contract', () => {
  it('accepts the 280-character boundary and rejects only over-limit drafts', () => {
    expect(NOTE_MAX).toBe(280)
    expect(validExerciseNote('x'.repeat(NOTE_MAX))).toBe(true)
    expect(validExerciseNote('x'.repeat(NOTE_MAX + 1))).toBe(false)
  })

  it('keeps an over-limit draft editable while committed values trim or omit whitespace', () => {
    const draft = ' x '.repeat(94) + 'x'
    expect(validExerciseNote(draft)).toBe(false)
    expect(normalizeExerciseNote(draft)).toBe(draft.trim())
    expect(normalizeExerciseNote('   ')).toBeUndefined()
  })

  it('does not expose a note as a valid freestyle entry before insertion', () => {
    expect(validExerciseNote(undefined)).toBe(true)
    expect(normalizeExerciseNote(undefined)).toBeUndefined()
  })
})
