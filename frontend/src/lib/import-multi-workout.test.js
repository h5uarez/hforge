import { describe, it, expect } from 'vitest'
import { mergeImport, mergeBackupImport, classifyImportWorkouts, workoutSignature } from './backup-import.js'
import { createWorkoutBackup, serializeBackup } from './export.js'
import { normalizeExerciseIds } from './exercise-ids.js'

const blankState = () => ({ unit: 'kg', bodyweight: [], customEx: [], exWeights: {}, workouts: [] })
const entry = (id = '0025', sets = [{ w: 60, r: 10, done: true }]) => ({ id, sets, topW: 60 })
const workout = (over = {}) => ({
  id: 'w-' + Math.random().toString(36).slice(2, 8), d: '2026-01-12',
  start: new Date('2026-01-12T18:00:00').getTime(), end: new Date('2026-01-12T19:00:00').getTime(),
  routineId: null, name: 'Push', entries: [entry()], prs: [], vol: 600, ...over,
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
    // Full backup serialisation keeps both sessions intact for additive restore.
    const restored = Object.assign({ unit: 'kg', workouts: [], routines: [] }, back)
    expect(restored.workouts.filter(w => w.d === '2026-01-12')).toHaveLength(2)
  })
})

describe('full backup merge is additive', () => {
  it('preserves current data, adds historical records, and keeps current collisions', () => {
    const currentWorkout = normalizeExerciseIds({ workouts: [workout({ id: 'current', d: '2026-02-01' })] }).workouts[0]
    const oldWorkout = workout({ id: 'old', d: '2026-01-01', name: 'Pull', entries: [entry('0032', [{ w: 100, r: 5, done: true }])] })
    const normalizedOldWorkout = normalizeExerciseIds({ workouts: [oldWorkout] }).workouts[0]
    const S = {
      ...blankState(), unit: 'lb', lang: 'en', theme: 'dark', routines: [{ id: 'current-routine', name: 'Current plan' }],
      week: { 1: 'current-routine' }, workouts: [currentWorkout],
      bodyweight: [{ d: '2026-02-01', w: 90, t: 1 }],
    }
    const backup = {
      unit: 'kg', theme: 'light', routines: [{ id: 'old-routine', name: 'Old plan' }],
      workouts: [{ ...currentWorkout, id: 'backup-copy' }, oldWorkout],
      bodyweight: [{ d: '2026-02-01', w: 80, t: 2 }, { d: '2026-01-01', w: 82, t: 3 }],
      customEx: [],
    }

    expect(mergeBackupImport(S, backup)).toEqual({ added: 2, skipped: 2 })
    expect(S.unit).toBe('lb')
    expect(S.lang).toBe('en')
    expect(S.theme).toBe('dark')
    expect(S.routines).toEqual([{ id: 'current-routine', name: 'Current plan' }])
    expect(S.week).toEqual({ 1: 'current-routine' })
    expect(S.workouts).toHaveLength(2)
    expect(S.workouts.find(w => w.id === 'current')).toEqual(currentWorkout)
    expect(S.workouts.find(w => w.id === 'old')).toEqual(normalizedOldWorkout)
    expect(S.bodyweight).toEqual([
      { d: '2026-01-01', w: 82, t: 3 },
      { d: '2026-02-01', w: 90, t: 1 },
    ])

    expect(mergeBackupImport(S, JSON.parse(JSON.stringify(backup)))).toEqual({ added: 0, skipped: 4 })
    expect(S.workouts).toHaveLength(2)
    expect(S.bodyweight).toHaveLength(2)
  })
})
