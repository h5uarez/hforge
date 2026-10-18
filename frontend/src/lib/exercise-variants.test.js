import { afterEach, describe, expect, it } from 'vitest'
import { EXDB, EXIDX, registerCustom, exerciseName } from './exercises.js'
import { buildPlanBundle, mergePlan, parsePlan } from './plan-share.js'
import { bestWeightFor, lastEntryFor } from './history.js'
import { createWorkoutBackup, serializeBackup } from './export.js'
import { createOrReuseVariant, normalizeVariant } from './exercise-variants.js'
import { best1RM, is1RMRecord } from './onerm.js'
import { nextPrescription } from './progression.js'

const bench = '79D0BB3A'
const pause = { kind: 'pause', durationSec: 2, position: 'chest' }
const definition = { id: 'coach-pause', n: 'My paused bench', bp: 'chest', baseId: bench, variant: pause }
const plan = customEx => ({ hforge_plan: 1, customEx, routines: [{ id: 'friday', name: 'Friday', ex: [{ id: definition.id, sets: 3, reps: 5 }] }] })
const empty = () => ({ customEx: [], routines: [], week: {} })
afterEach(() => registerCustom([]))

describe('exercise variant public contracts', () => {
  it('publishes explicit, translated paused and tempo variants without duplicating existing movements', () => {
    expect(EXIDX['hf-bp-pause-2s']).toMatchObject({ baseId: bench, variant: pause, img: null, video: null })
    expect(exerciseName(EXIDX['hf-bp-pause-2s'], 'es')).toContain('2 s')
    expect(EXIDX['hf-sq-pins-parallel'].variant).toEqual({ kind: 'pins', position: 'parallel' })
    expect(EXIDX['hf-dl-deficit-2cm'].variant).toEqual({ kind: 'deficit', heightCm: 2 })
    expect(EXDB.filter(ex => ex.id === 'D20D7BBE')).toHaveLength(1)
    expect(new Set(EXDB.map(ex => ex.id)).size).toBe(EXDB.length)
  })

  it('preserves personal variant definitions through plan export and repeated imports', () => {
    const personal = { ...definition, variant: { ...pause, durationSec: 4 } }
    const source = { ...empty(), customEx: [personal], routines: plan([personal]).routines }
    const bundle = buildPlanBundle(source, 'coach')
    expect(bundle.customEx[0]).toMatchObject({ baseId: bench, variant: personal.variant })
    const target = empty()
    mergePlan(target, parsePlan(bundle))
    mergePlan(target, parsePlan(bundle))
    expect(target.customEx).toHaveLength(1)
    expect(target.routines[0].ex[0].id).toBe(target.routines[1].ex[0].id)
    expect(target.customEx[0]).toMatchObject({ baseId: bench, variant: personal.variant })
  })

  it('matches equivalent conditions, not names, and never merges a variant into a plain custom', () => {
    const target = { ...empty(), customEx: [{ id: 'plain', n: definition.n, bp: 'chest' }] }
    mergePlan(target, parsePlan(plan([definition])))
    const id = target.routines[0].ex[0].id
    expect(id).not.toBe('plain')
    const renamed = { ...definition, id: 'other-coach', n: 'Different display name' }
    const other = plan([renamed]); other.routines[0].ex[0].id = renamed.id
    mergePlan(target, parsePlan(other))
    expect(target.routines[1].ex[0].id).toBe(id)
  })

  it('reuses an exact curated variant instead of creating a duplicate personal exercise', () => {
    const target = empty()
    mergePlan(target, parsePlan(plan([definition])))
    expect(target.routines[0].ex[0].id).toBe('hf-bp-pause-2s')
    expect(target.customEx).toHaveLength(0)
  })

  it.each([
    { ...definition, baseId: 'unknown-base' },
    { ...definition, variant: { ...pause, durationSec: -2 } },
    { ...definition, variant: { ...pause, durationSec: '2' } },
    { ...definition, variant: { ...pause, unsupported: 'must not disappear' } },
    { ...definition, baseId: definition.id },
    { ...definition, id: bench },
  ])('rejects invalid definitions atomically rather than silently importing a base movement: %j', invalid => {
    const target = empty(); const before = JSON.stringify(target)
    expect(() => mergePlan(target, parsePlan(plan([invalid])))).toThrow()
    expect(JSON.stringify(target)).toBe(before)
  })

  it('keeps existing ordinary custom matching and legacy plan behavior', () => {
    const target = { ...empty(), customEx: [{ id: 'local', n: 'My exercise', bp: 'chest' }] }
    const bundle = plan([{ id: 'coach-pause', n: 'My exercise', bp: 'chest' }])
    mergePlan(target, parsePlan(bundle))
    expect(target.customEx).toHaveLength(1)
    expect(target.routines[0].ex[0].id).toBe('local')
    expect(parsePlan({ hforge_plan: 1, routines: [{ ex: [{ id: '0025', sets: 3 }] }] }).routines[0].ex[0].id).toBe(bench)
  })

  it('separates previous sets and best weights and does not fall back to base history', () => {
    const state = { workouts: [
      { d: '2026-10-12', entries: [{ id: bench, sets: [{ w: 100, r: 5, done: true }] }] },
      { d: '2026-10-16', entries: [{ id: 'hf-bp-pause-2s', sets: [{ w: 80, r: 5, done: true }] }] },
    ] }
    expect(lastEntryFor(state, bench).sets[0].w).toBe(100)
    expect(lastEntryFor(state, 'hf-bp-pause-2s').sets[0].w).toBe(80)
    expect(bestWeightFor(state, bench)).toBe(100)
    expect(bestWeightFor(state, 'hf-bp-pause-2s')).toBe(80)
    expect(lastEntryFor(state, 'hf-bp-pause-3s')).toBeNull()
    expect(best1RM(state, bench).w).toBe(100)
    expect(best1RM(state, 'hf-bp-pause-2s').w).toBe(80)
    expect(is1RMRecord(state, 'hf-bp-pause-3s', { sets: [{ w: 60, r: 5, done: true }] }).prev).toBe(0)
    expect(nextPrescription(state, { id: 'hf-bp-pause-3s', prog: 'linear', sets: 1, reps: 5 })).toMatchObject({ kind: 'first' })
  })

  it('retains custom base dependencies and condition metadata in partial and full backups', () => {
    const base = { id: 'custom-base', n: 'My bench setup', bp: 'chest' }
    const variant = { ...definition, baseId: base.id }
    const state = { customEx: [variant, base], workouts: [{ d: '2026-10-16', entries: [{ id: variant.id, sets: [] }] }], routines: [] }
    const partial = createWorkoutBackup(state, ['2026-10-16'])
    expect(partial.customEx.map(ex => ex.id).sort()).toEqual([variant.id, base.id].sort())
    expect(JSON.parse(serializeBackup(state)).customEx[0].variant).toEqual(pause)
    registerCustom(state.customEx)
    expect(EXIDX[variant.id]).toMatchObject({ baseId: base.id, eq: 'custom', variant: pause })
  })

  it('creates, reuses and restores a personal variant without changing existing history', () => {
    const state = { ...empty(), workouts: [{ id: 'legacy', entries: [{ id: bench, sets: [{ w: 100, r: 5, done: true }] }] }] }
    const history = JSON.stringify(state.workouts)
    const spec = { ...pause, durationSec: 4 }
    const id = createOrReuseVariant(state, bench, spec, 'Four-second pause')
    expect(createOrReuseVariant(state, bench, spec, 'Renamed')).toBe(id)
    state.customEx[0].archived = true
    expect(createOrReuseVariant(state, bench, spec)).toBe(id)
    expect(state.customEx[0].archived).toBe(false)
    expect(JSON.stringify(state.workouts)).toBe(history)
    expect(createOrReuseVariant(state, bench, pause)).toBe('hf-bp-pause-2s')
  })

  it('keeps pause and complete tempo prescriptions semantically distinct', () => {
    expect(normalizeVariant(pause).kind).toBe('pause')
    expect(normalizeVariant({ kind: 'tempo', eccentricSec: 3, bottomPauseSec: 2, concentricSec: 'X', topPauseSec: 0 }).kind).toBe('tempo')
  })

  it.each([false, true])('rejects duplicate definition IDs in either order (variant first: %s)', first => {
    const plain = { id: definition.id, n: 'Plain bench', bp: 'chest' }
    const definitions = first ? [definition, plain] : [plain, definition]
    const state = empty(); const before = JSON.stringify(state)
    expect(() => mergePlan(state, parsePlan(plan(definitions)))).toThrow()
    expect(JSON.stringify(state)).toBe(before)
  })

  it('rejects misplaced inline conditions rather than silently importing ordinary bench', () => {
    expect(() => parsePlan({ hforge_plan: 1, routines: [{ ex: [{ id: bench, sets: 3, variant: pause }] }] })).toThrow()
  })

  it.each([false, true])('remaps custom base dependencies in either order (base first: %s)', first => {
    const base = { id: 'coach-base', n: 'My custom setup', bp: 'chest' }
    const child = { ...definition, baseId: base.id }
    const state = empty()
    mergePlan(state, parsePlan(plan(first ? [base, child] : [child, base])))
    const saved = state.customEx.find(ex => ex.variant)
    expect(saved.baseId).toBe(state.customEx.find(ex => !ex.variant).id)
    expect(state.routines[0].ex[0].id).toBe(saved.id)
    expect(buildPlanBundle(state).customEx).toHaveLength(2)
  })

  it('accepts legacy base IDs but does not permit variants of variants', () => {
    const target = empty()
    mergePlan(target, parsePlan(plan([{ ...definition, baseId: '0025' }])))
    expect(target.routines[0].ex[0].id).toBe('hf-bp-pause-2s')
    expect(() => parsePlan(plan([{ ...definition, baseId: 'hf-bp-pause-2s' }]))).toThrow()
  })
})
