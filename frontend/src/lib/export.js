import { MOBILE, shareExport } from './mobile.js'

const clone = value => JSON.parse(JSON.stringify(value))

// Build the minimal importable Hforge payload for the chosen workout dates.
// Clone each exported collection so callers can never mutate the live store through the payload.
export function createWorkoutBackup(state, selectedDates) {
  const source = state || {}
  const dates = new Set(selectedDates || [])
  const workouts = clone(source.workouts || [])
    .filter(workout => dates.has(workout.d))
    .map(workout => {
      const exportedWorkout = { ...workout }
      delete exportedWorkout.block
      return exportedWorkout
    })
  const routineIds = new Set(workouts.map(workout => workout.routineId).filter(id => id !== undefined && id !== null))
  const routines = clone(source.routines || []).filter(routine => routineIds.has(routine.id))
  const customIds = new Set([
    ...workouts.flatMap(workout => (workout.entries || []).map(entry => entry.id)),
    ...routines.flatMap(routine => (routine.ex || []).map(entry => entry.id)),
  ].filter(id => id !== undefined && id !== null))
  const customEx = clone(source.customEx || []).filter(exercise => customIds.has(exercise.id))

  return { unit: source.unit, routines, workouts, customEx }
}

export const serializeBackup = state => JSON.stringify(state, null, 2)
export const backupFilename = date => 'hforge-backup-' + date + '.json'

// WKWebView cannot download blob URLs, so native builds use the existing OS share sheet.
export async function deliverExport(json, filename) {
  if (MOBILE) return shareExport(json, filename)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  try { a.click() } finally { URL.revokeObjectURL(url) }
}
