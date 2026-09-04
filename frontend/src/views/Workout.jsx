import { useEffect, useLayoutEffect, useRef, useState, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr, exerciseName } from '../lib/exercises.js'
import { moveSessionUnit, remapCur, FOCUS_REF_RETRY_LIMIT, focusRefRetryDecision, restoreFocusedEntry } from '../lib/session.js'
import { effectiveRoutine, lastEntryFor, bestWeightFor, setsDoneActive, supersetUnits, unitOf, setLabel, modeOf, isBw, isPerSide, sideReps, repStep, EFFORT, effortOf, stepEffort, capEffort, syncSideSet, projectSideSet, parseTimedSeconds, NOTE_MAX, updateExerciseNote } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, exCount, DAYN } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { touchActiveRecord } from '../lib/inactivity.js'
import Media from '../components/Media.jsx'
import { startFlow, exercisePicker, exConfigSheet, exerciseDetailSheet, topWeightSheet, finishWorkout, workoutCompleteSheet, confirmSheet, commitPickerSelection, rebuildActiveEntry, buildWorkoutEntry } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField, TextArea } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'

// Long-press threshold in milliseconds. Long enough to be a deliberate gesture, short
// enough to feel snappy. The handler is reset on any pointer move, so scrolling through
// the row never accidentally opens a target.
const LONG_PRESS_MS = 500

/* ---------- start chooser (no active workout) ---------- */
function StartChooser() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const todayR = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const others = S.routines.filter(r => r !== todayR)
  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start workout')}</h1><div className="sub">{t(DAYN[new Date().getDay()])} — {todayR ? t('today is {0}', todayR.name) : t('rest day, but no one’s stopping you')}</div></div></div>
    {todayR && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="accent">{t("Today's plan")}{todayOvr ? ' · ' + t('rescheduled') : ''}</h2>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><div className="big">{todayR.name}</div><div className="muted small">{exCount(todayR.ex.length)}</div></div>
        <span className="lrow-i" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 22 }}><Icon name={glyphOf(todayR.emoji)} /></span>
      </div>
      <Button variant="primary" icon="play" onClick={() => startFlow(todayR.id)}>{t('Start')}</Button>
    </div>}
    {others.length > 0 && <><h4 className="sec">{t('Other routines')}</h4>
      <div className="list">{others.map(r => <div key={r.id} className="item" onClick={() => startFlow(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <span className="tag acc">{t('Start')}</span></div>)}</div></>}
    <div style={{ height: 14 }} />
    <Button icon="shuffle" onClick={() => startFlow(null)}>{t('Freestyle workout (pick as you go)')}</Button>
    {!S.routines.length && <><div style={{ height: 10 }} /><Button variant="primary" onClick={() => nav('/plan')}>{t('Build a plan first')}</Button></>}
  </div>
}

/* ---------- elapsed clock (isolated so the workout tree doesn't re-render every second) ---------- */
function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.floor((Date.now() - start) / 1000); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [start])
  return <span>{t}</span>
}

/* ---------- one exercise row (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
function ExerciseBlock({ entryIdx, sid, compact, heading = 'h2', onEdit, onToggle, onField, onNoteChange, onAddSet, onRemoveSet, onStartTimed }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const entry = S.active.entries[entryIdx]
  const ex = exOr(entry.id)
  const workoutNoteId = 'workout-note-' + sid
  const workoutNoteContentId = workoutNoteId + '-content'
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  const last = lastEntryFor(S, entry.id)
  // The same number the "confirm your working weight" sheet calls your best, so the two
  // never disagree inside one session: heaviest logged set, or the working weight you kept.
  const best = cardio ? 0 : Math.max(bestWeightFor(S, entry.id), (S.exWeights[entry.id] || {}).w || 0)
  // What the progression policy decided for this session, and why (issue #17). Computed when
  // the session was built so the reason matches the numbers already in the rows.
  const plan = entry.plan
  // A bodyweight set has no weight to type, so the column is not there (issue #32) — one
  // stepper instead of two, which is the whole point of the flag. Adding a belt weight in the
  // config brings it back, now labelled as the addition it is.
  const cfg = { ...(entry.target || {}), id: entry.id }
  const bw = !cardio && isBw(cfg)
  const added = bw && entry.sets.some(s => {
    const p = projectSideSet(s)
    return p.w > 0 || s.left?.w > 0 || s.right?.w > 0
  })
  const loadCol = { f: 'w', step: 2.5, dec: true, hd: bw ? t('Added ({0})', S.unit) : t('Weight ({0})', S.unit) }
  // The reps column is the total in every mode, unilateral included — the stepper walks in
  // twos there so the number you land on is one you can actually split evenly.
  const repCol = { f: 'r', step: repStep(cfg), dec: false, hd: t('Reps') }
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
      : (bw && !added) ? repCol : loadCol
  const col2 = cardio ? { f: 'speed', step: 0.5, dec: true, hd: t('Speed (km/h)') }
    : timed ? ((bw && !added) ? null : loadCol)
      : (bw && !added) ? null : repCol
  // Effort (RIR or RPE, whichever the profile logs) only makes sense for weighted rep sets,
  // not cardio/timed holds, and is opt-in since it adds a third stepper to every row. `opt`
  // because an unlogged effort is not the same as 0 — RIR 0 says the set went to failure.
  const kind = effortOf(S)
  const eff = EFFORT[kind]
  const col3 = mode === 'reps' && eff ? { ...eff, eff: kind, dec: true, opt: true, hd: t(eff.hd) } : null
  // Programmed-effort targets ride alongside the actual `rir`/`rpe` stepper. They are only
  // shown on the row when the saved metric matches the active profile — a routine planned
  // on RIR renders no target here the moment Settings flips to RPE, with no conversion.
  const showTargetBtn = mode === 'reps' && !!eff
  const setTarget = s => showTargetBtn && s && s.plannedEffort && s.plannedEffort.metric === kind
    ? s.plannedEffort
    : null
  // The effort column walks its own scale — see stepEffort. Weight and reps step up from 0
  // with no ceiling, as they always did.
  const bump = (s, i, col, dir) => {
    if (col.eff) return onField(i, col.f, stepEffort(col.eff, s[col.f], dir))
    onField(i, col.f, Math.max(0, Math.round(((s[col.f] || 0) + dir * col.step) * 100) / 100))
  }
  // Uses the shared stepper markup so a set row picks up the same control styling
  // as every other +/- field in the app.
  const cell = (s, i, col, cls) => (
    <div className={'stp ' + cls}>
      <button aria-label={t('Decrease')} onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>
      {/* a typed effort is capped — there is no RPE 12, and 12 reps in reserve is a warm-up.
          Vacant effort paints a dim "–" ghost so the slot reads as waiting input
          in the same full-width track (see .stp .num::placeholder). */}
      <span className="val"><NumberField aria-label={t('Sets') + ' ' + (i + 1) + ': ' + col.hd} decimal={col.dec} nullable={col.opt} placeholder={col.opt ? '–' : undefined} value={s[col.f] ?? ''}
        onChange={v => onField(i, col.f, col.eff ? capEffort(col.eff, v) : v)} /></span>
      <button aria-label={t('More time')} onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>
    </div>
  )
  // Effort steps on its own scale (see stepEffort) — routing col.eff through it keeps
  // the per-side RPE/RIR cells honest: + on empty starts at the scale floor (RPE 5),
  // − on empty stays empty, stepping off the floor clears the cell (null drops the key).
  const sideCell = (s, i, side, col, cls) => <div className={'stp ' + cls + ' side-' + side + '-' + cls}>
    <button aria-label={t('Decrease {0}', side)} onClick={() => onField(i, col.f, col.eff ? stepEffort(col.eff, s[side][col.f] ?? null, -1) : Math.max(0, Math.round(((s[side][col.f] || 0) - col.step) * 100) / 100), side)}><Icon name="minus" /></button>
   <span className="val"><NumberField className="side-input" aria-label={side.toUpperCase() + ' ' + t('Sets') + ' ' + (i + 1) + ': ' + col.hd} decimal={col.dec} nullable={col.opt} placeholder={col.opt ? '–' : undefined} value={s[side][col.f] ?? ''} onChange={v => onField(i, col.f, col.eff ? capEffort(col.eff, v) : v, side)} /></span>
   <button aria-label={t('Increase {0}', side)} onClick={() => onField(i, col.f, col.eff ? stepEffort(col.eff, s[side][col.f] ?? null, 1) : Math.max(0, Math.round(((s[side][col.f] || 0) + col.step) * 100) / 100), side)}><Icon name="plus" /></button>
    </div>
  // Disclosure: which set rows have their immutable planned target revealed. A new Set on
  // every change so React notices — disclosure is local UI state, never persisted.
  const [disclosed, setDisclosed] = useState(() => new Set())
  const toggleDisclosed = i => setDisclosed(s => {
    const ns = new Set(s)
    if (ns.has(i)) ns.delete(i); else ns.add(i)
    return ns
  })
  // Long-press on the row also reveals the target (spec: "info button or long-press"). The
  // timer is cancelled on any pointer move or release so a quick tap never opens a target,
  // and a swipe through the row never opens one either.
  const lpTimer = useRef(null)
  // Empty notes stay out of the way, while an existing note remains immediately readable. This
  // is local disclosure state and does not affect the note stored in the active workout.
  const [workoutNoteOpen, setWorkoutNoteOpen] = useState(() => typeof entry.note === 'string' && entry.note.trim().length > 0)
  const perSide = isPerSide(cfg) && !cardio && !timed
  const gridClass = (col3 ? ' eff3' : '') + (perSide ? ' per-side' : '') + (!col2 ? ' no-col2' : '') + (timed ? ' timed' : '')
  // The info track only exists when at least one set has a compatible target —
  // otherwise rows collapse it and the check moves up (no empty 44px track).
  const anyTarget = !!col3 && entry.sets.some(s => setTarget(s))
  const headClass = 'sethead' + gridClass + (anyTarget ? ' has-info' : '')
  const startLongPress = i => {
    cancelLongPress()
    lpTimer.current = setTimeout(() => { lpTimer.current = null; toggleDisclosed(i) }, LONG_PRESS_MS)
  }
  const cancelLongPress = () => {
    if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null }
  }
  return <>
    <Media ex={ex} key={entry.id} compact={compact} minimizable />
    <div className="row between" style={{ marginBottom: 6 }}>
      {heading === 'h3' ? <h3 style={{ fontSize: compact ? 17 : 20, margin: 0, letterSpacing: '-.02em', textTransform: 'capitalize', lineHeight: 1.2 }}>{exerciseName(ex)}</h3> : <h2 style={{ fontSize: compact ? 17 : 20, margin: 0, letterSpacing: '-.02em', textTransform: 'capitalize', lineHeight: 1.2 }}>{exerciseName(ex)}</h2>}
      <div className="row" style={{ gap: 4 }}>
        <button className="iconbtn" aria-label={t('Edit')} onClick={onEdit}><Icon name="pencil" /></button>
        <button className="iconbtn" aria-label={t('Details')} onClick={() => exerciseDetailSheet(ex)}><Icon name="info" /></button>
      </div>
    </div>
    {entry.target?.planNote && <div className="exnote" role="note"><div className="small dim">{t('Exercise note')}</div>{entry.target.planNote}</div>}
    <div style={{ marginBottom: 10 }}>
      <div className="row between" style={{ margin: '0 2px 6px' }}>
        <label className="small dim" htmlFor={workoutNoteId} style={{ margin: 0 }}>{t('Workout note')}</label>
        <button type="button" className="iconbtn" aria-label={t(workoutNoteOpen ? 'Hide {0}' : 'Show {0}', t('Workout note'))}
          title={t(workoutNoteOpen ? 'Hide {0}' : 'Show {0}', t('Workout note'))}
          aria-expanded={workoutNoteOpen} aria-controls={workoutNoteContentId}
          onClick={() => setWorkoutNoteOpen(open => !open)}>
          <Icon name={workoutNoteOpen ? 'chevronUp' : 'chevronDown'} />
        </button>
      </div>
      <div id={workoutNoteContentId} hidden={!workoutNoteOpen}>
        <TextArea id={workoutNoteId} rows={3} maxLength={NOTE_MAX} value={typeof entry.note === 'string' ? entry.note : ''}
          placeholder={t('Add a comment about this exercise')} aria-label={t('Workout note')}
          onChange={e => onNoteChange(e.target.value)} />
      </div>
    </div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      {/* You log the total; this is the split, so the set in front of you is unambiguous
          without the rep count having to mean two different things (issue #31). */}
      {!cardio && !timed && perSide && <span className="tag acc nocap"><Icon name="shuffle" />{t('{0} per side', fmtNum(sideReps(entry.sets.find(s => !projectSideSet(s).done)?.r ?? entry.sets[0]?.r)))}</span>}
      {(ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}
      {ex.eq && <span className="tag">{t(ex.eq)}</span>}
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtNum(best)} {S.unit}</span>}
    </div>
    {last && <div className="small dim" style={{ marginBottom: 4 }}>{t('Last time')} ({fmtDate(last.d)}): {last.sets.map(s => setLabel(entry.id, s, last.target)).join(', ')}</div>}
    {plan && plan.why && plan.kind !== 'off' && <div className={'progline' + (plan.kind === 'deload' ? ' warn' : '')}>
      <Icon name={plan.kind === 'up' ? 'arrowUp' : plan.kind === 'deload' ? 'arrowDown' : 'lightbulb'} />
      <span>{t(...plan.why)}</span>
    </div>}
    <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      {/* the header carries the same eff3 sizing as the rows, or the labels drift off their columns */}
      <div className="setgrid-scroll">
      <div className={headClass}>
        <span className="n-sp" />{perSide ? <>
          {/* per-side rows always stack L/R, so one shared W/R pair + check */}
          <span className="w-sp">{col1.hd}</span>{col2 && <span className="r-sp">{col2.hd}</span>}{col3 && <span className="eff-sp">{col3.hd}</span>}{anyTarget && <span className="info-sp" />}<span className="ck-sp" />
        </> : <><span className="w-sp">{col1.hd}</span>{col2 && <span className="r-sp">{col2.hd}</span>}{col3 && <span className="eff-sp">{col3.hd}</span>}{anyTarget && <span className="info-sp" />}{timed && <span className="ck-sp" />}<span className="ck-sp" /></>}
      </div>
      {(() => {
        // Done-run fusion: 2+ consecutive done rows render inside one .setgroup-done
        // card (single wash/border/radius); an isolated done row renders bare as before.
        // setDoneAt reuses entry.sets.map so the composition contract below still holds.
        const setDoneAt = entry.sets.map(s => projectSideSet(s).done)
        const firstPending = entry.sets.findIndex((s, i) => !setDoneAt[i])
        const renderSetRow = (s, i) => {
          const target = setTarget(s)
          const isOpen = disclosed.has(i)
          // P0: the first unfinished set is "current" (accent box + dot + aria-current);
          // finished sets are "done" (soft wash, full contrast); the rest are pending.
          const sDone = setDoneAt[i]
          const isCurrent = !sDone && firstPending === i
          return <Fragment key={i}>
           <div className={'setrow' + (sDone ? ' done' : '') + (isCurrent ? ' current' : '') + gridClass + (target ? ' has-info' : '')}
            aria-current={isCurrent ? 'true' : undefined}
            onPointerDown={e => {
              // The target info gesture is "info button OR long-press". A long-press on a
              // stepper would fight with the stepper's own tap, so the row's long-press
              // only fires when the touch starts on a non-interactive area.
              if (e.target.closest('button, input, textarea')) return
              startLongPress(i)
            }}
            onPointerUp={cancelLongPress}
            onPointerCancel={cancelLongPress}
            onPointerLeave={cancelLongPress}>
            <div className="n">{i + 1}</div>
            {perSide ? <>
              <span className="side-label side-left-label">L</span>{sideCell(s, i, 'left', col1, 'w')}{col2 && sideCell(s, i, 'left', col2, 'r')}{col3 && sideCell(s, i, 'left', col3, 'eff')}
              <span className="side-label side-right-label">R</span>{sideCell(s, i, 'right', col1, 'w')}{col2 && sideCell(s, i, 'right', col2, 'r')}{col3 && sideCell(s, i, 'right', col3, 'eff')}
            </> : <>{cell(s, i, col1, 'w')}{col2 && cell(s, i, col2, 'r')}{col3 && cell(s, i, col3, 'eff')}</>}
            {/* A timed set is started, not typed: the timer counts the hold down and checks the
                set off itself. The checkbox stays for anyone who timed it on their own watch. */}
            {timed && <button className="setgo" aria-label={t('Start set')} disabled={projectSideSet(s).done || !!working}
              onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
            {/* Per-set info button: only when this set actually has a compatible target.
                The disclosure toggles on tap; on a row with no target the button is not
                rendered at all, so the column never says "no information" for nothing. */}
            {target && <button className={'iconbtn setinfo' + (isOpen ? ' on' : '')}
              aria-label={isOpen ? t('Hide programmed target') : t('Show programmed target')}
              aria-expanded={isOpen}
              onClick={e => { e.stopPropagation(); toggleDisclosed(i) }}>
              <Icon name={isOpen ? 'chevronUp' : 'info'} />
            </button>}
            {perSide ? <div className="side-checks">
              <Check aria-label={'L ' + t('Sets') + ' ' + (i + 1)} checked={!!s.left?.done} onChange={() => onToggle(i, 'left')} />
              <Check aria-label={'R ' + t('Sets') + ' ' + (i + 1)} checked={!!s.right?.done} onChange={() => onToggle(i, 'right')} />
            </div> : <Check aria-label={t('Sets') + ' ' + (i + 1)} checked={s.done} onChange={() => onToggle(i)} />}
          </div>
          {isOpen && target && <div className="setrow-info" role="region" aria-label={t('Programmed target')}>
            <span className="lbl">{t('Target')}</span>
            <span className="target"><span className="num">{fmtNum(target.value)}</span><span className="metric">{t(EFFORT[target.metric].hd)}</span></span>
            <span className="dim small note">{t('read-only')}</span>
          </div>}
        </Fragment>
        }
        const out = []
        let k = 0
        while (k < entry.sets.length) {
          if (setDoneAt[k] && setDoneAt[k + 1]) {
            let j = k + 2
            while (j < entry.sets.length && setDoneAt[j]) j++
            // Key spans the run end so growing the run remounts the group and the
            // setfuse animation replays exactly at the fusion moment — no FLIP, no
            // height animation, opacity only, so there is no layout jump.
            out.push(<div key={'g' + k + '-' + j} className="setgroup-done">{entry.sets.slice(k, j).map((s, t) => renderSetRow(s, k + t))}</div>)
            k = j
          } else {
            out.push(renderSetRow(entry.sets[k], k))
            k++
          }
        }
        return out
      })()}
      </div>
      <div style={{ height: 8 }} />
      <div className="row">
        <Button size="sm" icon="minus" disabled={entry.sets.length <= 1} onClick={onRemoveSet}>{t('Remove set')}</Button>
        <Button size="sm" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
      </div>
    </div>
  </>
}

/* ---------- active workout ---------- */
function ActiveWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { startRest, stopRest } = useUI()
  const persistence = useStore(s => s.persistence)
  const retryPersistence = useStore(s => s.retryPersistence)
  const undoPersistence = useStore(s => s.undoPersistence)
  const cancelPersistence = useStore(s => s.cancelPersistence)
  const A = S.active
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur, Math.max(0, A.entries.length - 1))
  const unit = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unit)
  const isSuperset = unit.length > 1
  const cardRefs = useRef(new Map())
  const resumed = useRef(false)
  const [pendingFocus, setPendingFocus] = useState(null)
  const [moveStatus, setMoveStatus] = useState('')
  const focusEntry = (sid, scroll = true) => setPendingFocus({ sid, scroll })
  useLayoutEffect(() => {
    if (!pendingFocus) return
    let frame = 0
    let timer = 0
    let attempts = 0
    let fallbackUsed = false
    const restore = () => {
      const target = cardRefs.current.get(pendingFocus.sid)
      // Keep the request pending while a render has not attached the ref yet. A bounded retry
      // window also covers embedded runtimes that deliver the ref/layout one frame late.
      if (!target) {
        const retry = focusRefRetryDecision(attempts, fallbackUsed, false)
        if (retry.action === 'frame') {
          attempts = retry.attempts
          frame = requestAnimationFrame(restore)
        } else if (retry.action === 'fallback' && !timer) {
          timer = window.setTimeout(() => { timer = 0; fallbackUsed = true; restore() }, 50)
        } else if (retry.action === 'stop') {
          setPendingFocus(null)
        }
        return
      }
      restoreFocusedEntry(target, pendingFocus.scroll)
      if (pendingFocus.scroll && attempts++ < 3) {
        frame = requestAnimationFrame(restore)
        return
      }
      setPendingFocus(null)
    }
    restore()
    return () => { if (frame) cancelAnimationFrame(frame); if (timer) window.clearTimeout(timer) }
  }, [pendingFocus, A.entries])
  useEffect(() => {
    if (resumed.current || !A.entries[cur]) return
    resumed.current = true
    focusEntry(A.entries[cur].sid)
  }, [A.entries, cur])
  useEffect(() => { useUI.getState().resumeRest() }, [])

  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = setsDoneActive(A)

  const mutEntry = (idx, fn) => update(s => {
    if (!s.active?.entries?.[idx]) return
    fn(s.active.entries[idx])
    touchActiveRecord(s.active)
  }, true)
  const setNote = (idx, raw) => update(s => {
    const entry = s.active?.entries?.[idx]
    if (entry) {
      s.active.entries[idx] = updateExerciseNote(entry, raw)
      touchActiveRecord(s.active)
    }
  }, true)
  // Clearing an optional field drops the key rather than storing null, so a set only carries
  // what was actually logged — in the session, in history and in a backup.
  const setField = (idx, i, field, v, side) => mutEntry(idx, e => {
    if (side) {
      if (v == null) delete e.sets[i][side][field]; else e.sets[i][side][field] = v
      syncSideSet(e.sets[i])
      return
    }
    if (v == null) delete e.sets[i][field]; else e.sets[i][field] = v
  })
  const modeAt = idx => modeOf({ ...(A.entries[idx].target || {}), id: A.entries[idx].id })
  const moveUnit = (index, delta) => {
    const before = A.entries
    const result = moveSessionUnit(before, index, delta)
    if (!result.changed) return
    update(s => {
      const moved = moveSessionUnit(s.active.entries, index, delta)
      s.active.entries = moved.entries
      s.active.cur = remapCur(before, s.active.cur, moved.entries)
      touchActiveRecord(s.active)
    })
    const position = result.position + 1
    const moved = A.entries.find(e => e.sid === result.movedSid)
    if (moved) {
      focusEntry(moved.sid)
      setMoveStatus(t('Exercise {0} / {1}', exerciseName(exOr(moved.id)), units.length) + ' — ' + position)
    }
  }
  const editExercise = idx => {
    const st = useStore.getState().S
    const entry = st.active?.entries?.[idx]
    if (!entry) return
    const ex = exOr(entry.id)
    const routine = st.routines.find(r => r.id === st.active.routineId)
    exConfigSheet(ex, entry.target, cfg => {
      const current = useStore.getState().S
      const live = current.active?.entries?.[idx]
      if (!live || live.id !== entry.id) return
      const result = rebuildActiveEntry(current, live, cfg, current.routines.find(r => r.id === current.active.routineId))
      if (!result.ok) {
        useUI.getState().toast(t(result.reason))
        return
      }
      update(s => {
        if (s.active?.entries?.[idx]?.id === live.id) {
          s.active.entries[idx] = result.entry
          touchActiveRecord(s.active)
        }
      }, true)
    }, null, routine)
  }
  const addSet = idx => mutEntry(idx, e => {
    const l = e.sets[e.sets.length - 1]
    const m = modeOf({ ...(e.target || {}), id: e.id })
    if (m === 'cardio') e.sets.push({ min: l ? l.min : (e.target.min || 20), speed: l ? l.speed : (e.target.speed || 8), done: false })
    else if (m === 'time') e.sets.push({ sec: l ? l.sec : e.target.sec, w: l ? (l.w || 0) : (e.target.weight || 0), done: false })
    else if (isPerSide(e.target)) e.sets.push({ left: { w: l?.left?.w ?? 0, r: l?.left?.r ?? sideReps(e.target.reps), done: false }, right: { w: l?.right?.w ?? 0, r: l?.right?.r ?? sideReps(e.target.reps), done: false }, w: e.target.weight || 0, r: e.target.reps, done: false })
    else e.sets.push({ w: l ? l.w : 0, r: l ? l.r : e.target.reps, done: false })
  })
  const removeSet = idx => {
    const sets = A.entries[idx]?.sets || []
    if (sets.length <= 1) return
    const removed = sets[sets.length - 1]
    mutEntry(idx, e => { if (e.sets.length > 1) e.sets.pop() })
    // P0 Undo: the popped set snapshot is restored verbatim, same position
    useUI.getState().toast(t('Set removed'), { kind: 'neutral',
      action: { label: t('Undo'), onClick: () => mutEntry(idx, e => { e.sets.push(removed) }) } })
  }

  // A timed set is held, not typed. The work timer records what was actually held — an early
  // finish logs 0:38 of a 0:45 target rather than crediting the full prescription — and then
  // checks the set off through the normal path, so rest, supersets and the finish prompt all
  // behave exactly as they do for a reps set.
  const startTimed = (idx, i) => {
    const e = A.entries[idx]
    const seconds = parseTimedSeconds(e.sets[i].sec)
    if (seconds === null) {
      useUI.getState().toast(t('Enter a valid whole number of seconds'))
      return
    }
    useUI.getState().startWork(seconds, exerciseName(exOr(e.id)), elapsed => {
      mutEntry(idx, en => { en.sets[i].sec = elapsed })
      if (!useStore.getState().S.active.entries[idx].sets[i].done) toggle(idx, i)
    })
  }

  const toggle = (idx, i, side) => {
    const m = modeAt(idx)
    const cardioEntry = m === 'cardio'
    const isLastUnit = unitIdx >= units.length - 1
    let askTop = false, exJustDone = false, workoutDone = false
    mutEntry(idx, e => {
      if (side && e.sets[i].left && e.sets[i].right) {
        e.sets[i][side].done = !e.sets[i][side].done
        syncSideSet(e.sets[i])
      } else e.sets[i].done = !e.sets[i].done
      if (projectSideSet(e.sets[i]).done) {
        beep(S.sound, 1040, 0.12); vibrate(30)
        const isLastExInUnit = idx === unit[unit.length - 1]
          const unitDone = unit.every(ui => (ui === idx ? e : A.entries[ui]).sets.every(x => projectSideSet(x).done))
        if (isLastExInUnit && !unitDone) startRest(S.restSec, A.entries[idx].sid)
        else if (unitDone) stopRest()
        if (unitDone && isLastUnit) workoutDone = true      // last exercise's last set → done
        // Only loaded reps training has a "working weight" worth confirming — a bodyweight
        // plank has nothing to put in that slider, and neither does a set of push-ups
        // (issue #32: the fewest taps that still record what happened).
        const loaded = m === 'reps' && !(isBw({ ...(e.target || {}), id: e.id }) && !e.sets.some(x => {
          const p = projectSideSet(x)
          return p.w > 0 || x.left?.w > 0 || x.right?.w > 0
        }))
        if (e.sets.every(x => projectSideSet(x).done)) { exJustDone = true; if (loaded && !e.asked) { e.asked = true; askTop = true } }
      }
    })
    // reps: topWeight first (it chains into the finish/continue prompt on the last unit).
    // cardio/timed or already-confirmed: go straight to the prompt.
    if (askTop) topWeightSheet(idx)
    else if (workoutDone) workoutCompleteSheet()
    else if (exJustDone && cardioEntry) useUI.getState().toast(t('Cardio logged'))
    else if (exJustDone && m === 'time') useUI.getState().toast(t('Hold logged'))
  }

  // Live-presence heartbeat so the admin dashboard can show who's training now. Signed-in only —
  // guests have no server session. Reads fresh state each tick so progress stays current.
  useEffect(() => {
    if (!useStore.getState().user) return
    let stopped = false
    const ping = active => {
      const A2 = useStore.getState().S.active
      if (!A2) return
      const u = supersetUnits(A2.entries)
      const c = Math.min(A2.cur, Math.max(0, A2.entries.length - 1))
      const ui = u.findIndex(x => x.includes(c))
      const tot = A2.entries.reduce((n, e) => n + e.sets.length, 0)
      api('/api/activity', { method: 'POST', body: JSON.stringify({
        active, name: A2.name, exIdx: ui + 1, exTotal: u.length,
        setsDone: setsDoneActive(A2), setsTotal: tot, startedAt: A2.start
      }) }).catch(() => {})
    }
    ping(true)
    const iv = setInterval(() => { if (!stopped) ping(true) }, 20000)
    return () => {
      stopped = true; clearInterval(iv)
      // best-effort "left" signal: sendBeacon survives a tab close, fetch covers in-app nav
      try { navigator.sendBeacon?.('/api/activity', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })) } catch { /* */ }
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => {})
    }
  }, [])

  const renderCard = (entryIdx, unitIndex, members) => {
    const entry = A.entries[entryIdx]
    const superset = members.length > 1
    return <article key={entry.sid} className={superset ? 'ss-card session-card' : 'card session-card'} tabIndex={0}
      ref={node => { if (node) cardRefs.current.set(entry.sid, node); else cardRefs.current.delete(entry.sid) }}
      aria-labelledby={'session-heading-' + entry.sid}>
      <div className="row between session-card-head">
        <h2 id={'session-heading-' + entry.sid}>{superset ? t('Superset {0} / {1}', unitIndex + 1, units.length) : t('Exercise {0} / {1}', unitIndex + 1, units.length)}</h2>
        <div className="row" role="group" aria-label={t('Exercises')}>
          <button type="button" className="iconbtn" aria-label={t('Move up')} disabled={unitIndex <= 0} onClick={() => moveUnit(unitIndex, -1)}><Icon name="chevronUp" /></button>
          <button type="button" className="iconbtn" aria-label={t('Move down')} disabled={unitIndex >= units.length - 1} onClick={() => moveUnit(unitIndex, 1)}><Icon name="chevronDown" /></button>
        </div>
      </div>
      {superset && <div className="ss-hd"><Icon name="link" />{t('Superset · do these back-to-back, rest after both')}</div>}
      {members.map((idx, k) => <div key={A.entries[idx].sid} className={superset ? 'ss-ex' : undefined}>
        {superset && k > 0 && <div className="ss-amp">+</div>}
        <ExerciseBlock entryIdx={idx} sid={A.entries[idx].sid} heading={superset ? 'h3' : 'h2'} compact={superset}
          onEdit={() => editExercise(idx)} onToggle={(i, side) => toggle(idx, i, side)} onField={(i, f, v, side) => setField(idx, i, f, v, side)} onNoteChange={value => setNote(idx, value)} onAddSet={() => { addSet(idx); focusEntry(A.entries[idx].sid) }} onRemoveSet={() => removeSet(idx)} onStartTimed={i => startTimed(idx, i)} />
      </div>)}
    </article>
  }

  // Existing add-exercise flow, shared by the freestyle empty-state CTA below
  // and the regular "Add exercise" button — no new routes, same picker.
  const pickExercise = () => exercisePicker((ex, closePicker) => exConfigSheet(ex, null, cfg => {
    let addedSid
    commitPickerSelection(() => update(s => {
      const routine = s.routines.find(r => r.id === s.active.routineId)
      const added = buildWorkoutEntry(s, cfg, routine, { id: ex.id })
      addedSid = added.sid
      s.active.entries.push(added)
      s.active.cur = s.active.entries.length - 1
      touchActiveRecord(s.active)
    }), closePicker)
    if (addedSid) focusEntry(addedSid)
  }, null, S.routines.find(r => r.id === A.routineId)))

  return <main className="narrow workout-session" aria-labelledby="workout-session-title">
    <div className="hdr">
      <button className="iconbtn" aria-label={t('Discard')} onClick={() => confirmSheet({ title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: () => { update(s => { s.active = null }); stopRest(); nav('/home') } })}><Icon name="xmark" /></button>
      <div style={{ textAlign: 'center' }}><h1 id="workout-session-title" style={{ fontSize: 17, fontWeight: 600 }}>{A.name}</h1><div className="sub"><Elapsed start={A.start} /> · {t('{0} sets', done + '/' + total)}</div></div>
      <button className="iconbtn acc-ink" aria-label={t('Finish')} onClick={finishWorkout}><Icon name="check" /></button>
    </div>
    <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>
    {persistence?.status === 'failed' && <div className="card persistence-recovery" role="alert" aria-live="assertive">
      <strong>{t('Could not save your workout')}</strong>
      <div>{t('Your changes are still visible. Choose an action to recover.')}</div>
      <div className="row" role="group" aria-label={t('Recovery')}>
        <Button size="sm" onClick={retryPersistence}>{t('Retry')}</Button>
        <Button size="sm" onClick={undoPersistence}>{t('Undo')}</Button>
        <Button size="sm" onClick={cancelPersistence}>{t('Cancel')}</Button>
      </div>
    </div>}

    {A.entries.length ? <>
      <div className="session-cards" aria-label={t('Exercises')}>
        {units.map((members, index) => renderCard(members[0], index, members))}
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{moveStatus}</div>
    </> : <div className="empty empty-center"><div className="ico"><Icon name="shuffle" /></div><div>{t('Freestyle workout — add your first exercise.')}</div><Button variant="primary" icon="play" onClick={pickExercise}>{t('Start your first workout')}</Button></div>}

    <div style={{ height: 12 }} />
    <div style={{ height: 10 }} />
      <Button onClick={pickExercise} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    {(() => {
       const exDone = A.entries.filter(e => e.sets.length && e.sets.every(s => projectSideSet(s).done)).length
      const allDone = A.entries.length > 0 && exDone === A.entries.length
      return <button className={allDone ? 'btn primary' : 'btn tinted'} onClick={finishWorkout}>
        {allDone ? t('Finish workout') : t('Finish workout early · {0} exercises', exDone + '/' + A.entries.length)}
      </button>
    })()}
    <div style={{ height: 40 }} />
  </main>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
