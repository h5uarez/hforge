// Weekly Decision Board v1 — logic tests with fixtures.
import { describe, it, expect } from 'vitest'
import { EXDB } from './exercises.js'
import {
  weekDays, prevWeekDays, delta, fmtPct, ctxLine,
  buildWeeklyBoard, evaluateBoardRules, RULES,
} from './weekly-board.js'

const LIFT_A = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
const LIFT_B = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight' && e.id !== LIFT_A && e.bp !== EXDB.find(x => x.id === LIFT_A).bp).id || EXDB[1].id

const T = (iso, h = 18) => new Date(iso + `T${String(h).padStart(2, '0')}:00:00`).getTime()
const set = (w, r) => ({ w, r, done: true })
const workout = (d, entries, h = 18, durMin = 60) => ({
  id: 'w-' + d + '-' + h, d, start: T(d, h), end: T(d, h) + durMin * 60000, entries,
})
const base = (over = {}) => ({
  unit: 'kg', targetW: null, bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], ...over,
})
// Mon 2026-08-24 .. Sun 2026-08-30 is a full Mon-Sun week; prev week starts 2026-08-17.
const REF = '2026-08-27'

describe('weekDays', () => {
  it('returns the Monday..Sunday week containing the reference day', () => {
    expect(weekDays('2026-08-27')).toEqual([
      '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27',
      '2026-08-28', '2026-08-29', '2026-08-30',
    ])
  })
  it('a Monday starts its own week and a Sunday ends it', () => {
    expect(weekDays('2026-08-24')[0]).toBe('2026-08-24')
    expect(weekDays('2026-08-30')[6]).toBe('2026-08-30')
  })
  it('prevWeekDays is exactly 7 days earlier', () => {
    const cur = weekDays(REF), prev = prevWeekDays(REF)
    expect(prev).toHaveLength(7)
    prev.forEach((d, i) => {
      const diff = (new Date(cur[i] + 'T12:00:00') - new Date(d + 'T12:00:00')) / 86400000
      expect(diff).toBe(7)
    })
  })
})

describe('delta', () => {
  it('computes diff and percent', () => {
    expect(delta(108, 100)).toMatchObject({ cur: 108, prev: 100, diff: 8, pct: 8 })
    expect(delta(90, 100).pct).toBe(-10)
  })
  it('pct is null without a baseline instead of Infinity', () => {
    expect(delta(5, 0)).toMatchObject({ diff: 5, pct: null })
    expect(delta(0, 0)).toMatchObject({ diff: 0, pct: null })
  })
  it('fmtPct signs positives and passes null through', () => {
    expect(fmtPct(8)).toBe('+8%')
    expect(fmtPct(-2.5)).toBe('-2.5%')
    expect(fmtPct(null)).toBe(null)
  })
  it('ctxLine always carries comparison context, never a bare number', () => {
    expect(ctxLine(12, 10)).toContain('vs prev week')
    expect(ctxLine(0, 0)).toBe('—')
    expect(ctxLine(5, 0)).toContain('new vs prev week')
  })
})

describe('empty state', () => {
  it('a brand-new profile gets nulls and guidance, not zeros that read as failure', () => {
    const b = buildWeeklyBoard(base(), REF)
    expect(b.hasData).toBe(false)
    expect(b.adherence).toMatchObject({ done: 0, planned: 0, pending: 0, compliance: null })
    expect(b.performance).toMatchObject({ tracked: 0 })
    expect(b.body.ctx).toBe('no weigh-ins this week')
    expect(b.rules).toEqual([])
  })
})

describe('adherence', () => {
  const plan = () => {
    const r = { id: 'r1', name: 'Full', ex: [{ id: LIFT_A, sets: 3, reps: 8, weight: 60 }] }
    // Mon=1, Wed=3, Fri=5 planned
    return base({ routines: [r], week: { 1: 'r1', 3: 'r1', 5: 'r1' } })
  }
  it('counts planned vs trained days and pending', () => {
    const S = plan()
    S.workouts = [workout('2026-08-24', [{ id: LIFT_A, sets: [set(60, 8)] }])]
    const b = buildWeeklyBoard(S, REF)
    expect(b.adherence).toMatchObject({ done: 1, planned: 3, pending: 2, compliance: 0.333 })
    expect(b.hasData).toBe(true)
  })
  it('partial week: two of three planned days is 67% with one pending', () => {
    const S = plan()
    S.workouts = [
      workout('2026-08-24', [{ id: LIFT_A, sets: [set(60, 8)] }]),
      workout('2026-08-26', [{ id: LIFT_A, sets: [set(60, 8)] }]),
    ]
    const b = buildWeeklyBoard(S, REF)
    expect(b.adherence.compliance).toBeCloseTo(0.667, 2)
    expect(b.adherence.pending).toBe(1)
  })
  it('several workouts the same day count once for adherence but all sets for volume', () => {
    const S = plan()
    S.workouts = [
      workout('2026-08-24', [{ id: LIFT_A, sets: [set(60, 8), set(60, 8)] }], 9),
      workout('2026-08-24', [{ id: LIFT_A, sets: [set(60, 8)] }], 19),
    ]
    const b = buildWeeklyBoard(S, REF)
    expect(b.adherence.done).toBe(1)
    expect(b.adherence.compliance).toBeCloseTo(0.333, 2)
    expect(b.volume.totalSets).toBe(3)
    expect(b.load.workouts.cur).toBe(2)
  })
  it('training on an unplanned day is counted as extra, not as compliance', () => {
    const S = plan()
    S.workouts = [workout('2026-08-25', [{ id: LIFT_A, sets: [set(60, 8)] }])] // Tuesday, unplanned
    const b = buildWeeklyBoard(S, REF)
    expect(b.adherence.done).toBe(1)
    expect(b.adherence.compliance).toBe(0)
    expect(b.adherence.extra).toBe(1)
    expect(b.adherence.pending).toBe(3)
  })
})

describe('volume + gaps', () => {
  it('compares sets per muscle across weeks and flags last-week muscles gone quiet', () => {
    const S = base({
      workouts: [
        workout('2026-08-18', [{ id: LIFT_A, sets: [set(60, 8), set(60, 8)] }]),
        workout('2026-08-19', [{ id: LIFT_B, sets: [set(40, 10)] }]),
        workout('2026-08-25', [{ id: LIFT_A, sets: [set(62, 8), set(62, 8), set(62, 8)] }]),
      ],
    })
    const b = buildWeeklyBoard(S, REF)
    expect(b.volume.totalSets).toBe(3)
    expect(b.volume.ctx).toContain('vs prev week')
    expect(b.volume.top.length).toBeGreaterThan(0)
    expect(b.volume.top[0].prev).toBeDefined()
    // LIFT_B muscles were trained prev week and not this week → gaps, descriptive only
    expect(b.volume.gaps.length).toBeGreaterThan(0)
  })
  it('no gaps when the week only adds new muscles', () => {
    const S = base({ workouts: [workout('2026-08-25', [{ id: LIFT_A, sets: [set(60, 8)] }])] })
    const b = buildWeeklyBoard(S, REF)
    expect(b.volume.gaps).toEqual([])
  })
})

describe('performance (e1RM movers)', () => {
  it('classifies lifts as up / holding / down vs the previous week', () => {
    const S = base({
      workouts: [
        workout('2026-08-18', [{ id: LIFT_A, sets: [set(100, 5)] }]), // epley 116.7
        workout('2026-08-25', [{ id: LIFT_A, sets: [set(100, 6)] }]), // epley 120 → up
      ],
    })
    const b = buildWeeklyBoard(S, REF)
    expect(b.performance.tracked).toBe(1)
    expect(b.performance.up).toHaveLength(1)
    expect(b.performance.up[0].diff).toBeGreaterThan(0)
    expect(b.performance.ctx).toContain('1 up')
  })
  it('a lift with no earlier estimate is new, never up', () => {
    const S = base({ workouts: [workout('2026-08-25', [{ id: LIFT_A, sets: [set(80, 5)] }])] })
    const b = buildWeeklyBoard(S, REF)
    expect(b.performance.fresh).toHaveLength(1)
    expect(b.performance.up).toHaveLength(0)
  })
  it('falls back to the latest estimate before the week for fortnightly lifts', () => {
    const S = base({
      workouts: [
        workout('2026-08-10', [{ id: LIFT_A, sets: [set(100, 5)] }]),
        workout('2026-08-25', [{ id: LIFT_A, sets: [set(100, 5)] }]),
      ],
    })
    const b = buildWeeklyBoard(S, REF)
    expect(b.performance.flat).toHaveLength(1)
    expect(b.performance.flat[0].prevLabel).toBe('previous best')
  })
  it('cardio-only weeks track nothing instead of fabricating estimates', () => {
    const cardio = EXDB.find(e => e.bp === 'cardio')
    const S = base({ workouts: [workout('2026-08-25', [{ id: cardio.id, sets: [{ min: 20, speed: 9, done: true }] }])] })
    const b = buildWeeklyBoard(S, REF)
    expect(b.performance.tracked).toBe(0)
  })
})

describe('weekly load', () => {
  it('totals sets, tonnage and minutes with prev-week deltas', () => {
    const S = base({
      workouts: [
        workout('2026-08-18', [{ id: LIFT_A, sets: [set(100, 5), set(100, 5)] }], 18, 60),
        workout('2026-08-25', [{ id: LIFT_A, sets: [set(100, 5), set(100, 5), set(100, 5)] }], 18, 45),
        workout('2026-08-25', [{ id: LIFT_A, sets: [set(50, 10)] }], 19, 30),
      ],
    })
    const b = buildWeeklyBoard(S, REF)
    expect(b.load.sets).toMatchObject({ cur: 4, prev: 2, diff: 2, pct: 100 })
    expect(b.load.tonnage).toMatchObject({ cur: 2000, prev: 1000 })
    expect(b.load.minutes.cur).toBe(75)
    expect(b.load.minutes.prev).toBe(60)
    expect(b.load.workouts).toMatchObject({ cur: 2, prev: 1 })
  })
  it('workouts without timestamps contribute sets but no minutes', () => {
    const S = base({ workouts: [{ id: 'x', d: '2026-08-25', entries: [{ id: LIFT_A, sets: [set(60, 8)] }] }] })
    const b = buildWeeklyBoard(S, REF)
    expect(b.load.sets.cur).toBe(1)
    expect(b.load.minutes.cur).toBe(0)
  })
})

describe('body weight', () => {
  it('averages the week and diffs against the previous week average', () => {
    const S = base({
      bodyweight: [
        { d: '2026-08-18', w: 80, t: T('2026-08-18', 8) },
        { d: '2026-08-20', w: 80.4, t: T('2026-08-20', 8) },
        { d: '2026-08-25', w: 79.8, t: T('2026-08-25', 8) },
        { d: '2026-08-27', w: 79.6, t: T('2026-08-27', 8) },
      ],
    })
    const b = buildWeeklyBoard(S, REF)
    expect(b.body.entries).toBe(2)
    expect(b.body.avg).toBe(79.7)
    expect(b.body.delta).toBe(-0.5)
    expect(b.body.ctx).toContain('vs prev week')
  })
  it('stays informative with a single weigh-in and no baseline', () => {
    const S = base({ bodyweight: [{ d: '2026-08-26', w: 79, t: T('2026-08-26', 8) }] })
    const b = buildWeeklyBoard(S, REF)
    expect(b.body.avg).toBe(79)
    expect(b.body.delta).toBe(null)
    expect(b.body.ctx).toContain('no prev-week baseline')
  })
})

describe('many workouts + rule slots', () => {
  it('handles a dense week without losing counts', () => {
    const workouts = []
    for (let i = 0; i < 10; i++) {
      const day = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'][i % 5]
      workouts.push(workout(day, [{ id: LIFT_A, sets: [set(60 + i, 8)] }], 8 + (i % 10), 30))
    }
    const b = buildWeeklyBoard(base({ workouts }), REF)
    expect(b.load.sets.cur).toBe(10)
    expect(b.load.workouts.cur).toBe(10)
    expect(b.adherence.done).toBe(5)
  })
  it('RULES is empty in v1 and a throwing rule never breaks the board', () => {
    expect(RULES).toEqual([])
    expect(evaluateBoardRules({})).toEqual([])
    RULES.push({ id: 'boom', run: () => { throw new Error('x') } })
    expect(evaluateBoardRules({})).toEqual([])
    RULES.pop()
  })
  it('a registered rule result is projected onto the board', () => {
    RULES.push({ id: 'demo', run: () => ({ level: 'watch', text: 'demo signal' }) })
    expect(evaluateBoardRules({})).toEqual([{ id: 'demo', level: 'watch', text: 'demo signal' }])
    RULES.pop()
  })
})
