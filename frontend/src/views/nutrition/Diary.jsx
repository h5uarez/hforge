import { useState } from 'react'
import { fmtNum, todayISO } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import { energyGoal, nutrients, nutrientNames, slots, totals, shiftDay } from '../../lib/nutrition.js'
import { Button } from '../../components/ui.jsx'
import BodyweightCard from '../../components/BodyweightCard.jsx'
import { Empty, Picker, RecordRow, saveRow, Tool } from './Controls.jsx'
import PortionCalculator from './PortionCalculator.jsx'
import { dateText } from './Week.jsx'

export default function Diary({data,change,date,onDate,weights,unit,go}) {
  const [editor,setEditor]=useState(null)
  const day=data.diary.filter(r=>r.date===date)
  const sum=totals(day)
  const kcal=sum.energy.value
  const goal=date===todayISO() && energyGoal(data.profile,weights.at(-1)?.w,unit)
  const dayWeight=weights.find(b=>b.d===date)
  const pickDate=d=>{if(d){setEditor(null);onDate(d)}}
  const available=data.foods.length || data.meals.length
  const add=()=>available ? setEditor({}) : go('foods')
  return <>
    <section className="card nutrition-panel">
      <div className="nutrition-heading"><h2>{t('Food diary')}</h2><Tool name={t('Energy goal')} icon="target" onClick={()=>go('goals')}/></div>
      <div className="nutrition-period"><Tool name={t('Previous day')} icon="chevronLeft" onClick={()=>pickDate(shiftDay(date,-1))}/>
        <label className="nutrition-date"><strong>{date===todayISO()?t('Today'):dateText(date,{weekday:'short'})} · {dateText(date,{day:'numeric',month:'short'})}</strong>
          <input type="date" aria-label={t('Diary date')} value={date} onChange={e=>pickDate(e.target.value)}/></label>
        <Tool name={t('Next day')} icon="chevronRight" onClick={()=>pickDate(shiftDay(date,1))}/></div>
      <div className="nutrition-intake"><div><strong>{kcal==null?'—':fmtNum(kcal)}</strong> kcal</div>
        {goal && <small>{t('Daily goal: {0} kcal',fmtNum(goal.target))}</small>}</div>
      {goal && kcal!=null && <progress className="nutrition-progress" max={goal.target} value={Math.min(kcal,goal.target)} aria-label={t('Energy')}/>}
      <div className="nutrition-macros">{nutrients.slice(1).map(k=><div key={k}><small>{t(nutrientNames[k])}</small><b>{sum[k].value==null?'—':fmtNum(sum[k].value)+' g'}</b></div>)}</div>
      {nutrients.some(k=>sum[k].partial) && <small className="muted">{t('Partial totals: some label values are missing.')}</small>}
      {dayWeight && <small className="muted">{t('Weight on this date: {0}',fmtNum(dayWeight.w)+' '+unit)}</small>}
    </section>
    <section className="card nutrition-panel">
      <div className="nutrition-heading"><h2>{t('Daily meals')}</h2>{!editor && <Button size="sm" icon="plus" onClick={add}>{t(available?'Log food':'Add first product')}</Button>}</div>
      {editor && <Picker key={editor.id||date} date={date} initial={editor.id ? editor : null} data={data} onCancel={()=>setEditor(null)} onSave={r=>{change(n=>saveRow(n,'diary',r));setEditor(null)}}/>}
      {!day.length && !editor && <Empty>{t('Your foods and portions for this date will appear here.')}</Empty>}
      {slots.map(slot=>day.some(r=>r.slot===slot) && <div key={slot}><h3>{t(slot)}</h3>
        {day.filter(r=>r.slot===slot).map(r=><RecordRow key={r.id} row={r} onEdit={()=>setEditor(r)} onRemove={()=>change(n=>{n.diary=n.diary.filter(v=>v.id!==r.id)})}/>)}</div>)}
    </section>
    <BodyweightCard/>
    <details className="card nutrition-details"><summary>{t('Portion calculator')}</summary><PortionCalculator/></details>
  </>
}

