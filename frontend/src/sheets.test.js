// Tests for `commitPickerSelection`, the pure helper exported from sheets.jsx that
// guarantees the picker only closes after the caller's insertion mutation returns.
// Closing too early makes a failed save look successful; closing nothing on failure
// leaves a recoverable picker. The helper exists to make that contract testable.
//
// sheets.jsx transitively imports the Zustand stores at module load, and the stores
// register a `visibilitychange` listener on `document`. The default node test
// environment has no `document`, so we stub the stores out — the helper itself
// touches none of them, so the stub is just an import-time enabler.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EXDB } from './lib/exercises.js'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  openSheet: vi.fn(),
  stopRest: vi.fn(),
}))
vi.mock('./store/useStore.js', () => ({ useStore: { getState: mocks.getState } }))
vi.mock('./store/useUI.js', () => ({ useUI: { getState: () => ({ openSheet: mocks.openSheet, stopRest: mocks.stopRest }) } }))
vi.mock('./lib/nav.js', () => ({ nav: vi.fn() }))

const { commitPickerSelection, commitUnitMove, reorderTargetIndex, validTimedSeconds, clampTimedSeconds, weightBounds, clampWeight, adjustWeight, weightControlSteps, savedWeight, fmtWeight, startFlow, rebuildActiveEntry, ACTIVE_ENTRY_EDIT_REJECTED, buildImportedWorkoutEntries, historicalEntryNote, historicalCompletedSets } = await import('./sheets.jsx')
const { parseTimedSeconds, timedSecondsInput, defaultConfig, buildSets } = await import('./lib/history.js')
const { cloneHistoryValue, historyTargetBaseline } = await import('./lib/history-edit.js')

const ACTIVE_LIFT = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
const sheetsSource = readFileSync(resolve(process.cwd(), 'src/sheets.jsx'), 'utf8')

const activeState = () => ({ unit: 'kg', exWeights: {}, workouts: [], routines: [], active: null })

describe('commitPickerSelection', () => {
  it('calls commit() before closePicker() when the commit succeeds', () => {
    const order = []
    const commit = vi.fn(() => { order.push('commit') })
    const closePicker = vi.fn(() => { order.push('close') })

    commitPickerSelection(commit, closePicker)

    expect(order).toEqual(['commit', 'close'])
    expect(commit).toHaveBeenCalledTimes(1)
    expect(closePicker).toHaveBeenCalledTimes(1)
  })

  it('does not call closePicker() when commit() throws, so the picker stays recoverable', () => {
    const closePicker = vi.fn()
    const failing = () => { throw new Error('save failed') }

    expect(() => commitPickerSelection(failing, closePicker)).toThrow('save failed')
    expect(closePicker).not.toHaveBeenCalled()
  })

  it('only invokes the closer that was passed in, leaving any unrelated closer alone', () => {
    const thisCloser = vi.fn()
    const otherCloser = vi.fn()
    const commit = vi.fn()

    commitPickerSelection(commit, thisCloser)

    expect(thisCloser).toHaveBeenCalledTimes(1)
    expect(otherCloser).not.toHaveBeenCalled()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('passes the picker id invariant intact: a thrown commit leaves every closer untouched', () => {
    const thisCloser = vi.fn()
    const otherCloser = vi.fn()
    const failing = () => { throw new Error('boom') }

    expect(() => commitPickerSelection(failing, thisCloser)).toThrow('boom')
    expect(thisCloser).not.toHaveBeenCalled()
    expect(otherCloser).not.toHaveBeenCalled()
  })
})

describe('Historical workout conversion contracts', () => {
  it('deep-isolates entries, targets, sets, side objects, and arrays from the source', () => {
    const source = { id: 'w1', entries: [{ id: 'lift', target: { repsBySet: [8, 10] }, sets: [{ left: { r: 8 }, right: { r: 8 } }] }] }
    const draft = cloneHistoryValue(source)
    draft.entries[0].target.repsBySet[0] = 12
    draft.entries[0].sets[0].left.r = 1
    expect(source.entries[0].target.repsBySet).toEqual([8, 10])
    expect(source.entries[0].sets[0].left.r).toBe(8)
    expect(draft.entries[0].target).not.toBe(source.entries[0].target)
  })

  it('builds a target-only baseline for legacy entries without sharing actual sets', () => {
    const entry = { id: 'lift', mode: 'reps', sets: [{ r: 8, w: 20, done: true }], reps: 8, weight: 20 }
    const target = historyTargetBaseline(entry)
    target.reps = 10
    expect(target).toEqual({ mode: 'reps', reps: 10, weight: 20 })
    expect(target).not.toHaveProperty('sets')
    expect(entry.sets).toEqual([{ r: 8, w: 20, done: true }])
  })

})

describe('Historical workout detail presentation', () => {
  it('shows a trimmed workout note', () => {
    expect(historicalEntryNote({ note: '  felt strong today  ' }))
      .toEqual({ label: 'Workout note', text: 'felt strong today' })
  })

  it('does not show an exercise plan note on its own', () => {
    expect(historicalEntryNote({ target: { planNote: '  Keep the tempo  ' } })).toBeNull()
  })

  it('shows only the workout note when both notes exist', () => {
    expect(historicalEntryNote({ note: '  felt strong today  ', target: { planNote: 'Keep the tempo' } }))
      .toEqual({ label: 'Workout note', text: 'felt strong today' })
  })

  it('does not create a note for a whitespace-only workout note', () => {
    expect(historicalEntryNote({ note: '\t\n  ', target: { planNote: 'Keep the tempo' } })).toBeNull()
    expect(historicalEntryNote({})).toBeNull()
  })

  it('keeps only completed set labels in their original order', () => {
    expect(historicalCompletedSets({
      id: ACTIVE_LIFT,
      sets: [{ w: 40, r: 8, done: true }, { w: 45, r: 6, done: false }, { w: 50, r: 4, done: true }],
    })).toEqual([{ index: 0, label: '40×8' }, { index: 2, label: '50×4' }])
  })

  it('renders completed series as labeled list items instead of a joined line', () => {
    expect(sheetsSource).toContain('role="list" aria-label={t(\'Sets\')}')
    expect(sheetsSource).toContain('role="listitem" aria-label={t(\'Set {0}\', set.index + 1) + \': \' + set.label}')
    expect(sheetsSource).not.toContain(".filter(setIsDone).map(s => setLabel(e.id, s, e.target)).join('  ·  ')")
  })
})

describe('active workout routine imports', () => {
  it('imports the complete source in order with fresh snapshots and remapped supersets', () => {
    const source = {
      id: 'source-routine', name: 'Source routine', prog: 'off',
      ex: [
        { id: ACTIVE_LIFT, sets: 2, reps: 8, weight: 0, repsBySet: [8, 10], sg: 'source-pair' },
        { id: 'duplicate-exercise', sets: 1, reps: 6, weight: 25, sg: 'source-pair' },
        { id: ACTIVE_LIFT, sets: 1, reps: 5, weight: 0 },
      ],
    }
    const sourceBefore = JSON.parse(JSON.stringify(source))
    const existing = [{ id: 'existing', sid: 'existing-sid', sg: 'source-pair' }]
    const S = { unit: 'kg', workouts: [], exWeights: { [ACTIVE_LIFT]: { w: 90 } } }

    const imported = buildImportedWorkoutEntries(S, source, existing)

    expect(imported).toHaveLength(3)
    expect(imported.map(entry => entry.id)).toEqual([ACTIVE_LIFT, 'duplicate-exercise', ACTIVE_LIFT])
    expect(new Set(imported.map(entry => entry.sid)).size).toBe(3)
    expect(imported.every(entry => entry.sid !== 'existing-sid')).toBe(true)
    expect(imported[0].sg).toBe(imported[1].sg)
    expect(imported[0].sg).not.toBe('source-pair')
    expect(imported[2].sg).toBeUndefined()
    expect(imported[0].target.repsBySet).toEqual([8, 10])
    expect(imported[0].target.repsBySet).not.toBe(source.ex[0].repsBySet)
    expect(source).toEqual(sourceBefore)
    expect(existing).toEqual([{ id: 'existing', sid: 'existing-sid', sg: 'source-pair' }])
  })

  it('passes source-routine progression through the normal prescription path', () => {
    const source = {
      id: 'progressed-routine', name: 'Progressed routine', prog: 'linear',
      ex: [{ id: ACTIVE_LIFT, sets: 1, reps: 5, weight: 0 }],
    }
    const S = {
      unit: 'kg', exWeights: { [ACTIVE_LIFT]: { w: 95 } },
      workouts: [{ d: '2026-01-01', entries: [{ id: ACTIVE_LIFT, target: { mode: 'reps', sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }] }],
    }

    const [imported] = buildImportedWorkoutEntries(S, source)

    expect(imported.plan).toMatchObject({ policy: 'linear', kind: 'up' })
    expect(imported.plan.weight).toBeGreaterThan(60)
    expect(imported.sets[0]).toMatchObject({ w: imported.plan.weight, r: 5, done: false })
  })
})

describe('timed prescription validation', () => {
  it('initializes only a genuinely new timed config to 45 seconds', () => {
    expect(timedSecondsInput(undefined, '0001')).toBe('45')
    expect(defaultConfig('0001', 'time').sec).toBe(45)
  })
  it('keeps a missing existing value invalid instead of mutating it to 45', () => {
    const existing = { mode: 'time', sets: 3 }
    expect(timedSecondsInput(existing, '0001')).toBe('')
    expect(parseTimedSeconds(timedSecondsInput(existing, '0001'))).toBeNull()
    expect(existing.sec).toBeUndefined()
  })
  it('rejects missing input instead of producing NaN', () => {
    expect(parseTimedSeconds(undefined)).toBeNull()
    expect(parseTimedSeconds('')).toBeNull()
  })
  it('returns the validated value used for persistence', () => {
    expect(parseTimedSeconds('45')).toBe(45)
  })
  it.each(['1', '45', ' 90 '])('accepts positive whole seconds %j', raw => expect(validTimedSeconds(raw)).toBe(true))
  it.each(['', ' ', '0', '-1', '12.5', 'abc', '1e3', '9007199254740992'])('rejects unsafe seconds %j', raw => expect(validTimedSeconds(raw)).toBe(false))
  it('keeps stepper decrement at one second without a fallback', () => {
    expect(clampTimedSeconds(0)).toBe(1)
    expect(clampTimedSeconds(1 - 5)).toBe(1)
    expect(validTimedSeconds(String(clampTimedSeconds(1 - 5)))).toBe(true)
  })
  it('does not restore a malformed timed config with a 45-second fallback', () => {
    const S = { exWeights: {}, workouts: [] }
    expect(buildSets(S, { id: '0001', mode: 'time', sets: 1 }).at(0).sec).toBeUndefined()
  })
  it('persists a valid whole-second value exactly', () => {
    expect(parseTimedSeconds('75')).toBe(75)
    expect(parseTimedSeconds('12.5')).toBeNull()
  })
})

describe('weight bounds and precision modes', () => {
  it('uses equivalent 1–180 kg and 1–396 lb limits', () => {
    expect(weightBounds('kg')).toEqual({ min: 1, max: 180, step: 1 })
    expect(weightBounds('lb')).toEqual({ min: 1, max: 396, step: 1 })
    expect(clampWeight(1, 'kg')).toBe(1)
    expect(clampWeight(180, 'kg')).toBe(180)
    expect(clampWeight(396, 'lb')).toBe(396)
  })

  it('keeps the slider and primary controls on whole-kilogram values by default', () => {
    expect(clampWeight(181.27, 'kg')).toBe(180)
    expect(clampWeight(397, 'lb')).toBe(396)
    expect(clampWeight(72.34, 'kg')).toBe(72)
    expect(clampWeight(72.5, 'kg')).toBe(73)
    expect(clampWeight(72.5, 'lb')).toBe(73)
    expect(adjustWeight(72, -1, 'kg')).toBe(71)
    expect(adjustWeight(72, 1, 'kg')).toBe(73)
  })

  it('keeps the top-weight slider and primary controls at one kilogram', () => {
    expect(weightBounds('kg').step).toBe(1)
    expect(weightControlSteps(true)).toEqual({ primary: 1, chips: [-0.25, 0.25] })
    expect(adjustWeight(122.5, -weightControlSteps(true).primary, 'kg', true)).toBe(121.5)
    expect(adjustWeight(122.5, weightControlSteps(true).primary, 'kg', true)).toBe(123.5)
    expect(adjustWeight(7.25, -0.25, 'kg', true)).toBe(7)
    expect(adjustWeight(7.25, 0.25, 'kg', true)).toBe(7.5)
  })

  it('uses exactly two half-unit quick controls for bodyweight', () => {
    expect(weightControlSteps(true, true)).toEqual({ primary: 0.5, chips: [] })
    expect(adjustWeight(105.6, -weightControlSteps(true, true).primary, 'kg', true)).toBe(105.1)
    expect(adjustWeight(105.6, weightControlSteps(true, true).primary, 'lb', true)).toBe(106.1)
  })

  it('keeps whole-unit defaults for primary and chip controls', () => {
    expect(weightControlSteps(false)).toEqual({ primary: 1, chips: [-1, 1] })
    expect(adjustWeight(72, -weightControlSteps(false).primary, 'kg')).toBe(71)
    expect(adjustWeight(72, weightControlSteps(false).primary, 'kg')).toBe(73)
  })

  it.each([
    ['manual bodyweight', 'kg', 181.27, 180],
    ['goal weight', 'kg', 181.27, 180],
    ['top weight', 'lb', 397, 396],
  ])('clamps the %s save consumer through the shared helper', (_consumer, unit, value, expected) => {
    expect(savedWeight(value, unit)).toBe(expected)
  })

  it('rejects invalid save values without changing the whole-kilogram default', () => {
    expect(savedWeight('', 'kg')).toBeNull()
    expect(savedWeight('not-a-weight', 'lb')).toBeNull()
    expect(savedWeight(72.34, 'kg')).toBe(72)
  })

  it('keeps goal persistence whole-kilogram only', () => {
    expect(savedWeight(72.5, 'kg')).toBe(73)
    expect(savedWeight(0.5, 'kg')).toBe(1)
  })

  it('preserves decimal bodyweight saves and normalizes comma input', () => {
    expect(clampWeight('105,6', 'kg', true)).toBe(105.6)
    expect(savedWeight('105,6', 'kg', true)).toBe(105.6)
    expect(savedWeight('105.6', 'kg', true)).toBe(105.6)
    expect(savedWeight(181.276, 'kg', true)).toBe(180)
  })

  it('preserves two decimals for the explicit top-weight save mode', () => {
    expect(clampWeight(122.544, 'kg', true)).toBe(122.54)
    expect(clampWeight(122.545, 'kg', true)).toBe(122.55)
    expect(clampWeight(122.556, 'kg', true)).toBe(122.56)
    expect(savedWeight('122.55', 'kg', true)).toBe(122.55)
    expect(savedWeight(122.556, 'kg', true)).toBe(122.56)
    expect(fmtWeight(7.25, true)).toBe('7.25')
  })

  it('accepts comma decimal input for explicit top-weight saves', () => {
    expect(clampWeight('7,25', 'kg', true)).toBe(7.25)
    expect(savedWeight('7,25', 'kg', true)).toBe(7.25)
  })

  it('applies fine top-weight adjustments without floating-point artifacts', () => {
    expect(adjustWeight(122.55, -0.5, 'kg', true)).toBe(122.05)
    expect(adjustWeight(122.55, 0.5, 'kg', true)).toBe(123.05)
    expect(adjustWeight(122.55, -0.1, 'kg', true)).toBe(122.45)
    expect(adjustWeight(122.55, 0.1, 'kg', true)).toBe(122.65)
    expect(adjustWeight(122.5, -0.5, 'kg', true)).toBe(122)
    expect(adjustWeight(122.5, 0.5, 'kg', true)).toBe(123)
    expect(adjustWeight(122.5, -0.1, 'kg', true)).toBe(122.4)
    expect(adjustWeight(122.5, 0.1, 'kg', true)).toBe(122.6)
    expect(adjustWeight(122.6, -0.1, 'kg', true)).toBe(122.5)
  })

  it('clamps fine top-weight adjustments to the same valid bounds', () => {
    expect(adjustWeight(1, -0.5, 'kg', true)).toBe(1)
    expect(adjustWeight(180, 0.1, 'kg', true)).toBe(180)
    expect(savedWeight(0.5, 'kg', true)).toBe(1)
  })
})

describe('active exercise configuration', () => {
  it('regenerates an unfinished entry from the new config, including bodyweight', () => {
    const entry = {
      id: ACTIVE_LIFT, sg: 'pair-1',
      target: { mode: 'reps', sets: 2, reps: 8, weight: 0 },
      plan: { kind: 'old' },
      sets: [{ w: 0, r: 8, done: false }, { w: 0, r: 8, done: false }]
    }
    const before = JSON.parse(JSON.stringify(entry))

    const result = rebuildActiveEntry(activeState(), entry, {
      mode: 'reps', sets: 3, reps: 10, weight: 0, bodyweight: true
    })

    expect(result.ok).toBe(true)
    expect(result.entry).toMatchObject({ id: ACTIVE_LIFT, sg: 'pair-1', target: { bodyweight: true, reps: 10, sets: 3 } })
    expect(result.entry.sets).toEqual([
      { w: 0, r: 10, done: false },
      { w: 0, r: 10, done: false },
      { w: 0, r: 10, done: false },
    ])
    expect(entry).toEqual(before)
  })

  it('preserves the superset id and completed sets while refreshing unfinished sets', () => {
    const completed = { w: 40, r: 8, rir: 2, done: true }
    const entry = {
      id: ACTIVE_LIFT, sg: 'pair-2',
      target: { mode: 'reps', sets: 2, reps: 8, weight: 40 },
      sets: [completed, { w: 40, r: 8, done: false }]
    }
    const before = JSON.parse(JSON.stringify(entry))

    const result = rebuildActiveEntry(activeState(), entry, {
      mode: 'reps', sets: 2, reps: 12, weight: 50
    })

    expect(result.ok).toBe(true)
    expect(result.entry.id).toBe(ACTIVE_LIFT)
    expect(result.entry.sg).toBe('pair-2')
    expect(result.entry.sets[0]).toEqual(completed)
    expect(result.entry.sets[0]).not.toBe(completed)
    expect(result.entry.sets[1]).toEqual({ w: 50, r: 12, done: false })
    expect(entry).toEqual(before)
  })

  it('preserves the session note while rebuilding and normalizes the coach note snapshot', () => {
    const entry = {
      id: ACTIVE_LIFT, note: 'athlete context',
      target: { mode: 'reps', sets: 1, reps: 8, weight: 40, planNote: 'old coach cue' },
      sets: [{ w: 40, r: 8, done: false }],
    }

    const result = rebuildActiveEntry(activeState(), entry, {
      mode: 'reps', sets: 1, reps: 10, weight: 40, planNote: '  new coach cue  ',
    })

    expect(result.ok).toBe(true)
    expect(result.entry.note).toBe('athlete context')
    expect(result.entry.target.planNote).toBe('new coach cue')
  })

  it.each([
    ['mode', { mode: 'time', sets: 3, sec: 45, weight: 0 }],
    ['side setup', { mode: 'reps', sets: 3, reps: 10, weight: 40, side: true }],
    ['set count', { mode: 'reps', sets: 1, reps: 10, weight: 40 }],
  ])('rejects an incompatible %s change after completed sets', (_kind, cfg) => {
    const entry = {
      id: ACTIVE_LIFT,
      target: { mode: 'reps', sets: 3, reps: 8, weight: 40 },
      sets: [{ w: 40, r: 8, done: true }, { w: 40, r: 8, done: true }, { w: 40, r: 8, done: false }]
    }
    const before = JSON.parse(JSON.stringify(entry))

    const result = rebuildActiveEntry(activeState(), entry, cfg)

    expect(result).toEqual({ ok: false, reason: ACTIVE_ENTRY_EDIT_REJECTED })
    expect(entry).toEqual(before)
  })
})

describe('reorder live destination index', () => {
  // Five rows, 64px each: tops 0/64/128/192/256, midpoints 32/96/160/224/288.
  const ROW_H = 64
  const rectsOf = n => Array.from({ length: n }, (_, i) => ({ top: i * ROW_H, height: ROW_H }))

  it('maps the pointer Y to the row whose midpoint it crossed', () => {
    const rects = rectsOf(5)
    expect(reorderTargetIndex(rects, 10, 2)).toBe(0)
    expect(reorderTargetIndex(rects, 40, 0)).toBe(0)
    expect(reorderTargetIndex(rects, 100, 0)).toBe(1)
    expect(reorderTargetIndex(rects, 170, 1)).toBe(2)
    expect(reorderTargetIndex(rects, 300, 3)).toBe(4)
  })

  it('jumps across 2+ rows in a single move instead of stepping once', () => {
    expect(reorderTargetIndex(rectsOf(5), 250, 0)).toBe(3)
    expect(reorderTargetIndex(rectsOf(5), 20, 4)).toBe(0)
  })

  it('clamps outside pointers and falls back safely with no rows', () => {
    expect(reorderTargetIndex(rectsOf(5), -500, 2)).toBe(0)
    expect(reorderTargetIndex(rectsOf(5), 5000, 2)).toBe(4)
    expect(reorderTargetIndex([], 100, 2)).toBe(2)
    expect(reorderTargetIndex([], 100)).toBe(0)
  })
})

describe('reorder continuous drag commits', () => {
  // Mirrors the mocked store shape commitUnitMove expects: S with the active
  // snapshot, plus an update(mut) that applies the mutator like the real store.
  const entriesFor = () => ([
    { id: 'sq', sid: 's-sq', sets: [] },
    { id: 'bp', sid: 's-bp', sets: [] },
    { id: 'dl', sid: 's-dl', sets: [] },
    { id: 'ohp', sid: 's-ohp', sets: [] },
    { id: 'rw', sid: 's-rw', sets: [] },
  ])
  const installStore = ids => {
    const S = { active: { entries: entriesFor(), cur: ids?.cur ?? 0 } }
    mocks.getState.mockReset()
    mocks.getState.mockReturnValue({ S, update: mut => { mut(S) } })
    return S
  }
  const orderOf = S => S.active.entries.map(e => e.id)
  // Same loop the row runs per pointermove: measure live rects, resolve the
  // destination slot, commit one block move per slot change.
  const dragAcross = (S, ys, start = 0) => {
    let cur = start
    for (const y of ys) {
      const rects = S.active.entries.map((_, i) => ({ top: i * 64, height: 64 }))
      const target = reorderTargetIndex(rects, y, cur)
      if (target !== cur) {
        const result = commitUnitMove(cur, target)
        expect(result.changed).toBe(true)
        cur = target
      }
    }
    return cur
  }

  it('follows the finger down across 2+ rows with one commit per crossing', () => {
    const S = installStore()
    const end = dragAcross(S, [100, 170, 240], 0)
    expect(end).toBe(3)
    expect(orderOf(S)).toEqual(['bp', 'dl', 'ohp', 'sq', 'rw'])
    // cur tracks the dragged entry by stable sid, not by stale position
    expect(S.active.cur).toBe(3)
    expect(typeof S.active.lastRecordEditAt).toBe('number')
  })

  it('follows the finger up across 2+ rows with one commit per crossing', () => {
    const S = installStore()
    S.active.cur = 4
    const end = dragAcross(S, [200, 130, 60], 4)
    expect(end).toBe(0)
    expect(orderOf(S)).toEqual(['rw', 'sq', 'bp', 'dl', 'ohp'])
    expect(S.active.cur).toBe(0)
  })

  it('lands a single far jump as one block move', () => {
    const S = installStore()
    const end = dragAcross(S, [300], 0)
    expect(end).toBe(4)
    expect(orderOf(S)).toEqual(['bp', 'dl', 'ohp', 'rw', 'sq'])
  })

  it('leaves the order untouched when the pointer never crosses a midpoint', () => {
    const S = installStore()
    const before = orderOf(S)
    const end = dragAcross(S, [10, 20, 30], 0)
    expect(end).toBe(0)
    expect(orderOf(S)).toEqual(before)
  })
})

describe('reorder sheet layout and drag wiring', () => {
  it('opens the reorder sheet at content height instead of forcing the tall variant', () => {
    const line = sheetsSource.split('\n').find(l => l.includes('reorderExercisesSheet = '))
    expect(line).toBeDefined()
    expect(line).not.toContain('tall')
  })

  it('tracks the pointer on the window so mid-gesture commits cannot cut the drag short', () => {
    expect(sheetsSource).toContain("window.addEventListener('pointermove'")
    expect(sheetsSource).toContain("window.removeEventListener('pointermove'")
    expect(sheetsSource).toContain('setPointerCapture')
    expect(sheetsSource).toContain('data-nodrag')
  })

  it('auto-scrolls near the sheet edges and keeps keyboard + live region support', () => {
    expect(sheetsSource).toContain('requestAnimationFrame')
    expect(sheetsSource).toContain('REORDER_EDGE_PX')
    expect(sheetsSource).toContain("e.key === 'ArrowUp'")
    expect(sheetsSource).toContain("e.key === 'ArrowDown'")
    expect(sheetsSource).toContain('aria-live="polite"')
  })
})

describe('centralized workout start flow', () => {
  const stateFor = (bodyweightCheckEnabled, active = null) => ({
    S: {
      bodyweightCheckEnabled,
      active,
      routines: [{ id: 'today-routine', name: 'Today', ex: [] }, { id: 'other-routine', name: 'Other', ex: [] }],
      exWeights: {}, workouts: [], bodyweight: [],
    },
    update(mut, push = true) { this.lastPush = push; mut(this.S) },
  })
  // confirmSheet renders through the mocked openSheet: invoking the captured
  // render fn yields the ConfirmDialog element, whose props carry onConfirm.
  const confirmDialog = () => mocks.openSheet.mock.calls[0][0](() => {})

  it.each([
    ['Today', 'today-routine', 'Today'],
    ['other routine', 'other-routine', 'Other'],
    ['freestyle', null, 'Freestyle'],
  ])('asks for confirmation naming the routine before %s starts', (_variant, routineId, name) => {
    mocks.getState.mockReturnValue(stateFor(true))
    mocks.openSheet.mockReset()
    startFlow(routineId)
    expect(mocks.openSheet).toHaveBeenCalledTimes(1)
    expect(mocks.openSheet).toHaveBeenCalledWith(expect.any(Function), { kind: 'center' })
    const dialog = confirmDialog()
    // the routine name lives in the message body; the confirm button stays a short "Start"
    expect(dialog.props.message).toContain(name)
    expect(dialog.props.confirmText).toBe('Start')
  })

  it.each([
    ['Today', 'today-routine'],
    ['other routine', 'other-routine'],
    ['freestyle', null],
  ])('keeps the quick-check sheet for enabled %s starts after confirming', (_variant, routineId) => {
    mocks.getState.mockReturnValue(stateFor(true))
    mocks.openSheet.mockReset()
    startFlow(routineId)
    confirmDialog().props.onConfirm()
    expect(mocks.openSheet).toHaveBeenCalledWith(expect.any(Function), { locked: true })
    const options = mocks.openSheet.mock.calls.at(-1)[0]
    expect(options({})).toHaveProperty('props.required', true)
  })

  it.each([
    ['Today', 'today-routine'],
    ['other routine', 'other-routine'],
    ['freestyle', null],
  ])('bypasses the sheet and starts %s with a null bodyweight when disabled after confirming', (_variant, routineId) => {
    const state = stateFor(false)
    mocks.getState.mockReturnValue(state)
    mocks.openSheet.mockReset()
    startFlow(routineId)
    // only the confirm opened so far — nothing started yet
    expect(mocks.openSheet).toHaveBeenCalledTimes(1)
    expect(state.S.active).toBeNull()
    confirmDialog().props.onConfirm()
    expect(state.S.active).toEqual(expect.objectContaining({ routineId, bw: null }))
    expect(state.lastPush).toBe(false)
  })

  it('resumes instead of confirming when a session is already active', () => {
    const state = stateFor(true, { id: 'running', name: 'Today' })
    mocks.getState.mockReturnValue(state)
    mocks.openSheet.mockReset()
    startFlow('today-routine')
    expect(mocks.openSheet).not.toHaveBeenCalled()
    expect(state.S.active).toEqual({ id: 'running', name: 'Today' })
  })
})
