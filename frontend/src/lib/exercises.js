import { EXDB } from './exercises-data.js'
import { getLang, t } from './i18n.js'
import {
  EXERCISE_NAMES_ES, EXERCISE_ALIASES_ES, EXERCISE_NAME_ANGLICISMS_ES,
  EXERCISE_NAME_COLLISIONS_ES,
} from './exercise-names.es.js'

export { EXDB }
export const EXIDX = {}
EXDB.forEach(e => { EXIDX[e.id] = e })
export const BODYPARTS = [...new Set(EXDB.map(e => e.bp))].sort()

// Equipment options present in a given list of exercises, most common first (issue #6).
// Deriving them from the *already filtered* list keeps the chip row short and means
// every body-part × equipment combination on screen has results behind it.
export function equipmentOf(list) {
  const c = {}
  list.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
}

// Custom (user-created) exercises live in synced state S.customEx (issue #11) and are
// merged into the id index here so every EXIDX[id] lookup keeps working unchanged.
let customIds = []
export function registerCustom(list) {
  customIds.forEach(id => delete EXIDX[id])
  customIds = (list || []).map(e => e.id)
  ;(list || []).forEach(e => { EXIDX[e.id] = e })
}
// Full searchable catalogue — customs first so your own exercises are easy to find.
export const allExercises = st => [...(st.customEx || []), ...EXDB]

const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const isSpanish = lang => String(lang || '').toLowerCase().startsWith('es')

/** User-facing exercise name. Custom names always remain exactly as the user wrote them. */
export function exerciseName(ex, lang = getLang()) {
  if (!ex) return t('Unknown exercise')
  if (ex.custom || !isSpanish(lang)) return ex.n
  return EXERCISE_NAMES_ES[ex.id] || ex.n
}

/** Canonical, localized and curated alternative names used by search and import. */
export function exerciseMatchNames(ex) {
  if (!ex) return []
  if (ex.custom) return [ex.n]
  return [...new Set([ex.n, EXERCISE_NAMES_ES[ex.id], ...(EXERCISE_ALIASES_ES[ex.id] || [])].filter(Boolean))]
}

export function exerciseMatches(ex, query) {
  const q = fold(query)
  if (!q) return true
  return fold([
    ...exerciseMatchNames(ex), ex.tg, ex.eq, ex.desc,
  ].filter(Boolean).join(' ')).includes(q)
}

/** Auditable catalog coverage; duplicate localized labels are surfaced, never hidden. */
export function exerciseNameAudit(catalog = EXDB) {
  const catalogIds = new Set(catalog.map(ex => ex.id))
  const translatedIds = Object.keys(EXERCISE_NAMES_ES)
  const translatedSet = new Set(translatedIds)
  const missingIds = catalog.map(ex => ex.id).filter(id => !translatedSet.has(id))
  const unknownIds = translatedIds.filter(id => !catalogIds.has(id))
  const emptyIds = translatedIds.filter(id => !String(EXERCISE_NAMES_ES[id] || '').trim())
  const byName = new Map()
  translatedIds.forEach(id => {
    const key = fold(EXERCISE_NAMES_ES[id])
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(id)
  })
  const groupKey = ids => [...ids].sort().join('|')
  const allowed = new Set(EXERCISE_NAME_COLLISIONS_ES.map(entry => groupKey(entry.ids)))
  const allCollisions = [...byName.entries()].filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({ name, ids: [...ids].sort() }))
  const collisions = allCollisions.filter(entry => !allowed.has(groupKey(entry.ids)))
  const identicalToEnglish = catalog.filter(ex => fold(ex.n) === fold(EXERCISE_NAMES_ES[ex.id])).map(ex => ex.id)
  const approvedEnglish = new Set(Object.keys(EXERCISE_NAME_ANGLICISMS_ES))
  return {
    total: catalog.length,
    translated: translatedIds.length,
    fallback: missingIds.length,
    coverage: catalog.length ? translatedIds.length / catalog.length : 0,
    missingIds,
    unknownIds,
    emptyIds,
    collisions,
    allowedCollisions: allCollisions.filter(entry => allowed.has(groupKey(entry.ids))),
    identicalToEnglish,
    anglicismsAllowed: approvedEnglish.size,
    unapprovedEnglish: identicalToEnglish.filter(id => !approvedEnglish.has(id)),
  }
}

// Media normally sits next to the app (img/ and gif/, mounted into the web container).
// A build can point them somewhere else — the demo build pulls them off a CDN instead of
// shipping ~140 MB of images into the deployment.
const IMG_BASE = import.meta.env.VITE_IMG_BASE || 'img/'
const GIF_BASE = import.meta.env.VITE_GIF_BASE || 'gif/'
export const imgSrc = ex => IMG_BASE + ex.img
export const gifSrc = ex => GIF_BASE + ex.gif

// Cardio exercises log time + speed instead of weight × reps.
export const isCardio = idOrEx => (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.bp === 'cardio'

// Exercises the catalog already knows carry no external load (issue #32) — a quarter of the
// catalogue. This seeds the `bw` flag on a fresh config so a push-up never asks for a weight
// nobody was going to enter. It is only the default: the flag lives on the config, so a dip
// done with a belt can turn it off and a custom exercise can turn it on.
export const isBodyweightEq = idOrEx =>
  (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.eq === 'body weight'

// An id that resolves to nothing — a plan file built against a different exercise catalog,
// a custom exercise deleted on another device before the sync arrived — still has to
// render. A placeholder keeps it visible (and removable) instead of taking the whole view
// down on the first `ex.n`.
export const exOr = id => EXIDX[id] ||
  { id, n: t('Unknown exercise'), bp: '', tg: '', eq: '', sm: [], st: [], missing: true }
