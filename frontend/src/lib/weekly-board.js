// Weekly Decision Board (v1) — pure logic.
//
// Answers "how is my training going this week and what should I look at?"
// from data the app already records. No new tracking, no new science:
// every number below is a description of logged sets, nothing prescriptive.
//
// Architecture note for the stall/deload follow-up: rule evaluation lives in
// `evaluateBoardRules(board)` at the bottom of this file. v1 ships with no
// rules registered (RULES = []), so the board only describes. The next task
// adds detectors by appending `{ id, run }` entries to RULES — board shape,
// tiles and tests stay untouched. See the RULES comment for the contract.

import { todayISO, isoOf, weekKey } from './format.js'
import { effectiveRoutineId, setsDone, workoutVolume, projectSideSet } from './history.js'
import { loadOfWorkouts, rankOf, MUSCLES, MUSCLE_NAME } from './muscles.js'
import { bestSetOf, e1rmSeries } from './onerm.js'

// Monday..Sunday ISO days containing `refISO`.
export function weekDays(refISO) {
  const ref = new Date(refISO + 'T12:00:00')
  const monday = new Date(ref)
  monday.setDate(ref.getDate() - ((ref.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return isoOf(d)
  })
}

// The 7 ISO days of the week before the one containing `refISO`.
export function prevWeekDays(refISO) {
  const days = weekDays(refISO)
  return days.map(iso => {
    const d = new Date(iso + 'T12:00:00')
    d.setDate(d.getDate() - 7)
    return isoOf(d)
  })
}

const inDays = (days) => {
  const set = new Set(days)
  return (w) => set.has(w.d)
}

// Comparison of two numbers. `pct` is null when there is no base to compare
// against (previous was 0) — callers render the raw diff instead of a %.
export function delta(cur, prev) {
  const a = Number(cur) || 0
  const b = Number(prev) || 0
  const diff = Math.round((a - b) * 10) / 10
  return { cur: a, prev: b, diff, pct: b !== 0 ? Math.round((diff / Math.abs(b)) * 1000) / 10 : null }
}

export const fmtPct = (pct) =>
  pct == null ? null : (pct > 0 ? '+' : '') + (Math.round(pct * 10) / 10) + '%'

// "12 sets · +8% vs prev week" style context — never a bare number.
// `unit` is appended to cur/diff when given (e.g. 'kg', 'min').
export function ctxLine(cur, prev, unit) {
  const d = delta(cur, prev)
  const u = unit ? ' ' + unit : ''
  const pct = fmtPct(d.pct)
  if (d.prev === 0 && d.cur === 0) return '—'
  if (d.prev === 0) return `${d.cur}${u} · new vs prev week`
  const sign = d.diff > 0 ? '+' : ''
  return `${d.cur}${u} · ${sign}${d.diff}${u} (${pct} vs prev week)`
}

// Best estimated-1RM achieved per exercise inside a set of workouts,
// keyed by exercise id: { est, w, r, d }.
function bestEstIn(exIds, workouts) {
  const best = {}
  workouts.forEach((w) => {
    ;(w.entries || []).forEach((en) => {
      if (!exIds.has(en.id)) return
      const b = bestSetOf(en)
      if (b && (!best[en.id] || b.est > best[en.id].est)) best[en.id] = { ...b, d: w.d }
    })
  })
  return best
}

function avg(nums) {
  const xs = nums.filter((v) => typeof v === 'number' && Number.isFinite(v))
  if (!xs.length) return null
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
}

export function buildWeeklyBoard(S, refISO) {
  const ref = refISO || todayISO()
  const days = weekDays(ref)
  const pdays = prevWeekDays(ref)
  const wk = weekKey(days[0])
  const matchCur = inDays(days)
  const matchPrev = inDays(pdays)
  const cur = (S.workouts || []).filter(matchCur)
  const prev = (S.workouts || []).filter(matchPrev)

  // ---- Adherence: distinct trained days vs planned days ----
  // Several workouts on the same day (multi-workout support) count every set
  // for volume but a single day for adherence — compliance answers "did I show
  // up", not "how many sessions did I split it into".
  const plannedDays = days.filter((iso) => effectiveRoutineId(S, iso) != null)
  const doneDays = [...new Set(cur.map((w) => w.d))].sort()
  const donePlanned = doneDays.filter((iso) => effectiveRoutineId(S, iso) != null)
  const planned = plannedDays.length
  const done = doneDays.length
  const pending = Math.max(0, planned - donePlanned.length)
  const compliance = planned > 0 ? Math.min(1, Math.round((donePlanned.length / planned) * 1000) / 1000) : done > 0 ? 1 : null
  const adherence = {
    done, planned, pending, compliance,
    extra: Math.max(0, done - donePlanned.length), // trained on unplanned days
    days: doneDays,
    ctx: planned > 0
      ? `${donePlanned.length}/${planned} planned days · ${Math.round(((compliance ?? 0)) * 100)}%`
      : done > 0 ? `${done} trained day${done === 1 ? '' : 's'} · no plan set` : 'no plan, no workouts',
  }

  // ---- Useful volume: effective sets per muscle, this week vs last ----
  const loadCur = loadOfWorkouts(cur)
  const loadPrev = loadOfWorkouts(prev)
  const { worked, missed } = rankOf(loadCur)
  const totalSets = cur.reduce((a, w) => a + setsDone(w), 0)
  const totalSetsPrev = prev.reduce((a, w) => a + setsDone(w), 0)
  // Gaps are descriptive, not prescriptive: muscles trained last week (or in
  // the plan) that got nothing this week. Muscles never trained anywhere are
  // listed separately so a new profile does not read as "everything is a gap".
  const gaps = MUSCLES.filter((m) => !(loadCur[m] > 0) && loadPrev[m] > 0)
  const top = worked.slice(0, 4).map((m) => ({
    muscle: m,
    name: MUSCLE_NAME[m],
    sets: Math.round((loadCur[m] || 0) * 10) / 10,
    prev: Math.round((loadPrev[m] || 0) * 10) / 10,
  }))
  const volume = {
    totalSets,
    top,
    gaps,
    missed,
    ctx: ctxLine(totalSets, totalSetsPrev, 'sets'),
  }

  // ---- Performance: e1RM movers this week vs previous best ----
  // Compares each exercised lift's best estimate inside the week against its
  // best estimate the week before (falling back to the latest estimate before
  // the week, so a lift trained fortnightly still compares against something
  // real). Lifts with no earlier estimate are 'new', never 'up'.
  const exIds = new Set(cur.flatMap((w) => (w.entries || []).map((e) => e.id)))
  const curBest = bestEstIn(exIds, cur)
  const prevBest = bestEstIn(exIds, prev)
  const seriesCache = {}
  const perf = { up: [], flat: [], down: [], fresh: [] }
  exIds.forEach((id) => {
    const now = curBest[id]
    if (!now) return
    let was = prevBest[id] ? prevBest[id].est : null
    let wasLabel = prevBest[id] ? 'prev week' : null
    if (was == null) {
      if (!seriesCache[id]) seriesCache[id] = e1rmSeries(S, id)
      const before = seriesCache[id].filter((p) => p.d < days[0])
      if (before.length) {
        was = Math.max(...before.map((p) => p.y))
        wasLabel = 'previous best'
      }
    }
    const row = { id, est: now.est, w: now.w, r: now.r, d: now.d, prev: was, prevLabel: wasLabel, diff: was != null ? Math.round((now.est - was) * 10) / 10 : null }
    if (was == null) perf.fresh.push(row)
    else if (row.diff > 0) perf.up.push(row)
    else if (row.diff < 0) perf.down.push(row)
    else perf.flat.push(row)
  })
  ;['up', 'flat', 'down', 'fresh'].forEach((k) => perf[k].sort((a, b) => Math.abs(b.diff || 0) - Math.abs(a.diff || 0)))
  const tracked = perf.up.length + perf.flat.length + perf.down.length + perf.fresh.length
  const performance = {
    ...perf,
    tracked,
    ctx: tracked === 0
      ? 'no measurable lifts this week'
      : `${perf.up.length} up · ${perf.flat.length} holding · ${perf.down.length} down${perf.fresh.length ? ` · ${perf.fresh.length} new` : ''}`,
  }

  // ---- Weekly load: sets, tonnage, time trained, each vs prev week ----
  const tonnage = cur.reduce((a, w) => a + workoutVolume(w), 0)
  const tonnagePrev = prev.reduce((a, w) => a + workoutVolume(w), 0)
  const minutes = cur.reduce((a, w) => a + Math.max(0, ((w.end || w.start || 0) - (w.start || 0)) / 60000), 0)
  const minutesPrev = prev.reduce((a, w) => a + Math.max(0, ((w.end || w.start || 0) - (w.start || 0)) / 60000), 0)
  const load = {
    sets: delta(totalSets, totalSetsPrev),
    tonnage: delta(Math.round(tonnage * 10) / 10, Math.round(tonnagePrev * 10) / 10),
    minutes: delta(Math.round(minutes), Math.round(minutesPrev)),
    workouts: delta(cur.length, prev.length),
    ctxSets: ctxLine(totalSets, totalSetsPrev, 'sets'),
  }

  // ---- Body weight: trend when there are entries, held next to load ----
  // Informative pairing only ("tonnage moved X while weight moved Y") — the
  // board never claims one caused the other.
  const bwCur = (S.bodyweight || []).filter((b) => b.d >= days[0] && b.d <= days[6])
  const bwPrev = (S.bodyweight || []).filter((b) => b.d >= pdays[0] && b.d <= pdays[6])
  const avgCur = avg(bwCur.map((b) => b.w))
  const avgPrev = avg(bwPrev.map((b) => b.w))
  const bwDelta = avgCur != null && avgPrev != null ? Math.round((avgCur - avgPrev) * 10) / 10 : null
  const lastCur = bwCur.length ? bwCur[bwCur.length - 1].w : null
  const body = {
    entries: bwCur.length,
    avg: avgCur,
    prevAvg: avgPrev,
    delta: bwDelta,
    last: lastCur,
    target: S.targetW ?? null,
    ctx: avgCur == null
      ? 'no weigh-ins this week'
      : bwDelta == null
        ? `avg ${avgCur} · no prev-week baseline`
        : `avg ${avgCur} · ${bwDelta > 0 ? '+' : ''}${bwDelta} vs prev week`,
  }

  const hasData = cur.length > 0 || planned > 0 || bwCur.length > 0
  const board = { week: wk, ref, days, prevDays: pdays, current: cur, previous: prev, adherence, volume, performance, load, body, hasData }
  board.rules = evaluateBoardRules(board)
  return board
}

/* ============================================================
   Rule slots for the stall/deload follow-up (NOT implemented here).
   ------------------------------------------------------------
   Contract: each rule is `{ id, run }` where `run(board)` returns
   `null` (no signal) or `{ level: 'info'|'watch', text }` — text is a
   plain-English observation, never a prescription ("3 lifts down two
   weeks running", not "deload now"). Rules are read-only over the
   board; they never mutate it. v1 registers none, so `board.rules`
   is always `[]` until the next task appends detectors here.
   ============================================================ */
export const RULES = []

export function evaluateBoardRules(board) {
  const out = []
  for (const rule of RULES) {
    try {
      const hit = rule.run(board)
      if (hit) out.push({ id: rule.id, ...hit })
    } catch {
      // A rule must never break the board — a throwing detector is skipped.
    }
  }
  return out
}

// Project a unilateral set the same way history does, for tests/consumers
// that build fixtures with side-aware sets.
export { projectSideSet }
