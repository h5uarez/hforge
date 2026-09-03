import { describe, it, expect } from 'vitest'
import { buildWarmup, resolveKind, isBodyweightKind, DEFAULT_WARMUP_CONFIG, WARMUP_OPTIONS } from './warmup.js'

const plates = sets => sets.map(s => [s.kg, s.reps])
const gaps = sets => sets.slice(1).map((s, i) => Math.round((s.kg - sets[i].kg) * 100) / 100)

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
  it('builds a capped-jump ladder into a 100x5 top set, ending at 83% with a double', () => {
    expect(plates(buildWarmup({ exerciseId: '0025', topKg: 100, topReps: 5 })))
      .toEqual([[20, 10], [55, 5], [70, 3], [82.5, 2]])
  })

  it('regression: BP 140x1 climbs six rungs with no barbaric jump and parks >= 88%', () => {
    const sets = buildWarmup({ exerciseId: 'bench', topKg: 140, topReps: 1 })
    expect(plates(sets)).toEqual([[20, 10], [77.5, 5], [97.5, 3], [112.5, 1], [122.5, 1], [130, 1]])
    expect(sets).toHaveLength(6)
    // The opener gap is exempt (the bar is where it is); every other jump is capped.
    expect(gaps(sets).slice(1).every(g => g <= 25)).toBe(true)
    expect(sets[sets.length - 1].kg / 140).toBeGreaterThanOrEqual(0.88)
  })

  it('labels the opener as an empty bar with a short rest', () => {
    const [first] = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5 })
    expect(first.label).toBe('Empty bar')
    expect(first.restSec).toBe(60)
  })

  it('rounds every plate to the configured rounding', () => {
    const sets = buildWarmup({ exerciseId: 'bench', topKg: 93, topReps: 5 })
    expect(plates(sets)).toEqual([[20, 10], [50, 5], [65, 3], [77.5, 2]])
    for (const s of sets) expect(Math.round(s.kg * 100) % 250).toBe(0)
  })

  it('ends near the top for singles and lower for high-rep tops, tuned by experience', () => {
    const single = buildWarmup({ exerciseId: 'squat', topKg: 100, topReps: 1 })
    expect(single[single.length - 1].kg / 100).toBeGreaterThanOrEqual(0.90)
    const five = buildWarmup({ exerciseId: 'squat', topKg: 100, topReps: 5 })
    expect(five[five.length - 1]).toMatchObject({ kg: 82.5, reps: 2 })
    // The 92 ceiling binds for advanced lifters going heavy…
    const adv = buildWarmup({ exerciseId: 'squat', topKg: 100, topReps: 3, config: { experience: 'advanced' } })
    expect(adv[adv.length - 1]).toMatchObject({ kg: 90, reps: 1 })
    // …while beginners park a rung lower than intermediates.
    const beg = buildWarmup({ exerciseId: 'squat', topKg: 100, topReps: 5, config: { experience: 'beginner' } })
    expect(beg[beg.length - 1].kg).toBeLessThan(five[five.length - 1].kg)
  })

  it('shortens the runway through a lower ceiling when the top set grinds or runs long', () => {
    const fresh = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5 })
    const grind = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5, rpe: 9 })
    const long = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 10 })
    // Fatigue lowers the ceiling instead of deleting the heaviest single.
    expect(plates(grind)).toEqual([[20, 10], [40, 5], [55, 5], [70, 3], [77.5, 3]])
    expect(grind[grind.length - 1].kg).toBeLessThan(fresh[fresh.length - 1].kg)
    expect(plates(grind)[0]).toEqual([20, 10])
    expect(long[long.length - 1].kg).toBeLessThan(fresh[fresh.length - 1].kg)
  })

  it('ignores RPE decimals below the grind threshold by design, but reacts at 9.0', () => {
    const at7 = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5, rpe: 7 })
    const at75 = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5, rpe: 7.5 })
    // Decimals are parsed (Number, never parseInt) yet change nothing here: only the
    // 9.0 fatigue cliff moves the ceiling.
    expect(plates(at75)).toEqual(plates(at7))
    const at89 = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5, rpe: 8.9 })
    const at90 = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5, rpe: 9.0 })
    expect(plates(at90)).not.toEqual(plates(at89))
    expect(at90[at90.length - 1].kg).toBeLessThan(at89[at89.length - 1].kg)
  })

  it('keeps light tops to bar plus the heavy end, never the light end', () => {
    expect(plates(buildWarmup({ exerciseId: 'bench', topKg: 25, topReps: 5 }))).toEqual([[20, 10]])
    // slice(-n): the rungs closest to the top survive, not the lightest ones.
    expect(plates(buildWarmup({ exerciseId: 'bench', topKg: 40, topReps: 5 })))
      .toEqual([[20, 10], [27.5, 3], [32.5, 2]])
  })

  it('needs no warmup at or below the bar', () => {
    expect(buildWarmup({ exerciseId: 'bench', topKg: 20, topReps: 5 })).toEqual([])
  })

  it('dedups plates that round onto each other, keeping the heavier rung', () => {
    const sets = buildWarmup({ exerciseId: 'bench', topKg: 32, topReps: 5 })
    expect(plates(sets)).toEqual([[20, 10], [27.5, 2]])
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
  it('climbs small plates into a 60x5 top set with capped jumps', () => {
    const sets = buildWarmup({ exerciseId: '0091', topKg: 60, topReps: 5 })
    expect(plates(sets)).toEqual([[20, 10], [32.5, 5], [37.5, 5], [42.5, 3], [47.5, 3], [50, 2]])
    for (const s of sets.filter(x => !x.label)) expect(Math.round(s.kg * 100) % 125).toBe(0)
    expect(gaps(sets).slice(1).every(g => g <= 10)).toBe(true)
  })
})

describe('buildWarmup squat', () => {
  it('walks a capped ladder with fives in the middle into 140x5', () => {
    expect(plates(buildWarmup({ exerciseId: '0043', topKg: 140, topReps: 5 })))
      .toEqual([[20, 8], [55, 5], [77.5, 5], [97.5, 3], [107.5, 3], [115, 2]])
  })

  it('earns a longer runway into a heavy triple without jumping more than 30', () => {
    const sets = buildWarmup({ exerciseId: 'squat', topKg: 180, topReps: 3 })
    expect(plates(sets)).toEqual([[20, 8], [72.5, 5], [100, 5], [125, 3], [135, 3], [145, 2], [157.5, 2], [162.5, 1]])
    expect(gaps(sets).slice(1).every(g => g <= 30)).toBe(true)
    expect(sets[sets.length - 1].kg / 180).toBeGreaterThanOrEqual(0.90)
  })
})

describe('buildWarmup deadlift', () => {
  it('never prescribes an empty bar and starts at max(60, 40%)', () => {
    const sets = buildWarmup({ exerciseId: '0032', topKg: 200, topReps: 1 })
    expect(plates(sets)).toEqual([[80, 5], [110, 3], [140, 2], [152.5, 1], [165, 1], [185, 1]])
    expect(sets.every(s => s.label !== 'Empty bar')).toBe(true)
    const light = buildWarmup({ exerciseId: 'deadlift', topKg: 100, topReps: 5 })
    expect(light.some(s => s.kg === 60)).toBe(true)
    expect(light.every(s => s.label !== 'Empty bar')).toBe(true)
  })

  it('caps jumps at the deadlift table and parks a single at ~90% into 180x3', () => {
    const sets = buildWarmup({ exerciseId: 'deadlift', topKg: 180, topReps: 3 })
    expect(plates(sets)).toEqual([[72.5, 5], [100, 3], [125, 2], [137.5, 2], [147.5, 1], [162.5, 1]])
    expect(gaps(sets).every(g => g <= 40)).toBe(true)
  })

  it('turns the 82 percent double into a single in singles mode with a long last rest', () => {
    const sets = buildWarmup({ exerciseId: 'deadlift', topKg: 180, topReps: 3, config: { deadliftMode: 'singles' } })
    expect(plates(sets)).toEqual([[72.5, 5], [100, 3], [125, 2], [137.5, 1], [147.5, 1], [162.5, 1]])
    expect(sets[sets.length - 1].restSec).toBe(240)
  })
})

describe('buildWarmup golden ladders', () => {
  it('holds the reference ladders for the big four acceptance cases', () => {
    expect(plates(buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5 })))
      .toEqual([[20, 10], [55, 5], [70, 3], [82.5, 2]])
    expect(plates(buildWarmup({ exerciseId: 'squat', topKg: 180, topReps: 3 })))
      .toEqual([[20, 8], [72.5, 5], [100, 5], [125, 3], [135, 3], [145, 2], [157.5, 2], [162.5, 1]])
    expect(plates(buildWarmup({ exerciseId: 'deadlift', topKg: 200, topReps: 1 })))
      .toEqual([[80, 5], [110, 3], [140, 2], [152.5, 1], [165, 1], [185, 1]])
    expect(plates(buildWarmup({ exerciseId: 'ohp', topKg: 60, topReps: 5 })))
      .toEqual([[20, 10], [32.5, 5], [37.5, 5], [42.5, 3], [47.5, 3], [50, 2]])
  })
})

describe('buildWarmup ladder invariants', () => {
  const cases = [
    ['bench', 60, 5], ['bench', 100, 5], ['bench', 140, 1], ['bench', 180, 1],
    ['squat', 100, 5], ['squat', 140, 5], ['squat', 180, 3], ['squat', 220, 1],
    ['deadlift', 120, 5], ['deadlift', 180, 3], ['deadlift', 200, 1], ['deadlift', 240, 1],
    ['ohp', 40, 5], ['ohp', 60, 5], ['ohp', 80, 3],
    ['custom-9', 90, 5],
  ]
  const maxCap = { bench: 25, squat: 30, deadlift: 40, ohp: 10, generic: 25 }
  const minSep = { ohp: 2.5 }

  it.each(cases)('%s %skg x%s stays climbable: ordered, capped, separated, parked near the top', (id, top, reps) => {
    const sets = buildWarmup({ exerciseId: id, topKg: top, topReps: reps })
    expect(sets.length).toBeGreaterThan(0)
    const kind = resolveKind(id)
    const cap = maxCap[kind]
    const sep = minSep[kind] ?? 5
    const kgs = sets.map(s => s.kg)
    expect([...kgs].sort((a, b) => a - b)).toEqual(kgs)
    expect(new Set(kgs).size).toBe(kgs.length)
    for (const s of sets) expect(s.kg).toBeLessThan(top)
    const gs = gaps(sets)
    // Opener gap exempt; every other jump within the family table.
    expect(gs.slice(sets[0].label === 'Empty bar' ? 1 : 0).every(g => g <= cap)).toBe(true)
    // Minimum separation between neighbours (opener gap exempt the same way).
    const seps = sets[0].label === 'Empty bar' ? gs.slice(1) : gs
    expect(seps.every(g => g >= sep - 1e-9)).toBe(true)
    // Parked near the top but never on it.
    const lastPct = sets[sets.length - 1].kg / top
    expect(lastPct).toBeGreaterThanOrEqual(0.70)
    expect(lastPct).toBeLessThanOrEqual(0.93)
    // Reps taper toward the top.
    const repsSeq = sets.map(s => s.reps)
    expect([...repsSeq].sort((a, b) => b - a)).toEqual(repsSeq)
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

  it('adds a rung and stretches rests on conservative, trims one and compresses on aggressive', () => {
    const std = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5 })
    const slow = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5, config: { style: 'conservative' } })
    const fast = buildWarmup({ exerciseId: 'bench', topKg: 100, topReps: 5, config: { style: 'aggressive' } })
    expect(plates(slow)).toEqual([[20, 10], [40, 5], [55, 5], [70, 3], [77.5, 3], [82.5, 2]])
    expect(plates(fast)).toEqual([[20, 10], [70, 3], [82.5, 2]])
    expect(slow.length).toBeGreaterThan(std.length)
    expect(fast.length).toBeLessThan(std.length)
    expect(std.map(s => s.restSec)).toEqual([60, 90, 120, 150])
    expect(slow[0].restSec).toBeGreaterThan(std[0].restSec)
    expect(fast[0].restSec).toBeLessThan(std[0].restSec)
  })
})
