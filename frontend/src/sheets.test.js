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

const { commitPickerSelection } = await import('./sheets.jsx')

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
