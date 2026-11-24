import { useState } from 'react'
import { t } from '../../lib/i18n.js'
import { fmtNum, uid } from '../../lib/format.js'
import { decimal, positive, slots } from '../../lib/nutrition.js'
import { Button, TextField } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'

export const unitLabel = unit => unit === 'serving' ? t('servings') : unit
export function Field({ label, children, ...props }) {
  return <label className="nutrition-field"><span>{label}</span>{children || <TextField {...props} />}</label>
}
export function Select({ label, value, onChange, children, required }) {
  return <Field label={label}><select className="field" value={value} onChange={e => onChange(e.target.value)} required={required}>{children}</select></Field>
}
export function Tool({ name, icon, onClick }) {
  return <button type="button" className="iconbtn" aria-label={name} onClick={onClick}><Icon name={icon} /></button>
}
export function Empty({ children }) { return <p className="nutrition-empty small muted">{children}</p> }
export function Picker({ data, initial, date, onSave, onCancel }) {
  const options = [...data.foods, ...data.meals]
  const [id,setId] = useState(initial?.item.id || options[0]?.id || '')
  const [qty,setQty] = useState(String(initial?.amount ?? (options[0]?.unit === 'serving' ? 1 : 100)))
  const [slot,setSlot] = useState(initial?.slot || slots[0])
  const [filter,setFilter] = useState('')
  const item = (initial?.item.id === id ? initial.item : options.find(o => o.id === id))
  const visible = options.filter(o => o.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))
  if (item && !visible.some(v => v.id === id)) visible.unshift(item)
  const amount = decimal(qty)
  return <form className="nutrition-form" onSubmit={e => {
    e.preventDefault()
    if (item && positive(amount)) onSave({id:initial?.id || uid(), date, slot, item, amount})
  }}>
    <Field label={t('Filter foods and meals')} value={filter} onChange={e=>setFilter(e.target.value)} />
    <Select label={t('Food or meal')} value={id} onChange={next => {
      setId(next); setQty(options.find(o => o.id === next)?.unit === 'serving' ? '1' : '100')
    }}>{visible.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</Select>
    <div className="nutrition-grid">
      <Select label={t('Meal time')} value={slot} onChange={setSlot}>{slots.map(s=><option key={s} value={s}>{t(s)}</option>)}</Select>
      <Field label={t('Amount ({0})',unitLabel(item?.unit || 'g'))} inputMode="decimal" value={qty} maxLength={9} onChange={e=>setQty(e.target.value)} />
    </div>
    {item && positive(amount) && item.values.energy != null && <span className="small muted">{fmtNum(item.values.energy * amount / (item.unit === 'serving' ? 1 : 100))} kcal</span>}
    <div className="nutrition-actions"><Button type="submit" variant="primary" disabled={!item || !positive(amount)}>{t('Save')}</Button>
      <Button type="button" onClick={onCancel}>{t('Cancel')}</Button></div>
  </form>
}
export function RecordRow({ row, onEdit, onRemove, children }) {
  return <div className="nutrition-record">
    <div><strong>{row.item.name}</strong><small>{fmtNum(row.amount)} {unitLabel(row.item.unit)} · {row.item.values.energy == null ? '—' : fmtNum(row.item.values.energy * row.amount / (row.item.unit === 'serving' ? 1 : 100)) + ' kcal'}</small></div>
    {children}
    {onEdit && <Tool name={t('Edit {0}',row.item.name)} icon="pencil" onClick={onEdit} />}
    <Tool name={t('Remove {0}',row.item.name)} icon="trash" onClick={onRemove} />
  </div>
}
export function saveRow(draft, list, row) {
  const index = draft[list].findIndex(r => r.id === row.id)
  if (index >= 0) draft[list][index] = row
  else draft[list].push(row)
}

