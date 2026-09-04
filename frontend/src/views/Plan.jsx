import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DAYN, uid, exCount, isoOf } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, loadStarterPlan, planToolsSheet } from '../sheets.jsx'
import { effectiveRoutineId } from '../lib/history.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  // Current local-calendar week's Monday and the per-display-day ISO helper. Each weekday
  // row in the schedule below is rendered with `effectiveRoutineId(S, isoFor(d))`, which
  // keeps the legacy `S.dayPlan[iso]` then `S.week[wd]` precedence active.
  const today = new Date()
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const isoFor = d => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + (d === 0 ? 6 : d - 1))
    return isoOf(date)
  }

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>

    <div className="cols"><div>
      <h4 className="sec">{t('Week schedule')}</h4>
      <div className="list">
          {[1, 2, 3, 4, 5, 6, 0].map(d => {
           // Explicit date overrides win over the recurring weekly assignment.
          const routineId = effectiveRoutineId(S, isoFor(d))
          const r = routineId ? S.routines.find(x => x.id === routineId) : null
          return <div key={d} className="item schedule-item" onClick={() => dayAssignSheet(d)}>
            <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
            {r ? <span className="tag acc schedule-routine"><Icon name={glyphOf(r.emoji)} /><span className="schedule-routine-name">{r.name}</span></span> : <span className="tag schedule-routine"><span className="schedule-routine-name">{t('Rest')}</span></span>}
            <Icon name="chevronRight" className="chev" /></div>
        })}
      </div>
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
      </div>
      {S.routines.length ? <div className="list">{S.routines.map(r => <div key={r.id} className="item" onClick={() => nav('/plan/r/' + r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
    </div></div>
  </>
}
