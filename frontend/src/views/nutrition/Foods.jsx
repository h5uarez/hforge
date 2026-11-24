import { useEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { fmtNum, uid } from '../../lib/format.js'
import { decimal, nutrients, nutrientNames } from '../../lib/nutrition.js'
import { validGTIN, barcodeFromPhoto, lookupFood } from '../../lib/food-barcode.js'
import { Button, Segmented } from '../../components/ui.jsx'
import { Field, Tool, Empty, saveRow } from './Controls.jsx'

const blank = () => ({ name:'',barcode:'',unit:'g',values:{} })
export default function Foods({ data, change }) {
  const [form,setForm]=useState(null), [search,setSearch]=useState(''), [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const request=useRef(null), fileInput=useRef(null)
  const stop=()=>{request.current?.abort();request.current=null}
  useEffect(()=>stop,[])
  const edit=row=>{stop();setBusy(false);setMessage('');setForm(row ? {...row,values:{...row.values}} : blank())}
  const close=()=>{stop();setBusy(false);setMessage('');setForm(null)}
  const patch=values=>setForm(f=>({...f,...values}))
  const identify=async photo=>{
    stop()
    const control=new AbortController()
    request.current=control
    const timeout=setTimeout(()=>control.abort(),15000)
    setBusy(true);setMessage('')
    try {
      const code=photo ? await barcodeFromPhoto(photo) : form.barcode.trim()
      if (control.signal.aborted) return
      if (!code || !validGTIN(code)) {
        setMessage(t(photo ? 'Could not read the photo. Enter the digits below.' : 'Check the barcode digits.'));return
      }
      const local=data.foods.find(f=>f.barcode===code)
      if(local){setForm({...local,values:{...local.values}});setMessage(t('Found in your products.'));return}
      patch({barcode:code})
      const found=await lookupFood(code,control.signal)
      if(control.signal.aborted) return
      if(found){setForm(f=>({...f,...found}));setMessage(t('Check the name, values and unit against the label.'))}
      else setMessage(t('Product not found. Copy the label to save it.'))
    } catch { if(request.current===control)setMessage(t('Lookup unavailable. You can still enter the label.')) }
    finally {clearTimeout(timeout);if(request.current===control){setBusy(false);request.current=null}}
  }
  const submit=e=>{
    e.preventDefault()
    const barcode=form.barcode?.trim() || ''
    if(barcode && !validGTIN(barcode)) {setMessage(t('Check the barcode digits.'));return}
    if(barcode && data.foods.some(v=>v.barcode===barcode && v.id!==form.id)){setMessage(t('This barcode already belongs to a saved product.'));return}
    const values={}
    for(const k of nutrients){
      const raw=form.values[k] ?? ''
      values[k]=decimal(raw)
      if(String(raw).trim() && values[k]===null){setMessage(t('Check the values on the label.'));return}
    }
    const row={...form,id:form.id || uid(),name:form.name.trim(),barcode,values}
    if(!row.name || nutrients.every(k=>values[k]===null)){setMessage(t('Enter a name and at least one nutrient.'));return}
    change(n=>saveRow(n,'foods',row));close()
  }
  return <section className="card nutrition-panel">
    <div className="nutrition-heading"><h2>{t('My products')}</h2>{!form && <Button size="sm" icon="plus" onClick={()=>edit(null)}>{t('New product')}</Button>}</div>
    {form ? <form className="nutrition-form" onSubmit={submit}>
      <Field label={t('Barcode (optional)')} inputMode="numeric" maxLength={14} disabled={busy} value={form.barcode || ''} onChange={e=>patch({barcode:e.target.value,source:null})}/>
      <div className="nutrition-actions"><Button type="button" disabled={busy} onClick={()=>identify(null)}>{t('Look up code')}</Button>
        <Button type="button" disabled={busy} onClick={()=>fileInput.current.click()}>{t('Scan photo')}</Button></div>
      <input hidden ref={fileInput} type="file" accept="image/*" capture="environment" onChange={e=>{const file=e.target.files[0];e.target.value='';if(file)identify(file)}}/>
      <small className="muted">{t('Photograph the whole barcode straight on, with space on both sides.')}</small>
      {busy && <p role="status">{t('Looking up product…')}</p>}
      {message && <p role="status">{message}</p>}
      <fieldset disabled={busy} className="nutrition-form">
        <Field label={t('Product name')} required maxLength={160} value={form.name} onChange={e=>patch({name:e.target.value})}/>
        <Segmented value={form.unit} onChange={unit=>patch({unit})} options={[{value:'g',label:t('Per 100 g')},{value:'ml',label:t('Per 100 ml')}]}/>
        <div className="nutrition-grid">{nutrients.map(k=><Field key={k} label={t('{0} ({1})',t(nutrientNames[k]),k==='energy'?'kcal':'g')} inputMode="decimal" maxLength={8}
          value={form.values[k] ?? ''} onChange={e=>patch({values:{...form.values,[k]:e.target.value}})}/>)}</div>
        {form.source==='off' && <a className="small" href={'https://world.openfoodfacts.org/product/'+form.barcode} target="_blank" rel="noreferrer">Open Food Facts · ODbL</a>}
      </fieldset>
      <div className="nutrition-actions"><Button type="submit" variant="primary" disabled={busy}>{t('Save product')}</Button><Button type="button" onClick={close}>{t('Cancel')}</Button></div>
    </form> : <>
      {data.foods.length>0 && <Field label={t('Find a product')} type="search" value={search} onChange={e=>setSearch(e.target.value)}/>}
      {!data.foods.length && <Empty>{t('Add your first product from its label or barcode.')}</Empty>}
      {data.foods.filter(f=>(f.name+' '+f.barcode).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(f=><div className="nutrition-record" key={f.id}>
        <div><strong>{f.name}</strong><small>{f.values.energy == null ? '—' : fmtNum(f.values.energy)+' kcal'} / 100 {f.unit}{f.source==='off' && <> · <a href={'https://world.openfoodfacts.org/product/'+f.barcode} target="_blank" rel="noreferrer">Open Food Facts</a></>}</small></div>
        <Tool name={t('Edit {0}',f.name)} icon="pencil" onClick={()=>edit(f)}/>
      </div>)}
    </>}
  </section>
}

