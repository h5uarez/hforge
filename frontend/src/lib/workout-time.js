const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/

const finiteTimestamp = value => typeof value === 'number' && Number.isFinite(value)
const safeTimestamp = value => finiteTimestamp(value) && Number.isSafeInteger(value) && value > 0
const pad = value => String(value).padStart(2, '0')

// `datetime-local` deliberately has no timezone. Interpret its fields in the user's current
// local calendar rather than letting a UTC conversion move the workout to a different day.
export function parseWorkoutDateTime(raw) {
  const match = String(raw ?? '').trim().match(LOCAL_DATETIME)
  if (!match) return null
  const [, y, mo, d, h, mi, sec = '0', fraction = ''] = match
  const year = Number(y), month = Number(mo), day = Number(d), hour = Number(h), minute = Number(mi), second = Number(sec)
  const milliseconds = fraction ? Number(fraction.padEnd(3, '0')) : 0
  const date = new Date(year, month - 1, day, hour, minute, second, milliseconds)
  if (!Number.isFinite(date.getTime())
    || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second
    || date.getMilliseconds() !== milliseconds) return null
  return date.getTime()
}

export function formatWorkoutDateTime(timestamp) {
  if (!finiteTimestamp(timestamp)) return ''
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function localDateKey(timestamp) {
  if (!finiteTimestamp(timestamp)) return null
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return null
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function validateWorkoutTimestamps(start, end) {
  if (!finiteTimestamp(start) || !finiteTimestamp(end) || !localDateKey(start) || !localDateKey(end)) {
    return { ok: false, reason: 'invalid' }
  }
  if (end < start) return { ok: false, reason: 'order' }
  return { ok: true, start, end, d: localDateKey(start), duration: end - start }
}

// History timestamps have two deliberately separate representations. Older records are keyed
// only by their calendar date; accepting them here must never manufacture a time at midnight.
export function classifyWorkoutTimestamps(start, end) {
  const hasStart = start !== undefined && start !== null
  const hasEnd = end !== undefined && end !== null
  if ((!hasStart || start === 0) && (!hasEnd || end === 0)) return { kind: 'legacy' }
  if (!safeTimestamp(start) || !safeTimestamp(end)) return { kind: 'invalid', reason: 'invalid' }
  if (end < start) return { kind: 'invalid', reason: 'order' }
  const startDate = new Date(start), endDate = new Date(end)
  if (!localDateKey(start) || !localDateKey(end) || !Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    return { kind: 'invalid', reason: 'invalid' }
  }
  return { kind: 'timestamped', start, end, d: localDateKey(start), duration: end - start }
}

export function shiftWorkoutTimestamps(start, end, fromDate, toDate) {
  const classification = classifyWorkoutTimestamps(start, end)
  if (classification.kind !== 'timestamped') return classification
  const from = parseWorkoutDateTime(`${fromDate}T00:00:00`)
  const to = parseWorkoutDateTime(`${toDate}T00:00:00`)
  if (from === null || to === null) return { kind: 'invalid', reason: 'date' }
  const offsetDays = Math.round((to - from) / 86400000)
  const shiftedStart = new Date(start), shiftedEnd = new Date(end)
  shiftedStart.setDate(shiftedStart.getDate() + offsetDays)
  shiftedEnd.setDate(shiftedEnd.getDate() + offsetDays)
  return classifyWorkoutTimestamps(+shiftedStart, +shiftedEnd)
}

export function normalizeWorkoutDateEdit(workout, date) {
  const classification = classifyWorkoutTimestamps(workout?.start, workout?.end)
  if (classification.kind === 'legacy') {
    const copy = { ...workout, d: date }
    delete copy.start
    delete copy.end
    return copy
  }
  if (classification.kind !== 'timestamped') return classification
  const shifted = shiftWorkoutTimestamps(workout.start, workout.end, workout.d, date)
  if (shifted.kind !== 'timestamped') return shifted
  return { ...workout, d: shifted.d, start: shifted.start, end: shifted.end }
}

export function parseWorkoutTimestampEdit(startRaw, endRaw) {
  const start = parseWorkoutDateTime(startRaw)
  const end = parseWorkoutDateTime(endRaw)
  return validateWorkoutTimestamps(start, end)
}
