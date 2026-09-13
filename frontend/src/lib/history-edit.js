import { classifyWorkoutTimestamps, normalizeWorkoutDateEdit } from './workout-time.js'
import { copyHistoryEntry, keepHistoryEntry, modeOf, projectSideSet } from './history.js'

const MODES = new Set(['reps', 'time', 'cardio'])
const unsafe = new Set(['__proto__', 'prototype', 'constructor', 'sid'])
const finite = value => typeof value === 'number' && Number.isFinite(value)
const nonnegative = value => finite(value) && value >= 0
const plain = value => value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype
const TARGET_FIELDS = ['mode', 'sets', 'reps', 'repsBySet', 'weight', 'bodyweight', 'side', 'sec', 'min', 'speed', 'planNote', 'programmedEffort']
export const HISTORICAL_ADDITION_MARKER = '_historicalAddition'

export function cloneHistoryValue(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) throw new Error('cyclic value')
  const copy = Array.isArray(value) ? [] : {}
  seen.set(value, copy)
  Object.entries(value).forEach(([key, item]) => { copy[key] = cloneHistoryValue(item, seen) })
  seen.delete(value)
  return copy
}

function inspect(value, seen = new Set(), root = false) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite value')
  if (value === null || typeof value !== 'object') return
  if (!plain(value)) throw new Error('non-plain value')
  if (seen.has(value)) throw new Error('cyclic value')
  seen.add(value)
  if (Array.isArray(value) && (Object.keys(value).some(key => !/^\d+$/.test(key) || Number(key) >= value.length) || Object.keys(value).length !== value.length)) throw new Error('sparse value')
  for (const [key, child] of Object.entries(value)) {
    if (unsafe.has(key)) throw new Error('unsafe key')
    inspect(child, seen)
  }
  seen.delete(value)
}

export function occurrenceKey(workoutId, originalIndex, sameIdOrdinal = 0) {
  return `${String(workoutId ?? '')}:${originalIndex}:${sameIdOrdinal}`
}

export function attachOccurrenceIdentity(workout) {
  const counts = new Map()
  return (workout?.entries || []).map((entry, index) => {
    const ordinal = counts.get(entry?.id) || 0
    counts.set(entry?.id, ordinal + 1)
    return { ...cloneHistoryValue(entry), _draftKey: occurrenceKey(workout.id, index, ordinal) }
  })
}

// Mark an entry added in the historical editor without changing the active-workout contract.
// The entry object is carried through edits and reordering, then the save boundary below selects
// only stored history fields so this marker cannot persist in a history record.
export function markHistoricalAddition(entry) {
  if (!entry || typeof entry !== 'object') return entry
  return { ...entry, [HISTORICAL_ADDITION_MARKER]: true }
}

// A target is optional in old history records. Keep the legacy fields isolated from actual sets;
// the active workout renderer needs a target snapshot, but it must never use the actual array as
// the target's set count.
export function historyTargetBaseline(entry) {
  if (entry?.target && typeof entry.target === 'object') return cloneHistoryValue(entry.target)
  return Object.fromEntries(TARGET_FIELDS.filter(key => Object.prototype.hasOwnProperty.call(entry || {}, key) && (key !== 'sets' || Number.isSafeInteger(entry[key])))
    .map(key => [key, cloneHistoryValue(entry[key])]))
}

function completeHistoricalTarget(entry) {
  const target = historyTargetBaseline(entry)
  const actualSets = Array.isArray(entry?.sets) ? entry.sets : []
  const first = actualSets[0] || {}
  const projected = projectSideSet(first) || {}
  const mode = modeOf({ ...target, id: entry?.id })
  if (target.mode == null) target.mode = mode
  if (target.sets == null) target.sets = Math.max(1, actualSets.length || 1)
  if (target.side == null && (first.left || first.right)) target.side = true

  if (mode === 'cardio') {
    if (target.min == null) target.min = Number.isSafeInteger(projected.min) && projected.min > 0 ? projected.min : 1
    if (target.speed == null) target.speed = finite(projected.speed) ? projected.speed : 0
  } else if (mode === 'time') {
    if (target.sec == null) target.sec = Number.isSafeInteger(projected.sec) && projected.sec > 0 ? projected.sec : 1
    if (target.weight == null) target.weight = finite(projected.w) ? projected.w : 0
  } else {
    if (target.reps == null) target.reps = Number.isFinite(projected.r) && projected.r > 0 ? projected.r : 1
    if (target.weight == null) target.weight = finite(projected.w) ? projected.w : 0
  }
  return target
}

const historicalSid = (workoutId, index) => `history-${String(workoutId ?? 'workout').replace(/[^a-zA-Z0-9_-]/g, '_')}-${index}`

// Turn one completed record into the active-session shape consumed by ExerciseBlock. This is a
// view-model conversion only: every nested value is cloned, and originalWorkout/returnActive are
// transient context used to replace the same record or restore an already-running session.
export function historicalWorkoutToActive(workout, returnActive = null) {
  const source = cloneHistoryValue(workout || {})
  const entries = (source.entries || []).map((entry, index) => ({
    id: entry.id,
    sid: historicalSid(source.id, index),
    ...(entry.n ? { n: entry.n } : {}),
    ...(entry.sg ? { sg: entry.sg } : {}),
    target: completeHistoricalTarget(entry),
    sets: cloneHistoryValue(Array.isArray(entry.sets) ? entry.sets : []),
    ...(Object.prototype.hasOwnProperty.call(entry, 'topW') ? { topW: entry.topW } : {}),
    ...(Object.prototype.hasOwnProperty.call(entry, 'note') ? { note: entry.note } : {}),
  }))
  return {
    id: source.id,
    d: source.d,
    start: source.start,
    end: source.end,
    routineId: source.routineId ?? null,
    name: source.name || 'Workout',
    bw: source.bw ?? null,
    cur: 0,
    entries,
    historicalEdit: {
      workoutId: source.id,
      originalWorkout: source,
      returnActive: cloneHistoryValue(returnActive),
    },
  }
}

// Convert the edited active snapshot back to a history record. Selecting fields here is
// intentional: sid, plan, asked, rest/activity and other session-only metadata never cross the
// history boundary. Derived volume/PR/exWeights are rebuilt by the normal store persistence flow.
export function historyWorkoutFromActive(active) {
  const context = active?.historicalEdit
  if (!context || !Array.isArray(active.entries)) return { ok: false, reason: 'historical context missing' }
  const original = cloneHistoryValue(context.originalWorkout || {})
  const entries = active.entries.map(entry => {
    const clean = {
      id: entry.id,
      ...(entry.n ? { n: entry.n } : {}),
      ...(entry.sg ? { sg: entry.sg } : {}),
      sets: cloneHistoryValue(Array.isArray(entry.sets) ? entry.sets : []),
      topW: entry.topW ?? null,
      target: cloneHistoryValue(entry.target || {}),
      ...(Object.prototype.hasOwnProperty.call(entry, 'note') ? { note: entry.note } : {}),
    }
    const historyEntry = copyHistoryEntry(clean)
    return keepHistoryEntry(historyEntry) || entry[HISTORICAL_ADDITION_MARKER] === true ? historyEntry : null
  }).filter(entry => entry !== null)
  return {
    ok: true,
    workout: {
      ...original,
      id: context.workoutId,
      d: active.d,
      start: active.start,
      end: active.end,
      entries,
    },
  }
}

export function removeOccurrence(entries, key) { return (entries || []).filter(entry => entry._draftKey !== key) }
export function reorderOccurrences(entries, orderedKeys) {
  const byKey = new Map((entries || []).map(entry => [entry._draftKey, entry]))
  return orderedKeys.map(key => byKey.get(key)).filter(Boolean).concat((entries || []).filter(entry => !orderedKeys.includes(entry._draftKey)))
}

const validateEffort = value => nonnegative(value) && value <= 10
function validateSet(set, mode) {
  if (!set || typeof set !== 'object' || Array.isArray(set)) return false
  if (set.rir != null && !validateEffort(set.rir)) return false
  if (set.rpe != null && (!finite(set.rpe) || set.rpe < 5 || set.rpe > 10)) return false
  if ('left' in set || 'right' in set) {
    if (!set.left || !set.right || !plain(set.left) || !plain(set.right)) return false
    return validateSet(set.left, mode) && validateSet(set.right, mode)
  }
  if (mode === 'cardio') return Number.isSafeInteger(set.min) && set.min > 0 && nonnegative(set.speed)
  if (mode === 'time') return Number.isSafeInteger(set.sec) && set.sec > 0 && (set.w == null || nonnegative(set.w))
  return (set.r == null || nonnegative(set.r)) && (set.w == null || nonnegative(set.w))
}

function validateTarget(target, mode) {
  if (!target || typeof target !== 'object') return true
  if (target.sets != null && (!Number.isSafeInteger(target.sets) || target.sets < 1)) return false
  if (target.weight != null && !nonnegative(target.weight)) return false
  if (target.reps != null && (!finite(target.reps) || target.reps < 1)) return false
  if (target.repsBySet != null && (!Array.isArray(target.repsBySet) || !target.repsBySet.every(value => value == null || (finite(value) && value >= 1)))) return false
  if (target.sec != null && (!Number.isSafeInteger(target.sec) || target.sec < 1)) return false
  if (target.min != null && (!Number.isSafeInteger(target.min) || target.min < 1)) return false
  if (target.speed != null && !nonnegative(target.speed)) return false
  if (target.bodyweight != null && typeof target.bodyweight !== 'boolean') return false
  if (target.side != null && typeof target.side !== 'boolean') return false
  return !mode || MODES.has(mode)
}

export function validateHistoryEntry(entry) {
  try {
    inspect(entry, new Set(), true)
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.sets)) return { ok: false, reason: 'shape' }
    const mode = modeOf(entry.target ? { ...entry.target, id: entry.id } : entry)
    if (entry.mode != null && !MODES.has(entry.mode)) return { ok: false, reason: 'mode' }
    if (entry.target?.mode != null && !MODES.has(entry.target.mode)) return { ok: false, reason: 'mode' }
    if (!validateTarget(entry.target, mode)) return { ok: false, reason: 'target' }
    if (!entry.sets.every(set => validateSet(set, mode))) return { ok: false, reason: 'set' }
    return { ok: true, mode }
  } catch (error) { return { ok: false, reason: error.message } }
}

export function normalizeHistoryEntry(entry, removal = false) {
  const result = validateHistoryEntry(entry)
  if (!result.ok) return result
  if (removal) return { ok: true, removed: true }
  const copy = copyHistoryEntry(entry)
  if (!keepHistoryEntry(copy)) return { ok: true, removed: true }
  delete copy._draftKey
  return { ok: true, entry: copy }
}

export function normalizeHistoryWorkout(workout, date, removals = new Set()) {
  const edited = date ? normalizeWorkoutDateEdit(workout, date) : { ...workout }
  if (edited.kind === 'invalid') return edited
  const entries = []
  for (const entry of workout.entries || []) {
    const key = entry._draftKey
    const normalized = normalizeHistoryEntry(entry, removals.has(key))
    if (!normalized.ok) return normalized
    if (!normalized.removed) entries.push(normalized.entry)
  }
  return { ...edited, entries }
}

export function sortHistory(workouts) {
  return (workouts || []).map((workout, index) => ({ workout, index })).sort((a, b) => {
    const day = String(a.workout.d || '').localeCompare(String(b.workout.d || ''))
    if (day) return day
    const at = classifyWorkoutTimestamps(a.workout.start, a.workout.end)
    const bt = classifyWorkoutTimestamps(b.workout.start, b.workout.end)
    if (at.kind !== bt.kind) return at.kind === 'timestamped' ? -1 : 1
    if (at.kind === 'timestamped' && (at.start !== bt.start || at.end !== bt.end)) return at.start - bt.start || at.end - bt.end
    return a.index - b.index
  }).map(item => item.workout)
}

export function explicitHistoryAddition({ id, mode, sets, ...fields } = {}) {
  if (!MODES.has(mode) || !Array.isArray(sets) || !sets.length) return { ok: false, reason: 'explicit configuration required' }
  const candidate = cloneHistoryValue({ id, mode, sets, ...fields })
  const result = validateHistoryEntry(candidate)
  return result.ok ? { ok: true, entry: candidate } : result
}

export { MODES }
