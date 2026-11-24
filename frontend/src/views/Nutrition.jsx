import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import WorkspaceSwitch from '../components/WorkspaceSwitch.jsx'
import Icon from '../components/Icon.jsx'
import { Segmented, TextField, parseNumberDraft, useScrolled } from '../components/ui.jsx'
import { dateLocale, t } from '../lib/i18n.js'
import './nutrition.css'

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

export default function Nutrition() {
  const navigate = useNavigate()
  const scrolled = useScrolled()
  const [basis, setBasis] = useState('g')
  const [label, setLabel] = useState({})
  const [portion, setPortion] = useState('')
  const amount = readAmount(portion)
  const format = new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 1 })

  return <div className="narrow">
    <div className={'hdr page' + (scrolled ? ' scrolled' : '')}>
      <div><h1>Hforge Nutrition</h1></div>
      <button type="button" className="iconbtn" aria-label={t('Settings')} onClick={() => navigate('/settings')}>
        <Icon name="gear" />
      </button>
    </div>
    <WorkspaceSwitch current="/nutrition" />

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
