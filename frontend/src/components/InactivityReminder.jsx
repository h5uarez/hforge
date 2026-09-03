import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { getLang, t } from '../lib/i18n.js'
import { consumeInactivityReminder, inactivityDeadline, recoverInactivitySchedule } from '../lib/inactivity.js'
import {
  MOBILE, syncActiveInactivity, cancelActiveInactivity, activeInactivityIsScheduled,
  activeInactivityScheduleState, listenForActiveInactivity,
} from '../lib/mobile.js'
import {
  cancelInactivityPush, recoverInactivityPush, scheduleInactivityPush,
} from '../lib/push.js'

const NATIVE_NOTIFICATION_GRACE_MS = 5000
const WEB_RECOVERY_TIMEOUT_MS = 2000
const ACTIVE_PUSH_CLAIM_KEY = 'gym_active_inactivity_push_claim_v1'

const claimVisibleEvent = sessionId => {
  try {
    if (localStorage.getItem(ACTIVE_PUSH_CLAIM_KEY) === sessionId) return false
    localStorage.setItem(ACTIVE_PUSH_CLAIM_KEY, sessionId)
  } catch { /* a single page still owns the event if storage is unavailable */ }
  return true
}

// Foreground fallback for the active-workout reminder. The interval is intentionally only a
// liveness check; the visibility listener is what catches a tab that slept through the deadline.
// Native builds also schedule the same one-shot in Capacitor, and this component cancels it before
// showing a toast whenever both paths can observe the event.
export default function InactivityReminder() {
  const sessionId = useStore(s => s.S.active?.id || null)
  const editAt = useStore(s => s.S.active?.lastRecordEditAt ?? null)
  const sent = useStore(s => s.S.active?.inactivityReminderSent === true)
  const userId = useStore(s => s.user?.id || null)
  const restActive = useUI(s => !!s.timer)
  const timedWorkActive = useUI(s => !!s.work)
  const toast = useUI(s => s.toast)

  useEffect(() => {
    let disposed = false
    const snapshot = () => {
      const state = useStore.getState()
      return {
        active: state.S.active,
        restActive: !!useUI.getState().timer,
        timedWorkActive: !!useUI.getState().work,
      }
    }
    const syncNative = () => {
      const current = snapshot()
      void syncActiveInactivity(useStore.getState().S, Date.now(), {
        restActive: current.restActive,
        timedWorkActive: current.timedWorkActive,
      })
    }
    let webReady = MOBILE || !userId || !snapshot().active
    const markWebSent = status => {
      if (status?.status !== 'sent') return false
      let claimed = false
      useStore.getState().update(state => {
        if (state.active?.id === status.sessionId && !state.active.inactivityReminderSent) {
          state.active.inactivityReminderSent = true
          claimed = true
        }
      }, false)
      return claimed
    }
    const recoverWeb = async () => {
      const current = snapshot()
      if (MOBILE || !userId || !current.active) return null
      try {
        const status = await Promise.race([
          recoverInactivityPush(current.active.id),
          new Promise(resolve => setTimeout(() => resolve(null), WEB_RECOVERY_TIMEOUT_MS)),
        ])
        if (!disposed && current.active.id === snapshot().active?.id) markWebSent(status)
        return status
      } catch { return null }
    }
    const syncWeb = async () => {
      const current = snapshot()
      const A = current.active
      if (MOBILE || !userId || !A || A.inactivityReminderSent === true) return
      if (document.visibilityState === 'visible') {
        // A visible page owns this path through check(). Reconcile any job left by a hidden
        // state, but never leave a pending server job competing with the foreground reminder.
        void recoverInactivityPush(A.id).then(status => {
          if (status?.status === 'sent') markWebSent(status)
          else if (!disposed && snapshot().active?.id === A.id && !snapshot().active.inactivityReminderSent)
            void cancelInactivityPush(A.id).catch(() => {})
        }).catch(() => {})
        return
      }
      if (current.restActive || current.timedWorkActive) {
        // Check the durable marker before cancelling a timer-suppressed pending job. A push may
        // have fired while this tab was hidden; that sent metadata must survive until finish or
        // discard rather than being mistaken for an unsent timer cancellation.
        void recoverInactivityPush(A.id).then(status => {
          if (status?.status === 'sent') markWebSent(status)
          else if (!disposed && snapshot().active?.id === A.id && !snapshot().active.inactivityReminderSent)
            void cancelInactivityPush(A.id).catch(() => {})
        }).catch(() => {})
        return
      }
      const deadline = inactivityDeadline(A)
      if (deadline === null) return
      try {
        await scheduleInactivityPush({ sessionId: A.id, deadline, locale: getLang() === 'es' ? 'es' : 'en' })
      } catch { /* foreground remains the fallback */ }
    }
    const check = () => {
      if (disposed || document.visibilityState === 'hidden') return
      if (!webReady) return
      const current = snapshot()
      const A = current.active
      if (!A) {
        if (MOBILE) void cancelActiveInactivity()
        return
      }
      const result = consumeInactivityReminder(A, Date.now(), {
        restActive: current.restActive,
        timedWorkActive: current.timedWorkActive,
      })
      if (!result.eligible) return

      // If native scheduling succeeded, a due local notification is the user-facing event. Mark
      // it consumed without adding a duplicate toast when the app resumes just after delivery.
      const nativeSchedule = MOBILE && activeInactivityScheduleState()
      // Give a native notification scheduled for the current moment time to be delivered and
      // report through Capacitor before the foreground fallback claims the event.
      if (nativeSchedule && Date.now() < nativeSchedule.scheduledAt + NATIVE_NOTIFICATION_GRACE_MS) return
      const nativeAlreadyOwnsEvent = MOBILE && activeInactivityIsScheduled()
      if (MOBILE) void cancelActiveInactivity()
      if (useStore.getState().user) void cancelInactivityPush(A.id).catch(() => {})
      let consumed = false
      useStore.getState().update(state => {
        const live = state.active
        if (!live || live.id !== A.id) return
        const liveResult = consumeInactivityReminder(live, Date.now(), {
          restActive: !!useUI.getState().timer,
          timedWorkActive: !!useUI.getState().work,
        })
        if (liveResult.eligible) { state.active = liveResult.active; consumed = true }
      }, false)
      if (consumed && !nativeAlreadyOwnsEvent && claimVisibleEvent(A.id)) toast(t('Workout inactivity reminder'))
    }

    // Recover before syncNative(): syncActiveInactivity clears the marker synchronously while it
    // replaces the native schedule. A passed marker means the OS already owns the one-shot event,
    // so consume it without a duplicate toast and cancel the stale native notification.
    const current = snapshot()
    const recovery = recoverInactivitySchedule(current.active, MOBILE ? activeInactivityScheduleState() : null, Date.now())
    if (recovery.action === 'consume') {
      useStore.getState().update(state => {
        if (state.active?.id === current.active?.id) state.active = recovery.active
      }, false)
      if (MOBILE) void cancelActiveInactivity()
    } else {
      // Schedule/cancel immediately for this session and after each meaningful edit or timer change.
      syncNative()
    }
    const recoverAndScheduleWeb = async () => {
      if (!webReady) {
        await recoverWeb()
        webReady = true
      }
      if (disposed) return
      void syncWeb()
      check()
    }
    void recoverAndScheduleWeb()
    const interval = setInterval(check, 1000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void recoverWeb().then(() => syncWeb()).finally(check)
      else {
        syncNative()
        void syncWeb()
      }
    }
    const onPushChanged = () => { void recoverWeb().then(() => syncWeb()) }
    document.addEventListener('visibilitychange', onVisibility)
    globalThis.addEventListener?.('hforge-push-changed', onPushChanged)
    return () => {
      disposed = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      globalThis.removeEventListener?.('hforge-push-changed', onPushChanged)
      if (MOBILE) void cancelActiveInactivity()
    }
  }, [sessionId, editAt, sent, userId, restActive, timedWorkActive, toast])

  // A session change is the explicit server-side cancellation boundary. Ordinary record edits
  // rerun the scheduling effect but do not cancel first, which preserves a sent marker during
  // that session and lets the API replace only a still-pending deadline.
  useEffect(() => {
    if (MOBILE || !sessionId || !userId) return undefined
    const sid = sessionId
    return () => { void cancelInactivityPush(sid).catch(() => {}) }
  }, [sessionId, userId])

  // The service worker displays the event once and broadcasts an informational message. Matching
  // pages only recover the sent bit here; recovered sent markers deliberately do not toast.
  useEffect(() => {
    if (MOBILE || typeof navigator === 'undefined' || !navigator.serviceWorker) return undefined
    const onMessage = event => {
      const payload = event.data?.type === 'hforge-push-displayed' ? event.data.payload : null
      const A = useStore.getState().S.active
      if (!userId || payload?.kind !== 'active-inactivity' || payload.sessionId !== A?.id) return
      useStore.getState().update(state => {
        if (state.active?.id === payload.sessionId && !state.active.inactivityReminderSent) {
          state.active.inactivityReminderSent = true
        }
      }, false)
      // The service worker has already displayed the system notification. This message only
      // records ownership in the active session so the foreground check cannot toast again.
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [sessionId, userId, toast])

  // Capacitor notifies the WebView when a local notification is displayed in the foreground. Mark
  // the durable one-shot bit so a later foreground check cannot emit a second event.
  useEffect(() => {
    if (!MOBILE) return undefined
    let disposed = false
    let remove = () => {}
    void listenForActiveInactivity(() => {
      if (disposed) return
      const A = useStore.getState().S.active
      if (!A) return
      useStore.getState().update(state => {
        if (state.active?.id === A.id) state.active.inactivityReminderSent = true
      }, false)
    }).then(cleanup => {
      if (disposed) cleanup()
      else remove = cleanup
    })
    return () => { disposed = true; remove() }
  }, [])

  return null
}
