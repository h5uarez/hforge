// Pure helpers over the state object S (ported 1:1 from the vanilla app).
import { todayISO, isoOf, weekKey, fmtNum } from './format.js'
import { isCardio, isBodyweightEq } from './exercises.js'
import { t } from './i18n.js'

// How an exercise is logged (issue #16). This used to be derived from the body part alone,
// which meant a plank or a farmer's carry could only be timed by filing it under cardio.
// A routine entry can now say so explicitly:
//   reps   — weight × reps      sets look like { w, r }
//   time   — a work duration    sets look like { sec, w }   (w = 0 for bodyweight)
//   cardio — duration + speed   sets look like { min, speed }
// An entry without `mode` behaves exactly as before, so every existing plan, workout and
// plan file is read unchanged and nothing needs migrating.
export function modeOf(cfg) {
  const m = cfg && cfg.mode
  if (m === 'reps' || m === 'time' || m === 'cardio') return m
  return isCardio(cfg && cfg.id) ? 'cardio' : 'reps'
}
export const isTimed = cfg => modeOf(cfg) === 'time'

// Two flags that ride on top of a mode rather than making new ones (issues #31/#32), because
// "bodyweight" and "per side" are true of a rep set and of a timed hold alike:
//   bodyweight — the exercise carries no load of its own, so `w` means *added* weight and is
//                asked for only once you say there is some. Seeded from the equipment field.
//                Spelled out rather than `bw`, which a workout already uses for the weigh-in
//                it was logged at — two different things one letter apart is a bug waiting.
//   side       — the exercise is unilateral. You still log what you did: 16, the total across
//                both sides. The split is derived for planning ("8 per side"), never entered
//                — a number that sometimes means one side and sometimes both is the thing
//                that made this ambiguous in the first place, and one rep count that always
//                means the same thing beats two that need a legend.
// Both are absent on every plan, workout and backup written before they existed, and absent
// reads as false, so nothing needs migrating.
export const isBw = cfg => (cfg && cfg.bodyweight != null ? !!cfg.bodyweight : isBodyweightEq(cfg && cfg.id))
export const isPerSide = cfg => !!(cfg && cfg.side)
// What one side did, for display only. Half of an odd total is shown as it falls (8.5) rather
// than rounded away: it means the sides were not even, which is worth seeing.
export const sideReps = reps => (reps || 0) / 2
// Unilateral work moves in pairs, so its rep target steps by two — 16, 18, 20 — and a total
// that stayed odd would put a rep on one side and not the other.
export const repStep = cfg => (isPerSide(cfg) ? 2 : 1)

// mm:ss for a work duration — seconds alone read badly past a minute ("90 s" vs "1:30").
export function fmtSec(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0))
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0')
}

// How hard a set felt, if the profile logs it at all. Two scales for the same thing, kept in
// their own fields: RIR counts the reps still in the tank, RPE reads the same effort off a
// 10-point scale from the top (RPE 8 ≈ RIR 2). A set logged on one scale is never silently
// rewritten as the other — switching the setting changes what new sets ask for, nothing else.
// `min`..`max` is the range the stepper walks. RIR bottoms out at 0 (a set taken to failure);
// RPE bottoms out at 6, since the scale is only meaningful for working sets and anything
// lighter is a warm-up nobody rates.
export const EFFORT = {
  rir: { f: 'rir', hd: 'RIR', step: 0.5, min: 0, max: 10 },
  rpe: { f: 'rpe', hd: 'RPE', step: 0.5, min: 6, max: 10 }
}
// One tap of an effort stepper. Empty is not 0 — an unlogged effort must not become "went to
// failure" from one stray tap — so − on an empty cell leaves it empty, and + starts at the
// bottom of the scale and walks up from there in even steps. Stepping back off the bottom
// clears the cell again, so a mistap is undoable. null means "nothing logged"; the caller
// stores that by dropping the key rather than writing a null.
export function stepEffort(kind, cur, dir) {
  const e = EFFORT[kind]
  if (!e) return cur ?? null
  if (cur == null) return dir < 0 ? null : e.min
  const n = Math.round((cur + dir * e.step) * 100) / 100
  if (dir < 0 && n < e.min) return null
  // only the ceiling is enforced on the way up: a value typed below the floor (nothing stops
  // someone entering RPE 3) still steps in even increments instead of snapping to the floor.
  return dir > 0 ? Math.min(e.max, n) : Math.max(e.min, n)
}
// A typed effort is capped but not floored — clamping up while someone types "10" would turn
// the first keystroke into the floor and fight the input.
export const capEffort = (kind, v) =>
  (v == null || !EFFORT[kind] ? v : Math.min(EFFORT[kind].max, v))
// Which scale a profile logs. `showRir` is the boolean this replaced and is only consulted
// when the profile has no answer of its own — an explicit 'none' has to win over it, or a
// backup or another device that still carries the old flag would switch the column back on.
export const effortOf = S => {
  const e = S && S.effort
  return e === 'none' || EFFORT[e] ? e : (S && S.showRir ? 'rir' : 'none')
}
// The "(RIR 2)" / "(RPE 8)" tail on a set summary, empty when nothing was logged.
const effortTail = s => {
  const k = s.rir != null ? 'rir' : s.rpe != null ? 'rpe' : null
  return k ? ` (${EFFORT[k].hd} ${fmtNum(s[k])})` : ''
}

// One-line summary of a logged set. `cfg` carries the mode when the caller has it (a routine
// entry or a workout entry); passing an id alone keeps the old body-part behaviour.
export function setLabel(id, s, cfg) {
  const c = cfg || { id }
  const mode = modeOf(c)
  if (mode === 'cardio') return `${s.min || 0} min @ ${fmtNum(s.speed || 0)} km/h`
  if (mode === 'time') return fmtSec(s.sec) + (s.w > 0 ? ` · ${fmtNum(s.w)}` : '')
  // Bodyweight reads as what you did — "12", or "+10 × 12" once there is a belt involved —
  // rather than "0×12", which says a set was performed with no weight and means nothing.
  // A per-side set needs no mark here: the number logged is the total, the same as every
  // other set in the app.
  const reps = s.r || 0
  if (isBw({ ...c, id: c.id ?? id })) {
    const load = s.w > 0 ? `+${fmtNum(s.w)} × ` : ''
    return `${load}${reps}` + effortTail(s)
  }
  return `${fmtNum(s.w || 0)}×${reps}` + effortTail(s)
}
// Default config for a freshly added exercise.
export function defaultConfig(id, mode) {
  const m = mode || modeOf({ id })
  if (m === 'cardio') return { sets: 1, min: 20, speed: 8 }
  // Written only when it is true, so a barbell config is byte-for-byte what it was before
  // the flag existed and a plan file gains nothing it does not need.
  const bw = isBodyweightEq(id) ? { bodyweight: true } : {}
  if (m === 'time') return { sets: 3, sec: 45, weight: 0, mode: 'time', ...bw }
  return { sets: 3, reps: 10, weight: 0, mode: 'reps', ...bw }
}
// One-line summary of a planned exercise ("3 × 10 · 60 kg"), shared by the routine editor
// and the plan export so a mode is described the same way everywhere.
export function exLine(cfg, unit) {
  const mode = modeOf(cfg)
  const n = cfg.sets || 1
  // Added weight reads as added: "+10 kg" on a dip belt, "60 kg" on a barbell.
  const load = cfg.weight ? ' · ' + (isBw(cfg) ? '+' : '') + fmtNum(cfg.weight) + ' ' + unit : ''
  if (mode === 'cardio') return `${n} × ${cfg.min || 20} min @ ${fmtNum(cfg.speed || 8)} km/h`
  if (mode === 'time') return `${n} × ${fmtSec(cfg.sec || 45)}${load}`
  // This is the line with room for it, so the split is spelled out: "3 × 16 · 8/side".
  const split = isPerSide(cfg) ? ' · ' + t('{0}/side', fmtNum(sideReps(cfg.reps))) : ''
  return `${n} × ${cfg.reps}${load}${split}`
}

// Drop superset ids that no longer have an adjacent partner (after unlink/reorder/remove).
export function cleanupSg(ex) {
  ex.forEach((e, i) => {
    if (e.sg && !(ex[i - 1]?.sg === e.sg || ex[i + 1]?.sg === e.sg)) delete e.sg
  })
}

export function lastEntryFor(S, exId) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const en = S.workouts[i].entries.find(e => e.id === exId)
    // `target` is what the session prescribed; finished workouts carry it so labels and the
    // progression engine can read a session back the way it was logged. Older workouts have
    // none — modeOf() falls back to the body part for them, which is what they were.
    if (en && en.sets.some(s => s.done)) return { d: S.workouts[i].d, sets: en.sets.filter(s => s.done), target: en.target || null }
  }
  return null
}
export function bestWeightFor(S, exId) {
  let best = 0
  S.workouts.forEach(w => w.entries.forEach(e => {
    if (e.id === exId) {
      e.sets.forEach(s => { if (s.done && s.w > best) best = s.w })
      if (e.topW && e.topW > best) best = e.topW
    }
  }))
  return best
}
export function effectiveRoutineId(S, iso) {
  // Explicit date override always wins. A 'rest' marker is rest, even with an
  // active block: the user explicitly turned today off and the block must not
  // turn it back on.
  const ov = S && S.dayPlan ? S.dayPlan[iso] : undefined
  if (ov === 'rest') return null
  if (ov && S.routines && S.routines.some(r => r.id === ov)) return ov

  const wd = new Date(iso + 'T12:00:00').getDay()

  // Active block: derive the current local-calendar week and resolve that
  // weekday. A missing, empty, or stale (unknown routine id) day value
  // resolves to rest — it must NEVER fall through to legacy `week`, or a
  // partial block would silently mix schedules (spec #907 / design #908).
  // Mirrored in api/server.js blockWeek + effectiveRoutineId — keep in lockstep.
  const week = blockStatus(S, iso)
  if (week != null) {
    const ab = S.activeBlock
    const block = (S.blocks || []).find(b => b.id === ab.blockId)
    const w = block && block.weeks ? block.weeks[week - 1] : null
    if (w) {
      const v = w.days ? w.days[wd] : undefined
      if (v === 'rest') return null
      if (v && S.routines && S.routines.some(r => r.id === v)) return v
      // missing / empty / unknown → rest, never legacy
      return null
    }
    // blockStatus returned a week but the underlying block has no usable
    // week data — treat as rest, not legacy
    return null
  }

  // No active block (or stale active pointer whose block has been deleted):
  // legacy resolution unchanged.
  return (S.week && S.week[wd]) || null
}
export function effectiveRoutine(S, iso) {
  const id = effectiveRoutineId(S, iso)
  return id ? S.routines.find(r => r.id === id) || null : null
}
export function buildSets(S, cfg) {
  const last = lastEntryFor(S, cfg.id)
  const n = Math.max(1, cfg.sets || 1)
  const mode = modeOf(cfg)
  const sets = []
  // Last time's set at the same position, falling back to its final set when the plan grew.
  const prevAt = i => (last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null)

  if (mode === 'cardio') {
    for (let i = 0; i < n; i++) {
      const prev = prevAt(i)
      sets.push({ min: prev ? prev.min : (cfg.min || 20), speed: prev ? prev.speed : (cfg.speed || 8), done: false })
    }
    return sets
  }
  if (mode === 'time') {
    for (let i = 0; i < n; i++) {
      // Only carry a previous value over when it came from a timed set — switching an
      // exercise from reps to time must not seed the duration from a rep count.
      const prev = prevAt(i)
      const carried = prev && prev.sec > 0 ? prev : null
      sets.push({ sec: carried ? carried.sec : (cfg.sec || 45), w: carried ? (carried.w || 0) : (cfg.weight || 0), done: false })
    }
    return sets
  }
  const conf = S.exWeights[cfg.id]
  for (let i = 0; i < n; i++) {
    const prev = prevAt(i)
    const usable = prev && prev.r > 0 ? prev : null
    const w = conf && conf.w > 0 ? conf.w : (usable ? usable.w : cfg.weight)
    sets.push({ w, r: usable ? usable.r : cfg.reps, done: false })
  }
  return sets
}
export function workoutVolume(w) {
  let v = 0
  // No special case for unilateral work: a per-side set logs its total, so both sides are
  // already in the rep count that arrives here.
  w.entries.forEach(e => e.sets.forEach(s => { if (s.done) v += (s.w || 0) * (s.r || 0) }))
  return v
}
export function setsDone(w) {
  let n = 0
  w.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++ }))
  return n
}
export function setsDoneActive(A) {
  let n = 0
  if (A) A.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++ }))
  return n
}
export const lastBW = S => (S.bodyweight.length ? S.bodyweight[S.bodyweight.length - 1] : null)

// Group consecutive items sharing a superset id (sg) into "units" of indices.
// items may be routine exercises ({sg}) or active-workout entries ({sg}).
export function supersetUnits(items) {
  const units = []
  items.forEach((e, i) => {
    const prev = items[i - 1]
    if (i > 0 && e.sg && prev && prev.sg && e.sg === prev.sg) units[units.length - 1].push(i)
    else units.push([i])
  })
  return units
}
export function unitOf(units, idx) { return units.find(u => u.includes(idx)) || [idx] }

export function streakWeeks(S) {
  if (!S.workouts.length) return 0
  const weeks = new Set(S.workouts.map(w => weekKey(w.d)))
  let streak = 0
  const cur = new Date()
  for (let i = 0; i < 520; i++) {
    const wk = weekKey(isoOf(cur))
    if (weeks.has(wk)) streak++
    else if (i > 0) break
    cur.setDate(cur.getDate() - 7)
  }
  return streak
}

/* ============================================================
   Block management — Phase 1 foundation
   ------------------------------------------------------------
   Blocks are optional owned schedules layered on top of the
   legacy dayPlan / week resolution. The data shape lives in
   `useStore.js` (DEF) and the canonical resolver comes in
   Phase 2; this file owns validation, lifecycle and the
   calendar math that turns "started 23 days ago, paused
   between 5 and 9" into "you are on week 4".

   Every helper here is pure: it takes the full state object
   and a today string, and returns a new state. The store
   wraps them in `update()` for persistence.
   ============================================================ */

// Local-noon date math, shared by every block helper so the
// active block's clock cannot drift across a DST boundary the
// way a midnight-based walk would. noon is far enough from the
// 02:00 transitions that `getDate() +/- 1` lands on the right
// calendar day in every timezone, and the resulting ISO string
// is comparable with plain `<` / `>` (no time-of-day drift).
const localNoon = iso => new Date(iso + 'T12:00:00')

// Subtract `n` days from an ISO date and return the new ISO.
function isoMinusDays(iso, n) {
  const d = localNoon(iso)
  d.setDate(d.getDate() - n)
  return isoOf(d)
}

// Structural validation for a single block. Returns
//   { valid: boolean, errors: string[] }
// so callers can show every problem at once instead of one
// rerender per fix. The routine list is passed in (rather than
// read off S) so the same validator works for both the client
// state and any plan-share or import path that already has the
// routine list to hand.
export function validateBlock(block, routines) {
  const errors = []
  if (!block || typeof block !== 'object') {
    return { valid: false, errors: ['block is missing'] }
  }
  const routineList = routines || []
  const name = (block.name == null ? '' : String(block.name)).trim()
  if (!name) {
    errors.push('block name is blank')
  }
  // Block names only need to be nonblank; uniqueness against the
  // routine list is not in scope here (the routine list could be
  // filtered by the caller, and a cross-block name check would
  // belong at the store layer).
  if (!Array.isArray(block.weeks) || block.weeks.length === 0) {
    errors.push('block has no weeks')
  } else {
    block.weeks.forEach((week, wi) => {
      const days = week && week.days
      if (!days || typeof days !== 'object') {
        errors.push(`week ${wi + 1} has no day map`)
        return
      }
      for (let d = 0; d <= 6; d++) {
        const v = days[d]
        // `rest` is the explicit rest marker; anything else
        // has to be a routine id that actually exists. An
        // empty / null day is an error, not an implicit rest,
        // because we never want a saved plan to silently fall
        // through to the legacy week schedule.
        if (v == null || v === '') {
          errors.push(`week ${wi + 1} day ${d} is empty`)
        } else if (v !== 'rest' && !routineList.some(r => r.id === v)) {
          errors.push(`week ${wi + 1} day ${d} references an unknown routine`)
        }
      }
    })
  }
  return { valid: errors.length === 0, errors }
}

// Single-active invariant: every lifecycle helper rejects
// duplicate or out-of-order actions by throwing. The store
// wraps each helper in try/catch and toasts the message —
// there is never a partial mutation, the activeBlock pointer
// is whole-state swapped on success.

// Activate the named block at week 1. Throws when something is
// already active or the blockId doesn't exist.
export function activateBlock(S, blockId, today) {
  if (!S) throw new Error('activateBlock: missing state')
  if (!blockId) throw new Error('activateBlock: missing blockId')
  if (!today) throw new Error('activateBlock: missing today')
  if (S.activeBlock) throw new Error('a block is already active')
  const block = (S.blocks || []).find(b => b.id === blockId)
  if (!block) throw new Error('block not found')
  return {
    ...S,
    activeBlock: {
      blockId,
      startedOn: today,
      status: 'active',
      pausedRanges: [],
    },
  }
}

// Pause the active block on `today`. Throws when there is no
// active block, or when it is already paused (duplicate
// action). The `pausedOn` field is the start of an open pause
// range that `blockStatus` extends through `iso` until the
// next `resumeBlock` closes it.
export function pauseBlock(S, today) {
  if (!S) throw new Error('pauseBlock: missing state')
  if (!today) throw new Error('pauseBlock: missing today')
  if (!S.activeBlock) throw new Error('no block is active')
  if (S.activeBlock.status !== 'active') throw new Error('block is not active')
  return {
    ...S,
    activeBlock: {
      ...S.activeBlock,
      status: 'paused',
      pausedOn: today,
    },
  }
}

// Resume a paused block. Closes the open pause by appending
// `{ from: pausedOn, through: yesterday }` to pausedRanges and
// flipping status back to 'active'. Throws when there is no
// active block, or when it isn't paused.
export function resumeBlock(S, today) {
  if (!S) throw new Error('resumeBlock: missing state')
  if (!today) throw new Error('resumeBlock: missing today')
  const ab = S.activeBlock
  if (!ab) throw new Error('no block is active')
  if (ab.status !== 'paused' || !ab.pausedOn) throw new Error('block is not paused')
  const through = isoMinusDays(today, 1)
  const prev = ab.pausedRanges || []
  // A same-day pause/resume leaves `from > through`; we still
  // record it because the user asked for the cycle, and the
  // range matcher is a no-op on an empty span.
  return {
    ...S,
    activeBlock: {
      ...ab,
      status: 'active',
      pausedRanges: [...prev, { from: ab.pausedOn, through }],
      pausedOn: undefined,
    },
  }
}

// End the active block. Throws when there is no active block
// (a redundant End is a duplicate action).
export function endBlock(S) {
  if (!S) throw new Error('endBlock: missing state')
  if (!S.activeBlock) throw new Error('no block is active')
  return { ...S, activeBlock: null }
}

// Return the current local-calendar week of the active block
// for the given iso date, or null when no block is active
// or the block has been deleted out from under the pointer.
// Days are credited when they fall between startedOn and iso
// inclusive, EXCEPT for days inside any paused range (closed
// or open). The activation day itself always counts — even if
// the user paused on the same day, the block still started
// there. The result is clamped at `block.weeks.length`; the
// block does NOT auto-end at the boundary.
export function blockStatus(S, iso) {
  const ab = S && S.activeBlock
  if (!ab || !iso) return null
  const block = (S.blocks || []).find(b => b.id === ab.blockId)
  if (!block || !Array.isArray(block.weeks) || block.weeks.length === 0) return null
  const start = ab.startedOn
  if (!start || iso < start) return null

  // Build the set of paused local-calendar dates. The start
  // day is intentionally excluded from the set — even when
  // pausedOn equals startedOn, the activation day still counts.
  const paused = new Set()
  const collect = (from, through) => {
    if (!from) return
    const stop = through || iso
    let cur = localNoon(from)
    const end = localNoon(stop)
    while (cur <= end) {
      const isoCur = isoOf(cur)
      if (isoCur !== start) paused.add(isoCur)
      cur.setDate(cur.getDate() + 1)
    }
  }
  ;(ab.pausedRanges || []).forEach(r => collect(r.from, r.through))
  if (ab.status === 'paused' && ab.pausedOn) collect(ab.pausedOn, iso)

  // Walk forward from start to iso and count credited days.
  let credited = 0
  let cur = localNoon(start)
  const target = localNoon(iso)
  while (cur <= target) {
    if (!paused.has(isoOf(cur))) credited++
    cur.setDate(cur.getDate() + 1)
  }
  if (credited <= 0) return null
  // day 1 → week 1; day 7 → week 1; day 8 → week 2; clamp at the final week.
  const week = 1 + Math.floor((credited - 1) / 7)
  return Math.min(block.weeks.length, week)
}

// Snapshot the block context for a freshly-started workout. The result is what rides
// into `active.block` and into the finished workout record, so the snapshot is frozen
// at workout start — later block edits (rename, week re-mapping), pause/resume and
// end cannot rewrite history (spec #907 / design #908).
//
// Returns `{ id, name, week }` where:
//   id   — the block's id, copied so it stays valid even if the block is renamed
//   name — the block's name at the moment of the call
//   week — the resolved block week for `iso` (1-indexed)
//
// Returns null when no block is active, when the active blockId no longer resolves
// to a defined block, or when `iso` falls before the block started (no usable week).
// Pure: does not mutate `S`; the returned object is a fresh independent copy.
export function buildWorkoutBlockSnapshot(S, iso) {
  const ab = S && S.activeBlock
  if (!ab) return null
  const block = (S.blocks || []).find(b => b.id === ab.blockId)
  if (!block) return null
  const week = blockStatus(S, iso)
  if (week == null) return null
  return { id: block.id, name: block.name, week }
}
