import { HEVY_COMPATIBILITY } from './hevy-compatibility.js'

// The compatibility table is the only source of truth for the reviewed legacy-to-Hevy
// migration.  Keep the reverse map derived here so catalog generation, state restores, and
// import boundaries cannot silently drift apart.
export const LEGACY_TO_HEVY = Object.freeze(Object.fromEntries(
  Object.entries(HEVY_COMPATIBILITY).map(([hevyId, { appId }]) => [appId, hevyId])
))
export const HEVY_TO_LEGACY = Object.freeze(Object.fromEntries(
  Object.entries(LEGACY_TO_HEVY).map(([legacyId, hevyId]) => [hevyId, legacyId])
))

// 2330 was already retired as a duplicate of 0198.  Compose that alias with the reviewed
// migration instead of making it a visible catalog row again.
export const LEGACY_EXERCISE_ID_ALIASES = Object.freeze({ '2330': '0198' })

export const isLegacyExerciseId = id => typeof id === 'string' && (
  Object.hasOwn(LEGACY_TO_HEVY, id) || Object.hasOwn(LEGACY_EXERCISE_ID_ALIASES, id)
)

export function canonicalExerciseId(id) {
  if (typeof id !== 'string') return id
  const legacyId = LEGACY_EXERCISE_ID_ALIASES[id] || id
  return LEGACY_TO_HEVY[legacyId] || legacyId
}

const normalizeEntry = entry => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
  const next = { ...entry }
  if (Object.hasOwn(entry, 'id')) next.id = canonicalExerciseId(entry.id)
  if (entry.target && typeof entry.target === 'object' && !Array.isArray(entry.target)) {
    next.target = normalizeEntry(entry.target)
  }
  return next
}

const normalizePr = value => value && typeof value === 'object' && !Array.isArray(value)
  ? normalizeEntry(value)
  : canonicalExerciseId(value)

const betterWeight = (candidate, previous) => {
  if (!previous) return candidate
  const candidateWeight = Number.isFinite(Number(candidate?.w)) ? Number(candidate.w) : 0
  const previousWeight = Number.isFinite(Number(previous?.w)) ? Number(previous.w) : 0
  if (candidateWeight !== previousWeight) return candidateWeight > previousWeight ? candidate : previous

  // Keep the complete record belonging to the best value.  When weights tie, the newer date is
  // the more useful suggestion; all other fields on that record remain untouched.
  const candidateDate = candidate?.d == null ? '' : String(candidate.d)
  const previousDate = previous?.d == null ? '' : String(previous.d)
  return candidateDate > previousDate ? candidate : previous
}

const entryHasLegacyId = entry => !!(
  entry && typeof entry === 'object' && !Array.isArray(entry) && (
    (Object.hasOwn(entry, 'id') && isLegacyExerciseId(entry.id)) ||
    (entry.target && typeof entry.target === 'object' && !Array.isArray(entry.target) && entryHasLegacyId(entry.target))
  )
)

// Detect only the persisted exercise-ID positions that normalizeExerciseIds owns.  Routine IDs,
// workout IDs, customEx IDs, and arbitrary unknown fields deliberately stay outside this walk.
export function hasLegacyExerciseIds(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false
  if (Array.isArray(state.routines) && state.routines.some(routine =>
    Array.isArray(routine?.ex) && routine.ex.some(entryHasLegacyId))) return true
  if (Array.isArray(state.workouts) && state.workouts.some(workout =>
    (Array.isArray(workout?.entries) && workout.entries.some(entryHasLegacyId)) ||
    (Array.isArray(workout?.prs) && workout.prs.some(value =>
      typeof value === 'object' ? entryHasLegacyId(value) : isLegacyExerciseId(value))))) return true
  if (Array.isArray(state.active?.entries) && state.active.entries.some(entryHasLegacyId)) return true
  return !!(state.exWeights && typeof state.exWeights === 'object' && !Array.isArray(state.exWeights)
    && Object.keys(state.exWeights).some(isLegacyExerciseId))
}

export function normalizeExerciseIds(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state
  const next = { ...state }
  if (Array.isArray(state.routines)) {
    next.routines = state.routines.map(routine => routine && Array.isArray(routine.ex)
      ? { ...routine, ex: routine.ex.map(normalizeEntry) }
      : routine)
  }
  if (Array.isArray(state.workouts)) {
    next.workouts = state.workouts.map(workout => workout && typeof workout === 'object'
      ? {
          ...workout,
          ...(Array.isArray(workout.entries) ? { entries: workout.entries.map(normalizeEntry) } : {}),
          ...(Array.isArray(workout.prs) ? { prs: workout.prs.map(normalizePr) } : {}),
        }
      : workout)
  }
  if (state.active && typeof state.active === 'object' && !Array.isArray(state.active)) {
    next.active = Array.isArray(state.active.entries)
      ? { ...state.active, entries: state.active.entries.map(normalizeEntry) }
      : state.active
  }
  if (state.exWeights && typeof state.exWeights === 'object' && !Array.isArray(state.exWeights)) {
    next.exWeights = {}
    for (const [id, value] of Object.entries(state.exWeights)) {
      const canonical = canonicalExerciseId(id)
      const previous = next.exWeights[canonical]
      next.exWeights[canonical] = betterWeight(value, previous)
    }
  }
  return next
}
