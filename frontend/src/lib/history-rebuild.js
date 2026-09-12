import { workoutVolume, setIsDone, weightOfSet, projectSideSet } from './history.js'
import { bestSetOf } from './onerm.js'
import { sortHistory } from './history-edit.js'

const clone = value => structuredClone(value)

// Recompute every derived history field from the ordered occurrences. The input is never
// mutated, and duplicate exercise IDs are scanned as independent occurrences.
export function rebuildHistory(state) {
  const next = clone(state || {})
  next.workouts = sortHistory(next.workouts || []).map(workout => ({
    ...workout,
    vol: workoutVolume(workout),
    prs: []
  }))
  const bestWeight = new Map()
  const exWeights = {}
  for (const workout of next.workouts) {
    const seen = new Set()
    for (const entry of workout.entries || []) {
      let max = 0
      for (const raw of entry.sets || []) {
        const set = projectSideSet(raw)
        if (setIsDone(raw)) max = Math.max(max, weightOfSet(raw))
      }
      if (!max) continue
      const previous = bestWeight.get(entry.id) || 0
      if (max > previous && !seen.has(entry.id)) workout.prs.push(entry.id)
      if (max > previous) bestWeight.set(entry.id, max)
      if (!exWeights[entry.id] || max > exWeights[entry.id].w) exWeights[entry.id] = { w: max, d: workout.d }
      seen.add(entry.id)
    }
  }
  next.exWeights = exWeights
  return next
}

export const rebuildDerivedHistory = rebuildHistory
export const rebuildHistoryDerived = rebuildHistory
