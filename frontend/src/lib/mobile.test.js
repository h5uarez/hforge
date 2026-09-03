import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const start = 1_700_000_000_000

describe('native active inactivity notification lifecycle', () => {
  let localValues
  let LocalNotifications
  let mobile

  beforeEach(async () => {
    localValues = new Map()
    vi.stubGlobal('localStorage', {
      getItem: key => localValues.get(key) || null,
      setItem: (key, value) => localValues.set(key, String(value)),
      removeItem: key => localValues.delete(key),
    })
    LocalNotifications = {
      cancel: vi.fn(async () => {}),
      checkPermissions: vi.fn(async () => ({ display: 'granted' })),
      schedule: vi.fn(async () => ({ notifications: [] })),
      addListener: vi.fn(async (_event, handler) => ({ remove: vi.fn(), handler })),
    }
    vi.doMock('@capacitor/local-notifications', () => ({ LocalNotifications }))
    vi.stubEnv('VITE_MOBILE', '1')
    vi.resetModules()
    mobile = await import('./mobile.js')
  })

  afterEach(() => {
    vi.doUnmock('@capacitor/local-notifications')
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('schedules one non-repeating notification at the fixed deadline', async () => {
    const active = { id: 'w1', start, lastRecordEditAt: start, inactivityReminderSent: false }
    expect(await mobile.syncActiveInactivity({ active }, start)).toBe(true)
    expect(LocalNotifications.schedule).toHaveBeenCalledTimes(1)
    const [options] = LocalNotifications.schedule.mock.calls[0]
    expect(options.notifications).toHaveLength(1)
    expect(options.notifications[0]).toMatchObject({
      id: 200,
      title: 'Hforge',
      body: 'Still there? Your workout awaits.',
      extra: { kind: 'active-inactivity', sessionId: 'w1' },
      schedule: { allowWhileIdle: true, repeats: false },
    })
    expect(options.notifications[0].schedule.at.getTime()).toBe(start + 15 * 60 * 1000)
  })

  it('cancels the native schedule when the session is finished or discarded', async () => {
    const active = { id: 'w1', start, lastRecordEditAt: start, inactivityReminderSent: false }
    await mobile.syncActiveInactivity({ active }, start)
    await mobile.cancelActiveInactivity()
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 200 }] })
    expect(mobile.activeInactivityScheduleState()).toBeNull()
    expect(localValues.has('gym_active_inactivity_schedule_v1')).toBe(false)
  })

  it('does not schedule a sent or timer-suppressed session', async () => {
    const sent = { id: 'w1', start, lastRecordEditAt: start, inactivityReminderSent: true }
    const rest = { id: 'w2', start, lastRecordEditAt: start, inactivityReminderSent: false }
    expect(await mobile.syncActiveInactivity({ active: sent }, start)).toBe(false)
    expect(await mobile.syncActiveInactivity({ active: rest }, start, { restActive: true })).toBe(false)
    expect(LocalNotifications.schedule).not.toHaveBeenCalled()
  })
})
