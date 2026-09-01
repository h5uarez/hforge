import { uid } from './format.js'

const validSid = sid => typeof sid === 'string' && sid.length > 0
const legacySid = (entry, index) => `session-${String(entry?.id ?? 'entry').replace(/[^a-zA-Z0-9_-]/g, '_')}-${index}`

// Active entries are snapshots. Missing IDs are deterministic during migration; new entries use
// uid(), while duplicate exercise IDs remain distinct and retain every existing field.
export function normalizeActiveSession(active) {
  if (!active || typeof active !== 'object' || !Array.isArray(active.entries)) return active
  const used = new Set()
  const entries = active.entries.map((source, index) => {
    const entry = source && typeof source === 'object' ? { ...source } : { id: source }
    let sid = validSid(entry.sid) ? entry.sid : legacySid(entry, index)
    let suffix = 1
    while (used.has(sid)) sid = `${sid}-${suffix++}`
    used.add(sid)
    return { ...entry, sid }
  })
  const cur = Number.isInteger(active.cur) ? Math.max(0, Math.min(active.cur, Math.max(0, entries.length - 1))) : 0
  const rest = active.restResume
  const restResume = rest && Number.isFinite(rest.endsAt) && Number.isFinite(rest.total)
    && rest.total > 0 && validSid(rest.sid) && entries.some(entry => entry.sid === rest.sid)
    ? { endsAt: rest.endsAt, total: rest.total, sid: rest.sid }
    : undefined
  const next = { ...active, entries, cur }
  if (restResume) next.restResume = restResume
  else delete next.restResume
  return next
}

export function sessionUnits(entries = []) {
  const units = []
  entries.forEach((entry, index) => {
    const previous = entries[index - 1]
    if (index && entry?.sg && previous?.sg && entry.sg === previous.sg) units[units.length - 1].push(index)
    else units.push([index])
  })
  return units
}

export function remapCur(before, cur, after) {
  const current = before?.[cur]
  if (!current) return Math.max(0, Math.min(cur || 0, Math.max(0, (after?.length || 1) - 1)))
  const sid = current.sid
  const next = (after || []).findIndex(entry => sid && entry?.sid === sid)
  return next >= 0 ? next : Math.max(0, Math.min(cur || 0, Math.max(0, (after?.length || 1) - 1)))
}

// unitIndex addresses the projected sessionUnits list, not an entry index.
export function moveSessionUnit(entries, unitIndex, delta) {
  const units = sessionUnits(entries)
  if (!Array.isArray(entries) || !Number.isInteger(unitIndex) || !Number.isInteger(delta) || !delta || !units[unitIndex]) {
    return { changed: false, entries, movedSid: null, position: -1 }
  }
  const target = unitIndex + delta
  if (target < 0 || target >= units.length) return { changed: false, entries, movedSid: null, position: -1 }
  const order = units.map((_, index) => index)
  const [moved] = order.splice(unitIndex, 1)
  order.splice(target, 0, moved)
  const next = order.flatMap(index => units[index].map(entryIndex => entries[entryIndex]))
  const movedSid = entries[units[unitIndex][0]]?.sid || null
  return { changed: true, entries: next, movedSid, position: target }
}

export const newSessionSid = () => uid()

export const FOCUS_REF_RETRY_LIMIT = 3

export function focusRefRetryDecision(attempts, fallbackUsed, hasTarget) {
  if (hasTarget) return { action: 'restore' }
  if (attempts < FOCUS_REF_RETRY_LIMIT) return { action: 'frame', attempts: attempts + 1 }
  if (!fallbackUsed) return { action: 'fallback' }
  return { action: 'stop' }
}

// Embedded browsers can move focus back to the document while applying a scroll.
// Reassert focus after the one-shot visibility request without passive scrolling.
export function restoreFocusedEntry(target, scroll = true) {
  if (!target) return false
  target.focus?.({ preventScroll: true })
  if (scroll) target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'auto' })
  target.focus?.({ preventScroll: true })
  return true
}
