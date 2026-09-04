import { describe, it, expect } from 'vitest'
import { parseWorkoutCSV, mergeImport, classifyImportWorkouts, workoutSignature } from './import-csv.js'
import { createWorkoutBackup, serializeBackup } from './export.js'

// Tarea 11 — multi-workout same day: 0/1/2/N sessions on one date coexist and no
// import path silently discards one. Headers as the real exports write them.
const HEVY = 'title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps,rpe'
const STRONG = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Seconds,RPE'
const FITNOTES = 'Date,Exercise,Category,Weight,Reps,Distance,Distance Unit,Time'

const blankState = () => ({ unit: 'kg', bodyweight: [], customEx: [], exWeights: {}, workouts: [] })
const entry = (id = '0025', sets = [{ w: 60, r: 10, done: true }]) => ({ id, sets, topW: 60 })
const workout = (over = {}) => ({
  id: 'w-' + Math.random().toString(36).slice(2, 8), d: '2026-01-12',
  start: new Date('2026-01-12T18:00:00').getTime(), end: new Date('2026-01-12T19:00:00').getTime(),
  routineId: null, name: 'Push', entries: [entry()], prs: [], vol: 600, ...over,
})

describe('parsing keeps same-day sessions apart', () => {
  it('parses two Hevy sessions on one date as two workouts', () => {
    const p = parseWorkoutCSV([
      HEVY,
      'Push,"12 Jan 2026, 18:00","12 Jan 2026, 19:00",Bench Press (Barbell),0,normal,60,10,8',
      'Push,"12 Jan 2026, 18:00","12 Jan 2026, 19:00",Bench Press (Barbell),1,normal,60,8,',
      'Pull,"12 Jan 2026, 20:00","12 Jan 2026, 21:00",Deadlift,0,normal,100,5,',
    ].join('\n'), { unit: 'kg' })
    expect(p.error).toBeUndefined()
    expect(p.workouts).toHaveLength(2)
    expect(p.workouts.map(w => w.name)).toEqual(['Push', 'Pull'])
    expect(p.workouts[0].entries.flatMap(e => e.sets)).toHaveLength(2)
    expect(p.workouts[1].entries.flatMap(e => e.sets)).toHaveLength(1)
    expect(p.sets).toBe(3)
    expect(p.from).toBe('2026-01-12')
    expect(p.to).toBe('2026-01-12')
    expect(p.workouts[0].id).not.toBe(p.workouts[1].id)
  })

  it('parses two Strong sessions on one date as two workouts', () => {
    const p = parseWorkoutCSV([
      STRONG,
      '2026-01-12 18:00:00,Push,Bench Press (Barbell),1,60,10,0,',
      '2026-01-12 20:00:00,Pull,Deadlift,1,100,5,0,',
    ].join('\n'), { unit: 'kg' })
    expect(p.error).toBeUndefined()
    expect(p.workouts).toHaveLength(2)
    expect(p.workouts.map(w => w.name)).toEqual(['Push', 'Pull'])
  })

  it('keeps one workout per date for FitNotes files (legacy behaviour)', () => {
    // No workout-level identity columns: per-set timestamps cannot tell two
    // same-day sessions apart, so every set lands in one workout — nothing lost.
    const p = parseWorkoutCSV([
      FITNOTES,
      '2026-01-12,Bench Press,Chest,60,10,,,',
      '2026-01-12,Deadlift,Legs,100,5,,,',
    ].join('\n'), { unit: 'kg' })
    expect(p.error).toBeUndefined()
    expect(p.workouts).toHaveLength(1)
    expect(p.workouts[0].entries.flatMap(e => e.sets)).toHaveLength(2)
  })
})

describe('merge keeps same-day sessions and never duplicates', () => {
  it('adds an incoming same-date workout next to the existing one', () => {
    const S = blankState()
    S.workouts = [workout({ id: 'morning', name: 'Push' })]
    const incoming = { kind: 'workouts', workouts: [workout({ id: 'evening', name: 'Pull', entries: [entry('0032', [{ w: 100, r: 5, done: true }])] })], customEx: [] }
    const res = mergeImport(S, incoming)
    expect(res).toEqual({ added: 1, skipped: 0 })
    expect(S.workouts).toHaveLength(2)
    expect(S.workouts.map(w => w.name).sort()).toEqual(['Pull', 'Push'])
  })

  it('keeps three same-day workouts side by side', () => {
    const S = blankState()
    const parsed = {
      kind: 'workouts', customEx: [],
      workouts: [
        workout({ id: 'a', name: 'Push', start: 1 }),
        workout({ id: 'b', name: 'Pull', entries: [entry('0032')], start: 2 }),
        workout({ id: 'c', name: 'Legs', entries: [entry('0043')], start: 3 }),
      ],
    }
    expect(mergeImport(S, parsed)).toEqual({ added: 3, skipped: 0 })
    expect(S.workouts).toHaveLength(3)
  })

  it('re-importing the same file adds nothing (idempotent)', () => {
    const S = blankState()
    const parsed = { kind: 'workouts', customEx: [], workouts: [workout({ id: 'x' }), workout({ id: 'y', name: 'Pull', entries: [entry('0032')] })] }
    expect(mergeImport(S, parsed)).toEqual({ added: 2, skipped: 0 })
    // fresh ids on re-parse, same content: everything is recognised as duplicate
    const reparsed = { kind: 'workouts', customEx: [], workouts: parsed.workouts.map(w => ({ ...w, id: w.id + '-again' })) }
    expect(mergeImport(S, reparsed)).toEqual({ added: 0, skipped: 2 })
    expect(S.workouts).toHaveLength(2)
  })

  it('an end-to-end parsed file merges twice without duplication or loss', () => {
    const S = blankState()
    const csv = [
      HEVY,
      'Push,"12 Jan 2026, 18:00","12 Jan 2026, 19:00",Bench Press (Barbell),0,normal,60,10,8',
      'Pull,"12 Jan 2026, 20:00","12 Jan 2026, 21:00",Deadlift,0,normal,100,5,',
    ].join('\n')
    const first = parseWorkoutCSV(csv, { unit: 'kg' })
    expect(mergeImport(S, first)).toEqual({ added: 2, skipped: 0 })
    const second = parseWorkoutCSV(csv, { unit: 'kg' })
    expect(mergeImport(S, second)).toEqual({ added: 0, skipped: 2 })
    expect(S.workouts).toHaveLength(2)
  })

  it('re-keys an id collision with different content instead of dropping it', () => {
    const S = blankState()
    S.workouts = [workout({ id: 'same-id', name: 'Push' })]
    const res = mergeImport(S, { kind: 'workouts', customEx: [], workouts: [workout({ id: 'same-id', name: 'Pull', entries: [entry('0032')] })] })
    expect(res).toEqual({ added: 1, skipped: 0 })
    expect(S.workouts).toHaveLength(2)
    expect(new Set(S.workouts.map(w => w.id)).size).toBe(2)
  })

  it('merges alongside legacy workouts without ids or timestamps', () => {
    const S = blankState()
    S.workouts = [{ d: '2026-01-12', entries: [{ id: '0025', sets: [{ w: 50, r: 8, done: true }] }] }]
    const res = mergeImport(S, { kind: 'workouts', customEx: [], workouts: [workout({ id: 'new', name: 'Pull', entries: [entry('0032')] })] })
    expect(res).toEqual({ added: 1, skipped: 0 })
    expect(S.workouts).toHaveLength(2)
  })

  it('still seeds weight suggestions from newly imported sets', () => {
    const S = blankState()
    S.workouts = [workout({ id: 'old', name: 'Push' })]
    mergeImport(S, { kind: 'workouts', customEx: [], workouts: [workout({ id: 'new', name: 'Pull', entries: [entry('0032', [{ w: 120, r: 5, done: true }])] })] })
    expect(S.exWeights['0032']).toEqual({ w: 120, d: '2026-01-12' })
  })
})

describe('preview classification matches the merge', () => {
  it('counts only exact duplicates as skipped', () => {
    const existing = [workout({ id: 'morning', name: 'Push' })]
    const incoming = [
      { ...workout({ id: 'dup', name: 'Push' }) },                       // same content, other id
      workout({ id: 'new', name: 'Pull', entries: [entry('0032')] }),    // new session, same date
    ]
    expect(classifyImportWorkouts(existing, incoming)).toEqual({ fresh: [incoming[1]], skipped: 1 })
    expect(workoutSignature(incoming[0])).toBe(workoutSignature(existing[0]))
  })
})

describe('export and backup round-trips keep every same-day workout', () => {
  const twoADay = () => ({
    unit: 'kg', routines: [], customEx: [],
    workouts: [
      workout({ id: 'morning', name: 'Push' }),
      workout({ id: 'evening', name: 'Pull', entries: [entry('0032')], start: new Date('2026-01-12T20:00:00').getTime() }),
      workout({ id: 'other-day', d: '2026-01-13', name: 'Legs', entries: [entry('0043')] }),
    ],
  })

  it('selective day export carries both same-day workouts', () => {
    const backup = createWorkoutBackup(twoADay(), new Set(['2026-01-12']))
    expect(backup.workouts.map(w => w.id).sort()).toEqual(['evening', 'morning'])
  })

  it('full backup serialisation preserves both same-day workouts', () => {
    const S = twoADay()
    const back = JSON.parse(serializeBackup(S))
    expect(back.workouts.filter(w => w.d === '2026-01-12')).toHaveLength(2)
    // restoring over defaults (what Settings does) keeps both sessions intact
    const restored = Object.assign({ unit: 'kg', workouts: [], routines: [] }, back)
    expect(restored.workouts.filter(w => w.d === '2026-01-12')).toHaveLength(2)
  })
})
