import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./InactivityReminder.jsx', import.meta.url), 'utf8')
const messageHandler = source.slice(source.indexOf('const onMessage'), source.indexOf('navigator.serviceWorker.addEventListener'))

describe('active inactivity web push ownership', () => {
  it('only marks a matching active session and never toasts after the worker displayed it', () => {
    expect(messageHandler).toContain("event.data?.type === 'hforge-push-displayed'")
    expect(messageHandler).toContain('payload.sessionId !== A?.id')
    expect(messageHandler).toContain('state.active.inactivityReminderSent = true')
    expect(messageHandler).not.toContain('toast(')
    expect(source).toContain("toast(t('Still there? Your workout awaits.'))")
  })

  it('reconciles visible pages by cancelling pending web jobs', () => {
    expect(source).toContain("if (document.visibilityState === 'visible')")
    expect(source).toContain('void recoverInactivityPush(A.id).then(status =>')
    expect(source).toContain('void cancelInactivityPush(A.id).catch(() => {})')
  })
})
