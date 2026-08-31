// Pure helpers over the state object S (ported 1:1 from the vanilla app).
import { todayISO, isoOf, weekKey, fmtNum } from './format.js'
import { isCardio, isBodyweightEq } from './exercises.js'
import { t } from './i18n.js'

// Notes are optional context, not part of exercise calculations. Keep the unbounded helper
// available to editors that need to retain a draft, and use normalizeNote at persistence
// boundaries so stored values are trimmed, bounded, and absent when empty.
export const NOTE_MAX = 280
export function normalizeExerciseNote(raw) {
  if (typeof raw !== 'string') return undefined
  const note = raw.trim()
  return note || undefined
}
export function normalizeNote(raw) {
  const note = normalizeExerciseNote(raw)
  return note === undefined ? undefined : note.slice(0, NOTE_MAX)
}
export const normalizeStoredNote = normalizeNote

// Normalize the two note concepts without mutating the source. This is also used for nested
// routine snapshots so a finished workout cannot retain an empty or overlong coach note.
export function copyNoteFields(source) {
  if (!source || typeof source !== 'object') return source
  const copy = { ...source }
  for (const field of ['note', 'planNote']) {
    const note = normalizeNote(copy[field])
    if (note === undefined) delete copy[field]
    else copy[field] = note
  }
  return copy
}
// Build the history representation before applying the completed-set filter. This ordering is
// important: an entry with a note or coach note and no completed sets is still useful history.
export function copyHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry
  const copy = copyNoteFields({ ...entry, sets: Array.isArray(entry.sets) ? entry.sets : [] })
  if (copy.target && typeof copy.target === 'object') copy.target = copyNoteFields(copy.target)
  return copy
}

export function keepHistoryEntry(entry) {
  return !!entry && (
    (Array.isArray(entry.sets) && entry.sets.some(setIsDone)) ||
    normalizeNote(entry.note) !== undefined ||
    normalizeNote(entry.planNote) !== undefined ||
    normalizeNote(entry.target?.planNote) !== undefined
  )
}

// Pure active-session update used by the visible workout textarea. Keep the draft exactly as
// typed so a trailing space is still present when the next word is entered. Empty values are
// represented by a missing key rather than null, and the input object is never mutated. Stored
// history is normalized separately by copyNoteFields at the persistence boundary.
export function updateExerciseNote(entry, raw) {
  if (!entry || typeof entry !== 'object') return entry
  const copy = { ...entry }
  const draft = typeof raw === 'string' ? raw.slice(0, NOTE_MAX) : ''
  if (!draft.trim()) delete copy.note
  else copy.note = draft
  return copy
}

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

// A side-aware set carries both records explicitly.  The aggregate fields are a projection for
// old consumers, not a second source of truth.  In particular, a legacy set with only one side
// (or no sides) is never "completed" by inventing the missing record.
export const hasBothSides = s => !!(s && s.left && s.right && typeof s.left === 'object' && typeof s.right === 'object')
export function projectSideSet(s) {
  if (!hasBothSides(s)) return s
  const out = { ...s, done: !!s.left.done && !!s.right.done }
  const reps = [s.left.r, s.right.r].filter(v => typeof v === 'number' && Number.isFinite(v))
  if (reps.length) out.r = reps.reduce((a, b) => a + b, 0)
  else delete out.r
  const lw = s.left.w, rw = s.right.w
  if (typeof lw === 'number' && typeof rw === 'number' && Number.isFinite(lw) && lw === rw) out.w = lw
  else delete out.w
  for (const key of ['rir', 'rpe']) {
    const values = [s.left[key], s.right[key]].filter(v => typeof v === 'number' && Number.isFinite(v))
    if (values.length) out[key] = values.reduce((a, b) => a + b, 0) / values.length
    else delete out[key]
  }
  return out
}
export const setIsDone = s => !!projectSideSet(s)?.done
// A load projection for consumers that need the heaviest side. Aggregate `w` is retained only
// for legacy sets or equal side loads; differing explicit side loads remain authoritative here.
export function weightOfSet(s) {
  if (!hasBothSides(s)) return Number.isFinite(s?.w) ? s.w : 0
  return Math.max(
    Number.isFinite(s.left.w) ? s.left.w : 0,
    Number.isFinite(s.right.w) ? s.right.w : 0
  )
}
export function syncSideSet(s) {
  if (!hasBothSides(s)) return s
  const p = projectSideSet(s)
  Object.keys(s).forEach(k => { if (k !== 'left' && k !== 'right') delete s[k] })
  Object.assign(s, p, { left: s.left, right: s.right })
  return s
}

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
// Timed values are validated at the editor boundary. A missing value on an existing
// config is not a new config and must remain invalid rather than being defaulted.
export const parseTimedSeconds = raw => {
  const s = String(raw ?? '').trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n >= 1 ? n : null
}
export const timedSecondsInput = (existing, id) =>
  existing ? String(existing.sec ?? '') : String(defaultConfig(id, 'time').sec)
// The "(RIR 2)" / "(RPE 8)" tail on a set summary, empty when nothing was logged.
const effortTail = s => {
  const k = s.rir != null ? 'rir' : s.rpe != null ? 'rpe' : null
  return k ? ` (${EFFORT[k].hd} ${fmtNum(s[k])})` : ''
}

// One-line summary of a logged set. `cfg` carries the mode when the caller has it (a routine
// entry or a workout entry); passing an id alone keeps the old body-part behaviour.
export function setLabel(id, s, cfg) {
  s = projectSideSet(s)
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
  const side = id === '0739' ? { side: true } : {}
  if (m === 'time') return { sets: 3, sec: 45, weight: 0, mode: 'time', ...bw }
  return { sets: 3, reps: 10, weight: 0, mode: 'reps', ...bw, ...side }
}
// One-line summary of a planned exercise ("3 × 10 · 60 kg"), shared by the routine editor
// and the plan export so a mode is described the same way everywhere.
export function exLine(cfg, unit) {
  const mode = modeOf(cfg)
  const n = cfg.sets || 1
  // Added weight reads as added: "+10 kg" on a dip belt, "60 kg" on a barbell.
  const load = cfg.weight ? ' · ' + (isBw(cfg) ? '+' : '') + fmtNum(cfg.weight) + ' ' + unit : ''
  if (mode === 'cardio') return `${n} × ${cfg.min || 20} min @ ${fmtNum(cfg.speed || 8)} km/h`
  if (mode === 'time') return `${n} × ${fmtSec(cfg.sec)}${load}`
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

/* ============================================================
   Programmed effort — Phase 1 foundation (issue: programmed-rpe-rir)
   ------------------------------------------------------------
   Optional per-set metric-tagged RIR/RPE targets live on a routine
   entry as `programmedEffort: [{ metric, value } | null]` (one slot
   per set, length = cfg.sets). A target is only meaningful when its
   `metric` matches the Settings effort mode; mismatched targets are
   hidden until the routine is explicitly re-edited, never silently
   converted. These helpers are pure so sheets.jsx and history.jsx
   can share the same validation, normalization, and resolution.
   ============================================================ */

// Sentinel values returned by `validateProgrammedTargets`:
//   undefined — the routine carries no `programmedEffort` field at all
//               (legacy routine, plan, import, or workout — keeps working).
//   null      — the field exists but no non-null entry matches `metric`.
//               The caller MUST hide every target and not invent one.
//   Array     — every non-null entry matches `metric`; same reference
//               when the input was already valid, so routine editors can
//               keep using the array as-is.
export function validateProgrammedTargets(targets, metric) {
  if (targets == null) return undefined
  if (!Array.isArray(targets)) return null
  if (targets.length === 0) return targets
  // EFFORT keys are 'rir' and 'rpe'. A 'none' profile never seeds a target,
  // so any non-null entry is a mismatch by definition.
  const validMetric = EFFORT[metric] ? metric : null
  for (const t of targets) {
    if (t == null) continue
    if (!t || typeof t.metric !== 'string' || t.metric !== validMetric) return null
  }
  return targets
}

// Bring a saved targets array into line with the current set count.
//   - Empty / missing input → empty array (no growth happens; absence
//     is "no targets configured", distinct from "set count grew").
//   - Array longer than setCount → truncate (routine shrunk).
//   - Array shorter than setCount → extend with the last REAL (non-null)
//     target so a routine grown past the saved slots keeps its
//     prescription; falling back to null if there is no real target.
//   - Always returns a fresh array so callers can mutate safely.
export function normalizeTargets(targets, setCount) {
  const a = Array.isArray(targets) ? targets : null
  if (a === null || a.length === 0) return []
  const n = setCount > 0 ? (setCount | 0) : 0
  if (n === 0) return []
  if (a.length === n) return a.slice()
  if (a.length > n) return a.slice(0, n)
  // a.length < n: extend with the last non-null target, or null.
  let last = null
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i] != null) { last = a[i]; break }
  }
  const out = a.slice()
  while (out.length < n) out.push(last)
  return out
}

// Resolve the planned-effort target for the set at `idx` on `cfg`,
// given the current Settings `metric`. Returns `{ metric, value }` or
// `undefined`. Pure: no mutation of cfg. Extracted from `buildSets`
// in Phase 1 task 1.9 so sheets.jsx can resolve the same target the
// workout started with when a user adds a fresh set mid-session.
export function resolveTarget(cfg, idx, metric) {
  if (!cfg || !Array.isArray(cfg.programmedEffort)) return undefined
  const validated = validateProgrammedTargets(cfg.programmedEffort, metric)
  if (!Array.isArray(validated)) return undefined
  const n = Math.max(1, cfg.sets || 1)
  const norm = normalizeTargets(validated, n)
  return norm[idx] || undefined
}

export function lastEntryFor(S, exId) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const en = S.workouts[i].entries.find(e => e.id === exId)
    // `target` is what the session prescribed; finished workouts carry it so labels and the
    // progression engine can read a session back the way it was logged. Older workouts have
    // none — modeOf() falls back to the body part for them, which is what they were.
    if (en && en.sets.some(setIsDone)) return { d: S.workouts[i].d, sets: en.sets.map(projectSideSet).filter(setIsDone), target: en.target || null }
  }
  return null
}
export function bestWeightFor(S, exId) {
  let best = 0
  S.workouts.forEach(w => w.entries.forEach(e => {
    if (e.id === exId) {
      e.sets.forEach(raw => { if (projectSideSet(raw).done) best = Math.max(best, weightOfSet(raw)) })
      if (e.topW && e.topW > best) best = e.topW
    }
  }))
  return best
}
export function effectiveRoutineId(S, iso) {
  // Explicit date override always wins. A 'rest' marker is an explicit rest day.
  const ov = S && S.dayPlan ? S.dayPlan[iso] : undefined
  if (ov === 'rest') return null
  if (ov && S.routines && S.routines.some(r => r.id === ov)) return ov

  const wd = new Date(iso + 'T12:00:00').getDay()
  // Manual resolution: explicit date overrides win, then the recurring weekly plan.
  return (S.week && S.week[wd]) || null
}
export function effectiveRoutine(S, iso) {
  const id = effectiveRoutineId(S, iso)
  return id ? S.routines.find(r => r.id === id) || null : null
}
export function buildSets(S, cfg) {
  // Use the most recent completed entry for the exercise.
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
      const w = carried ? (carried.w || 0) : (cfg.weight || 0)
      sets.push({ sec: carried ? carried.sec : cfg.sec, w, done: false })
    }
    return sets
  }
  const conf = S.exWeights[cfg.id]
  const metric = effortOf(S)
  for (let i = 0; i < n; i++) {
    const prev = prevAt(i)
    const usable = prev && prev.r > 0 ? prev : null
    const w = conf && conf.w > 0 ? conf.w : (usable ? usable.w : cfg.weight)
    const set = isPerSide(cfg)
      ? { left: { w: usable && hasBothSides(usable) ? (usable.left.w ?? 0) : (cfg.weight || 0), r: usable && hasBothSides(usable) ? (usable.left.r ?? sideReps(cfg.reps)) : sideReps(cfg.reps), done: false }, right: { w: usable && hasBothSides(usable) ? (usable.right.w ?? 0) : (cfg.weight || 0), r: usable && hasBothSides(usable) ? (usable.right.r ?? sideReps(cfg.reps)) : sideReps(cfg.reps), done: false }, w, r: cfg.reps, done: false }
      : { w, r: usable ? usable.r : cfg.reps, done: false }
    // Snapshot the programmed target onto each set at workout start. The
    // snapshot rides alongside actual `rir`/`rpe` and is never edited by
    // the logger; metric mismatch yields `undefined`, which omits the key
    // entirely (legacy routines, plans, imports, and workouts stay valid
    // because the field is absent rather than being silently converted).
    const target = resolveTarget(cfg, i, metric)
    if (target) set.plannedEffort = target
    sets.push(set)
  }
  return sets
}
export function workoutVolume(w) {
  let v = 0
  // No special case for unilateral work: a per-side set logs its total, so both sides are
  // already in the rep count that arrives here.
  w.entries.forEach(e => e.sets.forEach(raw => { const s = projectSideSet(raw); if (s.done) v += weightOfSet(raw) * (s.r || 0) }))
  return v
}
export function setsDone(w) {
  let n = 0
  w.entries.forEach(e => e.sets.forEach(s => { if (projectSideSet(s).done) n++ }))
  return n
}
export function setsDoneActive(A) {
  let n = 0
  if (A) A.entries.forEach(e => e.sets.forEach(s => { if (projectSideSet(s).done) n++ }))
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
