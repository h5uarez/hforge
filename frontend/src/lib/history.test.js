import { describe, it, expect } from 'vitest'
import { NOTE_MAX, normalizeExerciseNote, normalizeNote, copyNoteFields, copyHistoryEntry, keepHistoryEntry, updateExerciseNote, modeOf, isTimed, fmtSec, setLabel, defaultConfig, buildSets, projectSideSet, weightOfSet, setIsDone, exLine, workoutVolume, setsDone, effortOf, stepEffort, capEffort, isBw, isPerSide, sideReps, repStep, effectiveRoutineId, validateProgrammedTargets, normalizeTargets, resolveTarget } from './history.js'
import { EXDB } from './exercises.js'

// Real ids out of the shipped catalogue, so the body-part fallback is exercised for real.
const CARDIO = EXDB.find(e => e.bp === 'cardio').id
// A *loaded* lift: the catalogue's first non-cardio entry is a sit-up, which since issue #32
// defaults to bodyweight and would quietly send every label test down the other path.
const LIFT = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
const BW = EXDB.find(e => e.eq === 'body weight').id

describe('exercise notes', () => {
  it('trims persisted notes, omits empties, and keeps the 280-character limit', () => {
    expect(NOTE_MAX).toBe(280)
    expect(normalizeExerciseNote('  remember the bench change  ')).toBe('remember the bench change')
    expect(normalizeExerciseNote(' \n\t ')).toBeUndefined()
    expect(normalizeExerciseNote('x'.repeat(NOTE_MAX + 1))).toHaveLength(NOTE_MAX + 1)
    expect(normalizeNote('  ' + 'x'.repeat(NOTE_MAX + 1) + '  ')).toBe('x'.repeat(NOTE_MAX))
  })

  it('copies both note concepts without mutating the source', () => {
    const source = { note: '  athlete context  ', planNote: '  coach cue  ' }
    const copy = copyNoteFields(source)
    expect(copy).toEqual({ note: 'athlete context', planNote: 'coach cue' })
    expect(source).toEqual({ note: '  athlete context  ', planNote: '  coach cue  ' })
    expect(copyNoteFields({ note: ' ', planNote: null })).toEqual({})
  })

  it('retains noted zero-set history entries and preserves nested coach notes', () => {
    const noted = {
      id: LIFT,
      sets: [{ done: false, w: 60, r: 10 }],
      target: { mode: 'reps', planNote: '  keep the shoulder down  ' },
      note: '  shoulder felt tight  ',
    }
    const copied = copyHistoryEntry(noted)
    expect(copied).not.toBe(noted)
    expect(copied).toMatchObject({ note: 'shoulder felt tight', target: { planNote: 'keep the shoulder down' } })
    expect(keepHistoryEntry(copied)).toBe(true)
    expect(keepHistoryEntry({ id: LIFT, sets: [{ done: false }] })).toBe(false)
    expect(noted.note).toBe('  shoulder felt tight  ')
  })

  it('preserves draft spacing while persistence still trims and omits empties', () => {
    const entry = { id: LIFT, note: 'old', target: { planNote: 'coach cue' } }
    const changed = updateExerciseNote(entry, '  new  context  ')
    expect(changed).toEqual({ id: LIFT, note: '  new  context  ', target: { planNote: 'coach cue' } })
    expect(copyNoteFields(changed).note).toBe('new  context')
    expect(updateExerciseNote(changed, '   ')).toEqual({ id: LIFT, target: { planNote: 'coach cue' } })
    expect(updateExerciseNote(entry, 'x'.repeat(NOTE_MAX + 1)).note).toHaveLength(NOTE_MAX)
    expect(entry).toEqual({ id: LIFT, note: 'old', target: { planNote: 'coach cue' } })
  })

  it('keeps calculations identical when only a note differs', () => {
    const base = { entries: [{ id: LIFT, sets: [{ w: 60, r: 10, done: true }] }] }
    const noted = { ...base, entries: [{ ...base.entries[0], note: 'bench changed' }] }
    expect(workoutVolume(noted)).toBe(workoutVolume(base))
    expect(setsDone(noted)).toBe(setsDone(base))
  })
})

describe('canonical exercise data', () => {
  it('ships the corrected 0739 title directly from the catalog source', () => {
    expect(EXDB.find(e => e.id === '0739')).toMatchObject({ id: '0739', n: 'sled 45° leg press' })
  })
})

describe('modeOf', () => {
  it('falls back to the body part when a plan has no mode — every existing plan keeps working', () => {
    expect(modeOf({ id: CARDIO })).toBe('cardio')
    expect(modeOf({ id: LIFT })).toBe('reps')
    expect(modeOf({ id: 'no-such-exercise' })).toBe('reps')
    expect(modeOf({})).toBe('reps')
    expect(modeOf(null)).toBe('reps')
    expect(modeOf(undefined)).toBe('reps')
  })

  it('lets an explicit mode win over the body part', () => {
    expect(modeOf({ id: LIFT, mode: 'time' })).toBe('time')
    expect(modeOf({ id: CARDIO, mode: 'reps' })).toBe('reps')
    expect(modeOf({ id: CARDIO, mode: 'time' })).toBe('time')
  })

  it('ignores a mode it does not know rather than trusting a bad file', () => {
    expect(modeOf({ id: LIFT, mode: 'nonsense' })).toBe('reps')
    expect(modeOf({ id: CARDIO, mode: '' })).toBe('cardio')
  })

  it('exposes the timed check', () => {
    expect(isTimed({ id: LIFT, mode: 'time' })).toBe(true)
    expect(isTimed({ id: LIFT })).toBe(false)
  })
})

describe('fmtSec', () => {
  it('reads as a clock, not a pile of seconds', () => {
    expect(fmtSec(0)).toBe('0:00')
    expect(fmtSec(9)).toBe('0:09')
    expect(fmtSec(45)).toBe('0:45')
    expect(fmtSec(60)).toBe('1:00')
    expect(fmtSec(90)).toBe('1:30')
    expect(fmtSec(605)).toBe('10:05')
  })
  it('is defensive about junk input', () => {
    expect(fmtSec(-5)).toBe('0:00')
    expect(fmtSec(undefined)).toBe('0:00')
    expect(fmtSec(null)).toBe('0:00')
    expect(fmtSec(NaN)).toBe('0:00')
    expect(fmtSec(44.6)).toBe('0:45')
  })
})

describe('side-aware set accounting', () => {
  it('requires both sides and projects explicit values without fabricating legacy sides', () => {
    const side = { left: { done: true, w: 20, r: 8 }, right: { done: false, w: 20, r: 7 } }
    expect(projectSideSet(side)).toMatchObject({ done: false, w: 20, r: 15 })
    side.right.done = true
    expect(projectSideSet(side)).toMatchObject({ done: true, w: 20, r: 15 })
    const legacy = { done: true, w: 20, r: 8 }
    expect(projectSideSet(legacy)).toBe(legacy)
    expect(legacy.left).toBeUndefined()
  })
  it('omits aggregate weight when side weights differ', () => {
    const set = { left: { done: true, w: 20, r: 8 }, right: { done: true, w: 22, r: 8 } }
    expect(projectSideSet(set)).not.toHaveProperty('w')
    expect(weightOfSet(set)).toBe(22)
  })
  it('uses explicit side load for volume and 1RM-compatible reads', () => {
    const set = { left: { done: true, w: 20, r: 8 }, right: { done: true, w: 22, r: 8 } }
    expect(workoutVolume({ entries: [{ sets: [set] }] })).toBe(22 * 16)
  })
  it('uses projected completion for finish and history consumers', () => {
    const side = { left: { done: true, w: 20 }, right: { done: true, w: 22 }, done: false }
    expect(setIsDone(side)).toBe(true)
    expect(setIsDone({ done: true, w: 40 })).toBe(true)
    expect(setIsDone({ left: { done: true }, right: { done: false } })).toBe(false)
  })
  it('does not copy a legacy aggregate into newly created side records', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-08-28', entries: [{ id: LIFT, sets: [{ done: true, w: 40, r: 10 }] }] }] }
    const sets = buildSets(S, { id: LIFT, mode: 'reps', side: true, sets: 1, reps: 12, weight: 0 })
    expect(sets[0].left).toMatchObject({ w: 0, r: 6 })
    expect(sets[0].right).toMatchObject({ w: 0, r: 6 })
    expect(sets[0]).toMatchObject({ w: 40, r: 12 })
  })
  it('counts a workout set only after both sides finish', () => {
    const w = { entries: [{ sets: [{ left: { done: true }, right: { done: false } }] }] }
    expect(setsDone(w)).toBe(0)
    w.entries[0].sets[0].right.done = true
    expect(setsDone(w)).toBe(1)
  })
})

describe('setLabel', () => {
  it('describes each mode in its own terms', () => {
    expect(setLabel(LIFT, { w: 60, r: 10 })).toBe('60×10')
    expect(setLabel(CARDIO, { min: 20, speed: 9 })).toBe('20 min @ 9 km/h')
    expect(setLabel(LIFT, { sec: 45, w: 0 }, { mode: 'time' })).toBe('0:45')
    expect(setLabel(LIFT, { sec: 90, w: 20 }, { mode: 'time' })).toBe('1:30 · 20')
  })

  it('reads a legacy set with no config exactly as before', () => {
    expect(setLabel(LIFT, { w: 0, r: 0 })).toBe('0×0')
    expect(setLabel(CARDIO, {})).toBe('0 min @ 0 km/h')
  })

  it('appends RIR when present, including a valid 0', () => {
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 2 })).toBe('60×10 (RIR 2)')
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 1.5 })).toBe('60×10 (RIR 1.5)')
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 0 })).toBe('60×10 (RIR 0)')
  })

  it('says nothing about RIR on a set that never logged one', () => {
    expect(setLabel(LIFT, { w: 60, r: 10 })).toBe('60×10')
    // cleared in the UI: the key is dropped, but a null must read the same as absent
    expect(setLabel(LIFT, { w: 60, r: 10, rir: null })).toBe('60×10')
  })

  it('appends RPE for a set logged on that scale', () => {
    expect(setLabel(LIFT, { w: 60, r: 10, rpe: 8 })).toBe('60×10 (RPE 8)')
    expect(setLabel(LIFT, { w: 60, r: 10, rpe: 9.5 })).toBe('60×10 (RPE 9.5)')
    expect(setLabel(LIFT, { w: 60, r: 10, rpe: null })).toBe('60×10')
  })

  it('keeps each set on the scale it was logged with', () => {
    // switching the setting must not rewrite history: an old RIR set still reads as RIR
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 2 })).toBe('60×10 (RIR 2)')
    // and a set that somehow carries both is described once, by the one it was logged with
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 2, rpe: 8 })).toBe('60×10 (RIR 2)')
  })
})

describe('effortOf', () => {
  it('reads the scale a profile logs', () => {
    expect(effortOf({ effort: 'rpe' })).toBe('rpe')
    expect(effortOf({ effort: 'rir' })).toBe('rir')
    expect(effortOf({ effort: 'none' })).toBe('none')
    expect(effortOf({})).toBe('none')
  })

  it('keeps the column for a profile still carrying the old showRir flag', () => {
    expect(effortOf({ showRir: true })).toBe('rir')
    // what a stored profile actually looks like once it is overlaid on DEF
    expect(effortOf({ effort: null, showRir: true })).toBe('rir')
    expect(effortOf({ effort: null })).toBe('none')
    expect(effortOf({ showRir: false })).toBe('none')
    // once the new setting is chosen it wins, whatever the old flag said
    expect(effortOf({ showRir: true, effort: 'rpe' })).toBe('rpe')
    expect(effortOf({ showRir: true, effort: 'none' })).toBe('none')
  })

  // The store cannot be imported here (it reaches for `navigator` at module load), so the
  // overlay it performs is reproduced literally: stored profile spread over the defaults.
  // DEF.effort is null precisely so this lands on the showRir fallback rather than on 'none'.
  const overlay = stored => ({ unit: 'kg', effort: null, ...stored })

  it('survives the overlay every load path performs', () => {
    // upgrading with the column on: local state, a server pull and a restored backup all
    // arrive as a stored object spread over the defaults, and all must keep the column
    expect(effortOf(overlay({ showRir: true }))).toBe('rir')
    expect(effortOf(overlay({ showRir: false }))).toBe('none')
    // a profile predating the RIR feature entirely
    expect(effortOf(overlay({}))).toBe('none')
    // and one written by this version
    expect(effortOf(overlay({ effort: 'rpe' }))).toBe('rpe')
    // an old backup restored over a profile that had already chosen: the file wins, because
    // an import replaces state wholesale rather than merging
    expect(effortOf(overlay({ showRir: true, effort: undefined }))).toBe('rir')
  })

  it('is not fooled by a junk value', () => {
    expect(effortOf({ effort: 'rpe10' })).toBe('none')
    expect(effortOf({ effort: 'RIR' })).toBe('none')
    expect(effortOf({ effort: 'f' })).toBe('none')
    expect(effortOf(null)).toBe('none')
    expect(effortOf(undefined)).toBe('none')
    // a junk value with the old flag still set falls back rather than showing nothing
    expect(effortOf({ effort: 'nope', showRir: true })).toBe('rir')
  })
})

describe('stepEffort', () => {
  it('starts at the bottom of the scale and walks up', () => {
    // the first + on an empty cell lands on the lowest value, not on some "typical" middle:
    // the stepper counts up from the floor the way every other stepper in the app does
    expect(stepEffort('rir', null, 1)).toBe(0)
    expect(stepEffort('rpe', null, 1)).toBe(5)
    // and then in even steps
    expect(stepEffort('rir', 0, 1)).toBe(0.5)
    expect(stepEffort('rir', 0.5, 1)).toBe(1)
    expect(stepEffort('rpe', 5, 1)).toBe(5.5)
  })

  it('leaves an untouched cell unlogged when stepped down', () => {
    // one stray − on a fresh row must not stamp "(RIR 0)" — went to failure — on the set
    expect(stepEffort('rir', null, -1)).toBe(null)
    expect(stepEffort('rpe', null, -1)).toBe(null)
    expect(stepEffort('rir', undefined, -1)).toBe(null)
  })

  it('clears the cell again when stepped back off the floor', () => {
    // so a mistap is undoable rather than sticking at the floor for good
    expect(stepEffort('rir', 0, -1)).toBe(null)
    expect(stepEffort('rpe', 5, -1)).toBe(null)
    // but a step that stays inside the scale is an ordinary step
    expect(stepEffort('rir', 0.5, -1)).toBe(0)
    expect(stepEffort('rpe', 5.5, -1)).toBe(5)
  })

  it('stops at the top of the scale', () => {
    expect(stepEffort('rir', 9.5, 1)).toBe(10)
    expect(stepEffort('rir', 10, 1)).toBe(10)
    expect(stepEffort('rpe', 10, 1)).toBe(10)
  })

  it('keeps halves clean instead of drifting into float dust', () => {
    let v = null
    for (let i = 0; i < 6; i++) v = stepEffort('rpe', v, 1)
    expect(v).toBe(7.5)
    expect(stepEffort('rir', 0.1 + 0.2, 1)).toBe(0.8)
  })

  it('steps evenly from a value typed below the floor rather than snapping', () => {
    // nothing stops someone typing RPE 3; the stepper must not jump them to 5 on one tap
    expect(stepEffort('rpe', 3, 1)).toBe(3.5)
    // stepping down out of the scale from there just clears it
    expect(stepEffort('rpe', 3, -1)).toBe(null)
  })

  it('does nothing when the profile logs no effort at all', () => {
    expect(stepEffort('none', null, 1)).toBe(null)
    expect(stepEffort('none', 2, 1)).toBe(2)
    expect(stepEffort(undefined, 2, -1)).toBe(2)
  })
})

describe('capEffort', () => {
  it('caps a typed value at the top of the scale', () => {
    expect(capEffort('rir', 12)).toBe(10)
    expect(capEffort('rpe', 99)).toBe(10)
    expect(capEffort('rpe', 8)).toBe(8)
  })

  it('does not floor a typed value, so typing "10" survives its first keystroke', () => {
    // clamping up would turn the "1" of "10" into 6 and fight the input
    expect(capEffort('rpe', 1)).toBe(1)
    expect(capEffort('rir', 0)).toBe(0)
  })

  it('passes an emptied field through untouched', () => {
    expect(capEffort('rir', null)).toBe(null)
    expect(capEffort('rpe', undefined)).toBe(undefined)
    expect(capEffort('none', 12)).toBe(12)
  })
})

// End-to-end on the data, not the pixels: what a set carries after the taps a real session
// makes, and what it reads back as afterwards.
describe('logging effort across a session', () => {
  it('logs a working set on the chosen scale', () => {
    // four + taps from empty on an RPE profile: 5, 5.5, 6, 6.5
    let v = null
    for (let i = 0; i < 4; i++) v = stepEffort('rpe', v, 1)
    expect(setLabel(LIFT, { w: 80, r: 5, rpe: v })).toBe('80×5 (RPE 6.5)')
  })

  it('a set taken to failure is logged, not left blank', () => {
    const v = stepEffort('rir', null, 1)      // one + on an RIR profile
    expect(v).toBe(0)
    expect(setLabel(LIFT, { w: 100, r: 3, rir: v })).toBe('100×3 (RIR 0)')
  })

  it('switching the setting mid-history rewrites nothing', () => {
    const old = { w: 60, r: 10, rir: 2 }      // logged while the profile was on RIR
    const fresh = { w: 60, r: 10, rpe: 8 }    // logged after switching to RPE
    expect(effortOf({ effort: 'rpe' })).toBe('rpe')
    expect(setLabel(LIFT, old)).toBe('60×10 (RIR 2)')
    expect(setLabel(LIFT, fresh)).toBe('60×10 (RPE 8)')
    // turning the column off entirely hides the control but keeps both sets readable
    expect(effortOf({ effort: 'none' })).toBe('none')
    expect(setLabel(LIFT, old)).toBe('60×10 (RIR 2)')
  })

  it('never attaches effort to a mode that has no place for it', () => {
    // cardio and timed sets have no third stepper, and their labels ignore the field even
    // if an import or an old file put one there
    expect(setLabel(CARDIO, { min: 20, speed: 9, rpe: 8 })).toBe('20 min @ 9 km/h')
    expect(setLabel(LIFT, { sec: 45, rir: 2 }, { id: LIFT, mode: 'time' })).toBe('0:45')
  })
})

describe('defaultConfig', () => {
  it('gives each mode a sensible starting point', () => {
    expect(defaultConfig(LIFT)).toEqual({ sets: 3, reps: 10, weight: 0, mode: 'reps' })
    expect(defaultConfig(CARDIO)).toEqual({ sets: 1, min: 20, speed: 8 })
    expect(defaultConfig(LIFT, 'time')).toEqual({ sets: 3, sec: 45, weight: 0, mode: 'time' })
  })
  it('seeds the bodyweight flag from the catalogue, and only when it is true', () => {
    expect(defaultConfig(BW)).toEqual({ sets: 3, reps: 10, weight: 0, mode: 'reps', bodyweight: true })
    expect(defaultConfig(BW, 'time')).toEqual({ sets: 3, sec: 45, weight: 0, mode: 'time', bodyweight: true })
    expect('bodyweight' in defaultConfig(LIFT)).toBe(false)
  })
  it('builds explicit left and right records for the corrected unilateral exercise', () => {
    const sets = buildSets({ workouts: [], exWeights: {}, active: null }, { id: '0739', sets: 1, reps: 16, weight: 40, side: true })
    expect(sets[0]).toMatchObject({ done: false, left: { done: false, r: 8, w: 40 }, right: { done: false, r: 8, w: 40 } })
  })
})

/* ---------- programmed effort (issue: programmed-rpe-rir, Phase 1 foundation) ----------
   Per-set metric-tagged RIR/RPE targets live on the routine entry as
   `programmedEffort: [{ metric, value } | null]`. Targets whose metric no
   longer matches Settings are hidden, never converted. */

describe('validateProgrammedTargets', () => {
  it('returns undefined when the routine has no programmedEffort field — legacy routines stay valid', () => {
    expect(validateProgrammedTargets(undefined, 'rir')).toBeUndefined()
    expect(validateProgrammedTargets(null, 'rir')).toBeUndefined()
    expect(validateProgrammedTargets(undefined, 'rpe')).toBeUndefined()
  })

  it('passes a fully-compatible array through untouched — the same object reference', () => {
    // the routine editor re-uses the array as-is when every entry already matches
    const arr = [{ metric: 'rir', value: 2 }, null, { metric: 'rir', value: 1 }]
    expect(validateProgrammedTargets(arr, 'rir')).toBe(arr)
  })

  it('treats an empty array as "no targets set" — distinct from absent', () => {
    // the sheets normalize step always produces at least cfg.sets entries, so an empty
    // array means a routine with zero sets, not a missing field
    const empty = []
    expect(validateProgrammedTargets(empty, 'rir')).toBe(empty)
  })

  it('rejects the whole array when any non-null entry has a mismatched metric', () => {
    // a metric change in Settings leaves the routine data intact; the UI hides the
    // mismatch until the user explicitly re-edits for the new metric
    expect(validateProgrammedTargets(
      [{ metric: 'rpe', value: 8 }, { metric: 'rpe', value: 8.5 }], 'rir'
    )).toBeNull()
    expect(validateProgrammedTargets(
      [{ metric: 'rir', value: 2 }, { metric: 'rpe', value: 8 }], 'rir'
    )).toBeNull()
  })

  it('accepts an array whose null entries are skipped and whose real entries all match', () => {
    // a null entry means "no target on this set" and never trips the metric gate
    const arr = [{ metric: 'rpe', value: 7 }, null, { metric: 'rpe', value: 8 }]
    expect(validateProgrammedTargets(arr, 'rpe')).toBe(arr)
  })

  it('returns null when metric is "none" and any entry is non-null — never seed a target on a profile with no effort column', () => {
    expect(validateProgrammedTargets(
      [{ metric: 'rir', value: 2 }], 'none'
    )).toBeNull()
  })

  it('rejects an entry whose metric is missing or not a string', () => {
    expect(validateProgrammedTargets(
      [{ value: 2 }], 'rir'   // missing metric
    )).toBeNull()
    expect(validateProgrammedTargets(
      [{ metric: 'rir', value: 2 }, null, { metric: 42 }], 'rir'  // bad metric type
    )).toBeNull()
  })
})

describe('normalizeTargets', () => {
  it('returns an empty array when given nothing — the routine has no targets', () => {
    expect(normalizeTargets(undefined, 3)).toEqual([])
    expect(normalizeTargets(null, 3)).toEqual([])
  })

  it('returns an empty array for an empty input array, even when setCount is positive', () => {
    // absence and "no targets configured" both read as empty: growth does not
    // invent null targets, callers always consult validateProgrammedTargets first
    expect(normalizeTargets([], 3)).toEqual([])
  })

  it('returns an empty array when setCount is 0 or negative — defensive against bad callers', () => {
    expect(normalizeTargets([{ metric: 'rir', value: 2 }], 0)).toEqual([])
    expect(normalizeTargets([{ metric: 'rir', value: 2 }], -1)).toEqual([])
  })

  it('truncates when the routine grows the array back down to setCount', () => {
    // a routine shrunk from 4 sets to 2: drop the trailing slots
    const arr = [{ metric: 'rir', value: 2 }, { metric: 'rir', value: 1 }, { metric: 'rir', value: 0 }, { metric: 'rir', value: 0 }]
    expect(normalizeTargets(arr, 2)).toEqual([
      { metric: 'rir', value: 2 }, { metric: 'rir', value: 1 },
    ])
  })

  it('extends with the last value when the routine grows past the saved targets', () => {
    // a routine expanded from 1 set to 3: carry the last programmed target forward
    // so the lifter does not lose a previously saved prescription on extra sets
    const arr = [{ metric: 'rir', value: 2 }]
    expect(normalizeTargets(arr, 3)).toEqual([
      { metric: 'rir', value: 2 },
      { metric: 'rir', value: 2 },
      { metric: 'rir', value: 2 },
    ])
  })

  it('copies the last non-null value when extending, even if trailing entries were null', () => {
    // null means "no target on this set" — extending must use the last REAL target,
    // not the trailing null, or a routine grown past a null would lose the prescription
    const arr = [{ metric: 'rir', value: 3 }, null, { metric: 'rir', value: 1 }, null]
    const out = normalizeTargets(arr, 6)
    expect(out).toEqual([
      { metric: 'rir', value: 3 },
      null,
      { metric: 'rir', value: 1 },
      null,
      { metric: 'rir', value: 1 },
      { metric: 'rir', value: 1 },
    ])
  })

  it('returns a fresh array (not the same reference) so callers can mutate without leaking', () => {
    const arr = [{ metric: 'rir', value: 2 }]
    const out = normalizeTargets(arr, 2)
    expect(out).not.toBe(arr)
    out[0] = null
    expect(arr[0]).toEqual({ metric: 'rir', value: 2 })   // original is intact
  })
})

/* ---------- bodyweight and per side (issues #31/#32/#33) ---------- */

describe('isBw', () => {
  it('defaults from the catalogue so an existing plan needs no flag', () => {
    expect(isBw({ id: BW })).toBe(true)
    expect(isBw({ id: LIFT })).toBe(false)
  })
  it('lets the config win in both directions — a belt on a dip, a flag on a machine', () => {
    expect(isBw({ id: BW, bodyweight: false })).toBe(false)
    expect(isBw({ id: LIFT, bodyweight: true })).toBe(true)
  })
})

describe('sideReps', () => {
  it('halves the logged total, because the total is what was logged', () => {
    expect(sideReps(16)).toBe(8)
    expect(sideReps(0)).toBe(0)
  })
  it('shows an odd total as it falls rather than rounding the imbalance away', () => {
    expect(sideReps(17)).toBe(8.5)
  })
})

describe('exLine — per side never reaches a timed hold', () => {
  it('ignores a stale side flag on a hold, which has no reps to split', () => {
    expect(exLine({ id: LIFT, sets: 3, sec: 45, mode: 'time', side: true }, 'kg')).toBe('3 × 0:45')
  })
})

describe('repStep', () => {
  it('steps unilateral work in twos so the total stays splittable', () => {
    expect(repStep({ side: true })).toBe(2)
    expect(repStep({})).toBe(1)
    expect(repStep(null)).toBe(1)
  })
})

describe('setLabel — bodyweight', () => {
  it('reads as reps alone, because "0×12" describes nothing', () => {
    expect(setLabel(BW, { w: 0, r: 12 }, { id: BW })).toBe('12')
  })
  it('spells out a belt as an addition', () => {
    expect(setLabel(BW, { w: 10, r: 8 }, { id: BW })).toBe('+10 × 8')
  })
  it('logs a per-side set as the plain total, like every other set in the app', () => {
    expect(setLabel(BW, { w: 0, r: 16 }, { id: BW, side: true })).toBe('16')
    expect(setLabel(LIFT, { w: 20, r: 16 }, { id: LIFT, side: true })).toBe('20×16')
  })
  it('keeps the effort tail', () => {
    expect(setLabel(BW, { w: 0, r: 12, rir: 2 }, { id: BW })).toBe('12 (RIR 2)')
  })
})

describe('exLine', () => {
  it('shows the split where there is room for it, next to the total you log', () => {
    expect(exLine({ id: LIFT, sets: 3, reps: 16, side: true }, 'kg')).toBe('3 × 16 · 8/side')
  })
  it('marks added weight as added', () => {
    expect(exLine({ id: BW, sets: 3, reps: 8, weight: 10 }, 'kg')).toBe('3 × 8 · +10 kg')
  })
  it('summarises a planned exercise per mode', () => {
    expect(exLine({ id: LIFT, sets: 3, reps: 10 }, 'kg')).toBe('3 × 10')
    expect(exLine({ id: LIFT, sets: 3, reps: 10, weight: 60 }, 'kg')).toBe('3 × 10 · 60 kg')
    expect(exLine({ id: LIFT, sets: 3, sec: 45, mode: 'time' }, 'kg')).toBe('3 × 0:45')
    expect(exLine({ id: LIFT, sets: 2, sec: 90, weight: 20, mode: 'time' }, 'kg')).toBe('2 × 1:30 · 20 kg')
    expect(exLine({ id: CARDIO, sets: 1, min: 20, speed: 8 }, 'kg')).toBe('1 × 20 min @ 8 km/h')
  })
})

const emptyS = { workouts: [], exWeights: {} }

describe('buildSets', () => {
  it('builds reps sets from the plan when there is no history', () => {
    expect(buildSets(emptyS, { id: LIFT, sets: 3, reps: 8, weight: 50 }))
      .toEqual([{ w: 50, r: 8, done: false }, { w: 50, r: 8, done: false }, { w: 50, r: 8, done: false }])
  })

  it('builds timed sets, carrying the planned duration and load', () => {
    expect(buildSets(emptyS, { id: LIFT, mode: 'time', sets: 2, sec: 60, weight: 20 }))
      .toEqual([{ sec: 60, w: 20, done: false }, { sec: 60, w: 20, done: false }])
  })

  it('builds cardio sets unchanged', () => {
    expect(buildSets(emptyS, { id: CARDIO, sets: 1, min: 25, speed: 9 }))
      .toEqual([{ min: 25, speed: 9, done: false }])
  })

  it('carries last time\'s numbers forward within the same mode', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, target: { mode: 'time' }, sets: [{ sec: 70, w: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, mode: 'time', sets: 2, sec: 45, weight: 0 }))
      .toEqual([{ sec: 70, w: 10, done: false }, { sec: 70, w: 10, done: false }])
  })

  it('does not seed a duration from a rep count when an exercise switches to time', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, mode: 'time', sets: 1, sec: 45, weight: 0 }))
      .toEqual([{ sec: 45, w: 0, done: false }])
  })

  it('does not seed reps from a timed set when an exercise switches back', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, target: { mode: 'time' }, sets: [{ sec: 70, w: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, mode: 'reps', sets: 1, reps: 8, weight: 40 }))
      .toEqual([{ w: 40, r: 8, done: false }])
  })

  it('still prefers the confirmed working weight for reps sets', () => {
    const S = { exWeights: { [LIFT]: { w: 75 } }, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 8, weight: 50 })).toEqual([{ w: 75, r: 10, done: false }])
  })

  /* ---- programmed-effort seeding (issue: programmed-rpe-rir, Phase 1) ----
     The planned effort is snapshotted onto each set at workout start; the
     snapshot is later displayed read-only while the user logs actual
     rir/rpe. plannedEffort is keyed off the Settings effort mode: when
     Settings flips to a different metric the old targets are hidden, not
     converted. */

  it('seeds plannedEffort from cfg.programmedEffort when the metric matches Settings', () => {
    const S = { workouts: [], exWeights: {}, effort: 'rir' }
    const cfg = { id: LIFT, sets: 3, reps: 8, weight: 50,
      programmedEffort: [{ metric: 'rir', value: 2 }, null, { metric: 'rir', value: 1 }] }
    const sets = buildSets(S, cfg)
    expect(sets).toEqual([
      { w: 50, r: 8, done: false, plannedEffort: { metric: 'rir', value: 2 } },
      { w: 50, r: 8, done: false },                                       // null slot → no plannedEffort
      { w: 50, r: 8, done: false, plannedEffort: { metric: 'rir', value: 1 } },
    ])
  })

  it('omits plannedEffort when Settings is on a different metric than the saved targets', () => {
    // routine was edited while Settings was on RPE; switching Settings to RIR must
    // not convert, must hide the target entirely
    const S = { workouts: [], exWeights: {}, effort: 'rir' }
    const cfg = { id: LIFT, sets: 2, reps: 8, weight: 50,
      programmedEffort: [{ metric: 'rpe', value: 8 }, { metric: 'rpe', value: 8.5 }] }
    const sets = buildSets(S, cfg)
    expect(sets).toEqual([
      { w: 50, r: 8, done: false },
      { w: 50, r: 8, done: false },
    ])
  })

  it('omits plannedEffort when Settings has no effort column — a "none" profile never seeds a target', () => {
    const S = { workouts: [], exWeights: {}, effort: 'none' }
    const cfg = { id: LIFT, sets: 2, reps: 8, weight: 50,
      programmedEffort: [{ metric: 'rir', value: 2 }, { metric: 'rir', value: 1 }] }
    const sets = buildSets(S, cfg)
    expect(sets).toEqual([
      { w: 50, r: 8, done: false },
      { w: 50, r: 8, done: false },
    ])
  })

  it('copies the last programmed target when the set count exceeds the saved array length', () => {
    // routine grew from 1 set to 3 after the lifter added sets; the single
    // saved target must be carried forward to every new set
    const S = { workouts: [], exWeights: {}, effort: 'rir' }
    const cfg = { id: LIFT, sets: 3, reps: 8, weight: 50,
      programmedEffort: [{ metric: 'rir', value: 2 }] }
    const sets = buildSets(S, cfg)
    expect(sets).toEqual([
      { w: 50, r: 8, done: false, plannedEffort: { metric: 'rir', value: 2 } },
      { w: 50, r: 8, done: false, plannedEffort: { metric: 'rir', value: 2 } },
      { w: 50, r: 8, done: false, plannedEffort: { metric: 'rir', value: 2 } },
    ])
  })

  it('truncates planned-effort seeding when the set count is shorter than the saved array', () => {
    const S = { workouts: [], exWeights: {}, effort: 'rir' }
    const cfg = { id: LIFT, sets: 2, reps: 8, weight: 50,
      programmedEffort: [{ metric: 'rir', value: 2 }, { metric: 'rir', value: 1 }, { metric: 'rir', value: 0 }] }
    const sets = buildSets(S, cfg)
    expect(sets).toEqual([
      { w: 50, r: 8, done: false, plannedEffort: { metric: 'rir', value: 2 } },
      { w: 50, r: 8, done: false, plannedEffort: { metric: 'rir', value: 1 } },
    ])
  })

  it('omits plannedEffort when cfg.programmedEffort is absent — legacy routines stay unaffected', () => {
    const S = { workouts: [], exWeights: {}, effort: 'rir' }
    const cfg = { id: LIFT, sets: 3, reps: 8, weight: 50 }
    const sets = buildSets(S, cfg)
    expect(sets).toEqual([
      { w: 50, r: 8, done: false },
      { w: 50, r: 8, done: false },
      { w: 50, r: 8, done: false },
    ])
  })

  it('does NOT seed plannedEffort on cardio or timed sets — programming effort is reps-only', () => {
    const S = { workouts: [], exWeights: {}, effort: 'rir' }
    const cardio = buildSets(S, { id: CARDIO, sets: 1, min: 20, speed: 8,
      programmedEffort: [{ metric: 'rir', value: 2 }] })
    expect(cardio[0]).toEqual({ min: 20, speed: 8, done: false })
    expect(cardio[0]).not.toHaveProperty('plannedEffort')

    const timed = buildSets(S, { id: LIFT, mode: 'time', sets: 1, sec: 45, weight: 20,
      programmedEffort: [{ metric: 'rir', value: 2 }] })
    expect(timed[0]).toEqual({ sec: 45, w: 20, done: false })
    expect(timed[0]).not.toHaveProperty('plannedEffort')
  })

  it('does not consume programmed effort when the actual rir/rpe is later recorded — planning is separate from logging', () => {
    // the planned snapshot must remain visible alongside the actual value the
    // lifter logs; buildSets only seeds plannedEffort, never edits it later
    const S = { workouts: [], exWeights: {}, effort: 'rir' }
    const cfg = { id: LIFT, sets: 1, reps: 5, weight: 80,
      programmedEffort: [{ metric: 'rir', value: 2 }] }
    const [set] = buildSets(S, cfg)
    expect(set.plannedEffort).toEqual({ metric: 'rir', value: 2 })
    // simulating the user logging actual RIR: plannedEffort survives
    set.rir = 0
    expect(set.plannedEffort).toEqual({ metric: 'rir', value: 2 })
    expect(set.rir).toBe(0)
  })

  it('uses the latest completed entry for an existing routine', () => {
    const S = {
      active: null,
      workouts: [
        { d: '2026-08-22', entries: [{ id: LIFT, sets: [{ w: 80, r: 5, done: true }] }] },
      ],
      exWeights: {},
      effort: 'rir',
    }
    const cfg = { id: LIFT, sets: 2, reps: 8, weight: 50 }
    const sets = buildSets(S, cfg)
    expect(sets[0].w).toBe(80)
    expect(sets[1].w).toBe(80)
  })
})

describe('workoutVolume', () => {
  it('counts reps work and leaves timed/cardio sets out — there is no weight × reps for a hold', () => {
    const w = { entries: [
      { id: LIFT, sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 10, done: false }] },
      { id: LIFT, target: { mode: 'time' }, sets: [{ sec: 60, w: 20, done: true }] },
      { id: CARDIO, sets: [{ min: 20, speed: 9, done: true }] }
    ] }
    expect(workoutVolume(w)).toBe(600)
  })

  it('needs no per-side case — the logged reps are already both sides (issue #31)', () => {
    const w = { entries: [{ id: LIFT, target: { side: true }, sets: [{ w: 20, r: 16, done: true }] }] }
    expect(workoutVolume(w)).toBe(320)
  })

  it('leaves an unloaded bodyweight set at zero volume rather than inventing a number', () => {
    const w = { entries: [{ id: BW, target: { bodyweight: true }, sets: [{ w: 0, r: 20, done: true }] }] }
    expect(workoutVolume(w)).toBe(0)
  })
})

/* ---------- effectiveRoutineId ---------- */

describe('effectiveRoutineId (canonical resolver)', () => {
  const ROUTINES = [
    { id: 'r-push', name: 'Push' },
    { id: 'r-pull', name: 'Pull' },
    { id: 'r-legs', name: 'Legs' },
  ]
  it('preserves legacy `week` resolution when no block is active', () => {
    const S = {
      routines: ROUTINES,
      dayPlan: {},
      week: { 1: 'r-legacy-fallback' }
    }
    expect(effectiveRoutineId(S, '2026-08-24')).toBe('r-legacy-fallback')
  })

  it('preserves dayPlan override over legacy week', () => {
    const S = {
      routines: ROUTINES,
      dayPlan: { '2026-08-24': 'r-legs' },
      week: { 1: 'r-legacy-fallback' }
    }
    expect(effectiveRoutineId(S, '2026-08-24')).toBe('r-legs')
  })

  it('falls back to S.week resolution for every weekday', () => {
    const S = {
      routines: ROUTINES,
      dayPlan: {},
      // Monday=r-legacy, Wednesday=r-legacy, the rest blank.
      week: { 1: 'r-legacy-fallback', 3: 'r-legacy-fallback' },
    }
    const expected = [
      { iso: '2026-08-23', id: null },           // Sunday (no entry)
      { iso: '2026-08-24', id: 'r-legacy-fallback' },  // Monday
      { iso: '2026-08-25', id: null },           // Tuesday (no entry)
      { iso: '2026-08-26', id: 'r-legacy-fallback' },  // Wednesday
      { iso: '2026-08-27', id: null },           // Thursday (no entry)
      { iso: '2026-08-28', id: null },           // Friday (no entry)
      { iso: '2026-08-29', id: null },           // Saturday (no entry)
    ]
    expected.forEach(({ iso, id }) => {
      expect(effectiveRoutineId(S, iso)).toBe(id)
    })
  })

})
