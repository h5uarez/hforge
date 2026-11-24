import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, dateLocale } from '../lib/i18n.js'
import { workoutExportSheet } from '../sheets.jsx'
import { useScrolled } from './ui.jsx'
import Icon from './Icon.jsx'

export default function HomeHeader({ onExport = workoutExportSheet }) {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const scrolled = useScrolled()
  const today = new Date()
  return <div className={'hdr page' + (scrolled ? ' scrolled' : '')}>
      <div><h1>{user ? t('Hi {0}', user.name) : 'Hforge'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="iconbtn" onClick={() => onExport()} aria-label={t('Export')}><Icon name="download" /></button>
        <button type="button" className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
      </div>
    </div>
}
