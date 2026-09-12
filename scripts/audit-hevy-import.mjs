#!/usr/bin/env node
// Read-only audit for the generated Hevy catalog, Spanish instruction pack, and media manifest.
// Run with the same authoritative JSON used by the importer; --media-dir is optional and checks
// the supplied binary directory without copying it.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EXDB, HEVY_EXDB } from '../frontend/src/lib/catalog.js'
import { HEVY_CATALOG_META } from '../frontend/src/lib/hevy-exercises-data.js'
import { HEVY_COMPATIBILITY } from '../frontend/src/lib/hevy-compatibility.js'
import { HEVY_MEDIA_MANIFEST, HEVY_MEDIA_SUMMARY } from '../frontend/src/lib/hevy-media-manifest.js'
import { EXERCISE_NAMES_ES } from '../frontend/src/lib/exercise-names.es.js'
import { default as SPANISH_INSTRUCTIONS } from '../frontend/src/instr/es.js'
import { isUnavailableInstruction, parseInstructionSteps } from './build-instructions.mjs'

const args = process.argv.slice(2)
const valueAfter = name => {
  const index = args.indexOf(name)
  return index < 0 ? null : args[index + 1] || null
}
const input = valueAfter('--input')
const mediaDir = valueAfter('--media-dir')

function fail(message) { throw new Error(message) }
function loadInput(path) {
  if (!path || !existsSync(path)) fail(`input file not found: ${path || '<missing --input>'}`)
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const records = data?.exercises?.filter(ex => !ex.is_archived && !ex.is_custom) || []
  return { data, records }
}
function mediaFiles(path) {
  if (!path) return null
  if (!existsSync(path)) fail(`media directory not found: ${path}`)
  return new Set(readdirSync(path).filter(file => /^[0-9A-Z]{8}\.(jpg|jpeg|png|mp4)$/i.test(file)).map(file => file.toUpperCase()))
}
function expectedMode(ex) {
  if (['floors_duration', 'steps_duration', 'distance_duration'].includes(ex.exercise_type) || (ex.exercise_type === 'duration' && ex.muscle_group === 'cardio')) return 'cardio'
  if (['duration', 'short_distance_weight'].includes(ex.exercise_type)) return 'time'
  return 'reps'
}
function expectedTracking(ex) {
  return { floors_duration: 'floors', steps_duration: 'steps', distance_duration: 'distance', duration: 'duration', short_distance_weight: 'short_distance_weight' }[ex.exercise_type] || null
}

function audit() {
  const { data, records: source } = loadInput(input)
  const sourceById = new Map(source.map(ex => [ex.id, ex]))
  const errors = []
  const check = (condition, message) => { if (!condition) errors.push(message) }
  check(source.length === 451, `source active records: ${source.length}`)
  check(HEVY_EXDB.length === 451, `generated Hevy records: ${HEVY_EXDB.length}`)
  check(new Set(HEVY_EXDB.map(ex => ex.hevyId)).size === HEVY_EXDB.length, 'duplicate source IDs in generated catalog')
  check(new Set(HEVY_EXDB.map(ex => ex.id)).size === HEVY_EXDB.length, 'duplicate app IDs in generated catalog')
  check(new Set(EXDB.map(ex => ex.id)).size === EXDB.length, 'duplicate visible catalog IDs')
  check(!EXDB.some(ex => ex.id === '2330'), 'retired app ID 2330 is visible')
  check(!HEVY_EXDB.some(ex => ex.id === '2330' || ex.hevyId === '2330'), 'retired app ID 2330 is generated')
  check(source.every(ex => HEVY_EXDB.some(record => record.hevyId === ex.id)), 'source record missing from generated catalog')
  check(Object.keys(HEVY_COMPATIBILITY).every(id => sourceById.has(id)), 'compatibility map references an absent source ID')
  check(HEVY_CATALOG_META.sourceRecords === 451, 'generated source metadata is not 451')
  check(HEVY_CATALOG_META.unavailableInstructionRecords === 18, `unavailable instruction metadata: ${HEVY_CATALOG_META.unavailableInstructionRecords}`)
  check(HEVY_CATALOG_META.spanishInstructionRecords === 433, `Spanish instruction metadata: ${HEVY_CATALOG_META.spanishInstructionRecords}`)

  for (const record of HEVY_EXDB) {
    const raw = sourceById.get(record.hevyId)
    check(record.n === raw?.name_en, `English name mismatch: ${record.hevyId}`)
    check(EXERCISE_NAMES_ES[record.id] === raw?.name, `Spanish name mismatch: ${record.hevyId}`)
    check(record.mode === expectedMode(raw), `mode mismatch: ${record.hevyId}`)
    check(record.tracking === expectedTracking(raw), `tracking mismatch: ${record.hevyId}`)
    check(record.exerciseType === raw.exercise_type, `exercise type metadata mismatch: ${record.hevyId}`)
    check(!record.st?.length, `new Hevy row exposes unverified English instructions: ${record.hevyId}`)
    if (record.img) check(/^([0-9A-Z]{8})\.(jpg|png)$/i.test(record.img), `invalid thumbnail filename: ${record.hevyId}`)
    if (record.video) check(/^([0-9A-Z]{8})\.mp4$/i.test(record.video), `invalid video filename: ${record.hevyId}`)
    const expected = isUnavailableInstruction(raw) ? [] : parseInstructionSteps(raw)
    check(JSON.stringify(SPANISH_INSTRUCTIONS[record.id] || []) === JSON.stringify(expected), `Spanish instruction mismatch: ${record.hevyId}`)
    check(isUnavailableInstruction(raw) === !Object.hasOwn(SPANISH_INSTRUCTIONS, record.id), `sentinel coverage mismatch: ${record.hevyId}`)
  }
  check(Object.keys(EXERCISE_NAMES_ES).length === EXDB.length, 'Spanish map does not cover visible catalog exactly')
  check(HEVY_MEDIA_MANIFEST.length === 451, `media manifest records: ${HEVY_MEDIA_MANIFEST.length}`)
  check(HEVY_MEDIA_SUMMARY.records === 451, 'media summary records are not 451')
  check(HEVY_MEDIA_SUMMARY.videos === 449, `media video count: ${HEVY_MEDIA_SUMMARY.videos}`)
  check(HEVY_MEDIA_SUMMARY.jpg === 448, `media JPG count: ${HEVY_MEDIA_SUMMARY.jpg}`)
  check(HEVY_MEDIA_SUMMARY.png === 1, `media PNG count: ${HEVY_MEDIA_SUMMARY.png}`)
  check(HEVY_MEDIA_SUMMARY.missing === 2, `media missing count: ${HEVY_MEDIA_SUMMARY.missing}`)
  check(JSON.stringify(HEVY_MEDIA_MANIFEST.filter(row => !row.thumbnail && !row.video).map(row => row.hevyId).sort()) === JSON.stringify(['911A58D3', 'E23F1F2B']), 'missing media IDs changed')

  const files = mediaFiles(mediaDir)
  if (files) {
    for (const row of HEVY_MEDIA_MANIFEST) {
      if (row.thumbnail) check(files.has(row.thumbnail.toUpperCase()), `thumbnail missing from source directory: ${row.thumbnail}`)
      if (row.video) check(files.has(row.video.toUpperCase()), `video missing from source directory: ${row.video}`)
    }
  }
  if (errors.length) fail(errors.join('\n'))
  console.log(JSON.stringify({ sourceRecords: source.length, visibleCatalogRecords: EXDB.length, generatedRecords: HEVY_EXDB.length, mappedRecords: HEVY_CATALOG_META.mappedRecords, SpanishInstructionRecords: Object.keys(SPANISH_INSTRUCTIONS).length, media: HEVY_MEDIA_SUMMARY, mediaSourceChecked: !!files }, null, 2))
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { audit() } catch (error) { console.error(`Hevy audit failed: ${error.message}`); process.exitCode = 1 }
}
