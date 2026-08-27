// Plan-share contract tests (Phase 2 guard).
// A shared plan is a self-contained file a friend imports into THEIR Hforge —
// it must carry only the routines, the week schedule, and the custom exercises
// those routines reference. Block-management state is the share-r's own
// training program and is intentionally NOT shared (spec #907: "Plan bundles
// MUST remain block-free"). A future change that accidentally starts
// including `blocks` or `activeBlock` would leak private training data to
// the friend and break the import (their store overlays a fresh default).
import { describe, it, expect } from 'vitest'
import { buildPlanBundle, parsePlan, mergePlan } from './plan-share.js'

const ROUTINES = [
  { id: 'r-push', name: 'Push', ex: [{ id: 'e-bench', sets: 3, reps: 8 }] },
  { id: 'r-pull', name: 'Pull', ex: [{ id: 'e-row', sets: 3, reps: 10 }] },
]
// A complete block the user might have active — must NOT appear in the bundle.
const BLOCK = {
  id: 'b1', name: 'Hypertrophy',
  weeks: [{
    days: { 0: 'r-push', 1: 'r-pull', 2: 'rest', 3: 'r-push', 4: 'r-pull', 5: 'rest', 6: 'rest' }
  }]
}
const ACTIVE = { blockId: 'b1', startedOn: '2026-08-24', status: 'active', pausedRanges: [] }

describe('buildPlanBundle — plan-share guard', () => {
  it('excludes `blocks` and `activeBlock` from the exported bundle', () => {
    const S = {
      routines: ROUTINES,
      customEx: [],
      week: { 1: 'r-push', 3: 'r-pull' },
      blocks: [BLOCK],
      activeBlock: ACTIVE,
    }
    const bundle = buildPlanBundle(S, 'my plan')
    expect(bundle).not.toHaveProperty('blocks')
    expect(bundle).not.toHaveProperty('activeBlock')
  })

  it('still works when the sharing user has no block state at all', () => {
    const S = {
      routines: ROUTINES,
      customEx: [],
      week: { 1: 'r-push', 3: 'r-pull' },
    }
    const bundle = buildPlanBundle(S, 'plain plan')
    expect(bundle).not.toHaveProperty('blocks')
    expect(bundle).not.toHaveProperty('activeBlock')
    expect(bundle.routines.length).toBe(2)
    expect(bundle.week[1]).toBe('r-push')
  })

  it('exported bundle is round-trippable through parsePlan / mergePlan without block fields', () => {
    const S = {
      routines: ROUTINES,
      customEx: [],
      week: { 1: 'r-push', 3: 'r-pull' },
      blocks: [BLOCK],
      activeBlock: ACTIVE,
    }
    const bundle = buildPlanBundle(S, 'rt')
    const parsed = parsePlan(JSON.stringify(bundle))
    // parsePlan only ever returns the shareable fields — block-shaped data
    // would be impossible to read here, and the contract says none exists.
    expect(parsed).not.toHaveProperty('blocks')
    expect(parsed).not.toHaveProperty('activeBlock')
    // mergePlan: importing into a fresh state adds routines + customEx and
    // leaves the importer's own block state alone (no block input was carried).
    const target = { routines: [], customEx: [], week: {}, blocks: [], activeBlock: null }
    const result = mergePlan(target, bundle)
    expect(target.routines.length).toBe(2)
    expect(target.blocks).toEqual([])
    expect(target.activeBlock).toBeNull()
    expect(result.routines).toBe(2)
  })
})

/* ---------- programmed-effort round-trip (Phase 2 — issue: programmed-rpe-rir) ----------
   A shared plan is a self-contained file a friend imports into THEIR Hforge. When the
   share-r's routine carries per-set metric-tagged effort targets (programmedEffort), the
   bundle must carry them so the friend's import keeps the same prescription. Legacy
   plans (no programmedEffort field) must remain valid — neither the export nor the
   import invents the field where it was absent. */
describe('programmedEffort round-trip (Phase 2)', () => {
  it('exports programmedEffort on a routine exercise when it is present in the source state', () => {
    // The share-r's routine has a slot mix (one target, one null) so the export
    // proves the array is carried through verbatim, null slots and all.
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
