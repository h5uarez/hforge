// Additive Hforge JSON backup restore. Existing records and profile settings stay intact.
import { EXIDX } from './exercises.js'
import { normalizeExerciseIds } from './exercise-ids.js'
import { uid } from './format.js'

// Content, rather than IDs alone, identifies duplicates across repeated restores.
const numOr = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb)
export function workoutSignature(w) {
  const entries = (w.entries || []).map(e => ({
    id: e.id,
    s: (e.sets || []).map(s => [
      numOr(s.w, 0), numOr(s.r, 0), numOr(s.min, 0), numOr(s.speed, 0), numOr(s.sec, 0),
      numOr(s.rpe, null), numOr(s.rir, null), s.done ? 1 : 0,
    ]),
    t: numOr(e.topW, 0),
  })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return JSON.stringify({ d: w.d || null, n: w.name || '', e: entries })
}

// Same-day sessions coexist; ID collisions with different content are re-keyed.
export function classifyImportWorkouts(existing, incoming) {
  const haveIds = new Set((existing || []).map(w => w && w.id))
  const haveSigs = new Set((existing || []).map(workoutSignature))
  const fresh = []
  let skipped = 0
  for (const w of incoming || []) {
    if (haveSigs.has(workoutSignature(w))) { skipped++; continue }
    let next = w
    if (w && haveIds.has(w.id)) next = { ...w, id: 'iw' + uid() }
    haveIds.add(next.id)
    haveSigs.add(workoutSignature(next))
    fresh.push(next)
  }
  return { fresh, skipped }
}

export function mergeImport(S, parsed) {
  if (parsed.kind === 'bodyweight') {
    const have = new Set(S.bodyweight.map(b => b.d))
    const fresh = parsed.bodyweight.filter(b => !have.has(b.d))
    S.bodyweight = [...S.bodyweight, ...fresh].sort((a, b) => (a.d < b.d ? -1 : 1))
    return { added: fresh.length, skipped: parsed.bodyweight.length - fresh.length }
  }
  const { fresh, skipped } = classifyImportWorkouts(S.workouts, parsed.workouts)
  const used = new Set(fresh.flatMap(w => w.entries.map(e => e.id)))
  const customs = parsed.customEx.filter(c => used.has(c.id) && !EXIDX[c.id])
  S.customEx = [...(S.customEx || []), ...customs]
  S.workouts = [...S.workouts, ...fresh].sort((a, b) => (a.d < b.d ? -1 : 1))
  // Seed weight suggestions from the newest restored set of each lift.
  fresh.forEach(w => w.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.map(s => s.w || 0), e.topW || 0)
    if (mx > 0) { const cur = S.exWeights[e.id]; if (!cur || w.d >= cur.d) S.exWeights[e.id] = { w: mx, d: w.d } }
  }))
  return { added: fresh.length, skipped }
}

/** Merge the historical collections from a full backup without replacing profile data. */
export function mergeBackupImport(S, backup) {
  const existingCustomIds = new Set((S.customEx || []).map(exercise => exercise.id))
  const workouts = normalizeExerciseIds({
    workouts: Array.isArray(backup?.workouts) ? backup.workouts : [],
  }).workouts
  const mergedWorkouts = mergeImport(S, {
    kind: 'workouts',
    workouts,
    customEx: (Array.isArray(backup?.customEx) ? backup.customEx : [])
      .filter(exercise => exercise && !existingCustomIds.has(exercise.id)),
  })
  const bodyweight = mergeImport(S, {
    kind: 'bodyweight',
    bodyweight: Array.isArray(backup?.bodyweight) ? backup.bodyweight : [],
  })
  return { added: mergedWorkouts.added + bodyweight.added, skipped: mergedWorkouts.skipped + bodyweight.skipped }
}
