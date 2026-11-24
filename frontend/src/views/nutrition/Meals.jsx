import { useState } from 'react'
import { t } from '../../lib/i18n.js'
import { fmtNum, uid } from '../../lib/format.js'
import { decimal, positive, mealItem } from '../../lib/nutrition.js'
import { Button } from '../../components/ui.jsx'
import { Empty, Field, Select, Tool, saveRow } from './Controls.jsx'

export default function Meals({data,change,openFoods}) {
  const [form,setForm]=useState(null)
  const patch=p=>setForm(f=>({...f,...p}))
  const edit=m=>setForm({id:m?.id || uid(),name:m?.name || '',servings:String(m?.servings ?? 1),
    parts:(m?.ingredients || [{item:data.foods[0],amount:100}]).map(p=>({...p,key:uid(),amount:String(p.amount)}))})
  const part=(key,patch)=>setForm(f=>({...f,parts:f.parts.map(p=>p.key===key ? {...p,...patch} : p)}))
  const valid=form && form.name.trim() && positive(decimal(form.servings)) && form.parts.length>0 && form.parts.every(p=>p.item && positive(decimal(p.amount)))
  const submit=e=>{
    e.preventDefault();if(!valid)return
    const ingredients=form.parts.map(({item,amount})=>({item,amount:decimal(amount)}))
    const row=mealItem(form.id,form.name.trim(),decimal(form.servings),ingredients)
    change(n=>saveRow(n,'meals',row));setForm(null)
  }
  return <section className="card nutrition-panel">
    <div className="nutrition-heading"><h2>{t('Saved meals')}</h2>{!form && data.foods.length>0 && <Button size="sm" icon="plus" onClick={()=>edit(null)}>{t('New meal')}</Button>}</div>
    {!data.foods.length && <><Empty>{t('Save the products you cook with, then combine them into a meal.')}</Empty><Button onClick={openFoods}>{t('My products')}</Button></>}
    {form ? <form className="nutrition-form" onSubmit={submit}>
      <Field label={t('Meal name')} required maxLength={160} value={form.name} onChange={e=>patch({name:e.target.value})}/>
      <Field label={t('Servings prepared')} inputMode="decimal" maxLength={6} value={form.servings} onChange={e=>patch({servings:e.target.value})}/>
      {form.parts.map(p=><div className="nutrition-ingredient" key={p.key}>
        <Select label={t('Ingredient')} value={p.item.id} onChange={id=>part(p.key,{item:data.foods.find(f=>f.id===id)})}>
          {!data.foods.some(f=>f.id===p.item.id) && <option value={p.item.id}>{p.item.name}</option>}
          {data.foods.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</Select>
        <Field label={t('Amount ({0})',p.item.unit)} inputMode="decimal" maxLength={8} value={p.amount} onChange={e=>part(p.key,{amount:e.target.value})}/>
        <Tool name={t('Remove {0}',p.item.name)} icon="trash" onClick={()=>patch({parts:form.parts.filter(r=>r.key!==p.key)})}/>
      </div>)}
      <Button type="button" icon="plus" disabled={form.parts.length>=200 || !data.foods.length} onClick={()=>patch({parts:[...form.parts,{key:uid(),item:data.foods[0],amount:'100'}]})}>{t('Add ingredient')}</Button>
      <div className="nutrition-actions"><Button type="submit" variant="primary" disabled={!valid}>{t('Save meal')}</Button>
      <Button type="button" onClick={()=>setForm(null)}>{t('Cancel')}</Button></div>
    </form> : <>
      {!data.meals.length && data.foods.length>0 && <Empty>{t('Create a meal with its ingredients and the number of portions it makes.')}</Empty>}
      {data.meals.map(m=><div className="nutrition-record" key={m.id}><div><strong>{m.name}</strong>
        <small>{m.ingredients.map(x=>x.item.name).join(' · ')}</small><small>{fmtNum(m.servings)} {t('servings')} · {m.values.energy==null?'—':fmtNum(m.values.energy)} kcal / {t('serving')}</small></div>
        <Tool name={t('Edit {0}',m.name)} icon="pencil" onClick={()=>edit(m)}/></div>)}
    </>}
  </section>
}

