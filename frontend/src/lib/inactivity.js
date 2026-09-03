export const INACTIVITY_THRESHOLD_MS = 15 * 60 * 1000

// Keep this id outside the weekly reminder range (100–106). Capacitor requires a signed 32-bit
// integer and uses the id to cancel the one-shot when the session changes or receives a record edit.
export const ACTIVE_INACTIVITY_NOTIFICATION_ID = 200

const finiteTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function normalizeActiveInactivity(active) {
  if (!active || typeof active !== 'object' || Array.isArray(active) || !Array.isArray(active.entries)) return active
  const next = { ...active }
  // Legacy active sessions have no edit timestamp. Starting the reference at `start` gives them
  // the same behavior without inventing a second duration field or changing their shape otherwise.
  if (finiteTime(next.lastRecordEditAt)) next.lastRecordEditAt = next.lastRecordEditAt
  else if (finiteTime(next.start)) next.lastRecordEditAt = next.start
  else delete next.lastRecordEditAt
  if (typeof next.inactivityReminderSent === 'boolean') next.inactivityReminderSent = next.inactivityReminderSent
  else next.inactivityReminderSent = false
  return next
}

export function inactivityReference(active) {
  if (finiteTime(active?.lastRecordEditAt)) return active.lastRecordEditAt
  if (finiteTime(active?.start)) return active.start
  return null
}

export function inactivityDeadline(active) {
  const reference = inactivityReference(active)
  return reference === null ? null : reference + INACTIVITY_THRESHOLD_MS
}

export function inactivityDue(active, now = Date.now(), { restActive = false, timedWorkActive = false } = {}) {
  const deadline = inactivityDeadline(active)
  return deadline !== null && finiteTime(now) && active?.inactivityReminderSent !== true
    && !restActive && !timedWorkActive && now >= deadline
}

// Called only by actual workout-record mutations. Navigation, disclosure, focus, and timer state
// deliberately stay outside this helper so they cannot postpone the reminder.
export function touchActiveRecord(active, at = Date.now()) {
  if (active && typeof active === 'object' && finiteTime(at)) active.lastRecordEditAt = at
  return active
}

export function consumeInactivityReminder(active, now = Date.now(), options) {
  if (!inactivityDue(active, now, options)) return { eligible: false, active }
  return { eligible: true, active: { ...active, inactivityReminderSent: true } }
}

// A native schedule survives the WebView, but the durable sent bit may not have been written before
// the OS delivered it. Claim only a marker for the current session and current deadline; an older
// marker must not suppress a reminder that was re-armed by a later edit.
export function recoverInactivitySchedule(active, marker, now = Date.now()) {
  const deadline = inactivityDeadline(active)
  const matches = !!active && !!marker
    && marker.sessionId === active.id
    && finiteTime(marker.deadline) && marker.deadline === deadline
    && finiteTime(marker.scheduledAt)
  if (!matches || !finiteTime(now)) return { action: 'reschedule', active }
  if (now < marker.scheduledAt) return { action: 'preserve', active }
  return { action: 'consume', active: { ...active, inactivityReminderSent: true } }
}
