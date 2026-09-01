import { describe, expect, it } from 'vitest'
import { parseNumberDraft } from './ui.jsx'

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
