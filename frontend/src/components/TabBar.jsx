import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { useScrollDirection } from './ui.jsx'

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
  const { compact } = useScrollDirection()
  // Keep bottom controls out of the way while editing with a software keyboard.
  // On iOS the workout also uses the visible height for its exercise scroll area.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const style = document.documentElement.style
    let frame = null
    const syncViewport = () => {
      frame = null
      const field = document.activeElement
      const editing = field?.isContentEditable || (field?.matches('input, textarea') && !field.readOnly && field.inputMode !== 'none')
      const visibleHeight = Math.abs(vv.scale - 1) < 0.01 && vv.height > 0 ? vv.height : null
      // The visual viewport may pan to the field. Its height still reflects
      // the keyboard even if its top edge has moved down the document.
      const open = !!editing && visibleHeight !== null && window.innerHeight - visibleHeight > 120
      document.body.classList.toggle('kb-open', open)
      if (visibleHeight !== null) style.setProperty('--workout-viewport-height', `${visibleHeight}px`)
      else style.removeProperty('--workout-viewport-height')
    }
    const queueSync = () => { if (frame === null) frame = requestAnimationFrame(syncViewport) }
    syncViewport()
    vv.addEventListener('resize', queueSync)
    window.addEventListener('resize', queueSync)
    window.addEventListener('pageshow', queueSync)
    document.addEventListener('focusin', queueSync)
    document.addEventListener('focusout', queueSync)
    document.addEventListener('visibilitychange', queueSync)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      vv.removeEventListener('resize', queueSync)
      window.removeEventListener('resize', queueSync)
      window.removeEventListener('pageshow', queueSync)
      document.removeEventListener('focusin', queueSync)
      document.removeEventListener('focusout', queueSync)
      document.removeEventListener('visibilitychange', queueSync)
      document.body.classList.remove('kb-open')
      style.removeProperty('--workout-viewport-height')
    }
  }, [])
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  if (cur === 'nutrition') return null
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
  const classes = [ind !== undefined ? 'has-ind' : '', compact ? 'is-compact' : ''].filter(Boolean).join(' ')
  return (
    <nav id="tabbar" aria-label={t('Home')} className={classes} style={ind !== undefined ? { '--tab-i': ind } : null}>
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
