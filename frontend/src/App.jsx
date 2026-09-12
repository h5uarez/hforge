import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { Skeleton } from './components/ui.jsx'
import { ACCENTS } from './lib/format.js'
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
import Login from './views/Login.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import Stats from './views/Stats.jsx'
import History from './views/History.jsx'
import Library from './views/Library.jsx'
import Settings from './views/Settings.jsx'
import Admin from './views/Admin.jsx'

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = theme === 'light' ? 'light' : 'dark'
  de.dataset.accent = ACCENTS[accent] ? accent : 'lime'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : '#000000'
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => { applyPrefs(S.theme, S.accent) }, [S.theme, S.accent])
  useEffect(() => { setLang(S.lang || getLang()) }, [S.lang])
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
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && S.keepAwake !== false)

  const authed = user || isGuest
  // P0 boot skeleton: same heights as the real home (title band, week strip,
  // tiles, rows), so first paint never shifts when the store lands. The store
  // hydrates synchronously after this, so this is the >1s branch of the rule.
  if (!ready && !authed) return (
    <div id="app" aria-busy="true">
      <Skeleton className="skel-hdr" />
      <Skeleton className="skel-week" />
      <div style={{ height: 12 }} />
      <div className="skel-tiles"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>
      <Skeleton className="skel-row" /><Skeleton className="skel-row" />
    </div>
  )

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out */}
      <div id="app" className="vfade" key={loc.pathname}>
        <ErrorBoundary>
          {!authed ? <Login /> : (
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
