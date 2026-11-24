import { useState } from 'react'
import { t } from '../../lib/i18n.js'
import { fmtNum } from '../../lib/format.js'
import { decimal, energyGoal } from '../../lib/nutrition.js'
import { bwSheet } from '../../sheets.jsx'
import { Button } from '../../components/ui.jsx'
import { Field, Select } from './Controls.jsx'

const choices={
  sex:[['male','Male'],['female','Female']],
  build:[['','Unspecified'],['small','Small frame'],['medium','Medium frame'],['large','Large frame']],
  activity:[['sedentary','Mostly seated'],['light','Lightly active'],['active','Active most days'],['veryActive','Very active']],
  goal:[['lose','Lose weight'],['maintain','Maintain weight'],['gain','Gain weight']],
}
export default function Goals({data,change,weight,unit}) {
  const [form,setForm]=useState(()=>({...{height:'',age:'',sex:'',build:'',activity:'light',goal:'maintain'},...data.profile}))
  const numeric={...form,age:decimal(form.age),height:decimal(form.height)}
  const estimate=energyGoal(numeric,weight,unit)
  const [saved,setSaved]=useState(false)
  const patch=(key,value)=>{setSaved(false);setForm(f=>({...f,[key]:value}))}
  const choice=(key,label)=><Select label={t(label)} value={form[key]} onChange={v=>patch(key,v)} required={key!=='build'}>
    {key==='sex' && <option value="">{t('Choose')}</option>}
    {choices[key].map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</Select>
  return <section className="card nutrition-panel"><h2>{t('Energy goal')}</h2>
    <p className="small muted">{t('Daily estimate for adults. During pregnancy or breastfeeding, use an individual assessment.')}</p>
    <form className="nutrition-form" onSubmit={e=>{e.preventDefault();if(estimate){change(n=>{n.profile=numeric});setSaved(true)}}}>
      <div className="nutrition-record"><div><strong>{t('Body weight')}</strong><small>{weight ? fmtNum(weight)+' '+unit : t('Log a weigh-in to calculate your goal.')}</small></div>
        <Button size="sm" type="button" onClick={()=>bwSheet()}>{t('Log')}</Button></div>
      <div className="nutrition-grid"><Field label={t('Height (cm)')} required inputMode="decimal" maxLength={5} value={form.height} onChange={e=>patch('height',e.target.value)}/>
        <Field label={t('Age (years)')} required type="number" min="18" max="100" value={form.age} onChange={e=>patch('age',e.target.value)}/>
        {choice('sex','Sex used in the equation')}{choice('build','Body frame (optional)')}</div>
      {choice('activity','Usual activity')}{choice('goal','Weight goal')}
      <small className="muted">{t('Mifflin–St Jeor uses weight, height, age and sex. Frame size is saved for reference. Activity estimates maintenance. Loss and gain start at −10% and +10%.')}</small>
      {estimate && <div className="nutrition-estimate"><strong>{fmtNum(estimate.target)} kcal</strong><small>{t('Estimated maintenance: {0} kcal',fmtNum(estimate.maintenance))}</small></div>}
      {!estimate && <small className="muted">{t('Enter an adult age, height (120–240 cm), sex and a current weight to calculate.')}</small>}
      <Button type="submit" variant="primary" disabled={!estimate}>{t('Save goal')}</Button>
      {saved && <span role="status">{t('Goal saved')}</span>}
    </form>
  </section>
}

