import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { filterSelectOptions, nextScrollState, parseNumberDraft, scheduleSetRowFlash } from './ui.jsx'

const uiSource = readFileSync(new URL('./ui.jsx', import.meta.url), 'utf8')
const statsSource = readFileSync(new URL('../views/Stats.jsx', import.meta.url), 'utf8')
const routineSource = readFileSync(new URL('../views/RoutineEdit.jsx', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../views/Settings.jsx', import.meta.url), 'utf8')
const warmupSource = readFileSync(new URL('./HomeWarmup.jsx', import.meta.url), 'utf8')

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

describe('SelectRow option search', () => {
  const options = [
    { value: 'bench', label: 'Bench press', subtitle: 'Chest' },
    { value: 'row', label: 'Équerre row', subtitle: 'Back' },
    { value: 'squat', label: 'Squat', subtitle: 'Legs' },
  ]

  it('matches labels and subtitles case- and accent-insensitively', () => {
    expect(filterSelectOptions(options, 'EQUERRE')).toEqual([options[1]])
    expect(filterSelectOptions(options, 'bench chest')).toEqual([options[0]])
    expect(filterSelectOptions(options, '')).toBe(options)
  })

  it('returns no options for an unmatched query and leaves search opt-in', () => {
    expect(filterSelectOptions(options, 'deadlift')).toEqual([])
    expect(uiSource).toContain('searchable = false')
    expect(uiSource).toContain('searchable ? filterSelectOptions(options, query) : options')
    expect(uiSource).toContain("t('No options match your search')")
    expect(uiSource).toContain('role="status"')
    expect(statsSource).toContain('onChange={setExId} searchable')
    expect(routineSource).not.toContain('searchable')
    expect(settingsSource).not.toContain('searchable')
    expect(warmupSource).not.toContain('searchable')
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
