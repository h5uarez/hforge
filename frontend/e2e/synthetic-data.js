export const FIXED_NOW = new Date('2026-09-11T12:00:00.000Z').getTime()

const routines = [
  { id: 'routine-push', name: 'Push Day', emoji: 'barbell', ex: [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10]].map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) },
  { id: 'routine-pull', name: 'Pull Day', emoji: 'pullup', ex: [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10]].map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) },
  { id: 'routine-legs', name: 'Leg Day', emoji: 'legs', ex: [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12]].map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) },
]

const workoutDates = ['2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']
const workouts = workoutDates.map((d, index) => {
  const routine = routines[index % routines.length]
  const start = new Date(`${d}T18:15:00.000Z`).getTime()
  const entries = routine.ex.map((target, exerciseIndex) => ({
    id: target.id,
    target,
    topW: 45 + index * 2.5 + exerciseIndex * 5,
    sets: Array.from({ length: target.sets }, (_, setIndex) => ({
      w: 45 + index * 2.5 + exerciseIndex * 5,
      r: Math.max(5, target.reps - (setIndex === target.sets - 1 ? 1 : 0)),
      rir: Math.max(0, 3 - (setIndex % 3)),
      done: true,
    })),
  }))
  return {
    id: `browser-workout-${index}`,
    d,
    start,
    end: start + (52 + index) * 60_000,
    routineId: routine.id,
    name: routine.name,
    bw: 81.5 - index * 0.25,
    entries,
    prs: index ? [routine.ex[0].id] : [],
    vol: entries.reduce((sum, entry) => sum + entry.sets.reduce((total, set) => total + set.w * set.r, 0), 0),
  }
})

const bodyweight = workoutDates.flatMap((d, index) => [
  { d, w: Math.round((81.8 - index * 0.28) * 10) / 10, t: new Date(`${d}T07:30:00.000Z`).getTime() },
  { d: new Date(new Date(`${d}T12:00:00.000Z`).getTime() + 3 * 86400000).toISOString().slice(0, 10), w: Math.round((81.6 - index * 0.28) * 10) / 10, t: new Date(`${d}T07:30:00.000Z`).getTime() + 3 * 86400000 },
])

export const emptyState = {
  lang: 'en', theme: 'dark', accent: 'lime', unit: 'kg', body: 'male',
  routines: [], week: {}, dayPlan: {}, workouts: [], bodyweight: [], exWeights: {},
  active: null, customEx: [], restSec: 90, restTimerEnabled: true, sound: false,
  keepAwake: false, targetW: null, effort: 'none',
}

export const richState = {
  ...emptyState,
  routines,
  week: { 1: routines[0].id, 3: routines[1].id, 5: routines[2].id },
  workouts,
  bodyweight,
  exWeights: Object.fromEntries(routines.flatMap(routine => routine.ex.map((exercise, index) => [exercise.id, { w: 70 + index * 5, d: '2026-09-07' }]))),
  targetW: 77,
  effort: 'rir',
  sound: false,
  keepAwake: false,
  home1rmCardEnabled: true,
  homeWarmupCardEnabled: true,
}

const activeRoutine = richState.routines[0]
export const activeState = {
  ...richState,
  active: {
    id: 'browser-active-workout',
    d: '2026-09-11',
    start: FIXED_NOW - 20 * 60_000,
    lastRecordEditAt: FIXED_NOW - 30_000,
    inactivityReminderSent: false,
    routineId: activeRoutine.id,
    name: activeRoutine.name,
    bw: 78.3,
    cur: 0,
    entries: activeRoutine.ex.slice(0, 2).map((target, entryIndex) => ({
      id: target.id,
      sid: `browser-entry-${entryIndex}`,
      target: { ...target, planNote: entryIndex === 0 ? 'Controlled tempo and full range.' : undefined },
      plan: null,
      note: entryIndex === 0 ? 'Keep shoulders set.' : '',
      sets: Array.from({ length: target.sets || 3 }, (_, setIndex) => ({
        w: entryIndex === 0 ? 72.5 : 50,
        r: target.reps || 10,
        rir: 2,
        done: setIndex === 0,
      })),
    })),
  },
}
