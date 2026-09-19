import { create } from 'zustand'
import { api, updateProfile } from '../lib/api.js'
import { localTZ, resolveAccent, resolveDefaultAccent } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { MOBILE, nativeLoad, nativeSave, syncReminder } from '../lib/mobile.js'
import { getExplicitLang, getInitialLang, getLang, normalizeLang } from '../lib/i18n.js'
import { normalizeActiveSession } from '../lib/session.js'
import { hasLegacyExerciseIds, normalizeExerciseIds } from '../lib/exercise-ids.js'
import { normalizeActiveInactivity } from '../lib/inactivity.js'
import { cancelInactivityPush } from '../lib/push.js'
import { rebuildHistory } from '../lib/history-rebuild.js'
import {
  STORAGE_STATE_KEY as KEY,
  STORAGE_LAST_VALID_KEY as LAST_VALID_KEY,
  STORAGE_USER_KEY,
  STORAGE_GUEST_KEY,
  STORAGE_DIRTY_KEY,
  PUSH_DEBOUNCE_MS,
  NATIVE_PERSIST_DEBOUNCE_MS,
} from '../lib/constants.js'
export const DEF = {
  unit: 'kg', restSec: 90, restTimerEnabled: true, sound: true, keepAwake: true, lang: 'es',
  theme: 'light', accent: 'default', defaultAccent: 'blue', body: 'male', targetW: null, bodyweightCheckEnabled: true,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full', workoutMediaEnabled: true, workoutCompactMode: true,
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

// Backups and server/mobile restores predate these compatibility preferences.
const normalizeState = state => {
  const next = normalizeExerciseIds(Object.assign(clone(DEF), state || {}))
  next.theme = next.theme === 'dark' || next.theme === 'light' ? next.theme : DEF.theme
  next.accent = resolveAccent(next.accent)
  // Eligible accent inside the neutral Default palette; resolved in its own
  // namespace so the legacy 8→6 ACCENT_MIGRATION above is never consulted here.
  next.defaultAccent = resolveDefaultAccent(next.defaultAccent)
  next.restTimerEnabled = state?.restTimerEnabled !== false
  next.bodyweightCheckEnabled = state?.bodyweightCheckEnabled !== false
  next.workoutMediaEnabled = state?.workoutMediaEnabled !== false
  // Compact presentation is the only supported workout view. Keep the legacy field normalized
  // to true so false, malformed, and absent values in old backups cannot restore an old layout.
  next.workoutCompactMode = true
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
      // No write-back here: loading must not churn localStorage. Normalization
      // is in-memory only; the next real change persists via persist().
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
  let lastTransaction = null

  // Keep the normal debounce window for remote writes, but do not flush a queued write while the
  // current workout is browser-local. The latest state remains available through get().S, so the
  // requeued callback will send it once the session has been finished or discarded.
  const schedulePush = () => {
    clearTimeout(pushTm)
    pushTm = setTimeout(() => {
      pushTm = null
      if (!get().user) return
      if (get().S.active) { schedulePush(); return }
      get().pushState()
    }, PUSH_DEBOUNCE_MS)
  }

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => { saveTm = null; nativeSave(get().S); syncReminder(get().S) }, NATIVE_PERSIST_DEBOUNCE_MS)
  }

  const persist = (S, push = true, transaction = null, { rebuild = true } = {}) => {
    const previous = transaction?.previous || get().S
    const previousKeys = transaction?.previousStorage || new Map([KEY, LAST_VALID_KEY].map(key => [key, localStorage.getItem(key)]))
    try {
      S = normalizeState(S)
      if (rebuild) S = rebuildHistory(S)
      S._ts = Date.now()
      registerCustom(S.customEx)
      const serialized = JSON.stringify(S)
      localStorage.setItem(KEY, serialized)
      localStorage.setItem(LAST_VALID_KEY, serialized)
      lastTransaction = { previous: structuredClone(previous), draft: structuredClone(S), previousStorage: previousKeys }
      set({ S, persistence: null })
    } catch (error) {
      for (const [key, value] of previousKeys) {
        try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* best effort rollback */ }
      }
      // Keep the draft visible and actionable. The two persisted keys are restored together.
      // scope 'local' marks a real on-device write failure: the blocking recovery card owns it.
      set({ S, persistence: { status: 'failed', scope: 'local', error, draft: structuredClone(S), previous, previousStorage: previousKeys } })
      return false
    }
    if (MOBILE) nativePersist()
    if (push && get().user) {
      schedulePush()
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
      if (get().S.active && get().user) schedulePush()
      else get().pushState()
    }
  })

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
    const language = getExplicitLang() || normalizeLang(getLang()) || getInitialLang()
    get().setUser(null)
    localStorage.removeItem(STORAGE_GUEST_KEY)
    localStorage.removeItem(STORAGE_DIRTY_KEY)
    localStorage.removeItem(KEY)
    persist(Object.assign(clone(DEF), { lang: language }), false)
  }

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    persistence: null,
    user: (() => { try { return JSON.parse(localStorage.getItem(STORAGE_USER_KEY)) || null } catch { return null } })(),
    ready: false,

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const S = clone(get().S)
      mut(S)
      return persist(S, push)
    },
    retryPersistence() {
      const pending = get().persistence
      if (pending?.status !== 'failed') return false
      return persist(pending.draft, true, pending)
    },
    undoPersistence() {
      const pending = get().persistence
      if (pending?.status !== 'failed') return false
      return persist(pending.previous, true, pending)
    },
    cancelPersistence() {
      const pending = get().persistence
      if (pending?.status !== 'failed') return false
      for (const [key, value] of pending.previousStorage || []) {
        try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* best effort rollback */ }
      }
      set({ S: pending.previous, persistence: null })
      return true
    },
    replaceState(S, push = false) {
      const next = normalizeState(S)
      next.lang = getExplicitLang() || normalizeLang(next.lang) || getInitialLang()
      persist(next, push)
    },

    isGuest: () => localStorage.getItem(STORAGE_GUEST_KEY) === '1',
    setGuest(v) { if (v) localStorage.setItem(STORAGE_GUEST_KEY, '1'); else localStorage.removeItem(STORAGE_GUEST_KEY); set({}) },

    setUser(u) {
      if (u) { localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(u)); localStorage.removeItem(STORAGE_GUEST_KEY) }
      else localStorage.removeItem(STORAGE_USER_KEY)
      set({ user: u })
    },

    // Rename the signed-in profile. Validation lives in the caller + server;
    // here we just persist the returned user. Throws so the caller can report it.
    async renameUser(name) {
      const updated = await updateProfile(name)
      get().setUser(updated)
      return updated
    },

    // Push an optional snapshot without replacing the locally visible state. The active session is
    // browser-local, so never include it in a server payload.
    async pushState(snapshot = null) {
      if (!get().user) return
      clearTimeout(pushTm)
      try {
        const state = { ...(snapshot || get().S) }
        delete state.active
        await api('/api/data', { method: 'PUT', body: JSON.stringify({ state }) })
        localStorage.removeItem(STORAGE_DIRTY_KEY)
        return true
      } catch (e) {
        localStorage.setItem(STORAGE_DIRTY_KEY, '1')
        // A remote push that rejects while the live session is intact in localStorage must never
        // raise the blocking recovery card (leave/re-enter with an active workout, backend down,
        // 502, offline). Stay silent, keep the draft exactly as it is, and retry in the background
        // once the session ends. Only a remote failure with NO active session escalates — and a
        // real local write failure (persist() catch above) always keeps its blocking dialog.
        // The early return also preserves any pre-existing local-failure recovery untouched.
        if (get().S.active) {
          schedulePush()
          return false
        }
        const current = get().S
        set({ persistence: { status: 'failed', scope: 'remote', error: e, draft: structuredClone(current), previous: lastTransaction?.previous || current, previousStorage: lastTransaction?.previousStorage } })
        return false
      }
    },
    async pullState(prefetchedData = null) {
      try {
        // Boot fires the snapshot GET in the same tick as /api/me so the two
        // requests overlap on the wire; every other caller passes nothing and
        // fetches here exactly as before.
        const { state } = prefetchedData ? await prefetchedData : await api('/api/data')
        const S = get().S
        const active = S.active
        // A live session is browser-local. Boot refresh may update the local copy, but must not
        // turn that refresh (or legacy-ID repair) into an implicit remote save. Explicit completed
        // workout, history, and settings saves still call pushState directly.
        const liveActive = !!active
        const dirty = localStorage.getItem(STORAGE_DIRTY_KEY) === '1'
        if (state && (!hasData(S) || ((state._ts || 0) >= (S._ts || 0) && !dirty))) {
          const migrated = hasLegacyExerciseIds(state)
          const next = normalizeState(state)
          const explicitLang = getExplicitLang()
          next.lang = explicitLang || normalizeLang(next.lang) || getInitialLang()
          if (active) next.active = active
          // Persist the normalized remote copy locally first. Only a successful local write may
          // trigger the repair PUT; an offline/failed local write must never overwrite the server
          // with a partially persisted migration.
          if (persist(next, false, null, { rebuild: !migrated }) && migrated && !liveActive) await get().pushState(get().S)
        } else if (hasData(S) && !liveActive) { await get().pushState() }
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
      localStorage.removeItem(STORAGE_DIRTY_KEY)
      persist(normalizeState(Object.assign(buildDemoState(), { lang: language })), false)
    },

    // Boot: the shell already paints the localStorage cache, so unlock first
    // paint immediately and refresh from the server without blocking it.
    // /api/me and /api/data both authenticate via the session cookie, but the
    // remote snapshot (plus its legacy-ID repair PUT) must only apply to an
    // authenticated profile. Both GETs fire in the same tick so they overlap
    // on the wire, while me is still awaited first: on a 401 the prefetched
    // snapshot is discarded and the identity clears exactly as before.
    // `ready` no longer gates either call. Repair-PUT semantics in pullState
    // are unchanged.
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
      // Non-blocking refresh: first paint already happened from cache.
      // Same-tick overlap: the snapshot request leaves together with /api/me
      // but is only consumed after me succeeds (pullState, with its repair PUT).
      set({ ready: true })
      const meRequest = api('/api/me')
      const dataRequest = api('/api/data')
      // A failed identity must never surface an unhandled rejection from the
      // snapshot it orphaned; the happy path consumes it via pullState below.
      dataRequest.catch(() => {})
      try {
        const me = await meRequest
        get().setUser(me.user)
        await get().pullState(dataRequest)
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
