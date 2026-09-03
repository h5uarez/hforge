import { describe, expect, it } from 'vitest'
import {
  formatWorkoutDateTime, localDateKey, parseWorkoutDateTime,
  parseWorkoutTimestampEdit, validateWorkoutTimestamps,
} from './workout-time.js'

describe('completed workout timestamp editing', () => {
  it('rejects non-finite or malformed timestamps', () => {
    expect(parseWorkoutDateTime('')).toBeNull()
    expect(parseWorkoutDateTime('2026-02-30T10:00:00')).toBeNull()
    expect(validateWorkoutTimestamps(NaN, 1)).toEqual({ ok: false, reason: 'invalid' })
    expect(validateWorkoutTimestamps(Infinity, 1)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects an end time before the start time', () => {
    const result = parseWorkoutTimestampEdit('2026-01-02T10:30:00', '2026-01-02T10:29:59')
    expect(result).toEqual({ ok: false, reason: 'order' })
  })

  it('derives duration and calendar key from valid local timestamps', () => {
    const result = parseWorkoutTimestampEdit('2026-01-02T23:30:00', '2026-01-03T01:15:00')
    expect(result.ok).toBe(true)
    expect(result.duration).toBe(105 * 60 * 1000)
    expect(result.d).toBe('2026-01-02')
    expect(result.d).toBe(localDateKey(result.start))
    expect(formatWorkoutDateTime(result.start)).toBe('2026-01-02T23:30:00')
  })

  it('keeps legacy records backward compatible until both edit fields are valid', () => {
    expect(formatWorkoutDateTime(undefined)).toBe('')
    expect(formatWorkoutDateTime(null)).toBe('')
    expect(parseWorkoutTimestampEdit('', '')).toEqual({ ok: false, reason: 'invalid' })
    expect(validateWorkoutTimestamps(undefined, undefined)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('allows equal start and end timestamps', () => {
    const start = parseWorkoutDateTime('2026-01-02T10:00:00')
    expect(validateWorkoutTimestamps(start, start)).toMatchObject({ ok: true, duration: 0, d: '2026-01-02' })
  })
})
