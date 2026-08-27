import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DAYN, uid, exCount, todayISO, isoOf } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { blockManagerSheet, dayAssignSheet, loadStarterPlan, planToolsSheet } from '../sheets.jsx'
import { blockStatus, effectiveRoutineId } from '../lib/history.js'
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

  // Block context for the small card below the header. Compact display only — the editor,
  // lifecycle controls, and the full block list live in the manager sheet so the legacy week
  // editor and dayPlan flows below stay primary for non-block users.
  const ab = S.activeBlock
  const blocks = S.blocks || []
  const activeBlockDef = ab ? blocks.find(b => b.id === ab.blockId) : null
  const currentWeek = ab ? blockStatus(S, todayISO()) : null

  // Current local-calendar week's Monday and the per-display-day ISO helper. Each weekday
  // row in the schedule below is rendered with `effectiveRoutineId(S, isoFor(d))` so the
  // schedule automatically reflects the active block's resolved current week when one is
  // active. With no active block, `effectiveRoutineId` falls back to the existing
  // `S.dayPlan[iso]` then `S.week[wd]` precedence — i.e. legacy behavior is unchanged.
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

    {/* Block management (issue: block-management). Unobtrusive card — only shows up when a
        block is active, or stays collapsed behind a single button for non-block users. The
        legacy week editor and dayPlan pickers below remain primary. */}
    <div className="card" style={{ marginBottom: 14, cursor: 'pointer' }} onClick={blockManagerSheet}>
      <div className="row between" style={{ alignItems: 'center' }}>
        <div className="row" style={{ gap: 10, alignItems: 'center', minWidth: 0 }}>
          <span className="lrow-i"><Icon name="clipboard" /></span>
          <div style={{ minWidth: 0 }}>
            <div className="tt">{ab ? (activeBlockDef ? activeBlockDef.name : t('(deleted block)')) : t('Training blocks')}</div>
            <div className="ss dim small">
              {ab
                ? (ab.status === 'paused' ? t('Paused') : t('Active')) + (currentWeek ? ' · ' + t('Week {0}', currentWeek) : '')
                : t(blocks.length === 1 ? '{0} block · tap to manage' : '{0} blocks · tap to manage', blocks.length)}
            </div>
          </div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>

    <div className="cols"><div>
      <h4 className="sec">{t('Week schedule')}</h4>
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          // Resolve through the canonical block-aware resolver so an active block's resolved
          // current week is what the row shows, including explicit rest. With no active
          // block, the resolver preserves the existing dayPlan-then-week precedence.
          const routineId = effectiveRoutineId(S, isoFor(d))
          const r = routineId ? S.routines.find(x => x.id === routineId) : null
          return <div key={d} className="item" onClick={() => dayAssignSheet(d)}>
            <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
            {r ? <span className="tag acc"><Icon name={glyphOf(r.emoji)} />{r.name}</span> : <span className="tag">{t('Rest')}</span>}
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
