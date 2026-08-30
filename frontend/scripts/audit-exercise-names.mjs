import { pathToFileURL } from 'node:url'
import { EXDB } from '../src/lib/exercises-data.js'
import {
  EXERCISE_NAMES_ES, EXERCISE_NAME_ANGLICISMS_ES, EXERCISE_NAME_COLLISIONS_ES,
  EXERCISE_NAME_LOW_CONFIDENCE_ES,
} from '../src/lib/exercise-names.es.js'

const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const groupKey = ids => [...ids].sort().join('|')

const QUALITY_RULES = Object.freeze([
  ['all-fours-calque', /\btodos cuatro\b/i],
  ['alternating-sides-calque', /\balternando lados\b/i],
  ['russian-movement-calque', /\bruso movimiento\b/i],
  ['from-with-calque', /\bdesde con\b/i],
  ['repeated-noun', /\b([a-záéíóúüñ]{4,})\s+\1\b/i],
  ['bare-muscle-stretch', /^estiramiento\s+(?:abdominal(?:es)?|aductor(?:es)?|bíceps|cuádriceps|deltoides|dorsal(?:es)?|gemelos|glúteos?|isquiotibiales|pectoral(?:es)?|peroneos|piriforme|tríceps)\b/i],
  ['position-before-movement', /^(?:de pie|en posición sentada|en posición tumbada|en decúbito (?:prono|supino))\s+(?:abdominales|curl|elevación|extensión|press|remo)\b/i],
  ['dangling-bench-preposition', /\ba banco (?:sobre )?(?:con|en)\b/i],
  ['literal-direction-stack', /\b(?:ascendente recto|inferior cuerpo|posterior inferior|superior pecho)\b/i],
  ['plural-adjective-disagreement', /\b(?:abdominales|aperturas|dominadas|elevaciones|encogimientos abdominales|flexiones|sentadillas)\s+(?:agrupado|ancho|completo|estrecho|inverso|modificado|oblicuo|pliométrico|posterior)\b/i],
  ['missing-stretch-preposition', /^estiramiento\s+(?:dinámico\s+)?(?:cadera|columna|corredor|cuello|deltoides|pecho)\b/i],
  ['mechanical-word-order', /\b(?:a una extremidad|cadera abducción|cadera aducción|hombros toque|pierna elevado|pierna patada|rodilla toque|uno en|uno mano)\b/i],
  ['missing-archer-preposition', /^(?:dominadas|flexiones)\s+arquero\b/i],
  ['mechanical-jump-squat-order', /\bsentadilla salto\b/i],
  ['mechanical-hammer-press-order', /\bpress\s+(?:en banco (?:inclinado|declinado)|en posición tumbada)\s+martillo\b/i],
  ['literal-iron-cross', /\bhierro cruzado\b/i],
  ['literal-sumo-pull-through', /\btirón sumo pasando\b/i],
  ['untranslated-swing-connector', /\bcon swing con\b/i],
  ['stacked-back-leg-prepositions', /\bcon (?:la )?espalda recta con piernas\b/i],
  ['literal-inner-chest-order', /\bpecho interior\b/i],
  ['literal-upper-row', /\bremo superior\b/i],
  ['dangling-bar-conjunction', /\ben banco inclinado y barra\b/i],
  ['literal-wide-lateral-order', /\b(?:lateral ancho|ancho lateral)\b/i],
  ['incomplete-bridge-transition', /\bhasta puente\b/i],
  ['literal-split-squat', /\bsentadillas en posición dividida\b/i],
  ['literal-straddle-planche', /\bplancha con piernas abiertas\b/i],
  ['mechanical-half-situp-order', /\bmedios abdominales\b/i],
])

export function linguisticQualityFindings(names = EXERCISE_NAMES_ES) {
  const findings = []
  for (const [id, name] of Object.entries(names)) {
    for (const [rule, pattern] of QUALITY_RULES) {
      if (pattern.test(name)) findings.push({ id, name, rule })
    }
  }
  return findings
}

export function auditExerciseNames() {
  const catalogIds = new Set(EXDB.map(ex => ex.id))
  const translatedIds = Object.keys(EXERCISE_NAMES_ES)
  const translatedSet = new Set(translatedIds)
  const missingIds = EXDB.map(ex => ex.id).filter(id => !translatedSet.has(id))
  const unknownIds = translatedIds.filter(id => !catalogIds.has(id))
  const emptyIds = translatedIds.filter(id => !String(EXERCISE_NAMES_ES[id] || '').trim())
  const byName = new Map()
  for (const [id, name] of Object.entries(EXERCISE_NAMES_ES)) {
    const key = fold(name)
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(id)
  }

  const allowedCollisionMap = new Map(EXERCISE_NAME_COLLISIONS_ES.map(entry => [groupKey(entry.ids), entry.reason]))
  const allCollisions = [...byName.entries()].filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({ name, ids: [...ids].sort(), reason: allowedCollisionMap.get(groupKey(ids)) || '' }))
  const collisions = allCollisions.filter(entry => !entry.reason)
  const allowedCollisions = allCollisions.filter(entry => !!entry.reason)
  const actualCollisionKeys = new Set(allCollisions.map(entry => groupKey(entry.ids)))
  const staleCollisionAllowlist = EXERCISE_NAME_COLLISIONS_ES.filter(entry => !actualCollisionKeys.has(groupKey(entry.ids)))

  const identicalToEnglish = EXDB.filter(ex => fold(ex.n) === fold(EXERCISE_NAMES_ES[ex.id])).map(ex => ex.id)
  const anglicismIds = Object.keys(EXERCISE_NAME_ANGLICISMS_ES)
  const anglicismSet = new Set(anglicismIds)
  const unapprovedEnglish = identicalToEnglish.filter(id => !anglicismSet.has(id))
  const staleAnglicismAllowlist = anglicismIds.filter(id => !identicalToEnglish.includes(id) || !catalogIds.has(id))

  const translated = translatedIds.length
  const fallback = missingIds.length
  const lowConfidence = Object.entries(EXERCISE_NAME_LOW_CONFIDENCE_ES)
    .map(([id, reason]) => ({ id, reason }))
  const linguisticFindings = linguisticQualityFindings()
  return {
    total: EXDB.length,
    translated,
    fallback,
    coveragePercent: Number((translated / EXDB.length * 100).toFixed(2)),
    missingIds,
    unknownIds,
    emptyIds,
    collisions,
    allowedCollisions,
    staleCollisionAllowlist,
    identicalToEnglish,
    anglicismsAllowed: anglicismIds.length,
    unapprovedEnglish,
    staleAnglicismAllowlist,
    lowConfidence,
    linguisticFindings,
  }
}

export function auditFailed(report) {
  return report.translated !== report.total || report.fallback !== 0 || [
    report.missingIds, report.unknownIds, report.emptyIds, report.collisions,
    report.staleCollisionAllowlist, report.unapprovedEnglish, report.staleAnglicismAllowlist,
    report.lowConfidence, report.linguisticFindings,
  ].some(items => items.length)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const report = auditExerciseNames()
  console.log(JSON.stringify(report, null, 2))
  if (auditFailed(report)) process.exitCode = 1
}
