import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { buildWarmup, DEFAULT_WARMUP_CONFIG, WARMUP_OPTIONS, resolveKind, isBodyweightKind } from '../lib/warmup.js'
import { effortOf } from '../lib/history.js'
import { rirOf, toScale } from '../lib/effort.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Stepper, Button, SelectRow, Section, Row, Segmented } from './ui.jsx'

// Warmup ladder on Home, modelled on Home1RM: collapsed to a headline row so it
// never pushes the day's work down. The exercise picker sits full-width on top
// with the steppers in a grid below, so the card still fits a 360 px screen.
// Everything is local state; the only profile inputs are the effort scale, the
// unit, and the warmup config from Settings. buildWarmup owns the ladder — this
// card only gathers the top set and renders the sets it returns.
const EXERCISE_LABEL = {
  bench: 'Bench press', squat: 'Squat', deadlift: 'Deadlift',
  ohp: 'Overhead press', pullup: 'Pull-ups', dip: 'Dips',
}

export default function HomeWarmup() {
  const S = useStore(s => s.S)
  const [open, setOpen] = useState(false)
  const [exerciseId, setExerciseId] = useState(WARMUP_OPTIONS[0].id)
  const [kg, setKg] = useState(0)
  const [reps, setReps] = useState(0)
  const [addedKg, setAddedKg] = useState(0)
  // Effort is stored in RIR, the scale with a real zero; buildWarmup takes an
  // RPE fatigue guard, so the value is converted back on the way in.
  const [rir, setRir] = useState(null)
  const [res, setRes] = useState(null)   // { sets, topLine } | null

  const kind = effortOf(S)
  const showEffort = kind === 'rir' || kind === 'rpe'
  const bw = isBodyweightKind(resolveKind(exerciseId))
  const cfg = { ...DEFAULT_WARMUP_CONFIG, ...(S.warmupConfig || {}) }

  const calc = () => {
    if (!(reps >= 1) || (!bw && !(kg > 0))) { setRes(null); return }
    const rpe = rir == null ? null : toScale('rpe', rir)
    const sets = buildWarmup({ exerciseId, topKg: bw ? addedKg : kg, topReps: reps, rpe, addedKg: bw ? addedKg : 0, config: cfg })
    const topLine = bw
      ? (addedKg > 0 ? `+${fmtNum(addedKg)} × ${reps}` : `${reps}`)
      : `${fmtNum(kg)} × ${reps}`
    setRes({ sets, topLine })
  }

  return (
    <div className="card">
      <button type="button" className="row between" style={{ width: '100%', padding: 0, border: 0, background: 'none', textAlign: 'left' }}
        onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="homewarmup-body">
        <span className="row" style={{ gap: 8 }}>
          <Icon name="dumbbell" />
          <b>{t('Warmup calculator')}</b>
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} />
      </button>
      <div id="homewarmup-body" hidden={!open}>
        <div style={{ marginTop: 10 }}>
          <SelectRow title={t('Exercise')} value={exerciseId} onChange={setExerciseId}
            options={WARMUP_OPTIONS.map(o => ({ value: o.id, label: t(EXERCISE_LABEL[o.key]) }))} />
        </div>
        <div className="homewarmup-grid" style={{ display: 'grid', gridTemplateColumns: showEffort ? 'repeat(3, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))', gap: 6, marginTop: 10 }}>
          {bw
            ? <Stepper label={t('Added weight ({0})', S.unit)} value={addedKg} step={2.5} onChange={setAddedKg} />
            : <Stepper label={t('Weight ({0})', S.unit)} value={kg} step={2.5} onChange={setKg} />}
          <Stepper label={t('Reps')} value={reps} step={1} decimal={false} onChange={setReps} />
          {showEffort && (
            <Stepper label={t(kind === 'rpe' ? 'RPE' : 'RIR')} value={toScale(kind, rir)} step={0.5}
              onChange={v => setRir(Math.min(4, rirOf({ [kind]: v })))} />
          )}
        </div>
        <Button size="sm" variant="primary" onClick={calc} style={{ display: 'block', width: '100%', marginTop: 10 }}>{t('Calcular')}</Button>
        <div style={{ marginTop: 10 }}>
          {res
            ? <>
                <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>{t('Warmup sets')}</div>
                {res.sets.length
                  ? <div style={{ display: 'grid', gap: 4 }}>
                      {res.sets.map((s, i) => (
                        <div key={i} className="row between small">
                          <span>{s.kg > 0 ? fmtNum(s.kg) : t('Bodyweight')} × {s.reps}{s.label ? ' · ' + t(s.label) : ''}</span>
                          <span className="muted">{t('Rest {0}s', s.restSec)}</span>
                        </div>
                      ))}
                    </div>
                  : <div className="muted small">{t('No warmup needed — go straight to the top set.')}</div>}
                <div className="row small" style={{ gap: 6, marginTop: 8 }}>
                  <span className="tag acc">{t('Main set')}</span>
                  <b>{res.topLine} <span className="muted" style={{ fontWeight: 400 }}>{bw && addedKg <= 0 ? '' : S.unit}</span></b>
                </div>
                <div className="muted small" style={{ marginTop: 6 }}>{t('Save your strength for the top set.')}</div>
              </>
            : <span className="muted small">{t('Enter a valid weight and reps.')}</span>}
        </div>
      </div>
    </div>
  )
}

// Settings sheet for the warmup ladder: five questions, no free text. Writes
// the whole config object at once so a half-answered sheet never persists.
export function WarmupSettingsForm() {
  const S = useStore(s => s.S)
  const { update } = useStore()
  const cfg = { ...DEFAULT_WARMUP_CONFIG, ...(S.warmupConfig || {}) }
  const set = patch => update(s => { s.warmupConfig = { ...DEFAULT_WARMUP_CONFIG, ...(s.warmupConfig || {}), ...patch } })

  return <div className="warmup-settings">
    <h3>{t('Configure warmup')}</h3>
    <Section title={t('Experience')}>
      <Row title={t('Experience')}>
        <Segmented className="seg-inline"
          options={[{ value: 'beginner', label: t('Beginner') }, { value: 'intermediate', label: t('Intermediate') }, { value: 'advanced', label: t('Advanced') }]}
          value={cfg.experience} onChange={v => set({ experience: v })} />
      </Row>
      <Row title={t('Bar weight')}>
        <Segmented className="seg-inline"
          options={[{ value: 20, label: '20 kg' }, { value: 15, label: '15 kg' }]}
          value={cfg.barKg} onChange={v => set({ barKg: v })} />
      </Row>
      <Row title={t('Rounding')}>
        <Segmented className="seg-inline"
          options={[{ value: 2.5, label: '2.5 kg' }, { value: 1.25, label: '1.25 kg' }]}
          value={cfg.roundingKg} onChange={v => set({ roundingKg: v })} />
      </Row>
      <Row title={t('Pace')}>
        <Segmented className="seg-inline"
          options={[{ value: 'conservative', label: t('Conservative') }, { value: 'standard', label: t('Standard') }, { value: 'aggressive', label: t('Aggressive') }]}
          value={cfg.style} onChange={v => set({ style: v })} />
      </Row>
      <Row title={t('Deadlift mode')}>
        <Segmented className="seg-inline"
          options={[{ value: 'reps', label: t('With reps') }, { value: 'singles', label: t('Singles') }]}
          value={cfg.deadliftMode} onChange={v => set({ deadliftMode: v })} />
      </Row>
    </Section>
    <div style={{ height: 8 }} />
  </div>
}
