// Mobile build (VITE_MOBILE=1) — the standalone app-store version (Capacitor native shell).
//
// There is no backend: nothing to sign in to, everything lives on the phone. Unlike guest
// mode in a browser, this is the user's only copy of their training log, so it can't depend
// on WebView localStorage alone (iOS evicts that under storage pressure). Every persist()
// therefore also lands in a JSON file in the app's private data directory, and boot()
// restores from it. The workout reminder uses native local notifications scheduled per
// planned weekday — no server involved, unlike Web Push in the self-hosted version.
//
// Like the demo build, MOBILE is replaced at build time, so all of this folds away in
// web bundles; the Capacitor plugins are only ever imported behind it.
import { t } from './i18n.js'
import { ACTIVE_INACTIVITY_NOTIFICATION_ID, inactivityDeadline } from './inactivity.js'

export const MOBILE = import.meta.env.VITE_MOBILE === '1'

// Legacy compatibility identifier: existing mobile installs depend on this state filename.
const FILE = 'opengym-state.json'

export async function nativeLoad() {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch (e) { return null }   // first launch, or unreadable — localStorage copy takes over
}

export async function nativeSave(state) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data: JSON.stringify(state), encoding: Encoding.UTF8 })
  } catch (e) { /* keep the localStorage copy */ }
}

// (Re)schedule the workout-day reminder: one repeating notification per weekday that has a
// routine in the weekly plan. Cheap enough to run after any state change — the plan or the
// reminder time may just have been edited. `interactive` gates the OS permission prompt to
// the Settings toggle; a background resync never pops a dialog.
export async function syncReminder(S, interactive = false) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [0, 1, 2, 3, 4, 5, 6].map(d => ({ id: 100 + d })) }).catch(() => {})
    const r = S.reminder
    if (!r?.on) return true
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && interactive) perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return false
    const [hour, minute] = (r.time || '08:00').split(':').map(Number)
    const notifications = Object.entries(S.week || {})
      .filter(([, rid]) => rid && (S.routines || []).some(x => x.id === rid))
      .map(([day, rid]) => ({
        id: 100 + Number(day),
        title: t('Workout day'),
        body: t('{0} is on the plan today — let’s go!', S.routines.find(x => x.id === rid).name),
        // Capacitor weekdays are 1 (Sunday) … 7 (Saturday); S.week uses getDay() 0…6.
        schedule: { on: { weekday: Number(day) + 1, hour, minute }, allowWhileIdle: true },
      }))
    if (notifications.length) await LocalNotifications.schedule({ notifications })
    return true
  } catch (e) { return false }
}

let activeInactivityVersion = 0
let activeInactivitySchedule = null
const ACTIVE_SCHEDULE_KEY = 'gym_active_inactivity_schedule_v1'

const forgetActiveSchedule = () => {
  try { localStorage.removeItem(ACTIVE_SCHEDULE_KEY) } catch (e) { /* ignore storage failures */ }
}
const rememberActiveSchedule = schedule => {
  try { localStorage.setItem(ACTIVE_SCHEDULE_KEY, JSON.stringify(schedule)) } catch (e) { /* memory state still works */ }
}
const rememberedActiveSchedule = () => {
  try {
    const value = JSON.parse(localStorage.getItem(ACTIVE_SCHEDULE_KEY) || 'null')
    return value && typeof value === 'object' ? value : null
  } catch (e) { return null }
}

const cancelNativeNotification = async LocalNotifications => {
  await LocalNotifications.cancel({ notifications: [{ id: ACTIVE_INACTIVITY_NOTIFICATION_ID }] }).catch(() => {})
}

// Native fallback for an active session. It is deliberately a single `at` schedule, never a
// repeating notification; edits cancel and replace it before it fires, while the sent bit makes a
// fired session permanently one-shot.
export async function cancelActiveInactivity() {
  if (!MOBILE) return false
  activeInactivityVersion++
  activeInactivitySchedule = null
  forgetActiveSchedule()
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await cancelNativeNotification(LocalNotifications)
  } catch (e) { /* web build or plugin unavailable */ }
}

export function activeInactivityIsScheduled() {
  return !!activeInactivitySchedule
}

export function activeInactivityScheduleState() {
  return activeInactivitySchedule || rememberedActiveSchedule()
}

export async function syncActiveInactivity(S, now = Date.now(), options = {}) {
  if (!MOBILE) return false
  const version = ++activeInactivityVersion
  activeInactivitySchedule = null
  forgetActiveSchedule()
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await cancelNativeNotification(LocalNotifications)
    const A = S?.active
    const deadline = inactivityDeadline(A)
    // Future deadlines are scheduled natively; due sessions are also scheduled when the app is
    // backgrounded, while the foreground checker owns the visible catch-up path.
    if (!A || deadline === null || A.inactivityReminderSent === true || options.restActive || options.timedWorkActive) return false
    const permission = await LocalNotifications.checkPermissions()
    if (permission.display !== 'granted' || version !== activeInactivityVersion) return false
    const currentTime = Number.isFinite(now) ? now : Date.now()
    const deliveryAt = new Date(Math.max(deadline, currentTime + 1000))
    await LocalNotifications.schedule({ notifications: [{
      id: ACTIVE_INACTIVITY_NOTIFICATION_ID,
      title: 'Hforge',
      body: t('Still there? Your workout awaits.'),
      extra: { kind: 'active-inactivity', sessionId: A.id },
      schedule: { at: deliveryAt, allowWhileIdle: true, repeats: false },
    }] })
    if (version === activeInactivityVersion) {
      activeInactivitySchedule = { sessionId: A.id, deadline, scheduledAt: deliveryAt.getTime() }
      // The WebView can be recreated after the OS displayed the notification. Retaining this tiny
      // schedule marker lets the next foreground catch-up consume that event without a duplicate
      // toast; it is cleared on every edit, finish, discard, or replacement schedule.
      rememberActiveSchedule(activeInactivitySchedule)
    }
    return true
  } catch (e) {
    return false
  }
}

export async function listenForActiveInactivity(onReceived) {
  if (!MOBILE) return () => {}
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    let disposed = false
    const handle = await LocalNotifications.addListener('localNotificationReceived', notification => {
      if (!disposed && notification?.id === ACTIVE_INACTIVITY_NOTIFICATION_ID) onReceived(notification)
    })
    return () => { disposed = true; handle.remove() }
  } catch (e) {
    return () => {}
  }
}

// WKWebView can't do blob-URL downloads, so the backup goes out through the OS share sheet
// (Files, AirDrop, mail, …) from a temp file instead.
export async function shareExport(json, filename) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const w = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: json, encoding: Encoding.UTF8 })
  await Share.share({ title: filename, url: w.uri })
}
