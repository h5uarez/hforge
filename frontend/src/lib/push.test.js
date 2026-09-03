import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api.js', () => ({ api: vi.fn() }))

import { api } from './api.js'
import {
  cancelInactivityPush, pushPathCapable, recoverInactivityPush,
  scheduleInactivityPush, statusInactivityPush,
} from './push.js'

describe('durable web inactivity push client API', () => {
  let subscription
  let registration

  beforeEach(() => {
    subscription = { endpoint: 'https://push.example/client', toJSON: () => ({ endpoint: 'https://push.example/client' }) }
    registration = { pushManager: { getSubscription: vi.fn(async () => subscription) } }
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(registration) } })
    vi.stubGlobal('window', { PushManager: function PushManager() {}, Notification: { permission: 'granted' } })
    vi.stubGlobal('Notification', { permission: 'granted' })
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'gym.example.com' })
    api.mockReset()
    api.mockResolvedValue({ ok: true, status: 'pending' })
  })

  it('allows HTTPS and localhost but not plain LAN HTTP', () => {
    expect(pushPathCapable()).toBe(true)
    location.protocol = 'http:'
    location.hostname = 'localhost'
    expect(pushPathCapable()).toBe(true)
    location.hostname = '192.168.1.20'
    expect(pushPathCapable()).toBe(false)
  })

  it('schedules only with an active browser subscription and sends bounded metadata', async () => {
    await scheduleInactivityPush({ sessionId: 'workout-a', deadline: 1_700_000_900_000, locale: 'es' })
    expect(api).toHaveBeenCalledWith('/api/push/inactivity/schedule', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ sessionId: 'workout-a', deadline: 1_700_000_900_000, locale: 'es' }),
    }))

    registration.pushManager.getSubscription.mockResolvedValue(null)
    api.mockClear()
    expect(await scheduleInactivityPush({ sessionId: 'workout-b', deadline: 1_700_000_900_000, locale: 'en' })).toEqual({ status: 'unavailable' })
    expect(api).not.toHaveBeenCalled()
  })

  it('exposes authenticated cancel and status/recovery calls for one session', async () => {
    await cancelInactivityPush('workout/a')
    await recoverInactivityPush('workout/a')
    await statusInactivityPush('workout/a')
    expect(api).toHaveBeenNthCalledWith(1, '/api/push/inactivity/cancel', expect.objectContaining({ method: 'POST' }))
    expect(api).toHaveBeenNthCalledWith(2, '/api/push/inactivity/recover', expect.objectContaining({ method: 'POST' }))
    expect(api).toHaveBeenNthCalledWith(3, '/api/push/inactivity/status?sessionId=workout%2Fa')
  })
})
