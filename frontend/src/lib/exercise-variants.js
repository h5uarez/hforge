import { EXDB } from './catalog.js'
import { canonicalExerciseId } from './exercise-ids.js'
import { uid } from './format.js'

const fail = () => { throw new Error('Invalid exercise variant: check the base exercise and all condition fields.') }
const text = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 120
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

export function normalizeVariant(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  let result
  switch (value.kind) {
    case 'pause':
      if (!number(value.durationSec, 0.1, 30) || !text(value.position)) return fail()
      result = { kind: 'pause', durationSec: value.durationSec, position: value.position.trim() }; break
    case 'tempo':
      if (![value.eccentricSec, value.bottomPauseSec, value.topPauseSec].every(n => number(n, 0, 30)) ||
        !(value.concentricSec === 'X' || number(value.concentricSec, 0, 30))) return fail()
      result = { kind: 'tempo', eccentricSec: value.eccentricSec, bottomPauseSec: value.bottomPauseSec, concentricSec: value.concentricSec, topPauseSec: value.topPauseSec }; break
    case 'pins':
      if (!text(value.position)) return fail()
      result = { kind: 'pins', position: value.position.trim() }; break
    case 'deficit':
    case 'blocks':
      if (!number(value.heightCm, 0.1, 100)) return fail()
      result = { kind: value.kind, heightCm: value.heightCm }; break
    case 'other':
      if (!text(value.detail)) return fail()
      result = { kind: 'other', detail: value.detail.trim() }; break
    default: return fail()
  }
  if (Object.keys(value).some(key => !Object.hasOwn(result, key))) return fail()
  return result
}

export function variantKey(ex) {
  if (!ex?.variant || !ex.baseId) return null
  const variant = normalizeVariant(ex.variant)
  for (const key of ['position', 'detail']) if (variant[key]) variant[key] = variant[key].normalize('NFC').toLowerCase()
  return JSON.stringify([canonicalExerciseId(ex.baseId), variant])
}

export function variantSummary(variant) {
  const v = normalizeVariant(variant)
  if (v.kind === 'pause') return `Pause ${v.durationSec} s · ${v.position}`
  if (v.kind === 'tempo') return `Tempo ${v.eccentricSec}-${v.bottomPauseSec}-${v.concentricSec}-${v.topPauseSec}`
  if (v.kind === 'pins') return `Pins · ${v.position}`
  if (v.kind === 'other') return v.detail
  return `${v.kind === 'deficit' ? 'Deficit' : 'Blocks'} ${v.heightCm} cm`
}

// Validate the whole graph before import mutates state. One derivation level is intentional:
// a variant of a variant must explicitly name the actual execution as a single condition.
export function validateCustomVariants(list) {
  const index = new Map(EXDB.map(ex => [ex.id, ex]))
  const ids = new Set()
  const variantIds = new Set(list.filter(ex => ex.variant || ex.baseId).map(ex => ex.id))
  for (const ex of list) {
    if (ids.has(ex.id) && variantIds.has(ex.id)) return fail()
    if (ex.variant || ex.baseId) {
      if (!text(ex.id) || typeof canonicalExerciseId(ex.id) !== 'string' || index.has(canonicalExerciseId(ex.id)) || !text(ex.n)) return fail()
    }
    ids.add(ex.id)
  }
  for (const ex of list) if (!ex.variant && !ex.baseId) index.set(ex.id, ex)
  return list.map(ex => {
    if (!ex.variant && !ex.baseId) return { ...ex }
    const baseId = canonicalExerciseId(ex.baseId)
    const base = index.get(baseId)
    if (!base || base.variant || ex.id === baseId) return fail()
    return { ...ex, baseId, bp: base.bp, variant: normalizeVariant(ex.variant) }
  })
}

export function hydrateCustomExercises(list = []) {
  const index = new Map([...EXDB, ...list.filter(ex => !ex.variant)].map(ex => [ex.id, ex]))
  return list.map(ex => {
    if (!ex.variant) return ex
    const base = index.get(canonicalExerciseId(ex.baseId))
    return {
      bp: base?.bp || ex.bp, tg: base?.tg || '', mg: base?.mg || '', sm: base?.sm || [],
      eq: base?.eq || 'custom', mode: base?.mode, bodyweight: base?.bodyweight,
      ...ex, custom: true, img: null, gif: null, video: null,
    }
  })
}

export function createOrReuseVariant(state, baseId, variant, name) {
  const definition = { id: 'v' + uid(), baseId: canonicalExerciseId(baseId), variant: normalizeVariant(variant), n: name }
  const base = [...EXDB, ...(state.customEx || [])].find(ex => ex.id === definition.baseId)
  definition.n = text(name) ? name.trim() : `${base?.n || ''} · ${variantSummary(definition.variant)}`
  const [clean] = validateCustomVariants([...(state.customEx || []).filter(ex => !ex.variant), definition]).slice(-1)
  const key = variantKey(clean)
  const same = [...EXDB, ...(state.customEx || [])].find(ex => variantKey(ex) === key)
  if (same) {
    if (same.archived) state.customEx = state.customEx.map(ex => ex.id === same.id ? { ...ex, archived: false } : ex)
    return same.id
  }
  ;(state.customEx ||= []).push({ ...clean, custom: true })
  return clean.id
}

export function referencedCustomExercises(list = [], ids) {
  const needed = new Set(ids)
  // A dependency may occur before or after its variant in state.
  let changed = true
  while (changed) {
    changed = false
    for (const ex of list) if (needed.has(ex.id) && ex.baseId && !needed.has(ex.baseId)) {
      needed.add(ex.baseId); changed = true
    }
  }
  return list.filter(ex => needed.has(ex.id))
}
