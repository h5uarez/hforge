// Warmup (aproximaciones) ladder builder — a small expert system.
//
// Given the planned top set (weight × reps, optional RPE and added load for
// bodyweight work) this returns the warmup sets leading into it, heaviest last.
// The top set itself is never included: the caller renders it separately.
//
// Every ladder is fixed by lift family (bench/OHP, squat, deadlift, bodyweight);
// the config only adjusts plates (bar/rounding), the 90/92 % ceiling, rest pace
// and the deadlift rep/single preference. RPE is a fatigue guard (drop the
// heaviest single), never an input to a formula.
export const DEFAULT_WARMUP_CONFIG = {
  experience: 'intermediate', // 'beginner' | 'intermediate' | 'advanced'
  barKg: 20,
  roundingKg: 2.5,
  style: 'standard',          // pace: 'conservative' | 'standard' | 'aggressive'
  deadliftMode: 'reps',       // 'reps' | 'singles'
}

// Catalog ids behind each family (see lib/exercises.js): bench 0025, squat 0043,
// deadlift 0032, pull-up 0652, dip 0251 (chest dip), overhead press 0091.
// Short keys are accepted too so callers are not forced to know catalog ids;
// anything unknown falls through to the generic barbell ladder.
export const WARMUP_OPTIONS = [
  { key: 'bench', id: '0025' },
  { key: 'squat', id: '0043' },
  { key: 'deadlift', id: '0032' },
  { key: 'ohp', id: '0091' },
  { key: 'pullup', id: '0652' },
  { key: 'dip', id: '0251' },
]

const KIND_BY_ID = {
  '0025': 'bench', bench: 'bench',
  '0043': 'squat', squat: 'squat',
  '0032': 'deadlift', deadlift: 'deadlift',
  '0091': 'ohp', ohp: 'ohp', overhead: 'ohp',
  '0652': 'pullup', pullup: 'pullup', 'pull-up': 'pullup',
  '0251': 'dip', dip: 'dip', dips: 'dip',
}

export const resolveKind = exerciseId => KIND_BY_ID[String(exerciseId || '').toLowerCase()] || 'generic'

export const isBodyweightKind = kind => kind === 'pullup' || kind === 'dip'

// Fixed ladders: [fractionOfTop | 'bar', reps, restSec]. The deadlift ladder
// carries its own minimum on the opener and never prescribes an empty bar.
const LADDER = {
  bench: [['bar', 10, 60], [0.50, 5, 90], [0.70, 3, 120], [0.85, 1, 180]],
  ohp: [['bar', 10, 60], [0.50, 5, 90], [0.70, 3, 120], [0.80, 1, 180]],
  squat: [['bar', 8, 60], [0.40, 5, 90], [0.60, 5, 120], [0.80, 2, 150], [0.90, 1, 180]],
  deadlift: [[0.40, 5, 90], [0.60, 3, 120], [0.75, 2, 150], [0.87, 1, 180]],
  generic: [['bar', 10, 60], [0.50, 5, 90], [0.70, 3, 120], [0.85, 1, 180]],
}

const roundTo = (x, step) => Math.round(x / step) * step

// Pace only stretches or compresses rests — it never changes a load, so the
// plates behind a ladder stay identical whatever the pace.
const paceRest = (sec, style) => {
  const mult = style === 'conservative' ? 1.25 : style === 'aggressive' ? 0.75 : 1
  return Math.round((sec * mult) / 15) * 15
}

// Same rounded kilos from two different rungs: keep the heavier rung (the later
// one — closer to the top), so the ladder never repeats a plate.
const dedupKg = sets => {
  const seen = new Set()
  const out = []
  for (let i = sets.length - 1; i >= 0; i--) {
    if (seen.has(sets[i].kg)) continue
    seen.add(sets[i].kg)
    out.unshift(sets[i])
  }
  return out
}

// A grinding top set earns a shorter runway: drop the heaviest single rather
// than re-computing anything.
const dropHeaviestSingle = sets => {
  for (let i = sets.length - 1; i >= 0; i--) {
    if (sets[i].reps === 1) return [...sets.slice(0, i), ...sets.slice(i + 1)]
  }
  return sets
}

// Build the warmup ladder for a top set. Returns [{ kg, reps, pct, label, restSec }]
// lightest first, top set excluded. label is 'Empty bar' | 'Bodyweight' | null.
export function buildWarmup({ exerciseId, topKg, topReps, rpe = null, addedKg = 0, config = {} } = {}) {
  const cfg = { ...DEFAULT_WARMUP_CONFIG, ...(config || {}) }
  const top = Number(topKg)
  const reps = Number(topReps)
  if (!Number.isFinite(reps) || reps < 1) return []
  const kind = resolveKind(exerciseId)
  const tired = reps >= 10 || (rpe != null && Number(rpe) >= 9)
  const rounding = Number(cfg.roundingKg) > 0 ? Number(cfg.roundingKg) : 2.5
  const bar = Number(cfg.barKg) > 0 ? Number(cfg.barKg) : 20

  // Bodyweight tops are bodyweight itself — there is no plate to validate.
  if (isBodyweightKind(kind)) return bodyweightLadder({ addedKg, tired, rounding, style: cfg.style })
  if (!Number.isFinite(top) || top <= 0) return []

  const ladder = LADDER[kind] || LADDER.generic
  // Only an advanced lifter going heavy (triples or less) is allowed past 90 %.
  const maxPct = cfg.experience === 'advanced' && reps <= 3 ? 0.92 : 0.90
  // OHP moves in small plates — never round coarser than 1.25 there.
  const step = kind === 'ohp' ? Math.min(rounding, 1.25) : rounding
  const singles = kind === 'deadlift' && cfg.deadliftMode === 'singles'

  let sets = ladder.map(([frac, n, rest]) => {
    if (frac === 'bar') {
      return { kg: bar, reps: n, pct: Math.round((bar / top) * 100), label: 'Empty bar', restSec: paceRest(rest, cfg.style) }
    }
    const pct = Math.min(frac, maxPct)
    let kg = Math.round(roundTo(pct * top, step) * 100) / 100
    if (kind === 'deadlift') {
      kg = Math.max(rounding, kg)
      if (frac === 0.40) kg = Math.max(60, kg)   // the opener never goes below 60
    } else {
      kg = Math.max(bar, kg)
    }
    let r = n
    if (singles && frac === 0.75) r = 1          // singles mode: no rep-out before the top
    const lastRest = kind === 'deadlift' && frac === 0.87 ? (singles ? 240 : 180) : rest
    return { kg, reps: r, pct: Math.round(pct * 100), label: null, restSec: paceRest(lastRest, cfg.style) }
  })

  // A warmup plate at or above the top set is not a warmup.
  sets = sets.filter(s => s.kg < top)
  sets = dedupKg(sets)
  if (tired) sets = dropHeaviestSingle(sets)
  // Below 30 kg there is no room for a ladder — bar plus one step is plenty.
  if (top < 30) sets = sets.slice(0, 2)
  return sets
}

// Bodyweight branch (pull-ups, dips): `addedKg` is the belt load on the top set.
// Unweighted work is just two bodyweight sets; weighted work climbs 50 % / 75 %
// of the added load before the top.
function bodyweightLadder({ addedKg, tired, rounding, style }) {
  const added = Number(addedKg) || 0
  const sets = [{ kg: 0, reps: 6, pct: 0, label: 'Bodyweight', restSec: paceRest(60, style) }]
  if (added <= 0) {
    sets.push({ kg: 0, reps: 3, pct: 0, label: 'Bodyweight', restSec: paceRest(90, style) })
    return sets
  }
  let mid = Math.round(roundTo(0.5 * added, rounding) * 100) / 100
  let single = Math.round(roundTo(0.75 * added, rounding) * 100) / 100
  mid = Math.max(rounding, mid)
  single = Math.max(rounding, single)
  let sets2 = [
    ...sets,
    { kg: mid, reps: 3, pct: 50, label: null, restSec: paceRest(90, style) },
    { kg: single, reps: 1, pct: 75, label: null, restSec: paceRest(120, style) },
  ]
  sets2 = sets2.filter(s => s.kg < added)
  sets2 = dedupKg(sets2)
  if (tired) sets2 = dropHeaviestSingle(sets2)
  return sets2
}
