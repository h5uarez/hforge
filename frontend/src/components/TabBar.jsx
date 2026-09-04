import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Per-tab scroll memory: leaving a tab stores window.scrollY under its route key,
// entering a tab restores it on the next frame. Same app, same flow — just no more
// losing your place when you peek at Stats mid-plan. App.jsx still scrolls to top
// on a *fresh* route and on every pathname change; tabs restore afterwards, so a
// revisited tab wins over that reset while a never-visited one still starts at top.
const scrollMem = new Map()
// The bar holds five equal slots (Start sits in the middle); the dot spans one
// slot, so route tabs map to slot indexes 0/1/3/4.
const TAB_INDEX = { home: 0, plan: 1, stats: 3, library: 4 }

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  // A tab is active only on its own route: /history and /settings have no tab,
  // so they must not light up Stats or Home respectively.
  const on = k => cur === k

  const startWorkout = () => {
    if (!S.active) {
      const r = effectiveRoutine(S, todayISO())
      if (r && r.ex.length) { onStart(r.id); return }
    }
    nav('/workout')
  }
  const go = to => {
    const from = loc.pathname
    if (from !== to) scrollMem.set(from, window.scrollY || 0)
    nav(to)
    // restore after the new view mounts; 0 when the tab was never visited
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo(0, scrollMem.get(to) || 0)
    }))
  }
  const Tab = ({ k, icon, to, label }) => (
    <button className={on(k) ? 'on' : ''} aria-current={on(k) ? 'page' : undefined} onClick={() => go(to)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )

  const ind = TAB_INDEX[cur]
  return (
    <nav id="tabbar" aria-label={t('Home')} className={ind !== undefined ? 'has-ind' : ''} style={ind !== undefined ? { '--tab-i': ind } : null}>
      <span className="tab-ind" aria-hidden="true"><i /></span>
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="plan" icon="calendar" to="/plan" label={t('Plan')} />
      <button className={'start' + (S.active ? ' rec' : '')} aria-label={S.active ? t('Resume') : t('Start workout')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active ? 'play' : 'dumbbell'} /></span>
        <span>{S.active ? t('Resume') : t('Start')}</span>
      </button>
      <Tab k="stats" icon="chart" to="/stats" label={t('Stats')} />
      <Tab k="library" icon="list" to="/library" label={t('Exercises')} />
    </nav>
  )
}
