import { describe, it, expect } from 'vitest'
import { buildWarmup, resolveKind, isBodyweightKind, DEFAULT_WARMUP_CONFIG, WARMUP_OPTIONS } from './warmup.js'

const plates = sets => sets.map(s => [s.kg, s.reps])

describe('resolveKind', () => {
  it('maps catalog ids and short keys to lift families', () => {
    expect(resolveKind('0025')).toBe('bench')
    expect(resolveKind('0043')).toBe('squat')
    expect(resolveKind('0032')).toBe('deadlift')
    expect(resolveKind('0652')).toBe('pullup')
    expect(resolveKind('0251')).toBe('dip')
    expect(resolveKind('0091')).toBe('ohp')
    expect(resolveKind('bench')).toBe('bench')
    expect(resolveKind('dip')).toBe('dip')
  })

  it('passes unknown and custom exercises through to the generic barbell ladder', () => {
    expect(resolveKind('custom-123')).toBe('generic')
    expect(resolveKind(undefined)).toBe('generic')
    expect(isBodyweightKind('pullup')).toBe(true)
    expect(isBodyweightKind('dip')).toBe(true)
    expect(isBodyweightKind('bench')).toBe(false)
  })

  it('lists one option per supported family', () => {
    expect(WARMUP_OPTIONS.map(o => o.key)).toEqual(['bench', 'squat', 'deadlift', 'ohp', 'pullup', 'dip'])
  })
})

describe('buildWarmup bench', () => {
  it('climbs bar x10, 50% x5, 70% x3, 85% x1 into a 100x5 top set', () => {
    expect(plates(buildWarmup({ exerciseId: '0025', topKg: 100, topReps: 5 })))
      .toEqual([[20, 10], [50, 5], [70, 3], [85, 1]])
  })

  it('labels the opener as an empty bar with a short rest', () => {
    const [first] = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5 })
    expect(first.label).toBe('Empty bar')
    expect(first.restSec).toBe(60)
  })

  it('rounds every plate to the configured rounding', () => {
    const sets = buildWarmup({ exerciseId: 'bench', topKg: 93, topReps: 5 })
    expect(plates(sets)).toEqual([[20, 10], [47.5, 5], [65, 3], [80, 1]])
    for (const s of sets) expect(Math.round(s.kg * 100) % 250).toBe(0)
  })

  it('caps the ladder at 90 percent, 92 only for advanced triples or less', () => {
    const squat = buildWarmup({ exerciseId: 'squat', topKg: 100, topReps: 5 })
    expect(squat[squat.length - 1]).toMatchObject({ kg: 90, reps: 1 })
    // The 92 ceiling only binds prescriptions hotter than the ladders ever go —
    // the squat 90 % single survives it unchanged.
    const adv = buildWarmup({ exerciseId: 'squat', topKg: 100, topReps: 3, config: { experience: 'advanced' } })
    expect(adv[adv.length - 1]).toMatchObject({ kg: 90, reps: 1 })
    const adv5 = buildWarmup({ exerciseId: 'squat', topKg: 100, topReps: 5, config: { experience: 'advanced' } })
    expect(adv5[adv5.length - 1]).toMatchObject({ kg: 90, reps: 1 })
  })

  it('drops the heaviest single when the top set grinds (RPE 9+) or runs long (10+ reps)', () => {
    const fresh = plates(buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5 }))
    const grind = plates(buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5, rpe: 9 }))
    const long = plates(buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 10 }))
    expect(fresh).toEqual([[20, 10], [50, 5], [70, 3], [85, 1]])
    expect(grind).toEqual([[20, 10], [50, 5], [70, 3]])
    expect(long).toEqual([[20, 10], [50, 5], [70, 3]])
  })

  it('keeps light tops to bar plus one step', () => {
    const sets = buildWarmup({ exerciseId: 'bench', topKg: 25, topReps: 5 })
    expect(sets.length).toBeLessThanOrEqual(2)
  })

  it('needs no warmup at or below the bar', () => {
    expect(buildWarmup({ exerciseId: 'bench', topKg: 20, topReps: 5 })).toEqual([])
  })

  it('dedups plates that round onto each other, keeping the heavier rung', () => {
    const sets = buildWarmup({ exerciseId: 'bench', topKg: 32, topReps: 5 })
    expect(new Set(sets.map(s => s.kg)).size).toBe(sets.length)
  })

  it('rejects invalid input with an empty ladder', () => {
    expect(buildWarmup({ exerciseId: 'bench', topKg: 0, topReps: 5 })).toEqual([])
    expect(buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 0 })).toEqual([])
    expect(buildWarmup({ exerciseId: 'bench', topKg: NaN, topReps: 5 })).toEqual([])
    expect(buildWarmup()).toEqual([])
  })
})

describe('buildWarmup overhead press', () => {
  it('caps the single at 80 percent on small plates', () => {
    const sets = buildWarmup({ exerciseId: '0091', topKg: 60, topReps: 5 })
    expect(plates(sets)).toEqual([[20, 10], [30, 5], [42.5, 3], [47.5, 1]])
    for (const s of sets.filter(x => !x.label)) expect(Math.round(s.kg * 100) % 125).toBe(0)
  })
})

describe('buildWarmup squat', () => {
  it('walks 40/60/80/90 percent with fives in the middle', () => {
    expect(plates(buildWarmup({ exerciseId: '0043', topKg: 140, topReps: 5 })))
      .toEqual([[20, 8], [55, 5], [85, 5], [112.5, 2], [125, 1]])
  })
})

describe('buildWarmup deadlift', () => {
  it('never prescribes an empty bar and floors the opener at 60 kg', () => {
    const sets = buildWarmup({ exerciseId: '0032', topKg: 180, topReps: 3 })
    expect(plates(sets)).toEqual([[72.5, 5], [107.5, 3], [135, 2], [157.5, 1]])
    expect(sets.every(s => s.label !== 'Empty bar')).toBe(true)
    const light = buildWarmup({ exerciseId: 'deadlift', topKg: 100, topReps: 5 })
    expect(light[0].kg).toBe(60)
  })

  it('pulls the 75 percent double down to a single in singles mode', () => {
    const sets = buildWarmup({ exerciseId: 'deadlift', topKg: 180, topReps: 3, config: { deadliftMode: 'singles' } })
    expect(plates(sets)).toEqual([[72.5, 5], [107.5, 3], [135, 1], [157.5, 1]])
    expect(sets[sets.length - 1].restSec).toBe(240)
  })
})

describe('buildWarmup bodyweight', () => {
  it('climbs half and three-quarter belt load into a BW+20 top set', () => {
    const sets = buildWarmup({ exerciseId: '0652', topKg: 20, topReps: 5, addedKg: 20 })
    expect(plates(sets)).toEqual([[0, 6], [10, 3], [15, 1]])
    expect(sets[0].label).toBe('Bodyweight')
  })

  it('keeps unweighted work to two bodyweight sets', () => {
    expect(plates(buildWarmup({ exerciseId: 'dip', topKg: 0, topReps: 8, addedKg: 0 })))
      .toEqual([[0, 6], [0, 3]])
    expect(plates(buildWarmup({ exerciseId: '0652', topKg: 5, topReps: 8, addedKg: 0 })))
      .toEqual([[0, 6], [0, 3]])
  })

  it('drops the belt single when the top set runs long', () => {
    const sets = buildWarmup({ exerciseId: '0652', topKg: 20, topReps: 12, addedKg: 20 })
    expect(plates(sets)).toEqual([[0, 6], [10, 3]])
  })
})

describe('buildWarmup config', () => {
  it('ships intermediate, 20 kg bar, 2.5 rounding, standard pace defaults', () => {
    expect(DEFAULT_WARMUP_CONFIG).toEqual({
      experience: 'intermediate', barKg: 20, roundingKg: 2.5, style: 'standard', deadliftMode: 'reps',
    })
  })

  it('honours a 15 kg bar and 1.25 rounding', () => {
    const sets = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5, config: { barKg: 15, roundingKg: 1.25 } })
    expect(sets[0]).toMatchObject({ kg: 15, reps: 10 })
  })

  it('stretches rests on a conservative pace and compresses them on aggressive', () => {
    const std = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5 })
    const slow = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5, config: { style: 'conservative' } })
    const fast = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5, config: { style: 'aggressive' } })
    expect(plates(slow)).toEqual(plates(std))
    expect(plates(fast)).toEqual(plates(std))
    expect(slow.map(s => s.restSec)).toEqual([75, 120, 150, 225])
    expect(std.map(s => s.restSec)).toEqual([60, 90, 120, 180])
    expect(slow[0].restSec).toBeGreaterThan(std[0].restSec)
    expect(fast[0].restSec).toBeLessThan(std[0].restSec)
  })
})
