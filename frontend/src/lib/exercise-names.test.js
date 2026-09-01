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
const POWERLIFTING_ADDITIONS = [
  { id: '5202', en: 'paused barbell squat', es: 'sentadilla con barra con pausa', aliases: ['sentadilla pausada', 'paused squat'], media: ['0043-qXTaZnJ.jpg', '0043-qXTaZnJ.gif'] },
  { id: '5203', en: 'tempo barbell squat', es: 'sentadilla con barra con tempo', aliases: ['sentadilla con tempo', 'tempo squat'], media: ['0043-qXTaZnJ.jpg', '0043-qXTaZnJ.gif'] },
  { id: '5204', en: 'barbell pin squat', es: 'sentadilla con barra desde topes', aliases: ['sentadilla desde topes', 'pin squat'], media: [null, null] },
  { id: '5205', en: 'paused barbell bench press', es: 'press de banca con barra con pausa', aliases: ['press banca con pausa', 'paused bench press'], media: ['0025-EIeI8Vf.jpg', '0025-EIeI8Vf.gif'] },
  { id: '5206', en: 'spoto press', es: 'press Spoto con barra', aliases: ['spoto press'], media: [null, null] },
  { id: '5207', en: 'larsen press', es: 'press Larsen con barra', aliases: ['larsen press'], media: [null, null] },
  { id: '5208', en: 'barbell floor press', es: 'press de suelo con barra', aliases: ['floor press', 'press banca en el suelo'], media: [null, null] },
  { id: '5209', en: 'deadlift from blocks', es: 'peso muerto con barra desde bloques', aliases: ['peso muerto desde bloques', 'deadlift from blocks'], media: [null, null] },
  { id: '5210', en: 'paused barbell deadlift', es: 'peso muerto con barra con pausa', aliases: ['peso muerto pausado', 'paused deadlift'], media: ['0032-ila4NZS.jpg', '0032-ila4NZS.gif'] },
  { id: '5211', en: 'deficit barbell deadlift', es: 'peso muerto deficit con barra', aliases: ['peso muerto con déficit', 'deficit deadlift'], media: [null, null] },
  { id: '5212', en: 'snatch-grip deadlift', es: 'peso muerto con agarre de arrancada', aliases: ['peso muerto con agarre ancho', 'snatch grip deadlift'], media: [null, null] },
  { id: '5213', en: 'tempo barbell deadlift', es: 'peso muerto con barra con tempo', aliases: ['peso muerto con tempo', 'tempo deadlift'], media: ['0032-ila4NZS.jpg', '0032-ila4NZS.gif'] },
  { id: '5214', en: 'chest-supported t-bar row', es: 'remo en T con pecho apoyado', aliases: ['remo T pecho apoyado', 'chest supported T bar row'], media: [null, null] },
  { id: '5215', en: 'chest-supported machine row', es: 'remo en máquina con pecho apoyado', aliases: ['remo máquina pecho apoyado', 'chest supported machine row'], media: [null, null] },
  { id: '5216', en: 'seal row', es: 'remo seal', aliases: ['seal row'], media: [null, null] },
  { id: '5217', en: 'chest-supported cable row', es: 'remo en polea con pecho apoyado', aliases: ['remo polea pecho apoyado', 'chest supported cable row'], media: [null, null] },
  { id: '5218', en: 'barbell hip thrust', es: 'hip thrust con barra', aliases: ['hip thrust barra'], media: [null, null] },
  { id: '5219', en: 'barbell reverse lunge', es: 'zancada inversa con barra', aliases: ['reverse lunge con barra'], media: [null, null] },
  { id: '5220', en: 'front-foot-elevated split squat', es: 'sentadilla dividida con pie delantero elevado', aliases: ['front foot elevated split squat'], media: [null, null] },
  { id: '5221', en: 'belt squat', es: 'sentadilla con cinturón', aliases: ['belt squat'], media: [null, null] },
  { id: '5222', en: 'nordic hamstring curl', es: 'curl nórdico', aliases: ['curl nordic', 'nordic curl', 'nordic hamstring curl'], media: [null, null] },
  { id: '5223', en: 'weighted back extension', es: 'hiperextensión lastrada', aliases: ['hiperextensión con lastre', 'weighted back extension'], media: [null, null] },
  { id: '5224', en: 'paused barbell romanian deadlift', es: 'peso muerto rumano con pausa', aliases: ['peso muerto rumano con pausa', 'paused RDL', 'RDL con pausa'], media: ['0085-wQ2c4XD.jpg', '0085-wQ2c4XD.gif'] },
]

afterEach(async () => {
  registerCustom([])
  await setLang('en')
})

describe('Spain-Spanish exercise names', () => {
  it('keeps every catalog id unique and canonical English names untouched', () => {
    expect(EXDB).toHaveLength(1347)
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
    expect(exerciseName(byId('0043'), 'es')).toBe('sentadilla trasera completa con barra')
    expect(exerciseName(byId('0032'), 'es')).toBe('peso muerto con barra')
    expect(exerciseName(byId('0054'), 'es')).toBe('zancada con barra')
    expect(exerciseName(byId('2330'), 'es')).toContain('jalón al pecho')
    expect(exerciseName(byId('0334'), 'es')).toBe('elevación lateral con mancuernas')
    expect(exerciseName(byId('1401'), 'es')).toBe('muscle-up en barra')
    expect(exerciseName(byId('1160'), 'es')).toBe('burpee')
    expect(exerciseName(byId('3236'), 'es')).toContain('hip thrust')
    expect(exerciseName(byId('0237'), 'es')).toBe('pullover de pie con cuerda en polea')
    expect(exerciseName(byId('0184'), 'es')).toBe('pullover tumbado con cuerda en polea')
    expect(exerciseName(byId('1409'), 'es')).toBe('puente de glúteos con barra')
    expect(EXDB.some(ex => ex.n === 'barbell hip thrust')).toBe(true)
    expect(exerciseName(byId('0818'), 'es')).toBe('jalón al pecho con agarre paralelo y doble asa')
    expect(exerciseName(byId('1420'), 'es')).toBe('sentadilla con salto desde rodillas')
    expect(exerciseName(byId('3644'), 'es')).toBe('zancada con balanceo de pesas')
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

  it('keeps existing powerlifting records singular instead of duplicating them', () => {
    const existingIds = [
      '0025', '0030', '0032', '0042', '0043', '0044', '0049', '0074', '0085', '0101',
      '0116', '0117', '0118', '0122', '0327', '0593', '0675', '0739', '0841', '1409',
      '1423', '1435', '1436', '1459', '1751', '1753', '2285', '2368', '2810', '3236',
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
    expect(exerciseMatches(byId('0091'), 'press militar')).toBe(true)
    expect(exerciseMatches(byId('0652'), 'dominada')).toBe(true)
    expect(exerciseMatches(byId('0237'), 'pullover con cuerda')).toBe(true)
    expect(exerciseMatches(byId('0237'), 'jalón de brazos rectos con cuerda')).toBe(true)
  })

  it('keeps English imports and adds unambiguous Spanish matching', () => {
    expect(matchExercise('Barbell Deadlift')).toBe('0032')
    expect(matchExercise('Bench Press (Barbell)')).toBe('0025')
    expect(matchExercise('Peso muerto')).toBe('0032')
    expect(matchExercise('Elevación lateral')).toBe('0334')
    expect(matchExercise('Jalon al pecho')).toBe('2330')
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
      ['Hyperextensiones', '0489'],
      ['hiperextensiones', '0489'],
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
      ['Pullover en polea', '0238'],
      ['Pullover con barra en polea', '0238'],
      ['Curl martillo con mancuerna', '0313'],
      ['Curl martillo con cuerda', '0165'],
      ['Pullover con cuerda en polea', '0237'],
    ]
    for (const [label, id] of aliases) {
      expect(exerciseMatches(byId(id), label), label).toBe(true)
      expect(matchExercise(label), label).toBe(id)
    }
    expect(matchExercise('RDL')).toBe('0085')
    expect(EXDB).toHaveLength(1347)
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
      'Remo Gironda',
      'Curl bíceps en polea con cuerda o agarres independientes',
      'Curl martillo con mancuerna o cuerda',
    ]
    for (const label of unresolved) expect(matchExercise(label), label).toBeNull()
    expect(matchExercise('Patada de glúteo en polea')).not.toBe('0860')
    expect(matchExercise('Fondos')).not.toBe('0814')
  })

  it('enforces complete coverage, documented anglicisms and collision policy', () => {
    const audit = exerciseNameAudit()
    expect(audit).toMatchObject({ total: 1347, translated: 1347, fallback: 0, coverage: 1 })
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
