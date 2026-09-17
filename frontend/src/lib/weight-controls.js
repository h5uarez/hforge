// Pure weight-control helpers shared by the weight picker consumers.
// The formatter accepts a locale so this module stays independent of the app's i18n state.

// Fixed range, not a moving window — a window that resizes itself mid-drag (the previous
// attempt) makes the thumb's position unpredictable: every time it grows, everything already
// placed on it shifts toward one side. A static range never has that problem, at the cost of
// coarser precision per pixel — the +/- buttons cover exact values.
// Ordinary selectors keep the established bodyweight/goal ceiling. TopWeight is intentionally a
// separate range: it records an exceptional confirmed working load without widening ordinary
// controls. The lb equivalents preserve the app's existing 2.2x convention (180 kg → 396 lb).
const W_LO = 1
const ORDINARY_MAX = { kg: 180, lb: 396 }
const TOP_WEIGHT_MAX = { kg: 500, lb: 1100 }

const boundsFor = (unit, maxes) => ({ min: W_LO, max: maxes[unit] || maxes.kg, step: 1 })
export const weightBounds = unit => boundsFor(unit, ORDINARY_MAX)
export const topWeightBounds = unit => boundsFor(unit, TOP_WEIGHT_MAX)

const weightNumber = value => typeof value === 'string' ? Number(value.trim().replace(',', '.')) : Number(value)

const roundWeight = (value, allowDecimals) => {
  const scale = allowDecimals ? 100 : 1
  return Math.round((value + Number.EPSILON) * scale) / scale
}

const clampInBounds = (value, unit, allowDecimals, getBounds) => {
  const { min, max } = getBounds(unit)
  const n = weightNumber(value)
  const rounded = roundWeight(Number.isFinite(n) ? n : 0, allowDecimals)
  return Math.max(min, Math.min(max, rounded))
}
export const clampWeight = (value, unit, allowDecimals = false) => clampInBounds(value, unit, allowDecimals, weightBounds)
export const clampTopWeight = (value, unit, allowDecimals = false) => clampInBounds(value, unit, allowDecimals, topWeightBounds)

export const adjustWeight = (value, delta, unit, allowDecimals = false) =>
  clampWeight(weightNumber(value) + weightNumber(delta), unit, allowDecimals)
export const adjustTopWeight = (value, delta, unit, allowDecimals = false) =>
  clampTopWeight(weightNumber(value) + weightNumber(delta), unit, allowDecimals)

// Routine targets may be explicitly unloaded (0), unlike picker values whose minimum is 1.
// Positive values still use the ordinary picker ceiling so the routine editor cannot widen the
// TopWeight range by accident.
export const clampConfiguredWeight = (value, unit, allowDecimals = true) => {
  const n = weightNumber(value)
  return Number.isFinite(n) && n > 0 ? clampWeight(n, unit, allowDecimals) : 0
}

export const weightControlSteps = (allowDecimals, bodyweight = false) => bodyweight
  ? { primary: 0.5, chips: [] }
  : allowDecimals
    ? { primary: 1, chips: [-0.25, 0.25] }
    : { primary: 1, chips: [-1, 1] }

export const savedWeight = (value, unit, allowDecimals = false) => {
  const raw = weightNumber(value)
  return Number.isFinite(raw) && raw > 0 ? clampWeight(raw, unit, allowDecimals) : null
}
export const savedTopWeight = (value, unit, allowDecimals = false) => {
  const raw = weightNumber(value)
  return Number.isFinite(raw) && raw > 0 ? clampTopWeight(raw, unit, allowDecimals) : null
}

// en-GB matches the app's default dateLocale; callers with a selected app language pass theirs.
export const fmtWeight = (value, allowDecimals = false, locale = 'en-GB') => {
  const n = weightNumber(value)
  const rounded = roundWeight(Number.isFinite(n) ? n : 0, allowDecimals)
  return rounded.toLocaleString(locale, { maximumFractionDigits: allowDecimals ? 2 : 0 })
}
