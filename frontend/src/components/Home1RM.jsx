import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { estimateWithEffort, REP_CAP } from '../lib/onerm.js'
import { effortOf } from '../lib/history.js'
import { rirOf, toScale } from '../lib/effort.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Stepper, Button } from './ui.jsx'

// One-rep-max estimate on Home, collapsed to a headline row so it never pushes the day's work
// down. Everything is local state; the only profile inputs are the effort scale and unit. The
// single Epley estimate serves every lift — the caveat line says so instead of per-lift notes.
export default function Home1RM() {
  const S = useStore(s => s.S)
  const [open, setOpen] = useState(false)
  const [kg, setKg] = useState(0)
  const [reps, setReps] = useState(0)
  // Effort is stored in RIR, the scale with a real zero; RPE is converted on display
  // (RPE 8 = RIR 2), so switching the profile scale never discards the entered value.
  const [rir, setRir] = useState(null)
  const [res, setRes] = useState(null)   // { est, tier, failureAssumed } | null

  const kind = effortOf(S)
  const showEffort = kind === 'rir' || kind === 'rpe'

  const calc = () => {
    const r = estimateWithEffort(kg, reps, showEffort ? rir : null)
    if (!r) { setRes(null); return }
    // Tiering reads effective reps before the cap, so a 13-rep set is honestly "unreliable"
    // even though the estimate itself was computed at the cap.
    const eff = reps + (showEffort ? (rir ?? 0) : 0)
    setRes({ est: r.est, failureAssumed: r.failureAssumed, tier: eff <= 8 ? 'HIGH' : eff <= REP_CAP ? 'MEDIUM' : 'unreliable' })
  }

  return (
    <div className="card">
      <button type="button" className="row between" style={{ width: '100%', padding: 0, border: 0, background: 'none', textAlign: 'left' }}
        onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="home1rm-body">
        <span className="row" style={{ gap: 8 }}>
          <Icon name="target" />
          <b>{t('1RM calculator')}</b>
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} />
      </button>
      <div id="home1rm-body" hidden={!open}>
        <div className="home1rm-grid" style={{ display: 'grid', gridTemplateColumns: showEffort ? 'repeat(3, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))', gap: 6, marginTop: 10 }}>
          <Stepper label={t('Weight ({0})', S.unit)} value={kg} step={2.5} onChange={setKg} />
          <Stepper label={t('Reps')} value={reps} step={1} decimal={false} onChange={setReps} />
          {showEffort && (
            <Stepper label={t(kind === 'rpe' ? 'RPE' : 'RIR')} value={toScale(kind, rir)} step={0.5}
              onChange={v => setRir(Math.min(4, rirOf({ [kind]: v })))} />
          )}
        </div>
        <Button size="sm" variant="primary" onClick={calc} style={{ display: 'block', width: '100%', marginTop: 10 }}>{t('Calcular')}</Button>
        <div className="row between" style={{ marginTop: 10, gap: 8 }}>
          {res
            ? <span className="row" style={{ gap: 8 }}>
                <span className="big">≈ {fmtNum(res.est)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></span>
                <span className={'tag' + (res.tier === 'unreliable' ? '' : ' acc')}>{t(res.tier)}</span>
              </span>
            : <span className="muted small">{t('Enter a valid weight and reps.')}</span>}
        </div>
        {res?.failureAssumed && <div className="muted small" style={{ marginTop: 6 }}>{t('Assuming set to failure. Add RPE/RIR for a better estimate.')}</div>}
        <div className="muted small" style={{ marginTop: 6 }}>{t('Estimate assumes a barbell compound; isolation lifts vary more.')}</div>
      </div>
    </div>
  )
}