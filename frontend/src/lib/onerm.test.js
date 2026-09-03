import { describe, it, expect } from 'vitest'
import { estimate1RM, estimateWithEffort, bestSetOf, e1rmSeries, best1RM, is1RMRecord, REP_CAP, FORMULAS } from './onerm.js'
import { rirOf } from './effort.js'

describe('estimate1RM', () => {
  it('returns the load unchanged for a single rep', () => {
    expect(estimate1RM(100, 1)).toBe(100)
    expect(estimate1RM(62.5, 1)).toBe(62.5)
  })

  it('matches Epley by hand across the usual rep ranges', () => {
    expect(estimate1RM(100, 5)).toBe(116.7)   // 100 · (1 + 5/30)
    expect(estimate1RM(100, 10)).toBe(133.3)
    expect(estimate1RM(80, 8)).toBe(101.3)
    expect(estimate1RM(60, 3)).toBe(66)
  })

  it('rounds to one decimal', () => {
    expect(estimate1RM(101.25, 7)).toBe(124.9)
    expect(Number.isInteger(estimate1RM(100, 3) * 10)).toBe(true)
  })

  it('refuses reps beyond the cap rather than guessing', () => {
    expect(estimate1RM(100, REP_CAP)).not.toBeNull()
    expect(estimate1RM(100, REP_CAP + 1)).toBeNull()
    expect(estimate1RM(60, 30)).toBeNull()
  })

  it('rejects invalid, zero and negative input', () => {
    expect(estimate1RM(0, 5)).toBeNull()
    expect(estimate1RM(-100, 5)).toBeNull()
    expect(estimate1RM(100, 0)).toBeNull()
    expect(estimate1RM(100, -3)).toBeNull()
    expect(estimate1RM(undefined, 5)).toBeNull()
    expect(estimate1RM(100, undefined)).toBeNull()
    expect(estimate1RM(NaN, 5)).toBeNull()
    expect(estimate1RM(Infinity, 5)).toBeNull()
    expect(estimate1RM('', '')).toBeNull()
  })

  it('accepts numeric strings, the shape number inputs arrive in', () => {
    expect(estimate1RM('100', '5')).toBe(116.7)
  })

  it('offers the other documented formulas and agrees with them at low reps', () => {
    expect(estimate1RM(100, 5, 'brzycki')).toBe(112.5)
    expect(estimate1RM(100, 5, 'lombardi')).toBe(117.5)
    expect(Object.keys(FORMULAS)).toContain('epley')
  })

  it('keeps the formulas within a few percent up to 8 reps, and diverges most at the cap', () => {
    const spread = r => Math.max(...Object.keys(FORMULAS).map(f => estimate1RM(100, r, f)))
      - Math.min(...Object.keys(FORMULAS).map(f => estimate1RM(100, r, f)))
    expect(spread(1)).toBe(0)                       // one rep is measured, not estimated
    for (let r = 2; r <= 8; r++) expect(spread(r)).toBeLessThan(6)
    const upTo = []
    for (let r = 1; r < REP_CAP; r++) upTo.push(spread(r))
    expect(spread(REP_CAP)).toBeGreaterThan(Math.max(...upTo))   // why REP_CAP exists
  })

  it('falls back to the default for an unknown formula name', () => {
    expect(estimate1RM(100, 5, 'nope')).toBe(estimate1RM(100, 5))
  })
})

describe('estimateWithEffort', () => {
  // The confidence tiers are rendered by the card; this is the same mapping, pinned here so
  // the numbers behind the HIGH / MEDIUM / unreliable tags stay honest.
  const tier = eff => (eff <= 8 ? 'HIGH' : eff <= REP_CAP ? 'MEDIUM' : 'unreliable')

  it('adjusts by RIR in effective reps (100×5 RIR0 → 116.7, HIGH)', () => {
    expect(estimateWithEffort(100, 5, 0)).toEqual({ est: 116.7, effReps: 5, failureAssumed: false })
    expect(tier(5)).toBe('HIGH')
  })

  it('treats 70×6 RIR1 as a 7-rep set → 86.3', () => {
    expect(estimateWithEffort(70, 6, 1)).toEqual({ est: 86.3, effReps: 7, failureAssumed: false })
  })

  it('caps effective reps at REP_CAP (60×10 RIR4 → 12 → 84.0)', () => {
    expect(estimateWithEffort(60, 10, 4)).toEqual({ est: 84, effReps: 12, failureAssumed: false })
    expect(tier(12)).toBe('MEDIUM')
    expect(tier(13)).toBe('unreliable')
  })

  it('still estimates past the cap, capped, and flags the caller\'s tier unreliable', () => {
    expect(estimateWithEffort(100, 13, null)).toEqual({ est: 140, effReps: 12, failureAssumed: true })
  })

  it('a null RIR means the set is assumed to have gone to failure', () => {
    expect(estimateWithEffort(100, 5, null).failureAssumed).toBe(true)
    expect(estimateWithEffort(100, 5, undefined).failureAssumed).toBe(true)
    expect(estimateWithEffort(100, 5, 0).failureAssumed).toBe(false)
  })

  it('returns null for the same invalid input estimate1RM rejects', () => {
    expect(estimateWithEffort(0, 5, 0)).toBeNull()
    expect(estimateWithEffort(-100, 5, 0)).toBeNull()
    expect(estimateWithEffort(100, 0, 0)).toBeNull()
    expect(estimateWithEffort(NaN, 5, 0)).toBeNull()
    expect(estimateWithEffort(100, undefined, 0)).toBeNull()
  })

  it('converts RPE to RIR via rirOf before the call', () => {
    expect(rirOf({ rpe: 8 })).toBe(2)
    expect(estimateWithEffort(70, 6, rirOf({ rpe: 9 }))).toEqual({ est: 86.3, effReps: 7, failureAssumed: false })
  })

  it('keeps fractional effort: RPE 7 vs 7.5 give different estimates', () => {
    const at7 = estimateWithEffort(100, 5, rirOf({ rpe: 7 }))
    const at75 = estimateWithEffort(100, 5, rirOf({ rpe: 7.5 }))
    expect(at7.effReps).toBe(8)
    expect(at75.effReps).toBe(7.5)
    expect(at7.est).toBe(126.7)   // 100 · (1 + 8/30)
    expect(at75.est).toBe(125)    // 100 · (1 + 7.5/30)
    expect(at7.est).not.toBe(at75.est)
  })
})

describe('bestSetOf', () => {
  it('picks the highest estimate, not the heaviest set', () => {
    const entry = { id: 'x', sets: [
      { w: 100, r: 5, done: true },   // 116.7
      { w: 110, r: 3, done: true },   // 121.0
      { w: 120, r: 1, done: true }    // 120.0
    ] }
    expect(bestSetOf(entry)).toEqual({ est: 121, w: 110, r: 3 })
  })

  it('ignores sets that were never checked off', () => {
    const entry = { id: 'x', sets: [{ w: 100, r: 5, done: true }, { w: 200, r: 5, done: false }] }
    expect(bestSetOf(entry).w).toBe(100)
  })

  it('uses both explicit side values without doubling the set', () => {
    const best = bestSetOf({ id: 'x', sets: [{ left: { w: 100, r: 5, done: true }, right: { w: 100, r: 5, done: true } }] })
    expect(best).toEqual({ est: 133.3, w: 100, r: 10 })
  })

  it('ignores topW, which carries no rep count', () => {
    const entry = { id: 'x', topW: 200, sets: [{ w: 100, r: 5, done: true }] }
    expect(bestSetOf(entry).est).toBe(116.7)
  })

  it('returns null for cardio and timed entries', () => {
    expect(bestSetOf({ id: 'c', sets: [{ min: 20, speed: 9, done: true }] })).toBeNull()
    expect(bestSetOf({ id: 'p', sets: [{ sec: 60, w: 0, done: true }] })).toBeNull()
    expect(bestSetOf({ id: 'p', sets: [{ sec: 60, w: 20, done: true }] })).toBeNull()
  })

  it('survives a missing or empty entry', () => {
    expect(bestSetOf(null)).toBeNull()
    expect(bestSetOf({ sets: [] })).toBeNull()
  })

  it('uses the heaviest explicit side load without fabricating an aggregate load', () => {
    const set = {
      left: { w: 80, r: 5, done: true },
      right: { w: 90, r: 5, done: true },
    }
    expect(bestSetOf({ id: 'x', sets: [set] })).toEqual({ est: 120, w: 90, r: 10 })
    expect(set.w).toBeUndefined()
  })
})

const S = {
  workouts: [
    { d: '2026-01-01', start: 1, entries: [{ id: 'bench', sets: [{ w: 80, r: 5, done: true }] }] },
    { d: '2026-01-08', start: 2, entries: [{ id: 'squat', sets: [{ w: 100, r: 5, done: true }] }] },
    { d: '2026-01-15', start: 3, entries: [{ id: 'bench', sets: [{ w: 90, r: 5, done: true }, { w: 90, r: 3, done: false }] }] },
    { d: '2026-01-22', start: 4, entries: [{ id: 'bench', sets: [{ w: 85, r: 5, done: true }] }] },
    { d: '2026-01-29', start: 5, entries: [{ id: 'run', sets: [{ min: 30, speed: 10, done: true }] }] }
  ]
}

describe('e1rmSeries / best1RM', () => {
  it('yields one chronological point per workout that produced an estimate', () => {
    const pts = e1rmSeries(S, 'bench')
    expect(pts.map(p => p.d)).toEqual(['2026-01-01', '2026-01-15', '2026-01-22'])
    expect(pts.map(p => p.y)).toEqual([93.3, 105, 99.2])
  })

  it('reports the all-time best with the set behind it', () => {
    expect(best1RM(S, 'bench')).toEqual({ est: 105, w: 90, r: 5, d: '2026-01-15', t: 3 })
  })

  it('has nothing to say about cardio or an unknown exercise', () => {
    expect(e1rmSeries(S, 'run')).toEqual([])
    expect(best1RM(S, 'run')).toBeNull()
    expect(best1RM(S, 'nope')).toBeNull()
    expect(best1RM({ workouts: [] }, 'bench')).toBeNull()
    expect(best1RM({}, 'bench')).toBeNull()
  })
})

describe('is1RMRecord', () => {
  it('flags a session that beats every previous estimate', () => {
    const rec = is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 95, r: 5, done: true }] })
    expect(rec).toEqual({ est: 110.8, w: 95, r: 5, prev: 105 })
  })

  it('stays quiet when the session does not beat the record', () => {
    expect(is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 90, r: 5, done: true }] })).toBeNull()
    expect(is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 80, r: 5, done: true }] })).toBeNull()
  })

  it('counts the first ever estimate as a record', () => {
    const rec = is1RMRecord(S, 'deadlift', { id: 'deadlift', sets: [{ w: 140, r: 3, done: true }] })
    expect(rec.prev).toBe(0)
    expect(rec.est).toBe(154)
  })

  it('says nothing for a timed or unfinished entry', () => {
    expect(is1RMRecord(S, 'plank', { id: 'plank', sets: [{ sec: 90, done: true }] })).toBeNull()
    expect(is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 200, r: 5, done: false }] })).toBeNull()
  })
})
