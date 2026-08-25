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
