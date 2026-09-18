import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI, Skeleton } from './components/ui.jsx'
import { resolveAccent, resolveDefaultAccent } from './lib/format.js'
import { getLang, setLang, useLang } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import { useWakeLock } from './lib/wakelock.js'
import { startFlow } from './sheets.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import PwaUpdateBanner from './components/PwaUpdateBanner.jsx'
import RestTimer from './components/RestTimer.jsx'
import InactivityReminder from './components/InactivityReminder.jsx'
import { handleAndroidBack } from './lib/android-back.js'
import Home from './views/Home.jsx'
import Workout from './views/Workout.jsx'
// Route code-splitting: Home and Workout stay in the entry chunk so first
// paint never waits on the network. Workout is deliberately eager: ActiveWorkout
// restores focus to the current card on mount, and loading it with the shell keeps
// the captured layout deterministic — a lazy chunk lets image decode win or lose
// the race and shifts the captured viewport by a few px (visual workout-active flakes).
// Login rides the existing boot Suspense (same skeleton as the pre-auth branch),
// every other view lazy-loads on navigation.
const Login = lazy(() => import('./views/Login.jsx'))
const Plan = lazy(() => import('./views/Plan.jsx'))
const RoutineEdit = lazy(() => import('./views/RoutineEdit.jsx'))
const Stats = lazy(() => import('./views/Stats.jsx'))
const History = lazy(() => import('./views/History.jsx'))
const Library = lazy(() => import('./views/Library.jsx'))
const Settings = lazy(() => import('./views/Settings.jsx'))
const Admin = lazy(() => import('./views/Admin.jsx'))

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

function applyPrefs(theme, accent, defaultAccent) {
  const de = document.documentElement
  de.dataset.theme = theme === 'dark' || theme === 'light' ? theme : 'light'
  de.dataset.accent = resolveAccent(accent)
  // Eligible accent inside the neutral Default palette (own namespace — the
  // legacy ACCENT_MIGRATION is never consulted). Always written; the CSS
  // override rules only match when data-accent is "default", and the neutral
  // shell keeps one bg per mode so PALETTE_BG below is untouched.
  de.dataset.defaultAccent = resolveDefaultAccent(defaultAccent)
  // Duplicated per-pair×mode --bg mirror (see PALETTE_BG in index.html):
  // theme-color follows the palette on every runtime switch.
  const PALETTE_BG = {"default":{"dark":"#000000","light":"#ffffff"},"ultraviolet":{"dark":"#10163A","light":"#E4E7FA"},"dragonfruit":{"dark":"#0C1F16","light":"#DCEFE2"},"ghost":{"dark":"#1A1E0C","light":"#E2E6CF"},"cobalt":{"dark":"#241016","light":"#FBE4EF"},"ember":{"dark":"#2E1510","light":"#F5E1C6"}}
  const bg = (PALETTE_BG[de.dataset.accent] && PALETTE_BG[de.dataset.accent][de.dataset.theme]) || PALETTE_BG.default.light
  de.style.setProperty('--boot-bg', bg)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = bg
}

function BootSkeleton() {
  // No #app wrapper of its own: the boot branch provides it, and the Suspense
  // fallback below already renders inside #app — a nested duplicate id would
  // break strict-mode selectors during chunk loads.
  return (
    <>
      <Skeleton className="skel-hdr" />
      <Skeleton className="skel-week" />
      <div style={{ height: 12 }} />
      <div className="skel-tiles"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>
      <Skeleton className="skel-row" /><Skeleton className="skel-row" />
    </>
  )
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => { applyPrefs(S.theme, S.accent, S.defaultAccent) }, [S.theme, S.accent, S.defaultAccent])
  useEffect(() => {
    const runtimeLang = getLang()
    const selectedLang = S.lang || runtimeLang
    if (selectedLang !== runtimeLang) setLang(selectedLang)
  }, [S.lang])
  useEffect(() => { document.documentElement.lang = getLang() }, [langV, S.lang])
  // every tab/route change starts at the top of the page
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return undefined

    let disposed = false
    let listener = null
    const removeListener = handle => {
      try { void handle?.remove?.() } catch { /* plugin teardown is best effort */ }
    }
    const onBackButton = ({ canGoBack } = {}) => {
      if (disposed) return
      const { sheets, closeSheet } = useUI.getState()
      handleAndroidBack({
        platform: 'android',
        sheets,
        canGoBack: !!canGoBack,
        // This is the same store close path used by Modals. Its unmount cleanup restores the
        // opener focus, including when a nested routine picker is dismissed from the hardware key.
        closeSheet,
        historyBack: () => window.history.back(),
        exitApp: () => { void import('@capacitor/app').then(({ App }) => App.exitApp()).catch(() => {}) },
      })
    }

    // Keep the App plugin out of ordinary browser execution. The promise guard also handles
    // React StrictMode's setup/cleanup cycle without leaving a late listener behind.
    void import('@capacitor/app').then(({ App }) => {
      if (disposed) return null
      return App.addListener('backButton', onBackButton)
    }).then(handle => {
      if (!handle) return
      if (disposed) removeListener(handle)
      else listener = handle
    }).catch(() => {})

    return () => {
      disposed = true
      removeListener(listener)
    }
  }, [])
  // Bound to a live workout, not to the route.
  useWakeLock(!!S.active && S.keepAwake !== false)

  const authed = user || isGuest
  // P0 boot skeleton: same heights as the real home (title band, week strip,
  // tiles, rows), so first paint never shifts when the store lands. The store
  // hydrates synchronously after this, so this is the >1s branch of the rule.
  // It also covers lazy route chunks below via Suspense.
  if (!ready && !authed) return <div id="app" aria-busy="true"><BootSkeleton /></div>

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out */}
      <div id="app" className="vfade" key={loc.pathname}>
        <ErrorBoundary>
          {!authed ? (
            <Suspense fallback={<BootSkeleton />}>
              <Login />
            </Suspense>
          ) : (
            <Suspense fallback={<BootSkeleton />}>
            <Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/history" element={<History />} />
              <Route path="/library" element={<Library />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
            </Suspense>
          )}
        </ErrorBoundary>
      </div>
      <TabBar onStart={startFlow} />
      <PwaUpdateBanner />
      <RestTimer />
      <InactivityReminder />
      <Modals />
      <Toast />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  return <HashRouter><Shell /></HashRouter>
}
