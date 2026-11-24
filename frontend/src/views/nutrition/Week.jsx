import { useState } from 'react'
import { t, dateLocale } from '../../lib/i18n.js'
import { fmtNum, uid } from '../../lib/format.js'
import { shiftDay, weekStart, shoppingList } from '../../lib/nutrition.js'
import { Button } from '../../components/ui.jsx'
import { Empty, Picker, RecordRow, Field, Tool, saveRow } from './Controls.jsx'

export const dateText=(iso,options)=>new Date(iso+'T12:00:00').toLocaleDateString(dateLocale(),options)
function WeekHeading({date,onDate}) {
  const monday=weekStart(date)
  return <div className="nutrition-period"><Tool name={t('Previous week')} icon="chevronLeft" onClick={()=>onDate(shiftDay(date,-7))}/>
    <strong>{dateText(monday,{day:'numeric', month:'short'})} – {dateText(shiftDay(monday,6),{day:'numeric',month:'short',year:'numeric'})}</strong>
    <Tool name={t('Next week')} icon="chevronRight" onClick={()=>onDate(shiftDay(date,7))}/></div>
}
export function Week({data,change,date,onDate,openFoods}) {
  const [editor,setEditor]=useState(null)
  const monday=weekStart(date)
  const pickDate=d=>{setEditor(null);onDate(d)}
  const rows=data.plan.filter(p=>p.date===date)
  return <section className="card nutrition-panel"><h2>{t('Weekly menu')}</h2>
    <WeekHeading date={date} onDate={pickDate}/>
    <div className="week nutrition-week">{Array.from({length:7},(_,i)=>{
      const d=shiftDay(monday,i)
      return <button key={d} className={'wday'+(d===date?' today':'')} aria-pressed={d===date} type="button" onClick={()=>pickDate(d)}>
        <span className="lbl">{dateText(d,{weekday:'narrow'})}</span><span className="num">{Number(d.slice(-2))}</span><span className={'dot'+(data.plan.some(p=>p.date===d)?' plan':'')}/></button>
    })}</div>
    <h3>{dateText(date,{weekday:'long',day:'numeric',month:'long'})}</h3>
    {rows.map(p=><div key={p.id}><small className="muted">{t(p.slot)}</small>
      <RecordRow row={p} onEdit={()=>setEditor(p)} onRemove={()=>change(n=>{n.plan=n.plan.filter(r=>r.id!==p.id)})}/>
      {data.diary.some(r=>r.id==='plan-'+p.id) ? <small className="muted">{t('Logged in diary')}</small> :
        <Button size="sm" icon="check" onClick={()=>change(n=>{
          if (!n.diary.some(r=>r.id==='plan-'+p.id)) n.diary.push({...p,id:'plan-'+p.id})
        })}>{t('Log in diary')}</Button>}
    </div>)}
    {editor ? <Picker key={editor.id || date} data={data} date={date} initial={editor.id ? editor : null} onCancel={()=>setEditor(null)} onSave={r=>{change(n=>saveRow(n,'plan',r));setEditor(null)}}/> :
      <><Empty>{!rows.length && t('No meals planned for this day.')}</Empty>
        <Button variant="primary" icon="plus" onClick={()=>data.foods.length || data.meals.length ? setEditor({}) : openFoods()}>{t(data.foods.length || data.meals.length ? 'Plan a meal' : 'Add first product')}</Button></>}
  </section>
}
export function Shopping({data,change,date,onDate}) {
  const [extra,setExtra]=useState('')
  const week=weekStart(date)
  const items=shoppingList(data.plan,week), saved=data.shopping.filter(s=>s.week===week)
  const rows=items.map(p=>{
    const id=week+'/'+p.key, quantity=Number(p.amount.toFixed(3)), old=saved.find(r=>r.id===id)
    return {id,week,name:p.name,quantity,unit:p.unit,checked:old?.quantity===quantity && old.checked}
  }).concat(saved.filter(s=>s.extra))
  return <section className="card nutrition-panel"><h2>{t('Shopping list')}</h2>
    <WeekHeading date={date} onDate={onDate}/>
    {rows.length ? <div className="nutrition-heading"><small className="muted">{t('{0} of {1} bought',rows.filter(r=>r.checked).length,rows.length)}</small></div> :
      <Empty>{t('Plan meals to combine their ingredients here, or add an extra below.')}</Empty>}
    {rows.map(row=><div key={row.id} className="nutrition-record">
      <label className="nutrition-check"><input type="checkbox" checked={!!row.checked} onChange={e=>{const checked=e.target.checked; change(n=>saveRow(n,'shopping',{...row,checked}))}}/>
        <span>{row.name}</span></label>{!row.extra && <b>{fmtNum(row.quantity)} {row.unit}</b>}
      {row.extra && <Tool name={t('Remove {0}',row.name)} icon="trash" onClick={()=>change(n=>{n.shopping=n.shopping.filter(r=>r.id!==row.id)})}/>}
    </div>)}
    <form className="nutrition-form" onSubmit={e=>{e.preventDefault();if(!extra.trim())return
      change(n=>n.shopping.push({id:uid(),week,name:extra.trim(),extra:true,checked:false}));setExtra('')
    }}><Field label={t('Extra item')} value={extra} maxLength={120} required onChange={e=>setExtra(e.target.value)}/>
      <Button type="submit" icon="plus" disabled={!extra.trim()}>{t('Add to shopping list')}</Button></form>
  </section>
}

