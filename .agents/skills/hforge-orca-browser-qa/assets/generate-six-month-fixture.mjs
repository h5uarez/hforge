#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'

const FIXTURE_ID = 'hforge-six-month-2026-09-07-v1'
const WEEK_COUNT = 26
const END_DATE = '2026-09-07'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const routineSpecs = [
  {
    id: 'routine-push-fixed', name: 'Push Day', emoji: 'barbell',
    exercises: [['0025', 4, 8, 70, 2.5], ['0047', 3, 10, 42.5, 2.5], ['0426', 3, 10, 30, 2.5], ['0334', 3, 12, 25, 2.5]],
  },
  {
    id: 'routine-pull-fixed', name: 'Pull Day', emoji: 'pullup',
    exercises: [['2330', 4, 10, 65, 2.5], ['0027', 4, 8, 55, 2.5], ['1323', 3, 10, 40, 2.5], ['0031', 3, 10, 35, 2.5]],
  },
  {
    id: 'routine-legs-fixed', name: 'Leg Day', emoji: 'legs',
    exercises: [['0043', 4, 8, 90, 5], ['0085', 3, 10, 70, 5], ['0739', 3, 12, 55, 2.5], ['0585', 3, 12, 45, 2.5]],
  },
]

const roundToHalf = value => Math.round(value * 2) / 2
const dateForWeek = index => {
  const end = Date.UTC(2026, 8, 7)
  return new Date(end - (WEEK_COUNT - 1 - index) * WEEK_MS).toISOString().slice(0, 10)
}
const epochFor = (date, hour, minute) => Date.UTC(
  Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hour, minute,
)
const dateAfter = (date, days) => new Date(epochFor(date, 0, 0) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

const routines = routineSpecs.map(({ id, name, emoji, exercises }) => ({
  id, name, emoji,
  ex: exercises.map(([exerciseId, sets, reps]) => ({ id: exerciseId, sets, reps, weight: 0 })),
}))

const workoutDates = Array.from({ length: WEEK_COUNT }, (_, index) => dateForWeek(index))
const workouts = workoutDates.map((date, weekIndex) => {
  const routineIndex = weekIndex % routines.length
  const spec = routineSpecs[routineIndex]
  const cycle = Math.floor(weekIndex / routines.length)
  const start = epochFor(date, 18, 15)
  const entries = spec.exercises.map(([exerciseId, targetSets, targetReps, baseWeight, increment], exerciseIndex) => {
    const topW = roundToHalf(baseWeight + cycle * increment * 2 + (weekIndex % 2) * increment)
    const sets = Array.from({ length: targetSets }, (_, setIndex) => {
      const rir = Math.max(0, 3 - ((setIndex + weekIndex + exerciseIndex) % 4))
      const rpe = 10 - rir
      return { w: topW, r: targetReps, rir, rpe, done: true }
    })
    return { id: exerciseId, target: { id: exerciseId, sets: targetSets, reps: targetReps, weight: 0 }, topW, sets }
  })
  return {
    id: `fixture-workout-${String(weekIndex + 1).padStart(2, '0')}`,
    d: date,
    start,
    end: start + (52 + weekIndex) * 60_000,
    routineId: spec.id,
    name: spec.name,
    bw: roundToHalf(82 - weekIndex * 0.12),
    entries,
    prs: weekIndex > 0 && weekIndex % 3 === 0 ? [entries[0].id] : [],
    vol: entries.reduce((total, entry) => total + entry.sets.reduce((sum, set) => sum + set.w * set.r, 0), 0),
  }
})

const bodyweight = workoutDates.flatMap((date, weekIndex) => [
  { id: `fixture-bodyweight-${String(weekIndex * 2 + 1).padStart(2, '0')}`, d: date, w: roundToHalf(82 - weekIndex * 0.12), t: epochFor(date, 7, 30) },
  { id: `fixture-bodyweight-${String(weekIndex * 2 + 2).padStart(2, '0')}`, d: dateAfter(date, 3), w: roundToHalf(81.8 - weekIndex * 0.12), t: epochFor(dateAfter(date, 3), 7, 30) },
])

const exWeights = Object.fromEntries(routineSpecs.flatMap(spec => spec.exercises.map(([id, , , baseWeight, increment]) => [
  id, { w: roundToHalf(baseWeight + Math.floor((WEEK_COUNT - 1) / routines.length) * increment * 2), d: END_DATE },
])))

const emptyState = {
  lang: 'en', theme: 'light', accent: 'default', unit: 'kg', body: 'male',
  routines: [], week: {}, dayPlan: {}, workouts: [], bodyweight: [], exWeights: {},
  active: null, customEx: [], restSec: 90, restTimerEnabled: true, sound: false,
  keepAwake: false, targetW: null, effort: 'rir', home1rmCardEnabled: true, homeWarmupCardEnabled: true,
}

const payload = {
  ...emptyState,
  routines,
  week: { 1: routines[0].id, 3: routines[1].id, 5: routines[2].id },
  workouts,
  bodyweight,
  exWeights,
  fixtureMeta: {
    id: FIXTURE_ID,
    schemaVersion: 1,
    weeks: WEEK_COUNT,
    workoutCount: workouts.length,
    weekStart: workoutDates[0],
    weekEnd: END_DATE,
    deterministic: true,
  },
}

const parseOutput = argv => {
  if (argv.length === 0) return null
  if (argv.length === 2 && argv[0] === '--output' && argv[1]) return argv[1]
  throw new Error('Usage: node generate-six-month-fixture.mjs [--output <path>]')
}

const main = async () => {
  const output = parseOutput(process.argv.slice(2))
  const json = JSON.stringify(payload, null, 2) + '\n'
  if (output) await writeFile(output, json, 'utf8')
  else process.stdout.write(json)
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
