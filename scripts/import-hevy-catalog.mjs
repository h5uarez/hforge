#!/usr/bin/env node
// Deterministically imports the operator-supplied Hevy JSON and local media metadata.
// Binary media is intentionally never copied by this script. Use sync-hevy-media.mjs to stage
// the supplied files into the runtime media volume separately.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { EXDB as LEGACY_EXDB } from '../frontend/src/lib/exercises-data.js'
import * as LegacyNames from '../frontend/src/lib/exercise-names.es.js'
import { HEVY_COMPATIBILITY, LEGACY_EXERCISE_DISPLAY_ALIASES_ES, hevyAppId } from '../frontend/src/lib/hevy-compatibility.js'
import { buildSpanishInstructionPack, isUnavailableInstruction, parseInstructionSteps } from './build-instructions.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_OUT = join(ROOT, 'frontend', 'src', 'lib', 'hevy-exercises-data.js')
const MEDIA_OUT = join(ROOT, 'frontend', 'src', 'lib', 'hevy-media-manifest.js')
const NAMES_OUT = join(ROOT, 'frontend', 'src', 'lib', 'exercise-names.es.js')
const INSTRUCTIONS_OUT = join(ROOT, 'frontend', 'src', 'instr', 'es.js')

const valueAfter = (args, name) => {
  const index = args.indexOf(name)
  return index < 0 ? null : args[index + 1] || null
}
const args = process.argv.slice(2)
const auditOnly = args.includes('--audit')
const inputPath = valueAfter(args, '--input')
const mediaPath = valueAfter(args, '--media-dir')

const fail = message => {
  console.error(`Hevy import failed: ${message}`)
  process.exitCode = 2
}

function readSource(path) {
  if (!path || !existsSync(path)) throw new Error(`input file not found: ${path || '<missing --input>'}`)
  const data = JSON.parse(readFileSync(path, 'utf8'))
  if (!data || !Array.isArray(data.exercises)) throw new Error('input must contain an exercises array')
  const exercises = data.exercises.filter(ex => !ex.is_archived && !ex.is_custom)
  if (exercises.length !== 451) throw new Error(`expected 451 active non-custom records, got ${exercises.length}`)
  const ids = new Set()
  for (const ex of exercises) {
    // The audited export is eight-character uppercase identifiers; three source IDs contain
    // G/S/H/K, so accepting only hexadecimal here would drop valid authoritative records.
    if (!/^[0-9A-Z]{8}$/.test(ex.id)) throw new Error(`invalid Hevy ID: ${ex.id}`)
    if (ids.has(ex.id)) throw new Error(`duplicate Hevy ID: ${ex.id}`)
    ids.add(ex.id)
    if (!String(ex.name_en || '').trim() || !String(ex.name || '').trim()) throw new Error(`missing bilingual name: ${ex.id}`)
  }
  return { data, exercises, sourceHash: createHash('sha256').update(readFileSync(path)).digest('hex') }
}

const BODY_PART = Object.freeze({
  abdominals: 'waist', abductors: 'upper legs', adductors: 'upper legs', biceps: 'upper arms',
  calves: 'lower legs', cardio: 'cardio', chest: 'chest', forearms: 'lower arms',
  full_body: 'full body', glutes: 'upper legs', hamstrings: 'upper legs', lats: 'back',
  lower_back: 'back', neck: 'neck', other: 'other', quadriceps: 'upper legs', shoulders: 'shoulders',
  traps: 'back', triceps: 'upper arms', upper_back: 'back',
})
const MUSCLE = Object.freeze({
  abdominals: 'abs', abductors: 'abductors', adductors: 'adductors', biceps: 'biceps', calves: 'calves',
  cardio: 'cardiovascular system', chest: 'pectorals', forearms: 'forearms', full_body: 'full body',
  glutes: 'glutes', hamstrings: 'hamstrings', lats: 'lats', lower_back: 'lower back', neck: 'neck',
  other: 'other', quadriceps: 'quads', shoulders: 'delts', traps: 'traps', triceps: 'triceps', upper_back: 'upper back',
})
const EQUIPMENT = Object.freeze({ barbell: 'barbell', dumbbell: 'dumbbell', kettlebell: 'kettlebell', plate: 'plate', resistance_band: 'band', suspension: 'suspension', other: 'other' })

function normalizeBodyPart(value) {
  return BODY_PART[value] || String(value || 'other').replaceAll('_', ' ')
}
function normalizeMuscle(value) {
  return MUSCLE[value] || String(value || 'other').replaceAll('_', ' ')
}
function normalizeEquipment(ex) {
  if (ex.hundred_percent_bodyweight_exercise || ex.equipment_category === 'none') return 'body weight'
  if (ex.equipment_category === 'machine') return /cable|pulley/i.test(`${ex.name_en} ${ex.name}`) ? 'cable' : 'leverage machine'
  return EQUIPMENT[ex.equipment_category] || 'other'
}
function modeFor(ex) {
  if (ex.exercise_type === 'floors_duration' || ex.exercise_type === 'steps_duration' || ex.exercise_type === 'distance_duration' || (ex.exercise_type === 'duration' && ex.muscle_group === 'cardio')) return 'cardio'
  if (ex.exercise_type === 'duration' || ex.exercise_type === 'short_distance_weight') return 'time'
  return 'reps'
}
function trackingFor(ex) {
  if (ex.exercise_type === 'floors_duration') return 'floors'
  if (ex.exercise_type === 'steps_duration') return 'steps'
  if (ex.exercise_type === 'distance_duration') return 'distance'
  if (ex.exercise_type === 'duration') return 'duration'
  if (ex.exercise_type === 'short_distance_weight') return 'short_distance_weight'
  return null
}

function localMediaIndex(mediaDir) {
  if (!mediaDir) return new Map()
  if (!existsSync(mediaDir)) throw new Error(`media directory not found: ${mediaDir}`)
  const index = new Map()
  for (const file of readdirSync(mediaDir).sort()) {
    const match = file.match(/^([0-9A-Z]{8})\.(jpg|jpeg|png|mp4)$/i)
    if (!match) continue
    const key = `${match[1].toUpperCase()}.${match[2].toLowerCase()}`
    if (index.has(key)) throw new Error(`duplicate media filename ignoring case: ${file}`)
    index.set(key, file)
  }
  return index
}
function mediaFor(id, media) {
  const thumbnail = media.get(`${id}.jpg`) || media.get(`${id}.jpeg`) || media.get(`${id}.png`) || null
  const video = media.get(`${id}.mp4`) || null
  return { thumbnail, video }
}

function toRecord(ex, media) {
  const others = (Array.isArray(ex.other_muscles) ? ex.other_muscles : []).map(normalizeMuscle).filter(Boolean)
  const steps = isUnavailableInstruction(ex) ? [] : parseInstructionSteps(ex)
  const assets = mediaFor(ex.id, media)
  return {
    id: hevyAppId(ex.id), hevyId: ex.id, n: ex.name_en,
    bp: normalizeBodyPart(ex.muscle_group), eq: normalizeEquipment(ex), tg: normalizeMuscle(ex.muscle_group),
    mg: others[0] || null, sm: others, st: [], img: assets.thumbnail, gif: null, video: assets.video,
    mode: modeFor(ex), tracking: trackingFor(ex), exerciseType: ex.exercise_type,
    bodyweight: !!ex.hundred_percent_bodyweight_exercise,
    hevyEquipment: ex.equipment_category, hevyMuscleGroup: ex.muscle_group,
    hevyInstructionLanguage: ex.instruction_language || null,
    spanishInstructionSteps: steps.length,
  }
}

function fold(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
function buildNames(exercises, records) {
  const names = {}
  const rawById = new Map(exercises.map(ex => [hevyAppId(ex.id), ex]))
  const recordById = new Map(records.map(ex => [ex.id, ex]))
  for (const legacy of LEGACY_EXDB) {
    const imported = recordById.get(legacy.id)
    names[legacy.id] = rawById.get(legacy.id)?.name || LegacyNames.EXERCISE_NAMES_ES[legacy.id] || legacy.n
    if (imported && rawById.get(legacy.id)) names[legacy.id] = rawById.get(legacy.id).name
  }
  for (const record of records) if (!Object.hasOwn(names, record.id)) names[record.id] = rawById.get(record.id)?.name || record.n
  return names
}
function buildCollisions(names) {
  const groups = new Map()
  for (const [id, name] of Object.entries(names)) {
    const key = fold(name)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(id)
  }
  const oldReasons = new Map((LegacyNames.EXERCISE_NAME_COLLISIONS_ES || []).map(item => [item.ids.slice().sort().join('|'), item.reason]))
  return [...groups.entries()].filter(([, ids]) => ids.length > 1).map(([name, ids]) => {
    const sorted = ids.slice().sort()
    return { ids: sorted, reason: oldReasons.get(sorted.join('|')) || `Distinct Hevy templates share the source Spanish display name: ${name}.` }
  })
}
function buildAnglicisms(names, records) {
  const byId = new Map(records.map(record => [record.id, record.n]))
  const output = {}
  for (const [id, name] of Object.entries(names)) {
    if (fold(name) === fold(byId.get(id))) output[id] = `The source Spanish name is an established term and is retained verbatim: ${name}.`
  }
  return output
}

function buildAliases(names) {
  const aliases = Object.fromEntries(Object.entries(LegacyNames.EXERCISE_ALIASES_ES || {}).map(([id, values]) => [id, [...values]]))
  const importedByAppId = new Map()
  for (const [hevyId, entry] of Object.entries(HEVY_COMPATIBILITY)) importedByAppId.set(entry.appId, hevyId)
  // Preserve the previous Spanish labels as search/import vocabulary when a reviewed Hevy
  // replacement changes the display label. This keeps old CSV and plan language resolvable
  // without violating the source-name display contract.
  for (const legacy of LEGACY_EXDB) {
    const oldName = LEGACY_EXERCISE_DISPLAY_ALIASES_ES[legacy.id] || LegacyNames.EXERCISE_NAMES_ES[legacy.id]
    if (!oldName || oldName === names[legacy.id] || !importedByAppId.has(legacy.id)) continue
    const list = aliases[legacy.id] || []
    if (!list.includes(oldName)) list.unshift(oldName)
    aliases[legacy.id] = list
  }
  return aliases
}

function generatedNamesModule(names, collisions, anglicisms) {
  const aliases = buildAliases(names)
  const lowConfidence = Object.fromEntries(Object.entries(LegacyNames.EXERCISE_NAME_LOW_CONFIDENCE_ES || {}).filter(([id]) => Object.hasOwn(names, id)))
  return `// Generated by scripts/import-hevy-catalog.mjs from the reviewed Hevy source; do not edit by hand.\n// Spanish values are copied from each source record's name field.\nexport const EXERCISE_NAMES_ES = Object.freeze(${JSON.stringify(names, null, 2)})\n\n// Existing import/search vocabulary remains explicit and does not create catalog records.\nexport const EXERCISE_ALIASES_ES = Object.freeze(${JSON.stringify(aliases, null, 2)})\n\nexport const EXERCISE_NAME_ANGLICISMS_ES = Object.freeze(${JSON.stringify(anglicisms, null, 2)})\n\nexport const EXERCISE_NAME_LOW_CONFIDENCE_ES = Object.freeze(${JSON.stringify(lowConfidence, null, 2)})\n\nexport const EXERCISE_NAME_COLLISIONS_ES = Object.freeze(${JSON.stringify(collisions, null, 2)})\n`
}

function buildManifest(exercises, records, media) {
  const byHevyId = new Map(records.map(record => [record.hevyId, record]))
  const manifest = exercises.map(ex => {
    const record = byHevyId.get(ex.id)
    return { hevyId: ex.id, appId: record.id, thumbnail: record.img, video: record.video }
  })
  const summary = {
    records: manifest.length,
    thumbnails: manifest.filter(row => row.thumbnail).length,
    jpg: manifest.filter(row => row.thumbnail?.toLowerCase().endsWith('.jpg')).length,
    png: manifest.filter(row => row.thumbnail?.toLowerCase().endsWith('.png')).length,
    videos: manifest.filter(row => row.video).length,
    missing: manifest.filter(row => !row.thumbnail && !row.video).length,
    sourceFilesIndexed: media.size,
  }
  return { manifest, summary }
}

function runAudit(source, records, manifest, names) {
  const sourceIds = new Set(source.exercises.map(ex => ex.id))
  const recordIds = new Set(records.map(ex => ex.id))
  const errors = []
  if (records.length !== 451) errors.push(`generated Hevy records: ${records.length}`)
  if (new Set(records.map(ex => ex.hevyId)).size !== 451) errors.push('generated Hevy IDs are not unique')
  if (new Set(records.map(ex => ex.id)).size !== records.length) errors.push('generated app IDs are not unique')
  if (![...sourceIds].every(id => records.some(ex => ex.hevyId === id))) errors.push('a source record is missing from generated records')
  if (manifest.length !== 451) errors.push(`media manifest records: ${manifest.length}`)
  if (Object.keys(names).length !== new Set([...LEGACY_EXDB.map(ex => ex.id), ...records.map(ex => ex.id)]).size) errors.push('Spanish name coverage does not match visible catalog')
  if (records.some(ex => ex.hevyId === '2330' || ex.id === '2330')) errors.push('retired ID 2330 was resurrected')
  if (Object.keys(HEVY_COMPATIBILITY).some(id => !sourceIds.has(id))) errors.push('compatibility map contains a source ID absent from input')
  if (errors.length) throw new Error(errors.join('; '))
  console.log(JSON.stringify({ sourceRecords: source.exercises.length, generatedRecords: records.length, manifestRecords: manifest.length, names: Object.keys(names).length, mappedRecords: records.filter(ex => ex.id !== ex.hevyId).length }, null, 2))
}

async function main() {
  const source = readSource(inputPath)
  const media = localMediaIndex(mediaPath)
  const records = source.exercises.map(ex => toRecord(ex, media))
  const names = buildNames(source.exercises, records)
  const collisions = buildCollisions(names)
  const anglicisms = buildAnglicisms(names, records)
  const { manifest, summary } = buildManifest(source.exercises, records, media)
  runAudit(source, records, manifest, names)
  if (auditOnly) return

  writeFileSync(DATA_OUT, `// Generated by scripts/import-hevy-catalog.mjs; do not edit.\nexport const HEVY_CATALOG_META = Object.freeze(${JSON.stringify({ source: source.data.source || null, sourceHash: source.sourceHash, sourceRecords: source.exercises.length, mappedRecords: records.filter(ex => ex.id !== ex.hevyId).length, spanishInstructionRecords: source.exercises.filter(ex => !isUnavailableInstruction(ex)).length, unavailableInstructionRecords: source.exercises.filter(isUnavailableInstruction).length, media: summary }, null, 2)})\nexport const HEVY_EXDB = ${JSON.stringify(records)}\n`)
  writeFileSync(MEDIA_OUT, `// Generated by scripts/import-hevy-catalog.mjs; binary files are staged separately.\nexport const HEVY_MEDIA_SUMMARY = Object.freeze(${JSON.stringify(summary, null, 2)})\nexport const HEVY_MEDIA_MANIFEST = Object.freeze(${JSON.stringify(manifest)} )\n`)
  writeFileSync(NAMES_OUT, generatedNamesModule(names, collisions, anglicisms))
  const pack = buildSpanishInstructionPack(source.exercises)
  writeFileSync(INSTRUCTIONS_OUT, '// Generated by scripts/import-hevy-catalog.mjs; do not edit.\nexport default ' + JSON.stringify(pack) + '\n')
  console.log(`Wrote ${DATA_OUT}, ${MEDIA_OUT}, ${NAMES_OUT}, and ${INSTRUCTIONS_OUT}`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => fail(error.message))
}
