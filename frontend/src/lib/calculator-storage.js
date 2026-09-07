import { WARMUP_OPTIONS } from './warmup.js'

export const HOME_1RM_STORAGE_KEY = 'hforge_home_1rm_v1'
export const HOME_WARMUP_STORAGE_KEY = 'hforge_home_warmup_v1'

const ONE_RM_TIERS = new Set(['HIGH', 'MEDIUM', 'unreliable'])
const WARMUP_EXERCISE_IDS = new Set(WARMUP_OPTIONS.map(option => option.id))

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = value => typeof value === 'number' && Number.isFinite(value)
const nonNegative = (value, fallback = 0) => finite(value) && value >= 0 ? value : fallback
const bounded = (value, min, max, fallback) => finite(value) ? Math.min(max, Math.max(min, value)) : fallback
const integerNonNegative = (value, fallback = 0) => finite(value) && value >= 0 ? Math.round(value) : fallback
const nullableBounded = (value, min, max) => value == null ? null : bounded(value, min, max, null)

const validOneRMResult = result => result === null || (
  isRecord(result) && finite(result.est) && result.est > 0
  && ONE_RM_TIERS.has(result.tier) && typeof result.failureAssumed === 'boolean'
)

const validWarmupSet = set => isRecord(set)
  && finite(set.kg) && set.kg >= 0
  && Number.isInteger(set.reps) && set.reps >= 1
  && finite(set.pct) && set.pct >= 0 && set.pct <= 100
  && (set.label === null || typeof set.label === 'string')
  && Number.isInteger(set.restSec) && set.restSec >= 0

const validWarmupResult = result => result === null || (
  isRecord(result) && Array.isArray(result.sets) && result.sets.every(validWarmupSet)
  && typeof result.topLine === 'string' && result.topLine.length <= 100
)

export function loadCalculatorState(key, fallback, sanitize) {
  try {
    const storage = globalThis.localStorage
    if (!storage || typeof storage.getItem !== 'function') return fallback
    const raw = storage.getItem(key)
    if (!raw) return fallback
    return sanitize(JSON.parse(raw)) || fallback
  } catch {
    return fallback
  }
}

export function saveCalculatorState(key, state) {
  try {
    const storage = globalThis.localStorage
    if (!storage || typeof storage.setItem !== 'function') return false
    storage.setItem(key, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function sanitizeHome1RMState(value) {
  if (!isRecord(value)) return null
  return {
    open: value.open === true,
    kg: nonNegative(value.kg),
    reps: Math.min(10, integerNonNegative(value.reps)),
    rir: nullableBounded(value.rir, 0, 5),
    res: validOneRMResult(value.res) ? value.res : null,
  }
}

export function sanitizeHomeWarmupState(value) {
  if (!isRecord(value)) return null
  return {
    open: value.open === true,
    exerciseId: WARMUP_EXERCISE_IDS.has(value.exerciseId) ? value.exerciseId : WARMUP_OPTIONS[0].id,
    kg: nonNegative(value.kg),
    reps: integerNonNegative(value.reps),
    addedKg: nonNegative(value.addedKg),
    rir: nullableBounded(value.rir, 0, 5),
    res: validWarmupResult(value.res) ? value.res : null,
  }
}
