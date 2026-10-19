import { afterEach, expect, it } from 'vitest'
import { allExercises, EXIDX, registerCustom } from './exercises.js'
import { visualExercises, visualUsage } from './visual-exercises.js'

const bench = '79D0BB3A'
const personal = { id: 'personal-pause', n: 'My four second pause', baseId: bench, variant: { kind: 'pause', durationSec: 4, position: 'chest' } }
afterEach(() => registerCustom([]))

it('groups built-in and personal condition variants without changing the full catalog or state', () => {
  const state = { customEx: [personal] }
  const before = JSON.stringify(state)
  const rows = visualExercises(state)
  expect(rows.every(ex => !ex.variant)).toBe(true)
  expect(rows.filter(ex => ex.id === bench)).toHaveLength(1)
  expect(rows.some(ex => ex.id === 'D20D7BBE')).toBe(true)
  expect(allExercises(state).some(ex => ex.id === personal.id)).toBe(true)
  expect(JSON.stringify(state)).toBe(before)
})

it('finds a base by a built-in or personal variant name and excludes archived variants', () => {
  expect(visualExercises({}, 'Bench Press · 2-second chest pause').map(ex => ex.id)).toEqual([bench])
  expect(visualExercises({ customEx: [personal] }, personal.n).map(ex => ex.id)).toEqual([bench])
  expect(visualExercises({ customEx: [{ ...personal, archived: true }] }, personal.n)).toEqual([])
  const custom = { id: 'custom-base', n: 'Special custom movement', bp: 'chest', custom: true }
  expect(visualExercises({ customEx: [custom, { ...personal, baseId: custom.id }] }, personal.n)).toEqual([custom])
  expect(visualExercises({}, EXIDX[bench].n).some(ex => ex.id === bench)).toBe(true)
})

it('groups chosen usage under the base while preserving ordinary exercise counts', () => {
  const state = { customEx: [personal], routines: [{ ex: [{ id: 'hf-bp-pause-2s' }, { id: personal.id }] }], workouts: [{ entries: [{ id: bench }, { id: 'D20D7BBE' }] }] }
  const before = JSON.stringify(state)
  expect(visualUsage(state)).toEqual({ [bench]: 3, D20D7BBE: 1 })
  expect(JSON.stringify(state)).toBe(before)
})
