import { pathToFileURL } from 'node:url'
import { EXDB } from '../src/lib/exercises-data.js'
import { EXERCISE_NAMES_ES } from '../src/lib/exercise-names.es.js'

const FAMILY_ORDER = [
  'strength-barbell-dumbbell',
  'strength-cable-machine',
  'calisthenics',
  'cardio-plyometrics',
  'mobility-stretching',
  'weightlifting-kettlebell',
  'rehabilitation-assisted',
]

export function exerciseNameFamily(ex) {
  const name = ex.n.toLowerCase()
  if (/stretch|mobility|rotation|circle/.test(name)) return 'mobility-stretching'
  if (/assisted|rehab|band/.test(name) || ['assisted', 'band'].includes(ex.eq)) return 'rehabilitation-assisted'
  if (/kettlebell|clean|snatch|jerk|turkish|get-up|swing/.test(name)) return 'weightlifting-kettlebell'
  if (ex.bp === 'cardio' || /jump|hop|sprint|run|walk|burpee/.test(name)) return 'cardio-plyometrics'
  if (['body weight', 'weighted'].includes(ex.eq)) return 'calisthenics'
  if (['cable', 'leverage machine', 'smith machine', 'sled machine'].includes(ex.eq)) return 'strength-cable-machine'
  return 'strength-barbell-dumbbell'
}

export function stratifiedExerciseNameSample(catalog = EXDB) {
  const grouped = Object.fromEntries(FAMILY_ORDER.map(family => [family, []]))
  catalog.forEach(ex => grouped[exerciseNameFamily(ex)].push(ex))
  return FAMILY_ORDER.flatMap(family => {
    const records = grouped[family]
    const indexes = [...new Set([0, Math.floor((records.length - 1) / 2), records.length - 1])]
    return indexes.map(index => {
      const ex = records[index]
      return { family, zone: index === 0 ? 'start' : index === records.length - 1 ? 'end' : 'middle', id: ex.id, en: ex.n, es: EXERCISE_NAMES_ES[ex.id] }
    })
  })
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(JSON.stringify(stratifiedExerciseNameSample(), null, 2))
}
