export const canonicalExerciseId = id => id === '2330' ? '0198' : id

const normalizeEntry = entry => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
  const next = { ...entry }
  if (Object.hasOwn(entry, 'id')) next.id = canonicalExerciseId(entry.id)
  if (entry.target && typeof entry.target === 'object' && !Array.isArray(entry.target)) {
    next.target = normalizeEntry(entry.target)
  }
  return next
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
          ...(Array.isArray(workout.prs) ? { prs: workout.prs.map(canonicalExerciseId) } : {}),
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
      next.exWeights[canonical] = !previous || (value?.w || 0) > (previous.w || 0) ? value : previous
    }
  }
  return next
}
