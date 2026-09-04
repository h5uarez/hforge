import { create } from 'zustand'
import { api, updateProfile } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { MOBILE, nativeLoad, nativeSave, syncReminder } from '../lib/mobile.js'
import { getExplicitLang, getInitialLang, getLang, normalizeLang } from '../lib/i18n.js'
import { normalizeActiveSession } from '../lib/session.js'
import { normalizeActiveInactivity } from '../lib/inactivity.js'
import { cancelInactivityPush } from '../lib/push.js'

const KEY = 'gym_state_v1'
const LAST_VALID_KEY = 'gym_state_last_valid_v1'
export const DEF = {
  unit: 'kg', restSec: 90, restTimerEnabled: true, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null, bodyweightCheckEnabled: true,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null }, effort: null,
  // Warmup ladder preferences for the Home card. Absent on every profile written before the
  // card existed; only an explicit false on the gate disables it, like the 1RM card above it.
  warmupConfig: { experience: 'intermediate', barKg: 20, roundingKg: 2.5, style: 'standard', deadliftMode: 'reps' },
}
const clone = o => JSON.parse(JSON.stringify(o))

// Backups and server/mobile restores predate the preference. Only an explicit false disables
// the timer; malformed or absent values retain the historical enabled behavior.
const normalizeState = state => {
  const next = Object.assign(clone(DEF), state || {})
  next.restTimerEnabled = state?.restTimerEnabled !== false
  next.bodyweightCheckEnabled = state?.bodyweightCheckEnabled !== false
  next.warmupConfig = { ...DEF.warmupConfig, ...(state?.warmupConfig || {}) }
  delete next.blocks
  delete next.activeBlock
  if (Array.isArray(next.workouts)) {
    next.workouts = next.workouts.map(workout => {
      if (!workout || typeof workout !== 'object' || Array.isArray(workout)) return workout
      const clean = { ...workout }
      delete clean.block
      return clean
    })
  }
  if (next.active && typeof next.active === 'object' && !Array.isArray(next.active)) {
    const clean = { ...next.active }
    delete clean.block
    next.active = normalizeActiveInactivity(normalizeActiveSession(clean))
  }
  return next
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const state = normalizeState(JSON.parse(raw))
      state.lang = getExplicitLang() || normalizeLang(state.lang) || getInitialLang()
      localStorage.setItem(KEY, JSON.stringify(state))
      return state
    }
  } catch (e) {
    // A partial/quota-corrupted primary must not erase the last known valid session.
    try {
      const fallback = localStorage.getItem(LAST_VALID_KEY)
      if (fallback) return normalizeState(JSON.parse(fallback))
    } catch { /* ignore malformed fallback too */ }
  }
  return normalizeState({ lang: getInitialLang() })
}

const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)

export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => { saveTm = null; nativeSave(get().S); syncReminder(get().S) }, 800)
  }

  const persist = (S, push = true) => {
    S = normalizeState(S)
    S._ts = Date.now()
    registerCustom(S.customEx)
    const previous = get().S
    try {
      const serialized = JSON.stringify(S)
      localStorage.setItem(KEY, serialized)
      localStorage.setItem(LAST_VALID_KEY, serialized)
      set({ S, persistence: null })
    } catch (error) {
      // Keep the draft visible and actionable. No routine/dayPlan data is rewritten here.
      set({ S, persistence: { status: 'failed', error, draft: S, previous } })
      return false
    }
    if (MOBILE) nativePersist()
    if (push && get().user) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
    return true
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    if (MOBILE && saveTm) {
      clearTimeout(saveTm)
      saveTm = null
      nativeSave(get().S)
    }
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      get().pushState()
    }
  })

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
    const language = getExplicitLang() || normalizeLang(getLang()) || getInitialLang()
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem(KEY)
    persist(Object.assign(clone(DEF), { lang: language }), false)
  }

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    persistence: null,
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    ready: false,

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const S = clone(get().S)
      mut(S)
      persist(S, push)
    },
    retryPersistence() {
      const pending = get().persistence
      if (pending?.status !== 'failed') return false
      return persist(pending.draft)
    },
    undoPersistence() {
      const pending = get().persistence
      if (pending?.status !== 'failed') return false
      return persist(pending.previous)
    },
    cancelPersistence() {
      const pending = get().persistence
      if (pending?.status !== 'failed') return false
      set({ S: pending.previous, persistence: null })
      return true
    },
    replaceState(S, push = false) {
      const next = normalizeState(S)
      next.lang = getExplicitLang() || normalizeLang(next.lang) || getInitialLang()
      persist(next, push)
    },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) { if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest'); set({}) },

    setUser(u) {
      if (u) { localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest') }
      else localStorage.removeItem('gym_user')
      set({ user: u })
    },

    // Rename the signed-in profile. Validation lives in the caller + server;
    // here we just persist the returned user. Throws so the caller can report it.
    async renameUser(name) {
      const updated = await updateProfile(name)
      get().setUser(updated)
      return updated
    },

    async pushState() {
      if (!get().user) return
      clearTimeout(pushTm)
      try { await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: get().S }) }); localStorage.removeItem('gym_dirty') }
      catch (e) { localStorage.setItem('gym_dirty', '1') }
    },
    async pullState() {
      try {
        const { state } = await api('/api/data')
        const S = get().S
        const dirty = localStorage.getItem('gym_dirty') === '1'
        if (state && (!hasData(S) || ((state._ts || 0) >= (S._ts || 0) && !dirty))) {
          const active = S.active
          const next = normalizeState(state)
          const explicitLang = getExplicitLang()
          next.lang = explicitLang || normalizeLang(next.lang) || getInitialLang()
          if (active) next.active = active
          persist(next, false)
        } else if (hasData(S)) { await get().pushState() }
      } catch (e) { /* offline — keep local */ }
    },

    async signOut() {
      const activeSessionId = get().S.active?.id
      if (activeSessionId && get().user) await cancelInactivityPush(activeSessionId).catch(() => {})
      try { await get().pushState(); await api('/api/logout', { method: 'POST', body: '{}' }) } catch (e) { /* */ }
      clearLocalSession()
    },

    // "Sign out everywhere": the server bumps this profile's session version, which kills every
    // session it has on any device — this browser included, so the app has to end up exactly
    // where a normal signOut leaves it. Unlike signOut the request is NOT swallowed: if it fails
    // the sessions elsewhere are all still valid, and wiping this device's copy of the data
    // would sign the user out of the one place the bump didn't reach. Caller reports the error.
    async signOutAll() {
      const activeSessionId = get().S.active?.id
      if (activeSessionId && get().user) await cancelInactivityPush(activeSessionId).catch(() => {})
      await get().pushState()   // never throws — stores gym_dirty and moves on when offline
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      clearLocalSession()
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      const language = getExplicitLang() || normalizeLang(getLang()) || getInitialLang()
      localStorage.removeItem('gym_dirty')
      persist(normalizeState(Object.assign(buildDemoState(), { lang: language })), false)
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      // Mobile build: no backend either — restore from the file mirror (the durable copy;
      // localStorage may have been evicted since the last run) and go straight in.
      if (MOBILE) {
        const saved = await nativeLoad()
        const S = get().S
        if (saved && (!hasData(S) || (saved._ts || 0) >= (S._ts || 0))) {
          const next = normalizeState(saved)
          next.lang = getExplicitLang() || normalizeLang(next.lang) || getInitialLang()
          persist(next, false)
        } else if (hasData(S)) {
          nativeSave(S)   // first run after an update from a file-less version: seed the mirror
        }
        get().setGuest(true)
        syncReminder(get().S)
        set({ ready: true })
        return
      }
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        set({ ready: true })
        return
      }
      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await get().pullState()
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
      }
      set({ ready: true })
    }
  }
})

export { hasData }
