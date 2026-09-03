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
//
// Validation ranges (UI-level; the lib stays tolerant):
//   · reps are clamped to UI_REPS_MAX (10). Past ~10 reps Epley/Brzycki diverge by double
//     digits and the number says more about work capacity than maximal strength, so capping
//     at 10 is sound. The lib's REP_CAP (12) remains as a backstop for history estimates.
//   · effort is clamped to the rated working-set range RPE 5..10 (RIR 0..5, since RPE = 10 −
//     RIR). A null effort still means "assumed to failure".
// A non-positive weight has no estimate — estimateWithEffort returns null and the card shows
// the hint line instead.
const UI_REPS_MAX = 10
const UI_RPE_MIN = 5
const UI_RPE_MAX = 10
const UI_RIR_MAX = UI_RPE_MAX - UI_RPE_MIN   // RPE 5 ⇔ RIR 5
const clampUiReps = v => Math.max(0, Math.min(UI_REPS_MAX, Math.round(Number(v) || 0)))
// English has no locale pack — source strings are the fallback — so its Capital Case tier
// labels live here; every other language comes from its locale file (e.g. es.js).
const TIER_LABEL = { HIGH: 'High', MEDIUM: 'Medium', unreliable: 'Unreliable' }
const tierLabel = tier => (t(tier) === tier ? (TIER_LABEL[tier] || tier) : t(tier))
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
    // Clamp again at compute time so a typed value that bypassed the stepper (e.g. "13"
    // typed straight into the field) still estimates inside the validated range.
    const repsUi = clampUiReps(reps)
    let rirUi = showEffort ? rir : null
    if (rirUi != null && Number.isFinite(Number(rirUi))) rirUi = Math.max(0, Math.min(UI_RIR_MAX, Number(rirUi)))
    const r = estimateWithEffort(kg, repsUi, rirUi)
    if (!r) { setRes(null); return }
    // Tiering reads effective reps (reps + RIR, up to 10 + 5 = 15), so a far-from-failure
    // high-rep input still lands honestly on "unreliable" even though the estimate itself
    // was computed at the lib cap.
    const eff = repsUi + (rirUi ?? 0)
    setRes({ est: r.est, failureAssumed: r.failureAssumed, tier: eff <= 8 ? 'HIGH' : eff <= REP_CAP ? 'MEDIUM' : 'unreliable' })
  }

  // Effort arrives on the profile's scale and is stored as RIR; clamp the typed value into
  // RPE 5..10 (RIR 0..5) so the stepper and the calc guard agree on the same range.
  const clampRirInput = v => {
    const converted = rirOf({ [kind]: v })
    if (converted == null || !Number.isFinite(Number(converted))) return converted
    return Math.max(0, Math.min(UI_RIR_MAX, Number(converted)))
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
          <Stepper label={t('Reps')} value={reps} step={1} decimal={false} onChange={v => setReps(clampUiReps(v))} />
          {showEffort && (
            <Stepper label={t(kind === 'rpe' ? 'RPE' : 'RIR')} value={toScale(kind, rir)} step={0.5}
              onChange={v => setRir(clampRirInput(v))} />
          )}
        </div>
        <Button size="sm" variant="primary" onClick={calc} style={{ display: 'block', width: '100%', marginTop: 10 }}>{t('Calcular')}</Button>
        <div className="row between" style={{ marginTop: 10, gap: 8 }}>
          {res
            ? <span className="row" style={{ gap: 8 }}>
                <span className="big">≈ {fmtNum(res.est)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></span>
                <span className={'tag' + (res.tier === 'unreliable' ? '' : ' acc')}>{tierLabel(res.tier)}</span>
              </span>
            : <span className="muted small">{t('Enter a valid weight and reps.')}</span>}
        </div>
        {res?.failureAssumed && <div className="muted small" style={{ marginTop: 6 }}>{t('Assuming set to failure. Add RPE/RIR for a better estimate.')}</div>}
        <div className="muted small" style={{ marginTop: 6 }}>{t('Estimate assumes a barbell compound; isolation lifts vary more.')}</div>
      </div>
    </div>
  )
}