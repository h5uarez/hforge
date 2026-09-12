import { afterEach, describe, expect, it } from 'vitest'
import {
  EXERCISE_ALIASES_ES, EXERCISE_NAMES_ES, EXERCISE_NAME_ANGLICISMS_ES, EXERCISE_NAME_COLLISIONS_ES,
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
import { normalizeExerciseIds } from './exercise-ids.js'

const byId = id => EXIDX[id]
const POWERLIFTING_ADDITIONS = [
  { id: '5214', en: 'chest-supported t-bar row', es: 'remo en T con pecho apoyado', aliases: ['remo T pecho apoyado', 'chest supported T bar row'], media: [null, null] },
  { id: '5218', en: 'hip thrust', es: 'hip thrust', aliases: ['hip thrust barra'], media: [null, null] },
  { id: '5223', en: 'weighted back extension', es: 'hiperextensión lastrada', aliases: ['hiperextensión con lastre', 'weighted back extension'], media: [null, null] },
]

const CATALOG_CORRECTIONS = [
  { id: '5225', en: 'glute kickback', es: 'patada de glúteo', aliases: ['patada de glúteo', 'glute kickback'], media: [null, null], primary: 'glutes', secondary: 'hamstrings' },
  { id: '5226', en: 'gironda row', es: 'remo Gironda', aliases: ['remo Gironda', 'gironda row'], media: [null, null], primary: 'lats' },
]

const SLED_MACHINE_RECORDS = [
  { id: '0739', en: 'sled 45° leg press', es: 'Prensa de Piernas a 45°', legacyAliases: ['Prensa de Piernas a 45° en Trineo'] },
]

afterEach(async () => {
  registerCustom([])
  await setLang('en')
})

describe('Spain-Spanish exercise names', () => {
  it('keeps every catalog id unique and canonical English names untouched', () => {
    expect(EXDB).toHaveLength(52)
    expect(new Set(EXDB.map(ex => ex.id)).size).toBe(EXDB.length)
    expect(byId('2330')).toBeUndefined()
    expect(byId('0652').n).toBe('pull-up')
    expect(byId('0032').n).toBe('barbell deadlift')
    expect(Object.keys(EXERCISE_NAMES_ES)).toHaveLength(EXDB.length)
    expect(Object.keys(EXERCISE_NAMES_ES).every(id => !!byId(id))).toBe(true)
    expect(Object.values(EXERCISE_NAMES_ES).every(name => !!name.trim())).toBe(true)
  })

  it('normalizes the merged legacy ID in persisted exercise data', () => {
    const state = normalizeExerciseIds({
      routines: [{ ex: [{ id: '2330' }] }],
      workouts: [{ entries: [{ id: '2330', target: { id: '2330' } }], prs: ['2330'] }],
      active: { entries: [{ id: '2330' }] },
      exWeights: { '2330': { w: 40 }, '0198': { w: 50 } },
    })
    expect(state.routines[0].ex[0].id).toBe('0198')
    expect(state.workouts[0].entries[0]).toMatchObject({ id: '0198', target: { id: '0198' } })
    expect(state.workouts[0].prs).toEqual(['0198'])
    expect(state.active.entries[0].id).toBe('0198')
    expect(state.exWeights).toEqual({ '0198': { w: 50 } })
  })

  it('uses established Spanish terms while retaining variant descriptors', () => {
    expect(exerciseName(byId('0251'), 'es-ES')).toBe('Fondos de Pecho')
    expect(exerciseName(byId('0652'), 'es')).toBe('Dominadas')
    expect(exerciseName(byId('0043'), 'es')).toBe('Sentadilla Trasera Completa con Barra')
    expect(exerciseName(byId('0032'), 'es')).toBe('Peso Muerto con Barra')
    expect(exerciseName(byId('0198'), 'es')).toBe('Jalón al Pecho (Cable)')
    expect(exerciseName(byId('0334'), 'es')).toBe('Elevación Lateral con Mancuernas')
    expect(exerciseName(byId('1401'), 'es')).toBe('Muscle-up en Barra')
    expect(exerciseName(byId('0237'), 'es')).toBe('Pullover de Pie con Cuerda en Polea')
    expect(exerciseName(byId('0184'), 'es')).toBe('Pullover Tumbado con Cuerda en Polea')
    expect(EXDB.some(ex => ex.n === 'hip thrust')).toBe(true)
  })

  it('adds curated powerlifting variants with deliberate media and matching', () => {
    for (const addition of POWERLIFTING_ADDITIONS) {
      const ex = byId(addition.id)
      expect(ex, addition.id).toBeDefined()
      expect(ex.n, addition.id).toBe(addition.en)
      expect(exerciseName(ex, 'es'), addition.id).toBe(addition.es)
      expect([ex.img, ex.gif], addition.id).toEqual(addition.media)
      expect(ex.st.length, addition.id).toBeGreaterThan(0)
      expect(exerciseMatches(ex, addition.es), addition.id).toBe(true)
      expect(matchExercise(addition.en), addition.en).toBe(addition.id)
      expect(matchExercise(addition.es), addition.es).toBe(addition.id)
      for (const alias of addition.aliases) {
        expect(exerciseMatches(ex, alias), alias).toBe(true)
        expect(matchExercise(alias), alias).toBe(addition.id)
      }
    }
  })

  it('adds the approved catalog corrections with precise names, muscles, media, and matching', () => {
    for (const addition of CATALOG_CORRECTIONS) {
      const ex = byId(addition.id)
      expect(ex, addition.id).toBeDefined()
      expect(ex.n, addition.id).toBe(addition.en)
      expect(exerciseName(ex, 'es'), addition.id).toBe(addition.es)
      expect([ex.img, ex.gif], addition.id).toEqual(addition.media)
      expect(ex.tg, addition.id).toBe(addition.primary)
      if (addition.secondary) expect(ex.mg, addition.id).toBe(addition.secondary)
      expect(ex.st.length, addition.id).toBeGreaterThan(0)
      for (const alias of addition.aliases) {
        expect(exerciseMatches(ex, alias), alias).toBe(true)
        expect(matchExercise(alias), alias).toBe(addition.id)
      }
    }
  })

  it('removes sled wording from plate-loaded machines while preserving imports', () => {
    for (const record of SLED_MACHINE_RECORDS) {
      const ex = byId(record.id)
      expect(ex, record.id).toBeDefined()
      expect(ex.n, record.id).toBe(record.en)
      expect(exerciseName(ex, 'es'), record.id).toBe(record.es)
      expect(exerciseMatches(ex, record.en), record.en).toBe(true)
      expect(matchExercise(record.en), record.en).toBe(record.id)
      expect(exerciseMatches(ex, record.es), record.es).toBe(true)
      expect(matchExercise(record.es), record.es).toBe(record.id)
      expect(EXERCISE_ALIASES_ES[record.id], record.id).toEqual(expect.arrayContaining(record.legacyAliases))
      for (const alias of record.legacyAliases) {
        expect(exerciseMatches(ex, alias), alias).toBe(true)
        expect(matchExercise(alias), alias).toBe(record.id)
      }
    }
  })

  it('has no current Spanish display label containing en Trineo', () => {
    expect(Object.values(EXERCISE_NAMES_ES).some(name => /en trineo/i.test(name))).toBe(false)
  })

  it('maps the generic hip thrust alias to the barbell record', () => {
    expect(matchExercise('hip thrust')).toBe('5218')
    expect(exerciseMatches(byId('5218'), 'hip thrust')).toBe(true)
  })

  it('keeps existing powerlifting records singular instead of duplicating them', () => {
    const existingIds = [
      '0025', '0032', '0043', '0085', '0739', '0841', '1435', '1436', '1459',
    ]
    for (const id of existingIds) expect(EXDB.filter(ex => ex.id === id), id).toHaveLength(1)
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
    expect(exerciseMatches(byId('0652'), 'dominada')).toBe(true)
    expect(exerciseMatches(byId('0237'), 'pullover con cuerda')).toBe(true)
    expect(exerciseMatches(byId('0237'), 'jalón de brazos rectos con cuerda')).toBe(true)
  })

  it('keeps English imports and adds unambiguous Spanish matching', () => {
    expect(matchExercise('Barbell Deadlift')).toBe('0032')
    expect(matchExercise('Bench Press (Barbell)')).toBe('0025')
    expect(matchExercise('Peso muerto')).toBe('0032')
    expect(matchExercise('Elevación lateral')).toBe('0334')
    expect(matchExercise('Jalon al pecho')).toBe('0198')
    expect(matchExercise('pullover con cuerda')).toBe('0237')
    expect(matchExercise('jalón de brazos rectos con cuerda')).toBe('0237')
    expect(matchExercise('pullover tumbado con cuerda')).toBe('0184')
  })

  it('recognizes the safe routine vocabulary without creating catalog records', () => {
    const aliases = [
      ['BP', '0025'],
      ['DL', '0032'],
      ['Press banca', '0025'],
      ['Fondos de pecho', '0251'],
      ['Dominadas', '0652'],
      ['Press inclinado multipower', '0757'],
      ['Elevaciones laterales', '0334'],
      ['Tríceps polea', '0241'],
      ['Muscle-up técnico', '1401'],
      ['Extensión de cuádriceps', '0585'],
      ['Abductor máquina', '0597'],
      ['SQ low-bar', '1435'],
      ['Dominadas con lastre', '0841'],
      ['Pájaro máquina', '0602'],
      ['Prensa', '0739'],
      ['Abducción en máquina', '0597'],
      ['Press inclinado en multipower', '0757'],
      ['Press hombro en máquina', '0603'],
      ['Peso muerto rumano con mancuernas', '1459'],
      ['RDL con mancuernas', '1459'],
      ['Curl femoral', '0586'],
      ['Curl martillo con mancuerna', '0313'],
      ['Pullover con cuerda en polea', '0237'],
    ]
    for (const [label, id] of aliases) {
      expect(exerciseMatches(byId(id), label), label).toBe(true)
      expect(matchExercise(label), label).toBe(id)
    }
    expect(matchExercise('RDL')).toBe('0085')
    expect(EXDB).toHaveLength(52)
  })

  it('leaves ambiguous and missing routine variants unresolved', () => {
    const unresolved = [
      'Fondos',
      'Press inclinado multipower/máquina',
      'Press inclinado máquina',
      'Remo pecho apoyado',
      'Crunch abdominal',
      'Curl declinado con mancuernas',
      'Bulgarian squat asistido',
      'Crunch en máquina o polea',
      'Extensión de tríceps',
      'Patada de glúteo en polea',
      'Hiperextensión enfocada a glúteo',
      'Jalón al pecho agarre',
      'Curl bíceps en polea con cuerda o agarres independientes',
      'Curl martillo con mancuerna o cuerda',
    ]
    for (const label of unresolved) expect(matchExercise(label), label).toBeNull()
  })

  it('enforces complete coverage, documented anglicisms and collision policy', () => {
    const audit = exerciseNameAudit()
    expect(audit).toMatchObject({ total: 52, translated: 52, fallback: 0, coverage: 1 })
    expect(audit.missingIds).toEqual([])
    expect(audit.unknownIds).toEqual([])
    expect(audit.emptyIds).toEqual([])
    expect(audit.collisions).toEqual([])
    expect(audit.allowedCollisions).toHaveLength(0)
    expect(EXERCISE_NAME_COLLISIONS_ES.every(entry => entry.reason && entry.ids.length > 1)).toBe(true)
    expect(audit.anglicismsAllowed).toBe(Object.keys(EXERCISE_NAME_ANGLICISMS_ES).length)
    expect(audit.anglicismsAllowed).toBe(1)
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
    expect(sample).toHaveLength(12)
    expect(new Set(sample.map(row => row.family))).toHaveLength(4)
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
    expect(html).toContain('Dominadas')
    expect(html).not.toContain('pull-up')
    expect(html).toContain('Press secreto')
  })
})
