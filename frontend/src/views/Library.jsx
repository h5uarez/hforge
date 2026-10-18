import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { EXDB, BODYPARTS, allExercises, equipmentOf, exerciseMatches, exerciseName } from '../lib/exercises.js'
import { bestWeightFor } from '../lib/history.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { Thumb } from '../components/Media.jsx'
import { exerciseDetailSheet, addToRoutineSheet, customExSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, SearchField } from '../components/ui.jsx'

export default function Library() {
  const S = useStore(s => s.S)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [eq, setEq] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [shown, setShown] = useState(40)
  const base = allExercises(S).filter(e => (!bp || e.bp === bp) && exerciseMatches(e, q))
  const eqOpts = equipmentOf(base)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  const f = eqOn ? base.filter(e => e.eq === eqOn) : base
  const activeFilterCount = (bp ? 1 : 0) + (eqOn ? 1 : 0)

  return <>
    <div className="hdr"><div><h1>{t('Exercises')}</h1><div className="sub">{t('{0} exercises with animations', EXDB.length)}</div></div></div>
    <div className="library-search">
      <SearchField value={q} onChange={e => { setQ(e.target.value); setShown(40) }} onClear={() => { setQ(''); setShown(40) }}
        placeholder={t('Search…')} aria-label={t('Search…')} />
      <Button type="button" size="sm" variant="tinted" className="filter-toggle"
        trailingIcon={filtersOpen ? 'chevronUp' : 'chevronDown'}
        aria-label={t('Filters') + (activeFilterCount ? ` (${activeFilterCount})` : '')}
        aria-expanded={filtersOpen} aria-controls="library-filters"
        onClick={() => setFiltersOpen(open => !open)}>
        {t('Filters')}{activeFilterCount > 0 && <span className="filter-count" aria-hidden="true">{activeFilterCount}</span>}
      </Button>
    </div>
    <div id="library-filters" role="group" aria-label={t('Filters')} hidden={!filtersOpen}>
      <div className="chips" style={{ marginBottom: eqOpts.length > 1 ? 8 : 12 }}>
        <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setEq(''); setShown(40) }}>{t('All')}</button>
        {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setEq(''); setShown(40) }}>{t(b)}</button>)}
      </div>
      {eqOpts.length > 1 && <div className="chips" style={{ marginBottom: 12 }}>
        <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(40) }}>{t('Any equipment')}</button>
        {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(40) }}>{t(x)}</button>)}
      </div>}
    </div>
    <div className="list">
      <div className="item" onClick={() => customExSheet(null, ex => exerciseDetailSheet(ex), q.trim())}>
        <div className="thumb thumb-x"><Icon name="sparkles" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name + body part, no animation')}</div></div><Icon name="plus" className="chev" />
      </div>
      {f.slice(0, shown).map(e => {
        const best = bestWeightFor(S, e.id)
        return <div key={e.id} className="item" onClick={() => exerciseDetailSheet(e)}>
          <Thumb ex={e} />
          <div className="grow"><div className="tt capitalize">{exerciseName(e)}</div><div className="ss capitalize">{t(e.tg || e.bp)} · {t(e.eq)}</div></div>
          {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
          <Button size="sm" variant="tinted" icon="plus" onClick={ev => { ev.stopPropagation(); addToRoutineSheet(e) }}>{t('Plan')}</Button>
        </div>
      })}
      {f.length === 0 && <div className="empty"><div className="ico"><Icon name="magnifier" /></div><div>{t('No match')}</div><div className="small dim" style={{ marginTop: 6 }}>{t('Try a shorter name — “press” finds every press there is.')}</div><Button variant="tinted" size="sm" style={{ marginTop: 14 }} onClick={() => { setQ(''); setBp(''); setEq(''); setShown(40) }}>{t('Clear')}</Button></div>}
    </div>
    {f.length > shown && <><div style={{ height: 10 }} /><Button onClick={() => setShown(s => s + 40)}>{t('Show more')}</Button></>}
  </>
}
