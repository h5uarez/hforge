import { describe, expect, it, vi } from 'vitest'
import { parseNumberDraft, scheduleSetRowFlash } from './ui.jsx'

describe('NumberField drafts', () => {
  it('keeps invalid text out of state while preserving it as a draft', () => {
    expect(parseNumberDraft('abc')).toEqual({ valid: false, value: undefined })
  })

  it('accepts valid numbers and comma decimals', () => {
    expect(parseNumberDraft('105.25')).toEqual({ valid: true, value: 105.25 })
    expect(parseNumberDraft('105,25')).toEqual({ valid: true, value: 105.25 })
  })

  it('keeps nullable empty values empty and non-decimal fields numeric', () => {
    expect(parseNumberDraft('', true, true)).toEqual({ valid: true, value: null })
    expect(parseNumberDraft('12', false)).toEqual({ valid: true, value: 12 })
    expect(parseNumberDraft('12,5', false).valid).toBe(false)
  })
})

describe('Check completion flash', () => {
  it('captures the set row before the deferred callback runs', () => {
    const row = {}
    const button = { closest: vi.fn(() => row) }
    let deferred
    const schedule = vi.fn(callback => { deferred = callback })
    const event = { currentTarget: button }

    scheduleSetRowFlash(event.currentTarget, schedule)
    event.currentTarget = null

    expect(button.closest).toHaveBeenCalledWith('.setrow')
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 0)
    expect(() => deferred()).not.toThrow()
  })
})
