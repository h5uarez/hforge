// Pure weight-control helpers shared by the weight picker consumers.
// The formatter accepts a locale so this module stays independent of the app's i18n state.

// Fixed range, not a moving window — a window that resizes itself mid-drag (the previous
// attempt) makes the thumb's position unpredictable: every time it grows, everything already
// placed on it shifts toward one side. A static range never has that problem, at the cost of
// coarser precision per pixel — the +/- buttons cover exact values.
// The ceiling follows the profile's unit while keeping kg and lb equivalent for bodyweight
// entry: 180 kg is approximately 396 lb.
const W_LO = 1

export const weightBounds = unit => ({ min: W_LO, max: unit === 'lb' ? 396 : 180, step: 1 })

const weightNumber = value => typeof value === 'string' ? Number(value.trim().replace(',', '.')) : Number(value)

const roundWeight = (value, allowDecimals) => {
  const scale = allowDecimals ? 100 : 1
  return Math.round((value + Number.EPSILON) * scale) / scale
}

export const clampWeight = (value, unit, allowDecimals = false) => {
  const { min, max } = weightBounds(unit)
  const n = weightNumber(value)
  const rounded = roundWeight(Number.isFinite(n) ? n : 0, allowDecimals)
  return Math.max(min, Math.min(max, rounded))
}

export const adjustWeight = (value, delta, unit, allowDecimals = false) =>
  clampWeight(weightNumber(value) + weightNumber(delta), unit, allowDecimals)

export const weightControlSteps = (allowDecimals, bodyweight = false) => bodyweight
  ? { primary: 0.5, chips: [] }
  : allowDecimals
    ? { primary: 1, chips: [-0.25, 0.25] }
    : { primary: 1, chips: [-1, 1] }

export const savedWeight = (value, unit, allowDecimals = false) => {
  const raw = weightNumber(value)
  return Number.isFinite(raw) && raw > 0 ? clampWeight(raw, unit, allowDecimals) : null
}

// en-GB matches the app's default dateLocale; callers with a selected app language pass theirs.
export const fmtWeight = (value, allowDecimals = false, locale = 'en-GB') => {
  const n = weightNumber(value)
  const rounded = roundWeight(Number.isFinite(n) ? n : 0, allowDecimals)
  return rounded.toLocaleString(locale, { maximumFractionDigits: allowDecimals ? 2 : 0 })
}
