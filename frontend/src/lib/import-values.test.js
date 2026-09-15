import { describe, it, expect } from 'vitest'
import { p2, MON, parseWhen, hm, toMinutes, KM, toKm } from './import-values.js'

describe('import scalar and date values', () => {
  it('parses ISO dates with optional time', () => {
    expect(parseWhen('2020-12-30 18:51:52')).toEqual({ d: '2020-12-30', t: 67860000 })
    expect(parseWhen('2024-3-7T8:05')).toEqual({ d: '2024-03-07', t: 29100000 })
  })

  it('parses month-name dates in both common orders', () => {
    expect(parseWhen('22 Dec 2025, 08:00')).toEqual({ d: '2025-12-22', t: 28800000 })
    expect(parseWhen('Mar 7, 2024')).toEqual({ d: '2024-03-07', t: null })
  })

  it('uses day-first interpretation for ambiguous numeric dates', () => {
    expect(parseWhen('07/03/2024')).toEqual({ d: '2024-03-07', t: null })
    expect(parseWhen('13/02/2024, 06:30')).toEqual({ d: '2024-02-13', t: 23400000 })
  })

  it('keeps the scalar date helpers dependency-free and stable', () => {
    expect(p2(3)).toBe('03')
    expect(MON.dec).toBe(12)
    expect(hm('2', '38')).toBe(9480000)
  })

  it('converts current duration formats to minutes', () => {
    expect(toMinutes('01:30:00')).toBe(90)
    expect(toMinutes('1:02')).toBe(1)
    expect(toMinutes('2h 38m')).toBe(158)
    expect(toMinutes('90')).toBe(90)
  })

  it('converts current distance units to kilometres', () => {
    expect(toKm(5, 'mi')).toBe(8.04672)
    expect(toKm('2500', 'm')).toBe(2.5)
    expect(toKm(3, 'unknown')).toBe(3)
    expect(KM.km).toBe(1)
  })
})
