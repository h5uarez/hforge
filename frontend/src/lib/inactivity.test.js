import { describe, expect, it } from 'vitest'
import {
  INACTIVITY_THRESHOLD_MS, inactivityDeadline, inactivityDue, normalizeActiveInactivity,
  touchActiveRecord, consumeInactivityReminder, recoverInactivitySchedule,
} from './inactivity.js'

const START = 1_700_000_000_000
const active = (extra = {}) => ({ id: 'workout-1', start: START, lastRecordEditAt: START, inactivityReminderSent: false, ...extra })

describe('one-shot active workout inactivity reminder', () => {
  it('becomes eligible exactly 15 minutes after the session reference', () => {
    const A = active()
    expect(INACTIVITY_THRESHOLD_MS).toBe(15 * 60 * 1000)
    expect(inactivityDeadline(A)).toBe(START + INACTIVITY_THRESHOLD_MS)
    expect(inactivityDue(A, START + INACTIVITY_THRESHOLD_MS - 1)).toBe(false)
    expect(inactivityDue(A, START + INACTIVITY_THRESHOLD_MS)).toBe(true)
  })

  it('moves the reference when a record is edited before the first alert', () => {
    const edited = touchActiveRecord(active(), START + 5 * 60 * 1000)
    expect(edited.lastRecordEditAt).toBe(START + 5 * 60 * 1000)
    expect(inactivityDue(edited, START + INACTIVITY_THRESHOLD_MS)).toBe(false)
    expect(inactivityDue(edited, START + 5 * 60 * 1000 + INACTIVITY_THRESHOLD_MS)).toBe(true)
  })

  it('never rearms after the one notification has fired', () => {
    const result = consumeInactivityReminder(active(), START + INACTIVITY_THRESHOLD_MS)
    expect(result.eligible).toBe(true)
    expect(result.active.inactivityReminderSent).toBe(true)
    expect(inactivityDue(result.active, START + 3 * INACTIVITY_THRESHOLD_MS)).toBe(false)
    expect(consumeInactivityReminder(result.active, START + 4 * INACTIVITY_THRESHOLD_MS).eligible).toBe(false)
  })

  it('uses workout start for legacy active sessions and resets a fresh session', () => {
    const legacy = normalizeActiveInactivity({ id: 'legacy', start: START, entries: [] })
    expect(legacy.lastRecordEditAt).toBe(START)
    expect(legacy.inactivityReminderSent).toBe(false)
    expect(inactivityDue(null, START + INACTIVITY_THRESHOLD_MS)).toBe(false)
    expect(inactivityDue(active({ id: 'next', start: START + 1, lastRecordEditAt: START + 1 }), START + INACTIVITY_THRESHOLD_MS)).toBe(false)
  })

  it.each([
    ['rest', { restActive: true }],
    ['timed work', { timedWorkActive: true }],
  ])('suppresses a due alert while an active %s timer is running', (_name, options) => {
    expect(inactivityDue(active(), START + INACTIVITY_THRESHOLD_MS, options)).toBe(false)
    expect(inactivityDue(active(), START + INACTIVITY_THRESHOLD_MS)).toBe(true)
  })

  it('supports foreground visibility catch-up after a sleeping interval', () => {
    const A = active()
    // The foreground coordinator calls the same predicate from visibilitychange, so a missed
    // interval cannot lose the event once the document is visible again.
    expect(inactivityDue(A, START + INACTIVITY_THRESHOLD_MS + 60 * 1000)).toBe(true)
    const caughtUp = consumeInactivityReminder(A, START + INACTIVITY_THRESHOLD_MS + 60 * 1000)
    expect(caughtUp.active.inactivityReminderSent).toBe(true)
  })

  it('has no eligible state after finish or discard clears the active session', () => {
    expect(inactivityDue(undefined, START + INACTIVITY_THRESHOLD_MS)).toBe(false)
    expect(inactivityDue(null, START + INACTIVITY_THRESHOLD_MS)).toBe(false)
  })

  it('claims a delivered native marker only for the same current session deadline', () => {
    const deadline = START + INACTIVITY_THRESHOLD_MS
    const marker = { sessionId: 'workout-1', deadline, scheduledAt: deadline }
    const recovered = recoverInactivitySchedule(active(), marker, deadline)
    expect(recovered.action).toBe('consume')
    expect(recovered.active.inactivityReminderSent).toBe(true)
    expect(recoverInactivitySchedule(active({ id: 'other' }), marker, deadline).action).toBe('reschedule')
    expect(recoverInactivitySchedule(active({ lastRecordEditAt: START + 1 }), marker, deadline).action).toBe('reschedule')
    expect(recoverInactivitySchedule(active(), { ...marker, scheduledAt: deadline + 1 }, deadline).action).toBe('preserve')
  })
})
