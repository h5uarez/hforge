import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { emptyNutrition } from '../lib/nutrition.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { deliverExport, serializeBackup } from '../lib/export.js'
import HomeHeader from '../components/HomeHeader.jsx'
import WorkspaceSwitch from '../components/WorkspaceSwitch.jsx'
import Icon from '../components/Icon.jsx'
import Diary from './nutrition/Diary.jsx'
import Foods from './nutrition/Foods.jsx'
import Meals from './nutrition/Meals.jsx'
import { Week, Shopping } from './nutrition/Week.jsx'
import Goals from './nutrition/Goals.jsx'
import './nutrition.css'

const tabs = [
  ['diary','Food diary','clipboard'], ['foods','Products','utensils'], ['meals','Meals','folder'],
  ['week','Weekly menu','calendar'], ['shopping','Shopping','basket'],
]
export default function Nutrition() {
  const S=useStore(s=>s.S)
  const update=useStore(s=>s.update), toast=useUI(s=>s.toast)
  const [params,setParams]=useSearchParams()
  const [date,setDate]=useState(todayISO)
  const tab=params.get('view') || 'diary'
  const go=view=>{setParams(view==='diary'?{}:{view}); window.scrollTo(0,0)}
  const data=S.nutrition || emptyNutrition()
  const change=fn=>update(s=>{s.nutrition ||= emptyNutrition();fn(s.nutrition)})
  const common={data,change,date,onDate:setDate,openFoods:()=>go('foods')}
  const download=async()=>{
    try {
      await deliverExport(serializeBackup({nutrition:data,bodyweight:S.bodyweight,unit:S.unit,workouts:[],routines:[]}),
        'hforge-nutrition-'+todayISO()+'.json')
      toast(t('Backup exported'))
    } catch {toast(t('Export cancelled or unavailable.'))}
  }
  return <div className="narrow nutrition-space">
    <HomeHeader onExport={download}/>
    <WorkspaceSwitch current="/nutrition"/>
    {tab==='goals' ? <Goals {...common} weight={S.bodyweight.at(-1)?.w} unit={S.unit}/> :
      tab==='foods' ? <Foods {...common}/> : tab==='meals' ? <Meals {...common}/> :
      tab==='week' ? <Week {...common}/> : tab==='shopping' ? <Shopping {...common}/> :
      <Diary {...common} weights={S.bodyweight} unit={S.unit} go={go}/>}
    <nav className="nutrition-nav" aria-label={t('Nutrition')}>{tabs.map(([id,label,icon])=>
      <button key={id} type="button" aria-current={(tab===id || (tab==='goals' && id==='diary'))?'page':undefined} onClick={()=>go(id)}>
        <Icon name={icon}/><span>{t(label)}</span></button>)}</nav>
  </div>
}
