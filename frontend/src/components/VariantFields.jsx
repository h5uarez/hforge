import { useId } from 'react'
import { allExercises, exerciseName } from '../lib/exercises.js'
import { t } from '../lib/i18n.js'

export function initialVariantSelection(ex) {
  return { enabled: !!ex.variant, selected: ex.variant ? ex.id : '', kind: 'pause', durationSec: '2', position: '', eccentricSec: '3', bottomPauseSec: '0', concentricSec: 'X', topPauseSec: '0', heightCm: '2', detail: '', name: '' }
}

const numeric = value => String(value).trim() === '' ? NaN : Number(value)
export function conditionFromSelection(value) {
  switch (value.kind) {
    case 'pause': return { kind: 'pause', durationSec: numeric(value.durationSec), position: value.position }
    case 'tempo': return { kind: 'tempo', eccentricSec: numeric(value.eccentricSec), bottomPauseSec: numeric(value.bottomPauseSec), concentricSec: value.concentricSec === 'X' ? 'X' : numeric(value.concentricSec), topPauseSec: numeric(value.topPauseSec) }
    case 'pins': return { kind: 'pins', position: value.position }
    case 'deficit': case 'blocks': return { kind: value.kind, heightCm: numeric(value.heightCm) }
    default: return { kind: 'other', detail: value.detail }
  }
}

export default function VariantFields({ base, state, value, onChange }) {
  const id = useId()
  const set = patch => onChange({ ...value, ...patch })
  const options = allExercises(state).filter(ex => ex.baseId === base.id)
  const field = (key, label, numericField = false) => <label className="variant-field">
    <span className="small dim">{t(label)}</span>
    <input className="input" value={value[key]} inputMode={numericField ? 'decimal' : undefined}
      maxLength={numericField ? 8 : 120} onChange={event => set({ [key]: event.target.value })} />
  </label>
  return <fieldset className="variant-fields">
    <legend className="sr-only">{t('Exercise variant')}</legend>
    <label className="variant-toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={value.enabled} onChange={event => set({ enabled: event.target.checked, selected: value.selected || (options[0]?.id ?? 'new') })} />
      <span>{t('Variant / specific execution')}</span>
    </label>
    {value.enabled && <div className="variant-content">
      <p className="small dim">{t('Independent history, records and progression. Reuse the same variant in other routines.')}</p>
      <label className="variant-field"><span className="small dim">{t('Choose a variant')}</span>
        <select className="input" value={value.selected} onChange={event => set({ selected: event.target.value })}>
          {options.map(ex => <option key={ex.id} value={ex.id}>{exerciseName(ex)}</option>)}
          <option value="new">{t('Create another variant')}</option>
        </select>
      </label>
      {value.selected === 'new' && <>
        <label className="variant-field"><span className="small dim">{t('Condition')}</span>
          <select className="input" value={value.kind} onChange={event => set({ kind: event.target.value })}>
            {['pause', 'tempo', 'pins', 'deficit', 'blocks', 'other'].map(kind => <option key={kind} value={kind}>{t({ pause: 'Pause', tempo: 'Tempo', pins: 'Pins', deficit: 'Deficit', blocks: 'Blocks', other: 'Other condition' }[kind])}</option>)}
          </select>
        </label>
        {value.kind === 'pause' && field('durationSec', 'Pause duration (seconds)', true)}
        {(value.kind === 'pause' || value.kind === 'pins') && field('position', 'Position / height reference')}
        {value.kind === 'tempo' && <>
          <div className="variant-grid">
            {field('eccentricSec', 'Lowering (seconds)', true)}
            {field('bottomPauseSec', 'Bottom pause (seconds)', true)}
            {field('concentricSec', 'Lifting (seconds or X)')}
            {field('topPauseSec', 'Top pause (seconds)', true)}
          </div>
          <p className="small dim">{t('X means explosive intent. A pause alone is not a complete tempo.')}</p>
        </>}
        {(value.kind === 'deficit' || value.kind === 'blocks') && field('heightCm', 'Height difference (cm)', true)}
        {value.kind === 'other' && field('detail', 'Execution condition')}
        {field('name', 'Variant name (optional)')}
      </>}
      <p className="small dim">{t('Changing a condition creates a different variant; old workouts are not reassigned.')}</p>
    </div>}
  </fieldset>
}
