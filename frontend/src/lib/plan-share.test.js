// Plan-share contract tests (Phase 2 guard).
// A shared plan is a self-contained file a friend imports into THEIR Hforge —
// it must carry only the routines, the week schedule, and the custom exercises
// those routines reference. Workouts and private settings never cross the share
// boundary.
import { describe, it, expect } from 'vitest'
import { buildPlanBundle, parsePlan, mergePlan } from './plan-share.js'
import { EXDB } from './exercises.js'

const KNOWN_EXERCISE = EXDB[0].id

const ROUTINES = [
  { id: 'r-push', name: 'Push', ex: [{ id: 'e-bench', sets: 3, reps: 8 }] },
  { id: 'r-pull', name: 'Pull', ex: [{ id: 'e-row', sets: 3, reps: 10 }] },
]
describe('buildPlanBundle — plan-share guard', () => {
  it('exports only the plan data needed by the recipient', () => {
    const S = {
      routines: ROUTINES,
      customEx: [],
      week: { 1: 'r-push', 3: 'r-pull' },
      workouts: [{ id: 'private-history' }],
      settings: { private: true },
    }
    const bundle = buildPlanBundle(S, 'my plan')
    expect(Object.keys(bundle).sort()).toEqual(['customEx', 'exported', 'name', 'opengym_plan', 'routines', 'week'].sort())
    expect(bundle).not.toHaveProperty('workouts')
    expect(bundle).not.toHaveProperty('settings')
  })

  it('still works when the sharing user has no block state at all', () => {
    const S = {
      routines: ROUTINES,
      customEx: [],
      week: { 1: 'r-push', 3: 'r-pull' },
    }
    const bundle = buildPlanBundle(S, 'plain plan')
    expect(bundle.routines.length).toBe(2)
    expect(bundle.week[1]).toBe('r-push')
  })

  it('exported bundle is round-trippable through parsePlan / mergePlan', () => {
    const S = {
      routines: ROUTINES,
      customEx: [],
      week: { 1: 'r-push', 3: 'r-pull' },
    }
    const bundle = buildPlanBundle(S, 'rt')
    const parsed = parsePlan(JSON.stringify(bundle))
    // parsePlan only returns the shareable fields.
    expect(parsed).toMatchObject({ routines: expect.any(Array), customEx: expect.any(Array), week: expect.any(Object) })
    const target = { routines: [], customEx: [], week: {} }
    const result = mergePlan(target, bundle)
    expect(target.routines.length).toBe(2)
    expect(result.routines).toBe(2)
  })
})

/* ---------- programmed-effort round-trip (Phase 2 — issue: programmed-rpe-rir) ----------
   A shared plan is a self-contained file a friend imports into THEIR Hforge. When the
   share-r's routine carries per-set metric-tagged effort targets (programmedEffort), the
   bundle must carry them so the friend's import keeps the same prescription. Legacy
   plans (no programmedEffort field) must remain valid — neither the export nor the
   import invents the field where it was absent. The null-slot cases below document
   Hforge's internal/legacy compatibility tolerance; canonical external payloads use
   one populated target object per prescribed set instead. */
describe('programmedEffort round-trip (Phase 2)', () => {
  it('exports programmedEffort on a routine exercise when it is present in the source state', () => {
    // The internal compatibility case has a slot mix (one target, one null), so the
    // export proves the array is carried through verbatim, null slots and all.
    const S = {
      routines: [{ id: 'r-push', name: 'Push', ex: [
        { id: 'e-bench', sets: 2, reps: 8, programmedEffort: [{ metric: 'rir', value: 2 }, null] }
      ] }],
      customEx: [],
      week: {},
    }
    const bundle = buildPlanBundle(S, 'with-targets')
    expect(bundle.routines[0].ex[0].programmedEffort).toEqual([{ metric: 'rir', value: 2 }, null])
  })

  it('preserves programmedEffort through mergePlan so the imported routine keeps the same prescription', () => {
    // Hand-built bundle: the field is on the ex and must survive the spread that
    // mergePlan performs when remapping the exercise id.
    const bundle = {
      opengym_plan: 1,
      name: 'with-targets',
      customEx: [],
      week: {},
      routines: [{ id: 'r-push', name: 'Push', ex: [
        { id: 'e-bench', sets: 2, reps: 8, programmedEffort: [{ metric: 'rir', value: 2 }, null] }
      ] }],
    }
    const target = { routines: [], customEx: [], week: {} }
    mergePlan(target, bundle)
    expect(target.routines[0].ex[0].programmedEffort).toEqual([{ metric: 'rir', value: 2 }, null])
  })

  it('round-trips a fully-valued programmedEffort (no nulls) so every set has a target', () => {
    // Triangulation: a different shape — every slot real, different metric (RPE).
    const S = {
      routines: [{ id: 'r-push', name: 'Push', ex: [
        { id: 'e-bench', sets: 3, reps: 8,
          programmedEffort: [{ metric: 'rpe', value: 8 }, { metric: 'rpe', value: 8.5 }, { metric: 'rpe', value: 9 }] }
      ] }],
      customEx: [],
      week: {},
    }
    const bundle = buildPlanBundle(S, 'all-targeted')
    expect(bundle.routines[0].ex[0].programmedEffort).toEqual([
      { metric: 'rpe', value: 8 }, { metric: 'rpe', value: 8.5 }, { metric: 'rpe', value: 9 },
    ])
    const target = { routines: [], customEx: [], week: {} }
    mergePlan(target, bundle)
    expect(target.routines[0].ex[0].programmedEffort).toEqual([
      { metric: 'rpe', value: 8 }, { metric: 'rpe', value: 8.5 }, { metric: 'rpe', value: 9 },
    ])
  })

  it('does not invent a programmedEffort field on a routine exercise that lacks it — legacy plans stay valid', () => {
    // buildPlanBundle strips nothing that wasn't there: the export omits the field
    // entirely so legacy plans keep their byte-for-byte shape on the wire.
    const S = {
      routines: [{ id: 'r-pull', name: 'Pull', ex: [
        { id: 'e-row', sets: 3, reps: 10 }
      ] }],
      customEx: [],
      week: {},
    }
    const bundle = buildPlanBundle(S, 'legacy')
    expect(bundle.routines[0].ex[0]).not.toHaveProperty('programmedEffort')

    // A hand-built legacy bundle imports cleanly: the import side never synthesises
    // the field, only copies what was already in the source.
    const legacyBundle = {
      opengym_plan: 1,
      name: 'legacy',
      customEx: [],
      week: {},
      routines: [{ id: 'r-pull', name: 'Pull', ex: [
        { id: 'e-row', sets: 3, reps: 10 }
      ] }],
    }
    const target = { routines: [], customEx: [], week: {} }
    const result = mergePlan(target, legacyBundle)
    expect(result.routines).toBe(1)
    expect(target.routines[0].ex[0]).not.toHaveProperty('programmedEffort')
  })
})

describe('per-side plan compatibility', () => {
  it('preserves the side marker while sharing legacy-shaped plans unchanged', () => {
    const bundle = buildPlanBundle({ routines: [{ id: 'r', name: 'Legs', ex: [{ id: 'e-bench', sets: 3, reps: 16, side: true }] }], customEx: [], week: {} }, 'side')
    expect(bundle.routines[0].ex[0]).toMatchObject({ id: 'e-bench', reps: 16, side: true })
    const legacy = buildPlanBundle({ routines: [{ id: 'r', name: 'Legs', ex: [{ id: 'e-bench', sets: 3, reps: 10 }] }], customEx: [], week: {} }, 'legacy')
    expect(legacy.routines[0].ex[0]).not.toHaveProperty('side')
  })
})

describe('weekly schedule import confirmation', () => {
  const weeklyBundle = {
    opengym_plan: 1,
    name: 'weekly',
    week: { '0': 'incoming' },
    routines: [{ id: 'incoming', name: 'Incoming', ex: [{ id: KNOWN_EXERCISE, sets: 1, reps: 5, weight: 0 }] }],
    customEx: [],
  }

  it('imports routines and applies root week only when the import confirmation enables schedule', () => {
    const declined = { routines: [], customEx: [], week: { '2': 'existing' } }
    const declinedResult = mergePlan(declined, weeklyBundle, { schedule: false })
    expect(declinedResult.routines).toBe(1)
    expect(declined.routines).toHaveLength(1)
    expect(declined.routines[0].id).not.toBe('incoming')
    expect(declined.week).toEqual({ '2': 'existing' })

    const accepted = { routines: [], customEx: [], week: { '2': 'existing' } }
    const acceptedResult = mergePlan(accepted, weeklyBundle, { schedule: true })
    expect(acceptedResult.routines).toBe(1)
    expect(accepted.routines).toHaveLength(1)
    const localRoutineId = accepted.routines[0].id
    expect(localRoutineId).not.toBe('incoming')
    expect(Object.keys(accepted.week)).toEqual(['0'])
    expect(accepted.week['0']).toBe(localRoutineId)
  })

  it('reports no schedule assignment condition for omitted or empty root week', () => {
    const emptyWeek = parsePlan({ ...weeklyBundle, week: {} })
    const omittedWeekInput = { ...weeklyBundle }
    delete omittedWeekInput.week
    const omittedWeek = parsePlan(omittedWeekInput)

    expect(parsePlan(weeklyBundle).scheduledDays).toBe(1)
    expect(emptyWeek.scheduledDays).toBe(0)
    expect(omittedWeek.scheduledDays).toBe(0)
  })
})

describe('coach note round-trip', () => {
  it('exports a normalized planNote but never exports a session note', () => {
    const bundle = buildPlanBundle({
      routines: [{ id: 'r', name: 'Push', ex: [{ id: 'e-bench', sets: 3, reps: 8, planNote: '  Keep the elbows tucked  ', note: 'session-only' }] }],
      customEx: [], week: {},
    }, 'notes')
    expect(bundle.routines[0].ex[0]).toMatchObject({ planNote: 'Keep the elbows tucked' })
    expect(bundle.routines[0].ex[0]).not.toHaveProperty('note')
  })

  it('normalizes imported plan notes and discards an imported session note', () => {
    const parsed = parsePlan({
      opengym_plan: 1, name: 'notes', customEx: [], week: {}, routines: [{ id: 'r', name: 'Push', ex: [
        { id: KNOWN_EXERCISE, sets: 1, reps: 8, planNote: '  Use a lighter load  ', note: 'do not import this' },
      ] }],
    })
    expect(parsed.routines[0].ex[0]).toMatchObject({ planNote: 'Use a lighter load' })
    expect(parsed.routines[0].ex[0]).not.toHaveProperty('note')
  })

  it('retains planNote through mergePlan and omits empty notes', () => {
    const bundle = {
      opengym_plan: 1, name: 'notes', customEx: [], week: {}, routines: [{ id: 'r', name: 'Push', ex: [
        { id: 'e-bench', sets: 1, reps: 8, planNote: '  Use a pause  ' },
        { id: 'e-row', sets: 1, reps: 10, planNote: '   ' },
      ] }],
    }
    const target = { routines: [], customEx: [], week: {} }
    mergePlan(target, bundle)
    expect(target.routines[0].ex[0].planNote).toBe('Use a pause')
    expect(target.routines[0].ex[1]).not.toHaveProperty('planNote')
  })

  it('round-trips planNote from export through parse into a new routine', () => {
    const source = {
      routines: [{ id: 'r', name: 'Push', ex: [{ id: KNOWN_EXERCISE, sets: 2, reps: 8, planNote: '  Pause at the bottom  ' }] }],
      customEx: [], week: {},
    }
    const parsed = parsePlan(JSON.stringify(buildPlanBundle(source, 'round-trip')))
    const target = { routines: [], customEx: [], week: {} }
    mergePlan(target, parsed)
    expect(target.routines[0].ex[0].planNote).toBe('Pause at the bottom')
  })
})
