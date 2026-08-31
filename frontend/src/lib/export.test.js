import { describe, it, expect } from 'vitest'
import { createWorkoutBackup, serializeBackup } from './export.js'

describe('selective workout backups', () => {
  it('exports selected workouts and their routines and custom exercises only', () => {
    const state = {
      unit: 'lb',
      routines: [
        { id: 'push', name: 'Push', ex: [{ id: 'bench', sets: 3, reps: 8 }, { id: 'custom-routine', sets: 2, reps: 12 }], note: 'keep this' },
        { id: 'pull', name: 'Pull', ex: [{ id: 'row', sets: 3, reps: 10 }] },
      ],
      customEx: [
        { id: 'custom-workout', n: 'Logged custom', bp: 'back', desc: 'all fields' },
        { id: 'custom-routine', n: 'Planned custom', bp: 'legs', desc: 'keep this too' },
        { id: 'unrelated-custom', n: 'Unrelated', bp: 'arms', desc: 'do not export' },
      ],
      week: { 1: 'push' }, dayPlan: { '2026-08-01': 'pull' },
      workouts: [
        { id: 'first', d: '2026-08-01', routineId: 'push', name: 'Push', entries: [{ id: 'custom-workout', sets: [{ w: 25, r: 10, done: true }] }], extra: { keep: true }, block: { id: 'snapshot', name: 'Historical block', weeks: [{ days: { 0: 'push' } }] } },
        { id: 'second', d: '2026-08-01', routineId: 'push', name: 'Push again', entries: [], end: 123 },
        { id: 'third', d: '2026-09-03', routineId: 'pull', name: 'Pull', entries: [{ id: 'row' }], extra: 'exclude' },
      ],
      bodyweight: [{ d: '2026-08-01', w: 80 }], exWeights: { bench: { w: 100 } }, active: { id: 'active' }, blocks: [{ id: 'block' }], activeBlock: { blockId: 'block' },
    }
    const before = JSON.parse(JSON.stringify(state))
    const expectedSelectedWorkout = { ...state.workouts[0] }
    delete expectedSelectedWorkout.block

    const backup = createWorkoutBackup(state, new Set(['2026-08-01', '2026-10-12']))

    expect(backup).toEqual({
      unit: 'lb',
      routines: [state.routines[0]],
      workouts: [expectedSelectedWorkout, state.workouts[1]],
      customEx: [state.customEx[0], state.customEx[1]],
    })
    expect(Object.keys(backup)).toEqual(['unit', 'routines', 'workouts', 'customEx'])
    expect(backup).not.toHaveProperty('bodyweight')
    expect(backup).not.toHaveProperty('week')
    expect(backup).not.toHaveProperty('dayPlan')
    expect(backup).not.toHaveProperty('exWeights')
    expect(backup).not.toHaveProperty('active')
    expect(backup).not.toHaveProperty('blocks')
    expect(backup).not.toHaveProperty('activeBlock')
    expect(backup.workouts[0]).not.toHaveProperty('block')
    expect(backup).not.toBe(state)
    expect(backup.workouts).not.toBe(state.workouts)
    expect(backup.workouts[0]).not.toBe(state.workouts[0])
    expect(backup.workouts[0].entries).not.toBe(state.workouts[0].entries)
    expect(backup.routines[0]).not.toBe(state.routines[0])
    expect(backup.routines[0].ex).not.toBe(state.routines[0].ex)
    expect(backup.customEx[0]).not.toBe(state.customEx[0])
    expect(state).toEqual(before)
  })

  it('serializes an empty selection with all required importer keys', () => {
    const state = { unit: 'kg', routines: [{ id: 'unused' }], customEx: [{ id: 'unused' }], workouts: [{ id: 'w', d: '2026-08-01' }] }

    const json = serializeBackup(createWorkoutBackup(state, []))

    expect(JSON.parse(json)).toEqual({ unit: 'kg', routines: [], workouts: [], customEx: [] })
    expect(json).toContain('\n  "workouts"')
  })
})
