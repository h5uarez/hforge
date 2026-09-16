import { describe, expect, it, vi } from 'vitest'
import { nextScrollState, parseNumberDraft, scheduleSetRowFlash } from './ui.jsx'

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

describe('Directional document scroll state', () => {
  it('compacts after meaningful downward movement and expands on meaningful upward movement', () => {
    let state = nextScrollState(0, 30)
    expect(state).toEqual({ baselineY: 30, direction: 'down', compact: true })

    state = nextScrollState(state.baselineY, 27, state.direction)
    expect(state).toEqual({ baselineY: 30, direction: 'down', compact: true })

    state = nextScrollState(state.baselineY, 24, state.direction)
    expect(state).toEqual({ baselineY: 24, direction: 'up', compact: false })
  })

  it('accumulates small frames, restores at the top, and clamps bounce values', () => {
    let state = nextScrollState(0, 2)
    expect(state.compact).toBe(false)
    state = nextScrollState(state.baselineY, 3, state.direction)
    expect(state.baselineY).toBe(0)
    state = nextScrollState(state.baselineY, 5, state.direction)
    expect(state.direction).toBe('down')

    state = nextScrollState(state.baselineY, -8, state.direction)
    expect(state).toEqual({ baselineY: 0, direction: 'up', compact: false })
  })
})
