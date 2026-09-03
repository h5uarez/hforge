// Warmup (aproximaciones) ladder builder — a small expert system.
//
// Given the planned top set (weight × reps, optional RPE and added load for
// bodyweight work) this returns the warmup sets leading into it, heaviest last.
// The top set itself is never included: the caller renders it separately.
//
// Barbell ladders are generative, not fixed: per-lift target percentages grow a
// candidate ladder capped by a last-rung ceiling derived from the top-set reps
// (plus experience and fatigue), trimmed to a top-weight budget that keeps the
// heaviest rungs, then refined so no jump between neighbours exceeds the
// per-lift capped-jump table (a midpoint rung is inserted instead) and no two
// rungs sit closer than the minimum separation. Reps taper as the ladder
// approaches the top; rests follow the reps. Pace (style) stretches or
// compresses rests, widens/narrows the jump caps and adds/removes one rung.
//
// Bodyweight work (pull-ups, dips) is NOT generative: it still climbs a fixed
// 50 % / 75 % of the belt load (limitation — see bodyweightLadder).
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

// Generative targets: fractions of the top set each family climbs through. The
// last-rung ceiling (lastPct) decides which of these survive; the ceiling
// itself is always forced in as the final rung.
const TARGETS = {
  bench: [0.40, 0.55, 0.70, 0.80, 0.88, 0.93],
  squat: [0.40, 0.55, 0.70, 0.80, 0.88, 0.92],
  deadlift: [0.40, 0.55, 0.70, 0.82, 0.92],
  ohp: [0.40, 0.55, 0.70, 0.80, 0.88],
}
TARGETS.generic = TARGETS.bench

// Capped-jump table per family: [earlyCap, midCap, lateCap]. A gap whose
// heavier rung sits at pct <= 0.60 allows earlyCap, <= 0.80 midCap, else
// lateCap. The gap out of the empty-bar opener is exempt — the bar is where it
// is, and no midpoint can fix 20 kg to a first plate.
const CAPS = {
  bench: [25, 20, 15],
  squat: [30, 25, 15],
  deadlift: [40, 30, 20],
  ohp: [10, 7.5, 5],
}
CAPS.generic = CAPS.bench

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
// than re-computing anything. Only the (fixed) bodyweight branch still uses
// this; barbell ladders fold fatigue into the last-rung ceiling instead.
const dropHeaviestSingle = sets => {
  for (let i = sets.length - 1; i >= 0; i--) {
    if (sets[i].reps === 1) return [...sets.slice(0, i), ...sets.slice(i + 1)]
  }
  return sets
}

// Last-rung ceiling as a fraction of the top set. Heavy singles earn a runway
// into the low 90s; high-rep tops stop in the 70s because the top set itself
// is the stimulus. Advanced lifters get a point more, beginners two points
// less, grinding/tired lifters five points less, and high-rep deadlifts two
// points less (the lower back does not need a near-max primer before a set of
// five). Clamped to [0.70, 0.93] so the ladder always ends near, never on, the top.
//
// NOTE (RPE decimals): the fatigue guard below is a cliff at 9.0 — Number(rpe)
// keeps decimals (never parseInt here), but 7 vs 7.5 build the same ladder by
// design; only crossing 9.0 (e.g. 8.9 vs 9.0) changes the ceiling. Deliberate:
// RPE noise below the grind threshold must not reshuffle plates.
const computeLastPct = ({ reps, rpe, experience, kind }) => {
  let p = reps <= 1 ? 0.92 : reps <= 3 ? 0.90 : reps <= 6 ? 0.83 : reps <= 10 ? 0.78 : 0.70
  if (experience === 'advanced') p += 0.01
  else if (experience === 'beginner') p -= 0.02
  if (reps >= 10 || (rpe != null && Number(rpe) >= 9)) p -= 0.05
  if (kind === 'deadlift' && reps >= 5) p -= 0.02
  return Math.min(0.93, Math.max(0.70, p))
}

// How many total sets (opener included) the ladder may hold. Heavier tops earn
// a longer runway; deadlifts and presses never need more than six rungs.
// Conservative pace adds one rung, aggressive removes one (never below three).
const budgetFor = (top, kind, style) => {
  let b = top < 60 ? 3 : top <= 100 ? 5 : top <= 140 ? 6 : top <= 180 ? 7 : 8
  if (kind === 'deadlift' || kind === 'ohp') b = Math.min(b, 6)
  if (style === 'conservative') b += 1
  else if (style === 'aggressive') b = Math.max(3, b - 1)
  return b
}

// Jump cap for a gap by the heavier rung's share of the top, scaled by pace
// (conservative tightens, aggressive loosens).
const maxJumpFor = (pctHeavy, caps, style) => {
  const base = pctHeavy <= 0.60 ? caps[0] : pctHeavy <= 0.80 ? caps[1] : caps[2]
  const scale = style === 'conservative' ? 0.8 : style === 'aggressive' ? 1.25 : 1
  return base * scale
}

// Reps taper toward the top. Deadlifts run leaner (fives never repeat past the
// opener); a top single — or a deadlift in singles mode — turns everything
// past 75 % into singles so the primer never becomes the workout.
const repsFor = (pct, { kind, topReps, singles }) => {
  let r
  if (pct <= 0.50) r = 5
  else if (pct <= 0.65) r = kind === 'deadlift' ? 3 : 5
  else if (pct <= 0.80) r = kind === 'deadlift' ? 2 : 3
  else if (pct <= 0.88) r = (kind === 'deadlift' || topReps === 1 || singles) ? 1 : 2
  else r = 1
  if (pct > 0.75 && (topReps === 1 || singles)) r = 1
  return r
}

// Rests follow the reps: touch-and-go early, full recovery on the last single.
// A deadlift single at the top of a singles-mode ladder earns extra rest.
const restFor = (reps, { kind, isLast, singles }) => {
  if (kind === 'deadlift' && isLast && reps === 1) return singles ? 240 : 180
  if (reps >= 8) return 60
  if (reps === 5) return 90
  if (reps === 3) return 120
  if (reps === 2) return 150
  return 180
}

// Build the warmup ladder for a top set. Returns [{ kg, reps, pct, label, restSec }]
// lightest first, top set excluded. label is 'Empty bar' | 'Bodyweight' | null.
export function buildWarmup({ exerciseId, topKg, topReps, rpe = null, addedKg = 0, config = {} } = {}) {
  const cfg = { ...DEFAULT_WARMUP_CONFIG, ...(config || {}) }
  const top = Number(topKg)
  const reps = Number(topReps)
  if (!Number.isFinite(reps) || reps < 1) return []
  const kind = resolveKind(exerciseId)
  // Same >= 9 cliff as computeLastPct: RPE decimals below 9.0 are identical by design.
  const tired = reps >= 10 || (rpe != null && Number(rpe) >= 9)
  const rounding = Number(cfg.roundingKg) > 0 ? Number(cfg.roundingKg) : 2.5
  const bar = Number(cfg.barKg) > 0 ? Number(cfg.barKg) : 20

  // Bodyweight tops are bodyweight itself — there is no plate to validate.
  if (isBodyweightKind(kind)) return bodyweightLadder({ addedKg, tired, rounding, style: cfg.style })
  if (!Number.isFinite(top) || top <= 0) return []

  const isDL = kind === 'deadlift'
  // OHP moves in small plates — never round coarser than 1.25 there — and its
  // rungs may sit closer together than a full plate pair allows.
  const step = kind === 'ohp' ? Math.min(rounding, 1.25) : rounding
  const minSep = kind === 'ohp' ? 2.5 : 5
  const targets = TARGETS[kind] || TARGETS.generic
  const caps = CAPS[kind] || CAPS.generic
  const singles = isDL && cfg.deadliftMode === 'singles'
  const lastPct = computeLastPct({ reps, rpe, experience: cfg.experience, kind })
  const roundKg = x => Math.round(roundTo(x, step) * 100) / 100

  // The opener: an empty bar everywhere but the deadlift, which starts at
  // max(60, 40 %) so nobody is told to pull an empty bar off the floor.
  let opener = null
  if (!isDL) {
    if (!(bar < top)) return []
    opener = { kg: bar, pct: bar / top, isOpener: true }
  }

  // Candidates: targets up to the ceiling, with the ceiling itself forced in
  // as the final rung. High-rep tops (8+) never prescribe past 85 %.
  let pts = targets.filter(p => p <= lastPct + 1e-9)
  if (reps >= 8) pts = pts.filter(p => p <= 0.85 + 1e-9)
  if (!pts.some(p => Math.abs(p - lastPct) < 1e-9)) pts = [...pts, lastPct]

  let kgs = pts.map(p => ({ kg: roundKg(p * top), pct: p }))
  if (isDL && kgs.length) kgs[0].kg = Math.max(60, kgs[0].kg)
  kgs = kgs.filter(k => k.kg < top && k.kg >= bar + minSep)
  kgs.sort((a, b) => a.kg - b.kg)
  // Same rounded kilos from two different rungs: keep the heavier rung.
  kgs = kgs.filter((k, i, arr) => i === arr.length - 1 || arr[i + 1].kg !== k.kg)

  // Cap to the ceiling: drop anything rounding pushed past it, then force the
  // exact lastPct rung (stepping down while it would touch the top set).
  let lastKg = roundKg(lastPct * top)
  let guardKg = 0
  while (lastKg >= top && guardKg < 10) { lastKg = Math.round((lastKg - step) * 100) / 100; guardKg++ }
  kgs = kgs.filter(k => k.kg <= lastKg + 1e-9)
  const floorKg = isDL ? 60 : bar + minSep
  if ((kgs.length === 0 || kgs[kgs.length - 1].kg !== lastKg) && lastKg < top && lastKg >= floorKg) {
    kgs.push({ kg: lastKg, pct: lastPct })
  }

  // Budget trim: keep the heaviest rungs, never the lightest. slice(-n) keeps
  // the runway into the top; slice(0, n) would keep the warmup and drop the
  // part that matters.
  const budget = budgetFor(top, kind, cfg.style)
  const maxCand = Math.max(1, budget - (opener ? 1 : 0))
  if (kgs.length > maxCand) kgs = kgs.slice(-maxCand)

  // Assemble lightest-first, then refine to a fixpoint: insert a rounded
  // midpoint wherever a jump exceeds the cap (the opener gap is exempt by
  // design), and collapse rungs closer than minSep into the heavier one (the
  // bar opener anchors — it is never dropped). Insertion can crowd a gap and
  // collapse can re-open one, so both passes repeat until stable.
  let full = opener ? [opener, ...kgs] : [...kgs]
  const insertPass = arr => {
    let added = false
    for (let i = 1; i < arr.length;) {
      const a = arr[i - 1]
      const b = arr[i]
      if (a.isOpener) { i++; continue }
      const cap = maxJumpFor(b.kg / top, caps, cfg.style)
      const gap = Math.round((b.kg - a.kg) * 100) / 100
      if (gap <= cap + 1e-9) { i++; continue }
      const mid = roundKg((a.kg + b.kg) / 2)
      if (!(mid > a.kg && mid < b.kg) || mid - a.kg < minSep - 1e-9 || b.kg - mid < minSep - 1e-9) { i++; continue }
      arr.splice(i, 0, { kg: mid, pct: mid / top })
      added = true
    }
    return added
  }
  const collapsePass = arr => {
    const out = [...arr]
    let removed = false
    for (let i = out.length - 1; i >= 1; i--) {
      if (out[i].kg - out[i - 1].kg < minSep - 1e-9) {
        out.splice(out[i - 1].isOpener ? i : i - 1, 1)
        removed = true
      }
    }
    return { out, removed }
  }
  for (let pass = 0; pass < 5; pass++) {
    const added = insertPass(full)
    const collapsed = collapsePass(full)
    full = collapsed.out
    if (!added && !collapsed.removed) break
  }

  // Reps taper, rests follow, light tops keep the heavy end.
  const sets = full.map((r, idx) => {
    const isLast = idx === full.length - 1
    if (r.isOpener) {
      return { kg: r.kg, reps: kind === 'squat' ? 8 : 10, pct: Math.round((r.kg / top) * 100), label: 'Empty bar', restSec: paceRest(60, cfg.style) }
    }
    const pct = r.kg / top
    const n = repsFor(pct, { kind, topReps: reps, singles })
    return { kg: r.kg, reps: n, pct: Math.round(pct * 100), label: null, restSec: paceRest(restFor(n, { kind, isLast, singles }), cfg.style) }
  })
  // Below 30 kg there is no room for a ladder — bar plus one heavy step; below
  // 60 just the heavy end. Always slice(-n): the top of the ladder matters.
  if (top < 30) return sets.slice(-2)
  if (top < 60) return sets.slice(-3)
  return sets
}

// Bodyweight branch (pull-ups, dips): `addedKg` is the belt load on the top set.
// Unweighted work is just two bodyweight sets; weighted work climbs 50 % / 75 %
// of the added load before the top.
//
// LIMITATION: this branch is still a fixed ladder — it does not use the
// generative capped-jump pipeline above (no jump caps, no budget, no rep
// taper). Good enough because belt loads are small and plates are coarse, but
// a heavy belt (+40 kg and up) can still show a jumpy second step.
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
