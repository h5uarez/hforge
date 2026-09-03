// Estimated one-rep max (issue #18).
import { projectSideSet, weightOfSet } from './history.js'
//
// Deliberately knows nothing about the exercise database: an estimate needs a weight AND a
// rep count, and only reps-mode sets carry both. Cardio sets ({min, speed}) and timed sets
// ({sec, w}) therefore drop out of every scan here on their own — there is no exercise-type
// check to keep in sync.
//
// Formulas are the usual submaximal-load estimators. Epley is the default because it is the
// one most lifters have seen; all of them agree closely at low reps and diverge as reps rise,
// which is exactly why REP_CAP exists.

// Above this many reps an estimate says more about work capacity than about maximal strength,
// and the formulas disagree by double digits. Refusing to guess beats printing a fantasy.
export const REP_CAP = 12

export const FORMULAS = {
  // Epley 1985 — w · (1 + r/30)
  epley: (w, r) => w * (1 + r / 30),
  // Brzycki 1993 — w · 36/(37 − r); undefined at r ≥ 37, but REP_CAP is far below that
  brzycki: (w, r) => w * 36 / (37 - r),
  // Lombardi 1989 — w · r^0.10
  lombardi: (w, r) => w * Math.pow(r, 0.1)
}
export const DEFAULT_FORMULA = 'epley'

// Estimate a 1RM from one set. Returns null for anything it cannot honestly answer:
// missing/zero/negative load, no reps, non-finite input, or more reps than REP_CAP.
// A single rep is not an estimate — it is the measurement — and comes back unchanged.
export function estimate1RM(w, r, formula = DEFAULT_FORMULA) {
  const weight = Number(w)
  const reps = Number(r)
  if (!isFinite(weight) || !isFinite(reps)) return null
  if (weight <= 0 || reps < 1) return null
  if (reps > REP_CAP) return null
  const fn = FORMULAS[formula] || FORMULAS[DEFAULT_FORMULA]
  // Fractional reps are preserved on purpose: estimateWithEffort feeds effective
  // reps like 7.5 (RPE 7.5), and rounding here would collapse 7 vs 7.5 to the
  // same estimate. Integer callers (history, sheets) are unaffected.
  const est = reps === 1 ? weight : fn(weight, reps)
  if (!isFinite(est) || est <= 0) return null
  return Math.round(est * 10) / 10
}

// Estimate a 1RM from a set plus how far it was from failure. The adjustment works in
// effective reps — a set of 6 with RIR 1 is treated as a set of 7 — because that is what the
// formula actually consumes. Effective reps stay fractional (RIR steps are 0.5, so RPE 7 vs
// 7.5 give different estimates) and are capped at REP_CAP, so this never asks estimate1RM
// to guess past the cap; invalid input returns null exactly like estimate1RM.
// A null RIR (no effort recorded) means "assumed to failure", which the caller flags as an
// assumption rather than a measurement.
export function estimateWithEffort(w, reps, rir) {
  const base = Number(reps)
  const reserve = rir == null ? 0 : Number(rir)
  if (!Number.isFinite(base) || !Number.isFinite(reserve)) return null
  const effReps = Math.min(base + reserve, REP_CAP)
  const est = estimate1RM(w, effReps)
  if (est === null) return null
  return { est, effReps, failureAssumed: rir == null }
}

// Best estimate out of one workout entry's completed sets.
// `topW` is ignored on purpose: it records the working weight a user confirmed after the
// exercise, with no rep count attached, so it cannot produce an estimate.
export function bestSetOf(entry, formula = DEFAULT_FORMULA) {
  let best = null
  ;(entry?.sets || []).forEach(raw => {
    const s = projectSideSet(raw)
    if (!s.done) return
    const weight = weightOfSet(raw)
    const est = estimate1RM(weight, s.r, formula)
    if (est !== null && (!best || est > best.est)) best = { est, w: Number(weight), r: Math.round(Number(s.r)) }
  })
  return best
}

// One point per workout in which the exercise produced an estimate — feeds the trend chart.
// Chronological, matching the order workouts are appended in.
export function e1rmSeries(S, exId, formula = DEFAULT_FORMULA) {
  const pts = []
  ;(S.workouts || []).forEach(w => {
    const entry = w.entries.find(e => e.id === exId)
    if (!entry) return
    const best = bestSetOf(entry, formula)
    if (best) pts.push({ t: w.start, d: w.d, y: best.est, w: best.w, r: best.r })
  })
  return pts
}

// All-time best estimate for an exercise, with the set and date it came from — the source
// matters, because "142.5 kg est. from 100×10" is a very different claim from "from 140×1".
export function best1RM(S, exId, formula = DEFAULT_FORMULA) {
  let best = null
  e1rmSeries(S, exId, formula).forEach(p => { if (!best || p.y > best.est) best = { est: p.y, w: p.w, r: p.r, d: p.d, t: p.t } })
  return best
}

// Did this workout beat every estimate that came before it? Used for the finish summary,
// so it compares against history that does not yet contain `w`.
export function is1RMRecord(S, exId, entry, formula = DEFAULT_FORMULA) {
  const now = bestSetOf(entry, formula)
  if (!now) return null
  const prev = best1RM(S, exId, formula)
  return !prev || now.est > prev.est ? { ...now, prev: prev ? prev.est : 0 } : null
}
