// Weekly Decision Board v1 — the Stats section that answers
// "how is my training going this week and what should I look at?"
//
// Placement: top of Stats (the analytics hub), above the 12-month activity
// map. Home stays "what to do now". No new route, no new tab, no chart
// dependency — tiles reuse .tiles/.tile, detail rows reuse .mrow/.bar,
// icons and tokens come from the existing system (mobile-first, 320px safe).
import { useMemo } from 'react'
import { useStore } from '../store/useStore.js'
import { EXIDX, exerciseName } from '../lib/exercises.js'
import { fmtNum, fmtDate, fmtVol } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { fmtPct, buildWeeklyBoard, ctxLine } from '../lib/weekly-board.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import Icon from './Icon.jsx'

const pctColor = (pct) => (pct == null ? 'inherit' : pct > 0 ? 'var(--acc)' : pct < 0 ? 'var(--orange)' : 'var(--label-2)')

function Tile({ icon, label, value, ctx, accent }) {
  return (
    <div className="tile" style={{ minWidth: 0 }}>
      <div className="l"><Icon name={icon} />{label}</div>
      <div className="v" style={{ fontSize: 22, overflowWrap: 'anywhere', ...(accent ? { color: accent } : null) }}>{value}</div>
      {ctx && <div className="small dim" style={{ marginTop: 4, overflowWrap: 'anywhere' }}>{ctx}</div>}
    </div>
  )
}

function Movers({ rows, empty, unit }) {
  if (!rows.length) return <div className="muted small">{empty}</div>
  return rows.slice(0, 4).map((r) => (
    <div key={r.id} className="mrow">
      <span className="nm">{EXIDX[r.id] ? exerciseName(EXIDX[r.id]) : r.id}</span>
      <span className="v" style={{ minWidth: 0, flex: 'none' }}>
        {fmtNum(r.est)} {unit}{r.diff != null && r.diff !== 0 && (
          <span style={{ color: r.diff > 0 ? 'var(--acc)' : 'var(--orange)' }}>
            {' '}{r.diff > 0 ? '+' : ''}{fmtNum(r.diff)}
          </span>
        )}
      </span>
    </div>
  ))
}

export default function WeeklyBoard() {
  const S = useStore((s) => s.S)
  const board = useMemo(() => buildWeeklyBoard(S), [S])
  const { adherence, volume, performance, load, body } = board

  const rangeLabel = `${fmtDate(board.days[0])} – ${fmtDate(board.days[6], true)}`

  if (!board.hasData) {
    return (
      <div className="card" data-testid="weekly-board-empty">
        <h2>{t('This week')}</h2>
        <div className="muted small">
          {t('Nothing logged yet this week — plan your days in Plan or finish your first workout and this board will describe adherence, volume, performance, load and weight here.')}
        </div>
      </div>
    )
  }

  const adhValue = adherence.planned > 0
    ? `${adherence.done}/${adherence.planned}`
    : String(adherence.done)
  const perfValue = performance.tracked === 0 ? '—' : `${performance.up.length}↑ ${performance.flat.length}= ${performance.down.length}↓`

  return (
    <section aria-label={t('This week')} data-testid="weekly-board">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('This week')}</h4>
        <span className="small dim">{rangeLabel}</span>
      </div>

      <div className="tiles" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Tile icon="check" label={t('Adherence')} value={adhValue} ctx={adherence.ctx} />
        <Tile icon="dumbbell" label={t('Useful volume')} value={t('{0} sets', volume.totalSets)} ctx={volume.ctx} />
        <Tile icon="trophy" label={t('Performance')} value={perfValue} ctx={performance.ctx} />
        <Tile icon="chartLine" label={t('Load')} value={fmtVol(Math.round(load.tonnage.cur * 10) / 10, S.unit)} ctx={ctxLine(Math.round(load.tonnage.cur * 10) / 10, Math.round(load.tonnage.prev * 10) / 10, S.unit)} />
        <Tile
          icon="scale" label={t('Body weight')}
          value={body.avg == null ? '—' : `${fmtNum(body.avg)} ${S.unit}`}
          ctx={body.ctx}
        />
        <Tile
          icon="clock" label={t('Sessions')}
          value={`${load.workouts.cur} · ${Math.round(load.minutes.cur)} min`}
          ctx={load.minutes.prev > 0 || load.minutes.cur > 0
            ? `${fmtPct(load.minutes.pct) ?? 'new'} ${t('vs prev week')}`
            : t('no timed sessions')}
        />
      </div>

      <div className="card">
        <h2>{t('What to look at')}</h2>

        <h4 className="sec">{t('Muscles this week')}</h4>
        {volume.top.length ? (
          <>
            {volume.top.map((m) => {
              const max = Math.max(1, ...volume.top.map((x) => x.sets))
              return (
                <div key={m.muscle} className="mrow">
                  <span className="nm">{t(m.name)}</span>
                  <span className="bar"><i style={{ width: Math.round((m.sets / max) * 100) + '%' }} /></span>
                  <span className="v">{t('{0} sets', fmtNum(m.sets))}{m.prev > 0 ? ` · ${fmtPct(((m.sets - m.prev) / m.prev) * 100) ?? ''}` : ''}</span>
                </div>
              )
            })}
            {volume.gaps.length > 0 && (
              <>
                <h4 className="sec" style={{ marginTop: 12 }}>{t('Quiet after last week')}</h4>
                <div className="mchips">{volume.gaps.map((m) => <span key={m} className="mchip miss">{t(MUSCLE_NAME[m])}</span>)}</div>
              </>
            )}
          </>
        ) : <div className="muted small">{t('No sets logged yet this week.')}</div>}

        <h4 className="sec" style={{ marginTop: 14 }}>{t('Strength direction')}</h4>
        {performance.tracked === 0
          ? <div className="muted small">{t('No measurable lifts this week — log working sets to compare estimates here.')}</div>
          : (
            <>
              {performance.up.length > 0 && (<><div className="small" style={{ color: 'var(--acc)', fontWeight: 600 }}>{t('Improving')}</div><Movers rows={performance.up} unit={S.unit} /></>)}
              {performance.down.length > 0 && (<><div className="small" style={{ color: 'var(--orange)', fontWeight: 600, marginTop: 8 }}>{t('Down vs last')}</div><Movers rows={performance.down} unit={S.unit} /></>)}
              {performance.flat.length > 0 && (<><div className="small dim" style={{ fontWeight: 600, marginTop: 8 }}>{t('Holding')}</div><Movers rows={performance.flat} unit={S.unit} /></>)}
              {performance.fresh.length > 0 && (<><div className="small dim" style={{ fontWeight: 600, marginTop: 8 }}>{t('New baseline')}</div><Movers rows={performance.fresh} unit={S.unit} empty="" /></>)}
              <div className="small dim" style={{ marginTop: 8 }}>
                {t('Estimated 1RM per lift, best in-week estimate vs previous — an estimate, not a tested max.')}
              </div>
            </>
          )}

        {board.rules.length > 0 && (
          <>
            <h4 className="sec" style={{ marginTop: 14 }}>{t('Signals')}</h4>
            {board.rules.map((r) => (
              <div key={r.id} className="row small" style={{ gap: 6, padding: '4px 0' }}>
                <Icon name="info" style={{ color: 'var(--yellow)', fontSize: 14 }} />
                <span>{r.text}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  )
}
