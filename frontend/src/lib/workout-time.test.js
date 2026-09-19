import { describe, expect, it } from 'vitest'
import {
  formatWorkoutDateTime, localDateKey, parseWorkoutDateTime,
  parseWorkoutTimestampEdit, validateWorkoutTimestamps, classifyWorkoutTimestamps,
  shiftWorkoutTimestamps, normalizeWorkoutDateEdit, chartTimestamp, workoutChartPoint,
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

  it('classifies legacy, valid, mixed, unsafe, and non-ordered timestamp rows', () => {
    expect(classifyWorkoutTimestamps(undefined, undefined)).toEqual({ kind: 'legacy' })
    expect(classifyWorkoutTimestamps(0, 0)).toEqual({ kind: 'legacy' })
    expect(classifyWorkoutTimestamps(1, 1).kind).toBe('timestamped')
    expect(classifyWorkoutTimestamps(1, undefined).reason).toBe('invalid')
    expect(classifyWorkoutTimestamps(-1, 1).reason).toBe('invalid')
    expect(classifyWorkoutTimestamps(1, Infinity).reason).toBe('invalid')
    expect(classifyWorkoutTimestamps(Number.MAX_SAFE_INTEGER + 1, 1).reason).toBe('invalid')
    expect(classifyWorkoutTimestamps(2, 1).reason).toBe('order')
  })

  it('shifts both local timestamps by a calendar day and preserves duration', () => {
    const start = parseWorkoutDateTime('2026-03-08T01:30:00')
    const end = parseWorkoutDateTime('2026-03-08T03:30:00')
    const shifted = shiftWorkoutTimestamps(start, end, '2026-03-08', '2026-03-09')
    expect(shifted.kind).toBe('timestamped')
    expect(shifted.d).toBe('2026-03-09')
    expect(shifted.end - shifted.start).toBe(end - start)
  })

  it('edits legacy dates without inventing start or end fields', () => {
    const edited = normalizeWorkoutDateEdit({ d: '2026-01-01', start: 0, end: 0 }, '2026-01-02')
    expect(edited).toEqual({ d: '2026-01-02' })
  })
})

describe('chart workout timestamps', () => {
  it('preserves valid starts and derives a local-noon fallback for date-only workouts', () => {
    const date = '2026-02-14'
    const valid = parseWorkoutDateTime(`${date}T09:30:00`)
    const fallback = parseWorkoutDateTime(`${date}T12:00:00`)

    expect(chartTimestamp(valid, date)).toBe(valid)
    expect(chartTimestamp(undefined, date)).toBe(fallback)
    expect(chartTimestamp(NaN, date)).toBe(fallback)
    expect(chartTimestamp(0, date)).toBe(fallback)
    expect(workoutChartPoint({ d: date }, 80)).toEqual({ t: fallback, y: 80, d: date })
  })
})
