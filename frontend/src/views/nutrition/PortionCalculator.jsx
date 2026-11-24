import { useState } from 'react'
import { Segmented, TextField, parseNumberDraft } from '../../components/ui.jsx'
import { dateLocale, t } from '../../lib/i18n.js'

const nutrients = [
  { key: 'energy', label: 'Energy', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbohydrates', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
]

function readAmount(raw) {
  const { value } = parseNumberDraft(raw, true, true)
  return Number.isFinite(value) ? value : null
}

function AmountField({ label, raw, onChange }) {
  const invalid = raw.trim() !== '' && readAmount(raw) === null
  return <label className="nutrition-field">
    <span>{label}</span>
    <TextField inputMode="decimal" value={raw} maxLength={12}
      aria-invalid={invalid} onChange={event => onChange(event.target.value)} />
    {invalid && <span className="small">{t('Enter a positive number or zero.')}</span>}
  </label>
}

export default function PortionCalculator() {
  const [basis, setBasis] = useState('g')
  const [label, setLabel] = useState({})
  const [portion, setPortion] = useState('')
  const amount = readAmount(portion)
  const format = new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 1 })

  return <div>
    <section className="card">
      <h2>{t('Portion calculator')}</h2>
      <p className="small muted">{t('Copy the values from the label, then enter how much you will eat or drink.')}</p>
      <Segmented className="seg-range" value={basis} onChange={setBasis} options={[
        { value: 'g', label: t('Per 100 g') }, { value: 'ml', label: t('Per 100 ml') },
      ]} />
      <div className="nutrition-grid">
        {nutrients.map(({ key, label: name, unit }) => <AmountField key={key}
          label={t('{0} ({1})', t(name), unit)} raw={label[key] || ''}
          onChange={raw => setLabel(previous => ({ ...previous, [key]: raw }))} />)}
      </div>
    </section>

    <section className="card">
      <h2>{t('Your portion')}</h2>
      <AmountField label={t('Amount ({0})', basis)} raw={portion} onChange={setPortion} />
      <dl className="nutrition-totals" aria-live="polite">
        {nutrients.map(({ key, label: name, unit }) => {
          const value = readAmount(label[key] || '')
          return <div key={key}>
            <dt>{t(name)}</dt>
            <dd>{amount === null || value === null ? '—' : format.format(value * amount / 100) + ' ' + unit}</dd>
          </div>
        })}
      </dl>
    </section>
  </div>
}
