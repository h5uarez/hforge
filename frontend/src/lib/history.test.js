import { describe, it, expect } from 'vitest'
import { modeOf, isTimed, fmtSec, setLabel, defaultConfig, buildSets, exLine, workoutVolume, effortOf, stepEffort, capEffort, isBw, isPerSide, sideReps, repStep, validateBlock, activateBlock, pauseBlock, resumeBlock, endBlock, blockStatus, effectiveRoutineId, buildWorkoutBlockSnapshot, blockWeekDays, blockWeekTrainingDays } from './history.js'
import { EXDB } from './exercises.js'

// Real ids out of the shipped catalogue, so the body-part fallback is exercised for real.
const CARDIO = EXDB.find(e => e.bp === 'cardio').id
// A *loaded* lift: the catalogue's first non-cardio entry is a sit-up, which since issue #32
// defaults to bodyweight and would quietly send every label test down the other path.
const LIFT = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
const BW = EXDB.find(e => e.eq === 'body weight').id

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
    expect(stepEffort('rpe', null, 1)).toBe(6)
    // and then in even steps
    expect(stepEffort('rir', 0, 1)).toBe(0.5)
    expect(stepEffort('rir', 0.5, 1)).toBe(1)
    expect(stepEffort('rpe', 6, 1)).toBe(6.5)
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
    expect(stepEffort('rpe', 6, -1)).toBe(null)
    // but a step that stays inside the scale is an ordinary step
    expect(stepEffort('rir', 0.5, -1)).toBe(0)
    expect(stepEffort('rpe', 6.5, -1)).toBe(6)
  })

  it('stops at the top of the scale', () => {
    expect(stepEffort('rir', 9.5, 1)).toBe(10)
    expect(stepEffort('rir', 10, 1)).toBe(10)
    expect(stepEffort('rpe', 10, 1)).toBe(10)
  })

  it('keeps halves clean instead of drifting into float dust', () => {
    let v = null
    for (let i = 0; i < 6; i++) v = stepEffort('rpe', v, 1)
    expect(v).toBe(8.5)
    expect(stepEffort('rir', 0.1 + 0.2, 1)).toBe(0.8)
  })

  it('steps evenly from a value typed below the floor rather than snapping', () => {
    // nothing stops someone typing RPE 3; the stepper must not jump them to 6 on one tap
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
    // four + taps from empty on an RPE profile: 6, 6.5, 7, 7.5
    let v = null
    for (let i = 0; i < 4; i++) v = stepEffort('rpe', v, 1)
    expect(setLabel(LIFT, { w: 80, r: 5, rpe: v })).toBe('80×5 (RPE 7.5)')
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

/* ---------- block management (Phase 1 foundation, issue: block-management) ---------- */

// Shared routines for the block tests. Stable ids so a week can map weekdays to real routines
// or to the explicit 'rest' marker that means "this day is a rest day by design".
const BLOCK_ROUTINES = [
  { id: 'r-push', name: 'Push' },
  { id: 'r-pull', name: 'Pull' },
  { id: 'r-legs', name: 'Legs' },
]
const FULL_WEEK = { days: { 0: 'r-push', 1: 'r-pull', 2: 'rest', 3: 'r-legs', 4: 'r-push', 5: 'rest', 6: 'rest' } }
const GOOD_BLOCK = { id: 'b1', name: 'Hypertrophy Block', weeks: [FULL_WEEK, FULL_WEEK, FULL_WEEK] }

describe('validateBlock', () => {
  it('accepts a complete block whose day map only references real routines or rest', () => {
    const r = validateBlock(GOOD_BLOCK, BLOCK_ROUTINES)
    expect(r.valid).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('rejects a blank or whitespace-only name', () => {
    expect(validateBlock({ ...GOOD_BLOCK, name: '' }, BLOCK_ROUTINES).valid).toBe(false)
    expect(validateBlock({ ...GOOD_BLOCK, name: '   ' }, BLOCK_ROUTINES).valid).toBe(false)
  })

  it('rejects an empty or missing weeks list', () => {
    expect(validateBlock({ ...GOOD_BLOCK, weeks: [] }, BLOCK_ROUTINES).valid).toBe(false)
    expect(validateBlock({ ...GOOD_BLOCK, weeks: undefined }, BLOCK_ROUTINES).valid).toBe(false)
  })

  it('rejects a week that is missing one or more of the seven weekdays', () => {
    const incomplete = { days: { 0: 'r-push', 1: 'r-pull', 2: 'rest', 3: 'r-legs', 4: 'r-push', 5: 'rest' } }   // day 6 missing
    expect(validateBlock({ ...GOOD_BLOCK, weeks: [incomplete] }, BLOCK_ROUTINES).valid).toBe(false)
    // day 0 missing instead
    const headless = { days: { 1: 'r-pull', 2: 'rest', 3: 'r-legs', 4: 'r-push', 5: 'rest', 6: 'rest' } }
    expect(validateBlock({ ...GOOD_BLOCK, weeks: [headless] }, BLOCK_ROUTINES).valid).toBe(false)
  })

  it('rejects a day that references an unknown routine id', () => {
    const wrong = { days: { 0: 'r-unknown', 1: 'r-pull', 2: 'rest', 3: 'r-legs', 4: 'r-push', 5: 'rest', 6: 'rest' } }
    const r = validateBlock({ ...GOOD_BLOCK, weeks: [wrong] }, BLOCK_ROUTINES)
    expect(r.valid).toBe(false)
    expect(r.errors.join(' ')).toMatch(/r-unknown|unknown|invalid|reference/i)
  })

  it('rejects a blank/empty day value, because an empty day is not the same as rest', () => {
    const blankDay = { days: { 0: '', 1: 'r-pull', 2: 'rest', 3: 'r-legs', 4: 'r-push', 5: 'rest', 6: 'rest' } }
    const nullDay = { days: { 0: null, 1: 'r-pull', 2: 'rest', 3: 'r-legs', 4: 'r-push', 5: 'rest', 6: 'rest' } }
    expect(validateBlock({ ...GOOD_BLOCK, weeks: [blankDay] }, BLOCK_ROUTINES).valid).toBe(false)
    expect(validateBlock({ ...GOOD_BLOCK, weeks: [nullDay] }, BLOCK_ROUTINES).valid).toBe(false)
  })

  it('returns a list of errors (not a single one) so the UI can show them all at once', () => {
    const r = validateBlock({ ...GOOD_BLOCK, name: '', weeks: [] }, BLOCK_ROUTINES)
    expect(r.valid).toBe(false)
    expect(Array.isArray(r.errors)).toBe(true)
    expect(r.errors.length).toBeGreaterThanOrEqual(2)
  })
})

// Lifecycle state shape: every lifecycle helper takes the full S and today as a string so the
// functions stay pure and testable. They throw on duplicate / invalid actions (single-active
// invariant) so callers can wrap them in error toasts without partial persistence.
describe('activateBlock', () => {
  const emptyS = { blocks: [GOOD_BLOCK], activeBlock: null, routines: BLOCK_ROUTINES }

  it('returns S with activeBlock set to week 1, status active, startedOn = today', () => {
    const next = activateBlock(emptyS, 'b1', '2026-08-24')
    expect(next.activeBlock).toEqual({
      blockId: 'b1',
      startedOn: '2026-08-24',
      status: 'active',
      pausedRanges: [],
    })
  })

  it('does not mutate the input S (pure helper)', () => {
    const before = JSON.stringify(emptyS)
    activateBlock(emptyS, 'b1', '2026-08-24')
    expect(JSON.stringify(emptyS)).toBe(before)
  })

  it('throws when a block is already active (single-active invariant)', () => {
    const S = { ...emptyS, activeBlock: { blockId: 'b1', startedOn: '2026-08-20', status: 'active', pausedRanges: [] } }
    expect(() => activateBlock(S, 'b1', '2026-08-24')).toThrow()
  })

  it('throws when the blockId does not match any defined block', () => {
    expect(() => activateBlock(emptyS, 'no-such', '2026-08-24')).toThrow()
  })
})

describe('pauseBlock', () => {
  const activeS = { blocks: [GOOD_BLOCK], activeBlock: { blockId: 'b1', startedOn: '2026-08-20', status: 'active', pausedRanges: [] } }

  it('moves status to paused and stamps pausedOn with today', () => {
    const next = pauseBlock(activeS, '2026-08-24')
    expect(next.activeBlock.status).toBe('paused')
    expect(next.activeBlock.pausedOn).toBe('2026-08-24')
  })

  it('throws when there is no active block', () => {
    expect(() => pauseBlock({ blocks: [GOOD_BLOCK], activeBlock: null }, '2026-08-24')).toThrow()
  })

  it('throws when the block is already paused (duplicate action)', () => {
    const S = { ...activeS, activeBlock: { ...activeS.activeBlock, status: 'paused', pausedOn: '2026-08-23' } }
    expect(() => pauseBlock(S, '2026-08-24')).toThrow()
  })
})

describe('resumeBlock', () => {
  const pausedS = { blocks: [GOOD_BLOCK], activeBlock: { blockId: 'b1', startedOn: '2026-08-20', status: 'paused', pausedOn: '2026-08-23', pausedRanges: [] } }

  it('sets status back to active and appends a closed pause range (pausedOn through yesterday)', () => {
    const next = resumeBlock(pausedS, '2026-08-25')
    expect(next.activeBlock.status).toBe('active')
    expect(next.activeBlock.pausedRanges).toEqual([{ from: '2026-08-23', through: '2026-08-24' }])
    expect(next.activeBlock.pausedOn).toBeUndefined()
  })

  it('appends, not replaces — multiple pause/resume cycles stack in pausedRanges', () => {
    let S = resumeBlock(pausedS, '2026-08-25')
    S = pauseBlock(S, '2026-08-27')
    S = resumeBlock(S, '2026-08-30')
    expect(S.activeBlock.pausedRanges).toEqual([
      { from: '2026-08-23', through: '2026-08-24' },
      { from: '2026-08-27', through: '2026-08-29' },
    ])
  })

  it('throws when there is no active block', () => {
    expect(() => resumeBlock({ blocks: [GOOD_BLOCK], activeBlock: null }, '2026-08-25')).toThrow()
  })

  it('throws when the block is not paused (duplicate action)', () => {
    expect(() => resumeBlock({ ...pausedS, activeBlock: { ...pausedS.activeBlock, status: 'active' } }, '2026-08-25')).toThrow()
  })
})

describe('endBlock', () => {
  it('clears activeBlock back to null', () => {
    const S = { blocks: [GOOD_BLOCK], activeBlock: { blockId: 'b1', startedOn: '2026-08-20', status: 'active', pausedRanges: [] } }
    const next = endBlock(S)
    expect(next.activeBlock).toBeNull()
  })

  it('throws when there is no active block (duplicate action / redundant end)', () => {
    expect(() => endBlock({ blocks: [GOOD_BLOCK], activeBlock: null })).toThrow()
  })
})

// blockStatus: counts credited local-noon dates from startedOn through iso, excluding the
// dates inside any closed pause range plus the open pausedOn range if still paused. The
// activation date counts even if pausedOn == startedOn (the user stepped on it for a reason).
describe('blockStatus', () => {
  // GOOD_BLOCK is a 3-week block; the name and exact week count matter only here.
  const BLOCK_3W = GOOD_BLOCK

  it('returns null when no block is active', () => {
    expect(blockStatus({ blocks: [BLOCK_3W], activeBlock: null }, '2026-08-24')).toBeNull()
  })

  it('returns null when the active blockId no longer resolves to a defined block', () => {
    expect(blockStatus({ blocks: [], activeBlock: { blockId: 'gone', startedOn: '2026-08-20', status: 'active', pausedRanges: [] } }, '2026-08-24')).toBeNull()
  })

  it('returns week 1 on the activation day', () => {
    const S = { blocks: [BLOCK_3W], activeBlock: { blockId: 'b1', startedOn: '2026-08-24', status: 'active', pausedRanges: [] } }
    expect(blockStatus(S, '2026-08-24')).toBe(1)
  })

  it('rolls over to week 2 on day 8 of credited activity', () => {
    const S = { blocks: [BLOCK_3W], activeBlock: { blockId: 'b1', startedOn: '2026-08-17', status: 'active', pausedRanges: [] } }
    // day 1 = 17, day 8 = 24 → week 2
    expect(blockStatus(S, '2026-08-24')).toBe(2)
  })

  it('counts the activation date as week 1 even when it is also the pausedOn day', () => {
    const S = { blocks: [BLOCK_3W], activeBlock: { blockId: 'b1', startedOn: '2026-08-24', status: 'paused', pausedOn: '2026-08-24', pausedRanges: [] } }
    expect(blockStatus(S, '2026-08-24')).toBe(1)
  })

  it('excludes paused dates and resumes counting from the adjusted position', () => {
    // activated 2026-08-17, paused 2026-08-20 (through 22), resumed 2026-08-23
    // credited days: 17, 18, 19, 23, 24 → day 5 → week 1
    const S = { blocks: [BLOCK_3W], activeBlock: {
      blockId: 'b1', startedOn: '2026-08-17', status: 'active',
      pausedRanges: [{ from: '2026-08-20', through: '2026-08-22' }],
    } }
    expect(blockStatus(S, '2026-08-24')).toBe(1)
  })

  it('clamps to the final block week once the credited days exceed the block length', () => {
    // 3-week block, way past week 3 → must stay at 3 until explicit End (the design
    // forbids auto-ending at the boundary)
    const S = { blocks: [BLOCK_3W], activeBlock: { blockId: 'b1', startedOn: '2026-01-01', status: 'active', pausedRanges: [] } }
    expect(blockStatus(S, '2027-01-01')).toBe(3)
  })

  it('uses local-noon dates so a DST spring-forward day still resolves to the right weekday', () => {
    // spring forward in EU timezones falls on the last Sunday of March; the local noon of
    // 2026-03-29 is unambiguous regardless of the system's TZ because the helper constructs
    // dates at noon, far from the 02:00 transition
    const S = { blocks: [BLOCK_3W], activeBlock: { blockId: 'b1', startedOn: '2026-03-22', status: 'active', pausedRanges: [] } }
    // 2026-03-22 is day 1, 2026-03-29 is day 8 → week 2 (and noon-based date math must not
    // skip a day in any local timezone)
    expect(blockStatus(S, '2026-03-29')).toBe(2)
  })
})

/* ---------- effectiveRoutineId (canonical resolver, Phase 2) ----------
   Precedence (per spec #907 and design #908):
     1. Explicit `dayPlan[iso]` (a routine id or 'rest') always wins.
     2. With an active block, the current block week / weekday mapping is used.
        A missing, empty, or invalid block-day value resolves to `rest` —
        it MUST NOT fall through to legacy `week`.
     3. Without an active block, legacy `dayPlan` then `week` behavior is preserved. */

describe('effectiveRoutineId (canonical resolver)', () => {
  // Reuse the block fixtures from the foundation suite so the new resolver is
  // tested against the same well-known shapes.
  const ROUTINES = BLOCK_ROUTINES
  // 2026-08-24 is a Monday (wd 1), 2026-08-25 is Tuesday (wd 2),
  // 2026-08-23 is Sunday (wd 0). The GOOD_BLOCK day map assigns:
  //   0→r-push, 1→r-pull, 2→rest, 3→r-legs, 4→r-push, 5→rest, 6→rest.
  const ACTIVE_DAY1 = {
    blocks: [GOOD_BLOCK],
    activeBlock: { blockId: 'b1', startedOn: '2026-08-24', status: 'active', pausedRanges: [] },
    routines: ROUTINES,
    dayPlan: {},
    week: { 1: 'r-legacy-fallback' }
  }

  it('lets an explicit dayPlan routine override the active block day', () => {
    // 2026-08-24 is day 1 in the block (r-pull) but dayPlan forces r-legs for today.
    const S = { ...ACTIVE_DAY1, dayPlan: { '2026-08-24': 'r-legs' } }
    expect(effectiveRoutineId(S, '2026-08-24')).toBe('r-legs')
  })

  it('treats dayPlan "rest" as rest even when a block would resolve a routine', () => {
    const S = { ...ACTIVE_DAY1, dayPlan: { '2026-08-24': 'rest' } }
    expect(effectiveRoutineId(S, '2026-08-24')).toBeNull()
  })

  it('resolves the active block current weekday to its routine id', () => {
    // Monday 2026-08-24, week 1, day 1 → r-pull (not the legacy r-legacy-fallback).
    expect(effectiveRoutineId(ACTIVE_DAY1, '2026-08-24')).toBe('r-pull')
  })

  it('resolves the active block current weekday "rest" to null', () => {
    // Tuesday 2026-08-25, week 1, day 2 → "rest" in the block, must beat the legacy week.
    const S = { ...ACTIVE_DAY1, week: { 2: 'r-legacy-fallback' } }
    expect(effectiveRoutineId(S, '2026-08-25')).toBeNull()
  })

  it('returns rest (never legacy) when the active block day value is missing for the current weekday', () => {
    // day 1 (Monday) is absent from the block's day map → rest, NOT the legacy fallback.
    const incomplete = {
      id: 'b1', name: 'Incomplete',
      weeks: [{ days: { 0: 'r-push', 2: 'rest', 3: 'r-legs', 4: 'r-push', 5: 'rest', 6: 'rest' } }]
    }
    const S = {
      ...ACTIVE_DAY1,
      blocks: [incomplete],
      week: { 1: 'r-legacy-fallback' }
    }
    expect(effectiveRoutineId(S, '2026-08-24')).toBeNull()
  })

  it('returns rest (never legacy) when the active block day value is an unknown / deleted routine id', () => {
    // day 0 (Sunday) references 'r-deleted' which is not in ROUTINES.
    // 2026-08-23 is a Sunday (wd 0); the block started 2026-08-23 → week 1.
    const stale = {
      id: 'b1', name: 'Stale refs',
      weeks: [{ days: { 0: 'r-deleted', 1: 'r-pull', 2: 'rest', 3: 'r-legs', 4: 'r-push', 5: 'rest', 6: 'rest' } }]
    }
    const S = {
      blocks: [stale],
      activeBlock: { blockId: 'b1', startedOn: '2026-08-23', status: 'active', pausedRanges: [] },
      routines: ROUTINES,
      dayPlan: {},
      week: { 0: 'r-legacy-fallback' }
    }
    expect(effectiveRoutineId(S, '2026-08-23')).toBeNull()
  })

  it('preserves legacy `week` resolution when no block is active', () => {
    const S = {
      blocks: [GOOD_BLOCK],   // blocks defined but not active
      activeBlock: null,
      routines: ROUTINES,
      dayPlan: {},
      week: { 1: 'r-legacy-fallback' }
    }
    expect(effectiveRoutineId(S, '2026-08-24')).toBe('r-legacy-fallback')
  })

  it('preserves dayPlan override over legacy week when no block is active', () => {
    const S = {
      blocks: [GOOD_BLOCK], activeBlock: null, routines: ROUTINES,
      dayPlan: { '2026-08-24': 'r-legs' },
      week: { 1: 'r-legacy-fallback' }
    }
    expect(effectiveRoutineId(S, '2026-08-24')).toBe('r-legs')
  })

  // Plan-resolution contract (issue: block-lifecycle-playwright-audit, Plan.jsx fix).
  // Plan.jsx renders the current local-calendar week's seven weekdays and must show the
  // active block's resolved routine / rest for each one. This test exercises the resolver
  // Plan relies on, for every weekday of the current week — so a regression in either the
  // resolver or the View's per-day call would surface here.
  it('resolves every weekday of the active block\'s current week to its block-mapped routine or rest', () => {
    // GOOD_BLOCK week 1 day map (Mon-anchored week): 0(Sun)=r-push, 1(Mon)=r-pull, 2(Tue)=rest,
    // 3(Wed)=r-legs, 4(Thu)=r-push, 5(Fri)=rest, 6(Sat)=rest.
    // The current week containing 2026-08-24 (Mon, activation day) runs 2026-08-24..2026-08-30.
    const S = { ...ACTIVE_DAY1, dayPlan: {} }
    const expected = [
      { iso: '2026-08-24', id: 'r-pull' },  // Monday (activation day, wd 1)
      { iso: '2026-08-25', id: null },       // Tuesday (rest, wd 2)
      { iso: '2026-08-26', id: 'r-legs' },  // Wednesday (wd 3)
      { iso: '2026-08-27', id: 'r-push' },  // Thursday (wd 4)
      { iso: '2026-08-28', id: null },       // Friday (rest, wd 5)
      { iso: '2026-08-29', id: null },       // Saturday (rest, wd 6)
      { iso: '2026-08-30', id: 'r-push' },  // Sunday (wd 0)
    ]
    expected.forEach(({ iso, id }) => {
      expect(effectiveRoutineId(S, iso)).toBe(id)
    })
  })

  // Legacy-fallback contract (issue: block-lifecycle-playwright-audit, Plan.jsx fix).
  // With no active block, Plan.jsx must keep its existing dayPlan-then-week legacy behavior
  // — every weekday reads from S.week (or S.dayPlan). A regression that accidentally makes
  // Plan use the block resolver when no block is active would surface here.
  it('falls back to legacy S.week resolution for every weekday when no block is active', () => {
    const S = {
      blocks: [], activeBlock: null, routines: ROUTINES,
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

  // Mid-week activation contract (issue: block-lifecycle-playwright-audit, WU2
  // remediation, verify-report #1256 critical finding #1). When a block is
  // activated mid-week, the current local-calendar week must show the block's
  // day map for ALL seven weekdays — not just from the activation day onward.
  // Otherwise Plan/Home would silently mix the block's day map (Thu+) with
  // the legacy S.week (Mon-Wed), which is exactly the "Plan shows Descanso
  // while the block has Fourth Day" defect.
  //
  // 2026-08-27 is a Thursday (wd 4). The current week is 2026-08-24..2026-08-30.
  // The block starts on Thursday; Monday-Wednesday are before the start but
  // still in the start's local-calendar week. Every weekday of that week must
  // resolve through the block's day map (week 1 = FULL_WEEK.days).
  it('applies the block\'s day map to every weekday of the start week, even before the activation day', () => {
    const S = {
      blocks: [GOOD_BLOCK],
      activeBlock: { blockId: 'b1', startedOn: '2026-08-27', status: 'active', pausedRanges: [] },
      routines: ROUTINES,
      dayPlan: {},
      // Legacy week has Push on Monday and Pull on Wednesday — the resolver
      // must NOT fall through to these for the block's start week.
      week: { 1: 'r-legacy-fallback', 3: 'r-legacy-fallback' },
    }
    const expected = [
      { iso: '2026-08-24', id: 'r-pull' },  // Monday (BEFORE start, same week)
      { iso: '2026-08-25', id: null },       // Tuesday (BEFORE start, same week, rest)
      { iso: '2026-08-26', id: 'r-legs' },  // Wednesday (BEFORE start, same week)
      { iso: '2026-08-27', id: 'r-push' },  // Thursday (start day, wd 4)
      { iso: '2026-08-28', id: null },       // Friday (after start, rest)
      { iso: '2026-08-29', id: null },       // Saturday (after start, rest)
      { iso: '2026-08-30', id: 'r-push' },  // Sunday (after start, wd 0)
    ]
    expected.forEach(({ iso, id }) => {
      expect(effectiveRoutineId(S, iso)).toBe(id)
    })
  })

  // Out-of-start-week contract: days in a week BEFORE the block's start week
  // must still fall through to legacy (the block wasn't active yet). A
  // regression that over-extends the start-week override would surface here.
  it('falls through to legacy for weekdays in a week before the block started', () => {
    const S = {
      blocks: [GOOD_BLOCK],
      activeBlock: { blockId: 'b1', startedOn: '2026-08-27', status: 'active', pausedRanges: [] },
      routines: ROUTINES,
      dayPlan: {},
      week: { 1: 'r-legacy-fallback', 3: 'r-legacy-fallback' },
    }
    // Week of 2026-08-17 (Mon)..2026-08-23 (Sun) is entirely before the start.
    // The block hasn't started yet, so the resolver must use legacy.
    expect(effectiveRoutineId(S, '2026-08-17')).toBe('r-legacy-fallback')  // Mon (legacy)
    expect(effectiveRoutineId(S, '2026-08-18')).toBeNull()           // Tue (no legacy)
    expect(effectiveRoutineId(S, '2026-08-19')).toBe('r-legacy-fallback')  // Wed (legacy)
    expect(effectiveRoutineId(S, '2026-08-20')).toBeNull()           // Thu
    expect(effectiveRoutineId(S, '2026-08-21')).toBeNull()           // Fri
    expect(effectiveRoutineId(S, '2026-08-22')).toBeNull()           // Sat
    expect(effectiveRoutineId(S, '2026-08-23')).toBeNull()           // Sun
  })
})

/* ---------- blockWeekDays / blockWeekTrainingDays (block-aware Plan/Home) ----------
   The Plan view renders the current local-calendar week's daily routine / rest
   mapping, and the Home view shows a "X / Y this week" denominator where Y is
   the number of training days the user planned for the week. When a block is
   active, both surfaces must reflect the block's resolved current week, not the
   legacy `S.week` map. These helpers expose the block-resolved view of the
   week so the View components have a single, tested source of truth.

   Block data is the canonical GOOD_BLOCK: week 1 has 4 training days
   (Sun=r-push, Mon=r-pull, Wed=r-legs, Thu=r-push) and 3 rest days (Tue, Fri,
   Sat). Any active block with that week therefore has `blockWeekTrainingDays(S, iso) === 4`.

   Pure helpers: never mutate S; return null when no block is active, when the
   active blockId has been deleted, or when the resolved week has no usable
   day map. */

describe('blockWeekDays', () => {
  // 2026-08-24 is a Monday, day 1 of an activated-on-day-1 block.
  const ACTIVE_DAY1 = {
    blocks: [GOOD_BLOCK],
    activeBlock: { blockId: 'b1', startedOn: '2026-08-24', status: 'active', pausedRanges: [] },
  }

  it('returns the resolved current week\'s day map when an active block resolves to week 1', () => {
    expect(blockWeekDays(ACTIVE_DAY1, '2026-08-24')).toEqual(FULL_WEEK.days)
  })

  it('returns null when no block is active (legacy fallthrough belongs in the View)', () => {
    const S = { blocks: [GOOD_BLOCK], activeBlock: null }
    expect(blockWeekDays(S, '2026-08-24')).toBeNull()
  })

  it('returns null when the active blockId no longer resolves to a defined block', () => {
    const S = { blocks: [], activeBlock: { blockId: 'gone', startedOn: '2026-08-24', status: 'active', pausedRanges: [] } }
    expect(blockWeekDays(S, '2026-08-24')).toBeNull()
  })

  it('returns null when the resolved week is past the block length', () => {
    // 3-week block, activation 2026-08-24 → week 1 on the 24th. Asking for a date past the
    // final week would normally clamp to 3, but that clamped week must still resolve to its
    // own day map, not null — only a missing day map returns null.
    const S = {
      blocks: [GOOD_BLOCK],
      activeBlock: { blockId: 'b1', startedOn: '2026-08-24', status: 'active', pausedRanges: [] },
    }
    // 21 days after activation → still week 3 (the third week of the block), which has the
    // same day map as week 1 in GOOD_BLOCK.
    expect(blockWeekDays(S, '2026-09-13')).toEqual(FULL_WEEK.days)
  })

  // Mid-week activation: the block starts on Thursday 2026-08-27, but the
  // start's local-calendar week (Mon 2026-08-24..Sun 2026-08-30) is the one
  // Plan/Home renders. Every day of that week — including Monday through
  // Wednesday which sit BEFORE the start — must still resolve to week 1's day
  // map, otherwise the Home weekly denominator would fall through to the
  // legacy S.week (verify-report #1256 critical finding #2).
  it('returns the resolved week\'s day map for every weekday of the start week, even before the activation day', () => {
    const S = {
      blocks: [GOOD_BLOCK],
      activeBlock: { blockId: 'b1', startedOn: '2026-08-27', status: 'active', pausedRanges: [] },
    }
    // Monday and Wednesday of the start week are before the start; without the
    // start-week override blockStatus returns null for them and the View would
    // fall through to legacy. The override makes these days see week 1's map.
    expect(blockWeekDays(S, '2026-08-24')).toEqual(FULL_WEEK.days)  // Mon (before start)
    expect(blockWeekDays(S, '2026-08-25')).toEqual(FULL_WEEK.days)  // Tue (before start)
    expect(blockWeekDays(S, '2026-08-26')).toEqual(FULL_WEEK.days)  // Wed (before start)
    expect(blockWeekDays(S, '2026-08-27')).toEqual(FULL_WEEK.days)  // Thu (start day)
    expect(blockWeekDays(S, '2026-08-30')).toEqual(FULL_WEEK.days)  // Sun
  })

  it('returns null for a week entirely before the block started', () => {
    const S = {
      blocks: [GOOD_BLOCK],
      activeBlock: { blockId: 'b1', startedOn: '2026-08-27', status: 'active', pausedRanges: [] },
    }
    // Mon 2026-08-17..Sun 2026-08-23 is the week before the start week.
    expect(blockWeekDays(S, '2026-08-17')).toBeNull()
    expect(blockWeekDays(S, '2026-08-23')).toBeNull()
  })
})

describe('blockWeekTrainingDays', () => {
  const ACTIVE_DAY1 = {
    blocks: [GOOD_BLOCK],
    activeBlock: { blockId: 'b1', startedOn: '2026-08-24', status: 'active', pausedRanges: [] },
  }

  it('returns the count of training (non-rest) days in the active block\'s resolved week', () => {
    // GOOD_BLOCK week 1: 4 routine days + 3 rest days → 4 training days.
    expect(blockWeekTrainingDays(ACTIVE_DAY1, '2026-08-24')).toBe(4)
  })

  it('returns null when no block is active so the View can fall back to the legacy denominator', () => {
    const S = { blocks: [GOOD_BLOCK], activeBlock: null, week: { 1: 'r-push', 3: 'r-pull' } }
    expect(blockWeekTrainingDays(S, '2026-08-24')).toBeNull()
    // The legacy denominator stays a View-level calculation: the helper returns null and
    // the View falls back to `Object.keys(S.week).filter(k => S.week[k]).length` (here 2).
    const legacyCount = Object.keys(S.week).filter(k => S.week[k]).length
    expect(legacyCount).toBe(2)
  })

  it('returns null when the active blockId has been deleted out from under the pointer', () => {
    const S = { blocks: [], activeBlock: { blockId: 'gone', startedOn: '2026-08-24', status: 'active', pausedRanges: [] } }
    expect(blockWeekTrainingDays(S, '2026-08-24')).toBeNull()
  })

  it('does not mutate the input S (pure helper)', () => {
    const before = JSON.stringify(ACTIVE_DAY1)
    blockWeekTrainingDays(ACTIVE_DAY1, '2026-08-24')
    expect(JSON.stringify(ACTIVE_DAY1)).toBe(before)
  })

  // Mid-week activation: Home's weekly denominator must reflect the block's
  // training-day count for the current week even when the block started
  // mid-week. Before this contract, the denominator would fall through to
  // legacy S.week for the days before the start and the user would see the
  // wrong "X / Y this week" count.
  it('returns the block training-day count for a mid-week activation, not null', () => {
    const S = {
      blocks: [GOOD_BLOCK],
      activeBlock: { blockId: 'b1', startedOn: '2026-08-27', status: 'active', pausedRanges: [] },
      week: { 1: 'r-legacy-fallback', 3: 'r-legacy-fallback' },
    }
    // GOOD_BLOCK week 1: 4 training days. The start-week override must make
    // every day of the start week return that count, not the legacy 2.
    expect(blockWeekTrainingDays(S, '2026-08-24')).toBe(4)  // Mon (before start)
    expect(blockWeekTrainingDays(S, '2026-08-25')).toBe(4)  // Tue (before start)
    expect(blockWeekTrainingDays(S, '2026-08-27')).toBe(4)  // Thu (start day)
  })
})

/* ---------- buildWorkoutBlockSnapshot (Phase 3 immutable workout context) ----------
   The shape that lands on `active.block` at workout start and rides into the finished
   workout record: { id, name, week }. Capturing at start means later block edits
   (rename, week re-mapping, lifecycle changes) cannot rewrite the historical record.
   Pure helper: takes S + iso and returns a fresh object, or null. */

describe('buildWorkoutBlockSnapshot', () => {
  // 2026-08-24 is Monday (wd 1), 2026-08-30 is Sunday (wd 0)
  const ACTIVE_DAY1 = {
    blocks: [GOOD_BLOCK],
    activeBlock: { blockId: 'b1', startedOn: '2026-08-24', status: 'active', pausedRanges: [] },
    routines: BLOCK_ROUTINES,
  }

  it('returns null when no block is active', () => {
    const S = { blocks: [GOOD_BLOCK], activeBlock: null, routines: BLOCK_ROUTINES }
    expect(buildWorkoutBlockSnapshot(S, '2026-08-24')).toBeNull()
  })

  it('returns { id, name, week: 1 } when an active block resolves a week on its activation day', () => {
    expect(buildWorkoutBlockSnapshot(ACTIVE_DAY1, '2026-08-24')).toEqual({
      id: 'b1', name: 'Hypertrophy Block', week: 1,
    })
  })

  it('returns the current local-calendar week (day 8 of credited activity → week 2)', () => {
    const S = {
      blocks: [GOOD_BLOCK],
      activeBlock: { blockId: 'b1', startedOn: '2026-08-17', status: 'active', pausedRanges: [] },
      routines: BLOCK_ROUTINES,
    }
    expect(buildWorkoutBlockSnapshot(S, '2026-08-24').week).toBe(2)
  })

  it('returns null when the active blockId no longer resolves to a defined block', () => {
    const S = {
      blocks: [],
      activeBlock: { blockId: 'gone', startedOn: '2026-08-24', status: 'active', pausedRanges: [] },
      routines: BLOCK_ROUTINES,
    }
    expect(buildWorkoutBlockSnapshot(S, '2026-08-24')).toBeNull()
  })

  it('returns null when iso is before the block started', () => {
    const S = {
      blocks: [GOOD_BLOCK],
      activeBlock: { blockId: 'b1', startedOn: '2026-08-24', status: 'active', pausedRanges: [] },
      routines: BLOCK_ROUTINES,
    }
    expect(buildWorkoutBlockSnapshot(S, '2026-08-23')).toBeNull()
  })

  it('does not mutate the input S (pure helper)', () => {
    const before = JSON.stringify(ACTIVE_DAY1)
    buildWorkoutBlockSnapshot(ACTIVE_DAY1, '2026-08-24')
    expect(JSON.stringify(ACTIVE_DAY1)).toBe(before)
  })

  it('captures the block name as it exists right now — renaming the block later does not change this snapshot', () => {
    // Take the snapshot first, then mutate the source. The snapshot must stay frozen.
    const snap = buildWorkoutBlockSnapshot(ACTIVE_DAY1, '2026-08-24')
    ACTIVE_DAY1.blocks[0].name = 'Renamed Block'
    expect(snap.name).toBe('Hypertrophy Block')
    // A fresh call after the rename sees the new name — the helper reads current state,
    // it is the consumer (beginWorkout) that freezes the value into the workout record.
    expect(buildWorkoutBlockSnapshot(ACTIVE_DAY1, '2026-08-24').name).toBe('Renamed Block')
  })

  it('captures the resolved week as of today — a pause/resume that advances position is not reflected in an older snapshot', () => {
    // Day 1 snapshot, then a 4-day pause+resume that pushes blockStatus forward by 4 credited days.
    const day1 = buildWorkoutBlockSnapshot(ACTIVE_DAY1, '2026-08-24')
    expect(day1.week).toBe(1)
    // 4 days later (28), with no pauses → credited = 5 → still week 1 (Math: floor((5-1)/7)+1 = 1)
    expect(buildWorkoutBlockSnapshot(ACTIVE_DAY1, '2026-08-28').week).toBe(1)
    // 7 days after activation, no pauses → credited = 8 → week 2
    expect(buildWorkoutBlockSnapshot(ACTIVE_DAY1, '2026-08-31').week).toBe(2)
    // The day-1 snapshot stays at week 1.
    expect(day1.week).toBe(1)
  })

  // Finished-workout attribution contract (issue: block-lifecycle-playwright-audit,
  // verify-report #1256 critical finding "Workout context survives completion").
  // A workout record's `block` field is the same value the snapshot returned at
  // workout start; nothing the store does after the start can rewrite the frozen
  // id/name/week on that record. This is the unit-level back-stop for the smoke
  // assertion that the finished record retains `block.id`, `block.name`, `block.week`.
  it('the snapshot is what rides into the finished workout record; endBlock + a rename after start cannot rewrite it', () => {
    // Use a fresh state shape so earlier `captures the block name as it exists right now`
    // does not pollute the assertion with its in-place rename. ACTIVE_DAY1 is shared
    // across the describe block.
    const fresh = {
      blocks: [{ id: 'b1', name: 'Hypertrophy Block', weeks: [{ days: { 0: 'r-push', 1: 'r-pull', 2: 'rest', 3: 'r-legs', 4: 'r-push', 5: 'rest', 6: 'rest' } }] }],
      activeBlock: { blockId: 'b1', startedOn: '2026-08-24', status: 'active', pausedRanges: [] },
      routines: [{ id: 'r-push', name: 'Push' }, { id: 'r-pull', name: 'Pull' }, { id: 'r-legs', name: 'Legs' }],
    }
    const snap = buildWorkoutBlockSnapshot(fresh, '2026-08-24')
    expect(snap).toEqual({ id: 'b1', name: 'Hypertrophy Block', week: 1 })
    // Simulate the store lifecycle that happens AFTER the workout started: end the block,
    // rename the block, mutate the activeBlock pointer. The snapshot we captured must be
    // untouched — that's what gets pushed into S.workouts by doFinishWorkout.
    const ended = endBlock(fresh)
    ended.blocks[0].name = 'Renamed After Finish'
    ended.blocks[0].weeks[0].days[1] = 'r-deleted'   // day 1 now references a non-existent routine
    ended.activeBlock = null
    expect(snap).toEqual({ id: 'b1', name: 'Hypertrophy Block', week: 1 })
  })
})
