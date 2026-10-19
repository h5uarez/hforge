import { allExercises, exerciseMatches, EXIDX } from './exercises.js'

// Presentation only: variants keep their IDs in the full catalog and saved state.
export function visualExercises(state, query = '') {
  const all = allExercises(state)
  const matches = new Set(all.filter(ex => exerciseMatches(ex, query)).map(ex => ex.baseId || ex.id))
  return all.filter(ex => !ex.variant && matches.has(ex.id))
}

export function visualUsage(state) {
  const index = new Map(allExercises(state).map(ex => [ex.id, ex]))
  const usage = {}
  const count = entry => {
    const ex = index.get(entry.id) || EXIDX[entry.id]
    const id = ex?.baseId || entry.id
    usage[id] = (usage[id] || 0) + 1
  }
  ;(state.routines || []).forEach(r => r.ex.forEach(count))
  ;(state.workouts || []).forEach(w => w.entries.forEach(count))
  return usage
}

export function exerciseMedia(ex) {
  if (!ex.variant || ex.video || ex.gif || ex.img) return ex
  return EXIDX[ex.baseId] || ex
}
