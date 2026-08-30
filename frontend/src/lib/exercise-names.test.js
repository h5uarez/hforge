import { afterEach, describe, expect, it } from 'vitest'
import {
  EXERCISE_NAMES_ES, EXERCISE_NAME_ANGLICISMS_ES, EXERCISE_NAME_COLLISIONS_ES,
} from './exercise-names.es.js'
import {
  EXDB, EXIDX, exerciseMatchNames, exerciseMatches, exerciseName,
  exerciseNameAudit, registerCustom,
} from './exercises.js'
import { matchExercise } from './import-csv.js'
import { planPrintHTML } from './plan-share.js'
import { setLang } from './i18n.js'
import { auditExerciseNames } from '../../scripts/audit-exercise-names.mjs'
import { stratifiedExerciseNameSample } from '../../scripts/review-exercise-names.mjs'

const byId = id => EXIDX[id]

afterEach(async () => {
  registerCustom([])
  await setLang('en')
})

describe('Spain-Spanish exercise names', () => {
  it('keeps every catalog id unique and canonical English names untouched', () => {
    expect(EXDB).toHaveLength(1324)
    expect(new Set(EXDB.map(ex => ex.id)).size).toBe(EXDB.length)
    expect(byId('0652').n).toBe('pull-up')
    expect(byId('0662').n).toBe('push-up')
    expect(byId('0032').n).toBe('barbell deadlift')
    expect(Object.keys(EXERCISE_NAMES_ES)).toHaveLength(EXDB.length)
    expect(Object.keys(EXERCISE_NAMES_ES).every(id => !!byId(id))).toBe(true)
    expect(Object.values(EXERCISE_NAMES_ES).every(name => !!name.trim())).toBe(true)
  })

  it('uses established Spanish terms while retaining variant descriptors', () => {
    expect(exerciseName(byId('0251'), 'es-ES')).toBe('fondos de pecho')
    expect(exerciseName(byId('0652'), 'es')).toBe('dominadas')
    expect(exerciseName(byId('0662'), 'es')).toBe('flexiones')
    expect(exerciseName(byId('0043'), 'es')).toBe('sentadilla trasera con barra')
    expect(exerciseName(byId('0032'), 'es')).toBe('peso muerto con barra')
    expect(exerciseName(byId('0054'), 'es')).toBe('zancada con barra')
    expect(exerciseName(byId('2330'), 'es')).toContain('jalón al pecho')
    expect(exerciseName(byId('0334'), 'es')).toBe('elevación lateral con mancuernas')
    expect(exerciseName(byId('1401'), 'es')).toBe('muscle-up en barra')
    expect(exerciseName(byId('1160'), 'es')).toBe('burpee')
    expect(exerciseName(byId('3236'), 'es')).toContain('hip thrust')
    expect(exerciseName(byId('0818'), 'es')).toBe('jalón al pecho con agarre paralelo y doble asa')
    expect(exerciseName(byId('1420'), 'es')).toBe('sentadilla con salto desde la posición de rodillas')
    expect(exerciseName(byId('3644'), 'es')).toBe('zancada con balanceo de pesas')
  })

  it('covers every built-in and never translates a custom exercise', () => {
    expect(EXDB.every(ex => exerciseName(ex, 'es') === EXERCISE_NAMES_ES[ex.id])).toBe(true)
    const custom = { id: '0652', n: 'Dominada de Marta', custom: true }
    expect(exerciseName(custom, 'es')).toBe('Dominada de Marta')
    expect(exerciseMatchNames(custom)).toEqual(['Dominada de Marta'])
  })

  it('searches localized, accentless Spanish, canonical English and safe aliases', () => {
    const lateralRaise = byId('0334')
    expect(exerciseMatches(lateralRaise, 'elevacion lateral')).toBe(true)
    expect(exerciseMatches(lateralRaise, 'dumbbell lateral raise')).toBe(true)
    expect(exerciseMatches(byId('0091'), 'press militar')).toBe(true)
    expect(exerciseMatches(byId('0652'), 'dominada')).toBe(true)
  })

  it('keeps English imports and adds unambiguous Spanish matching', () => {
    expect(matchExercise('Barbell Deadlift')).toBe('0032')
    expect(matchExercise('Bench Press (Barbell)')).toBe('0025')
    expect(matchExercise('Peso muerto')).toBe('0032')
    expect(matchExercise('Elevación lateral')).toBe('0334')
    expect(matchExercise('Jalon al pecho')).toBe('2330')
  })

  it('enforces complete coverage, documented anglicisms and collision policy', () => {
    const audit = exerciseNameAudit()
    expect(audit).toMatchObject({ total: 1324, translated: 1324, fallback: 0, coverage: 1 })
    expect(audit.missingIds).toEqual([])
    expect(audit.unknownIds).toEqual([])
    expect(audit.emptyIds).toEqual([])
    expect(audit.collisions).toEqual([])
    expect(audit.allowedCollisions).toHaveLength(EXERCISE_NAME_COLLISIONS_ES.length)
    expect(EXERCISE_NAME_COLLISIONS_ES.every(entry => entry.reason && entry.ids.length > 1)).toBe(true)
    expect(audit.anglicismsAllowed).toBe(Object.keys(EXERCISE_NAME_ANGLICISMS_ES).length)
    expect(audit.anglicismsAllowed).toBe(7)
    expect(audit.unapprovedEnglish).toEqual([])
    expect(new Set(audit.identicalToEnglish)).toEqual(new Set(Object.keys(EXERCISE_NAME_ANGLICISMS_ES)))
  })

  it('rejects known mechanical-translation residue and unresolved names', () => {
    const audit = auditExerciseNames()
    expect(audit.linguisticFindings).toEqual([])
    expect(audit.lowConfidence).toEqual([])
  })

  it('provides a deterministic start, middle and end sample for every semantic family', () => {
    const sample = stratifiedExerciseNameSample()
    expect(sample).toHaveLength(21)
    expect(new Set(sample.map(row => row.family))).toHaveLength(7)
    expect(sample.every(row => row.id && row.en && row.es)).toBe(true)
    expect(stratifiedExerciseNameSample()).toEqual(sample)
  })

  it('uses localized built-ins and untouched custom names in print/PDF HTML', async () => {
    await setLang('es')
    const custom = { id: 'custom-press', n: 'Press secreto', custom: true, bp: 'chest' }
    registerCustom([custom])
    const html = planPrintHTML({
      unit: 'kg', week: {},
      routines: [{ id: 'r', name: 'Día A', ex: [
        { id: '0652', sets: 3, reps: 8 },
        { id: custom.id, sets: 2, reps: 10 },
      ] }],
    }, 'Ana')
    expect(html).toContain('dominadas')
    expect(html).not.toContain('pull-up')
    expect(html).toContain('Press secreto')
  })
})
