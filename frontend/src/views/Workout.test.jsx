import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FOCUS_REF_RETRY_LIMIT, focusRefRetryDecision, restoreFocusedEntry } from '../lib/session.js'

const source = readFileSync(resolve(process.cwd(), 'src/views/Workout.jsx'), 'utf8')
const session = readFileSync(resolve(process.cwd(), 'src/lib/session.js'), 'utf8')
const media = readFileSync(resolve(process.cwd(), 'src/components/Media.jsx'), 'utf8')

describe('scrollable workout composition contracts', () => {
  it('renders every ordered unit and treats cur as a focus hint', () => {
    expect(source).toContain('units.map((members, index) => renderCard')
    expect(source).toContain('const cur = Math.min(A.cur')
    expect(source).toContain('session-cards')
    expect(source).toContain('active.entries')
  })

  it('uses semantic cards, expanded set grids, and stable sid identity', () => {
    expect(source).toContain('<article')
    expect(source).toContain('tabIndex={0}')
    expect(source).toContain('<h2')
    expect(source).toContain('entry.sets.map')
    expect(source).toContain("'workout-note-' + sid")
    expect(source).toContain('A.entries[idx].sid')
  })

  it('keeps media and notes independently disclosed with persisted density', () => {
    expect(source).toContain('minimizable')
    expect(source).toContain('workoutNoteOpen')
    expect(source).toContain("typeof entry.note === 'string' && entry.note.trim().length > 0")
    expect(source).toContain('aria-controls={workoutNoteContentId}')
    expect(media).toContain('gifSize')
  })

  it('keeps empty note disclosure collapsed while preserving editable content and semantics', () => {
    expect(source).toContain('hidden={!workoutNoteOpen}')
    expect(source).toContain("value={typeof entry.note === 'string' ? entry.note : ''}")
    expect(source).toContain("t(workoutNoteOpen ? 'Hide {0}' : 'Show {0}'")
    expect(source).toContain('aria-expanded={workoutNoteOpen}')
    expect(source).toContain('entry.note.trim().length > 0')
  })

  it('renders all exercises without bottom navigation', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(source).not.toContain('workout-session-nav')
    expect(source).not.toContain('<select')
    expect(source).not.toContain('session-selector')
    expect(source).not.toContain('const unitIndex = Number(e.target.value)')
    expect(source).not.toContain('session-index')
    expect(css).not.toContain('.workout-session .session-index')
    expect(css).not.toContain('.session-selector')
    expect(css).toContain('.workout-session .session-card{padding:12px')
    expect(css).toContain('.workout-session .session-card .card{padding:12px}')
    expect(css).toContain('.workout-session .session-card:focus,.workout-session .session-card:focus-visible{outline:2px solid var(--acc);outline-offset:-2px;box-shadow:none}')
    expect(css).not.toContain('.workout-session .session-card:focus-visible{box-shadow:0 0 0 2px var(--acc);outline-offset:4px}')
    expect(css).toContain('.workout-session-nav > button{flex:1 1 0;width:auto}')
  })

  it('removes the obsolete Previous/Next jump path', () => {
    expect(source).not.toContain('workout-session-nav')
    expect(source).not.toContain('jumpTo(')
    expect(source).not.toContain('jumpTo(Number(e.target.value))')
  })

  it('keeps every set grid inside narrow scrollports with zero x-scroll', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(source).toContain('const gridClass =')
    expect(source).toContain("' no-col2'")
    expect(source).toContain("' timed'")
    expect(source).toContain("const loadCol = { f: 'w', step: 2.5, dec: true")
    expect(source).toContain('decimal={col.dec}')
    // the wrapper is a plain full-width box: visible overflow, never a scrollport
    // (other components like .hm-wrap keep their own legitimate scroll strips)
    expect(css).toContain('.setgrid-scroll{width:100%;max-width:100%;overflow:visible}')
    const scrollRule = css.match(/\.setgrid-scroll\{[^}]*\}/)?.[0] || ''
    expect(scrollRule).not.toContain('overflow-x')
    expect(scrollRule).not.toContain('scrollbar')
    // one fluid system: every stepper track is minmax(0,1fr), 32px check track
    expect(css).toContain('minmax(0,1.35fr) minmax(0,1fr) minmax(36px,40px)')
    expect(css).toContain('minmax(0,.9fr) minmax(0,1.3fr) minmax(36px,40px) minmax(36px,40px)')
    expect(css).toContain('--set-go-col:3;--set-check-col:4')
    expect(css).toContain('.setrow:not(.per-side) > .setgo{grid-column:var(--set-go-col,4);justify-self:center}')
    expect(css).toContain('.setrow:not(.per-side) > .chk{grid-column:var(--set-check-col);justify-self:center}')
    expect(css).toContain('.sethead .eff-toggle')
    expect(css).toContain('--set-grid-template:minmax(24px,24px) minmax(0,1.35fr) minmax(0,1fr) minmax(36px,40px)')
    expect(css).toContain('.sethead .ck-sp{width:100%;min-width:0}')
    expect(css).toContain('.sethead .eff-sp,.sethead .eff-info-sp{min-width:0;min-height:44px;display:flex;align-items:center;justify-content:center}')
    expect(css).toContain('.sethead .eff-sp{overflow:hidden;text-align:center}')
    expect(css).toContain('.sethead .eff-info-sp{overflow:visible}')
    expect(css).toContain('.sethead .eff-title{display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}')
    expect(css).toContain('.sethead .eff-toggle{position:relative;display:flex')
    expect(css).toContain('width:44px;height:44px;min-width:44px;flex:none')
    expect(css).toContain('.sethead .eff-toggle-surface{--eff-toggle-paint-width:clamp(20px,2vw + 12px,28px);display:flex;align-items:center;justify-content:center;width:var(--eff-toggle-paint-width);height:28px')
    expect(css).toContain('.sethead.eff3 > .eff-sp{grid-column:4}')
    expect(css).toContain('.sethead.eff3 > .eff-info-sp{grid-column:5;justify-self:stretch}')
    expect(css).toContain('.sethead.eff3.no-col2 > .eff-sp{grid-column:3}')
    expect(css).toContain('.sethead.eff3.no-col2 > .eff-info-sp{grid-column:4;justify-self:stretch}')
    expect(css).toContain('.sethead.per-side.eff3 > .eff-sp{grid-column:5}')
    expect(css).toContain('.sethead.per-side.eff3 > .eff-info-sp{grid-column:6;justify-self:stretch}')
    expect(css).toContain('.sethead.per-side.eff3.no-col2 > .eff-sp{grid-column:4}')
    expect(css).toContain('.sethead.per-side.eff3.no-col2 > .eff-info-sp{grid-column:5;justify-self:stretch}')
    expect(css).not.toContain('.sethead .eff-toggle::after')
    expect(css).toContain('.setrow .eff .num:placeholder-shown')
    expect(css).toContain('.setrow .eff .num:not(:placeholder-shown)')
    expect(css).toContain('.setrow-info')
    expect(css).toContain('.setrow-info[hidden]{display:none}')
    expect(css).toContain('.setrow.per-side + .setrow-info')
    expect(css).toContain('.setgroup-done > .setrow-info')
    expect(css).toContain('.setrow .eff .num:placeholder-shown,.setrow .eff .num:not(:placeholder-shown){background:transparent;border-radius:0}')
    expect(css).toContain('.setrow .eff .num::placeholder,.setrow .eff .num.planned-effort-placeholder::placeholder{color:var(--label-4);opacity:1}')
    expect(css).not.toContain('background:var(--surface-3);border-radius:4px;color:var(--label-3)')
    expect(css).not.toContain('setinfo')
    expect(css).not.toContain('minmax(104px')
    expect(css).not.toContain('minmax(76px')
    expect(css).not.toContain('min-width:340px')
    expect(css).not.toContain('min-width:386px')
    expect(css).not.toContain('min-width:560px')
    expect(css).toContain('@media (max-width:430px)')
    expect(css).not.toContain('@media (max-width:420px)')
    // RIR rows: compact keys + tabular values, with separate effort and info header rails
    // and the read-only target region beneath matching sets.
    expect(css).toContain('repeat(3,minmax(0,1fr))')
    expect(css).toContain('repeat(3,minmax(0,1fr)) minmax(36px,40px)')
    expect(css).toContain('.setrow.eff3 .stp button,.setrow.timed .stp button{width:28px}')
    expect(css).toContain('.setrow-info')
    expect(css).toContain('.setrow .eff .num:placeholder-shown')
    expect(css).not.toContain('inset:-2px -14px')
    // single-row contract: effort never leaves the crowded first row — no
    // ≤430px/≤340px effort sub-row, bilateral or per-side, headers included.
    // Compact sizing (24px keys, 22px on eff3/timed/per-side, 44px slop,
    // 4px gaps, fluid 12-14px tabular numbers) owns the fit instead.
    expect(css).not.toContain('@media (max-width:340px)')
    expect(css).not.toContain('.stp.eff{grid-column:2 / 4;grid-row:2}')
    expect(css).not.toContain('.side-left-eff{grid-column:2 / 5;grid-row:2}')
    expect(css).not.toContain('.side-left-eff{grid-column:2 / 4;grid-row:2}')
    expect(css).not.toContain('.eff-sp{grid-column:2 / 4;grid-row:2}')
    expect(css).not.toContain('.eff-sp{grid-column:2 / 5;grid-row:2}')
    expect(css).toContain('.setrow:not(.per-side) .stp button{width:24px}')
    expect(css).toContain('.setrow.eff3 .stp button,.setrow.timed .stp button,.setrow.per-side .stp button{width:22px}')
    expect(css).toContain('.setrow .stp{gap:2px}')
    expect(css).toContain('font-size:clamp(12px,2.8vw + 3px,14px)')
    expect(css).toContain('font-size:clamp(12px,6.25vw - 8px,13px)')
    // fixed minima are only n + action tracks: every layout fits a 240px scrollport (320px phone)
    const gridWidth = (tracks, gap) => tracks.reduce((sum, track) => sum + track, 0) + (tracks.length - 1) * gap
    expect(gridWidth([24, 0, 0, 32], 8)).toBeLessThanOrEqual(240)
    expect(gridWidth([24, 0, 0, 32, 32], 8)).toBeLessThanOrEqual(240)
    expect(gridWidth([24, 0, 0, 0, 32], 6)).toBeLessThanOrEqual(240)
    expect(gridWidth([24, 20, 0, 0, 32], 6)).toBeLessThanOrEqual(240)
    expect(source).toContain('const [targetOpen, setTargetOpen] = useState(false)')
    expect(source).toContain('const effortHeader = col3 && <span className="eff-sp">')
    expect(source).toContain('const effortToggle = col3 && <span className="eff-info-sp">')
    expect(source).toContain('{col3 ? effortToggle : <span className="ck-sp" />}')
    expect(source).toContain('{col3 ? effortToggle : <>{timed && <span className="ck-sp" />}<span className="ck-sp" /></>}')
    expect(source).toContain('targetAvailable = !!col3 && entry.sets.some')
    expect(source).toContain('aria-expanded={targetAvailable ? targetOpen : false}')
    expect(source).toContain('disabled={!targetAvailable}')
    expect(source).toContain('const effortInputProps = s =>')
    expect(source).toContain('const target = setTarget(s)')
    expect(source).toContain("placeholder: target ? fmtNum(target.value) : col3 ? '–' : undefined")
    expect(source).toContain("className: target ? 'planned-effort-placeholder' : ''")
    expect(source).toContain('effortInputProps(s)')
    expect(source).toContain('const targetRegionIds = entry.sets.reduce')
    expect(source).toContain('aria-controls={targetAvailable ? targetRegionIds : undefined}')
    expect(source).toContain('className="setrow-info"')
    expect(source).toContain('hidden={!targetOpen}')
    expect(source).toContain('role="region"')
    expect(source).toContain('className="eff-toggle-surface" aria-hidden="true"')
    expect(source).not.toContain('hasInfoTrack')
    expect(source).not.toContain('setinfo')
    expect(source).not.toContain('onPointerDown')
  })

  it('renders visible persistence recovery actions without clearing the active draft', () => {
    expect(source).toContain("persistence?.status === 'failed'")
    expect(source).toContain('role="alert"')
    expect(source).toContain("t('Could not save your workout')")
    expect(source).toContain('onClick={retryPersistence}')
    expect(source).toContain('onClick={undoPersistence}')
    expect(source).toContain('onClick={cancelPersistence}')
  })

  it('restores only sid-keyed rest metadata and keeps work timer separate', () => {
    expect(source).toContain('useUI.getState().resumeRest()')
    expect(source).toContain('startRest(S.restSec, A.entries[idx].sid)')
    expect(readFileSync(resolve(process.cwd(), 'src/store/useUI.js'), 'utf8')).toContain('state.active.restResume')
    expect(readFileSync(resolve(process.cwd(), 'src/store/useUI.js'), 'utf8')).toContain('work: null')
  })

  it('provides index jumps, deterministic restoration, and accessible unit reorder', () => {
    expect(source).toContain('focusEntry')
    expect(source).toContain('useLayoutEffect')
    expect(source).toContain('requestAnimationFrame(restore)')
    expect(source).toContain('if (!target)')
    expect(session).toContain('scrollIntoView')
    // single-pass nearest: re-centering fights the browser scroll-into-view
    // while the software keyboard is open (fixed tab bar floats mid-screen)
    expect(session).toContain("block: 'nearest'")
    expect(session).not.toContain("block: 'center'")
    expect(session).toContain("inline: 'nearest'")
    expect(session).toContain("behavior: 'auto'")
    // single pass on success: late refs retry above, a landed restore never
    // re-frames (that loop fights the keyboard scroll and is the mid-screen
    // tab bar). Focus + aria-live stay intact.
    expect(source).not.toContain('attempts++ < 3')
    expect(source).toContain('window.setTimeout')
    expect(source).toContain('window.clearTimeout')
    expect(source).toContain('embedded runtimes')
    expect(source).toContain('moveSessionUnit')
    expect(source).toContain("t('Move up')")
    expect(source).toContain("t('Move down')")
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain('disabled={unitIndex <= 0}')
    expect(source).toContain('disabled={unitIndex >= units.length - 1}')
  })

  it('restores focus when moving through the session with Back or Next', () => {
    expect(source).toContain('focusEntry')
    expect(source).not.toContain('s.active.cur = units[unitIdx - 1][0]')
    expect(source).not.toContain('s.active.cur = units[unitIdx + 1][0]')
  })

  it('reasserts the SID card after one-shot Back or Next scrolling', () => {
    const calls = []
    const target = {
      focus: options => calls.push(['focus', options]),
      scrollIntoView: options => calls.push(['scroll', options])
    }
    expect(restoreFocusedEntry(target)).toBe(true)
    expect(calls.map(([kind]) => kind)).toEqual(['focus', 'scroll', 'focus'])
    expect(calls[2][1]).toEqual({ preventScroll: true })
    expect(source).toContain('restoreFocusedEntry(target, pendingFocus.scroll)')
  })

  it('stacks unilateral sides with fluid sub-rows at every width', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).not.toContain('min-width:560px')
    expect(css).toContain('.setrow.per-side > .side-checks{display:contents}')
    expect(css).toContain('.setrow.per-side .side-input{width:100%;min-width:0}')
    expect(css).toContain('.setrow .stp button{width:32px;height:40px}')
    expect(css).toContain('--set-grid-template:minmax(20px,22px) minmax(10px,14px) repeat(2,minmax(0,1fr)) minmax(36px,40px)')
    expect(css).toContain('.setrow.per-side > .side-left-label{grid-column:2;grid-row:1;align-self:center}')
    expect(css).toContain('.setrow.per-side > .side-right-label{grid-column:2;grid-row:2;align-self:center}')
    expect(css).toContain('.setrow.per-side > .side-left-r{grid-column:4;grid-row:1}')
    expect(css).toContain('.setrow.per-side > .side-right-w{grid-column:3;grid-row:2}')
    expect(css).toContain('.setrow.per-side > .side-right-r{grid-column:4;grid-row:2}')
    expect(css).toContain('.setrow.per-side > .side-checks > .chk:first-child{grid-column:5;grid-row:1;justify-self:center}')
    expect(css).toContain('.setrow-info .note')
     expect(css).toContain('.setrow.per-side.eff3 > .side-left-eff{grid-column:5;grid-row:1}')
     expect(css).toContain('.setrow.per-side.eff3 > .side-right-eff{grid-column:5;grid-row:2}')
     expect(css).toContain('.setrow.per-side.eff3 > .side-checks > .chk:first-child{grid-column:6;grid-row:1}')
    // no side-by-side desktop grid, no fixed stepper minima, no ghost tracks
    expect(css).not.toContain('minmax(120px')
    expect(css).not.toContain('minmax(84px')
    expect(css).not.toContain('.setrow.per-side .stp.w{min-width:120px}')
    expect(css).not.toContain('.setrow.per-side .stp.r{min-width:84px}')
    expect(css).not.toContain('grid-template-columns:44px 44px')
    expect(css).not.toContain('side-label:nth-of-type')
    expect(source).toContain('side-left-label')
    expect(source).toContain('side-right-label')
    expect(source).not.toContain('side-sp')
    expect(source).toContain("className={'side-input ' + effortProps.className}")
  })

  it('terminates missing-ref restoration after frames and one fallback', () => {
    let attempts = 0
    let fallbackUsed = false
    const actions = []
    for (;;) {
      const retry = focusRefRetryDecision(attempts, fallbackUsed, false)
      actions.push(retry.action)
      if (retry.action === 'frame') attempts = retry.attempts
      else if (retry.action === 'fallback') fallbackUsed = true
      else break
    }
    expect(FOCUS_REF_RETRY_LIMIT).toBe(3)
    expect(actions).toEqual(['frame', 'frame', 'frame', 'fallback', 'stop'])
    expect(source).not.toContain('attempts = 0; restore()')
    expect(source).toContain('setPendingFocus(null)')
  })

  it('keeps progress as the only workout sticky contract', () => {
    expect(source).toContain('className="wprog"')
    expect(source).not.toContain('position: sticky')
    expect(source).not.toContain('draggable=')
  })

  it('keeps mode-specific inputs, timers, notes, completion, and lifecycle actions wired', () => {
    for (const token of ["mode === 'cardio'", "mode === 'time'", 'isBw(cfg)', 'startRest', 'onStartTimed',
      'Workout note', 'projectSideSet(s).done', 'finishWorkout', "t('Discard')", 'confirmSheet']) {
      expect(source).toContain(token)
    }
  })

  it('marks only workout-record mutations and clears the active reminder lifecycle', () => {
    expect(source).toContain('touchActiveRecord')
    expect(source).toContain('s.active = null')
    expect(source).toContain('Discard workout?')
    expect(readFileSync(resolve(process.cwd(), 'src/components/InactivityReminder.jsx'), 'utf8')).toContain('visibilitychange')
  })

  it('keeps approved exclusions out of the active-session renderer', () => {
    expect(source).not.toContain("from '../lib/mobile.js'")
    expect(source).not.toContain('Capacitor')
    expect(source).not.toContain('draggable=')
    expect(source).not.toMatch(/s\.routines\s*=/)
    expect(source).not.toMatch(/s\.dayPlan\s*=/)
    expect(source).not.toContain('delete s.dayPlan')
  })

  it('fuses consecutive done sets into one card while loners stay bare', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    // JSX groups runs of 2+ done rows; isolated/current rows render unwrapped.
    expect(source).toContain('setgroup-done')
    expect(source).toContain("entry.sets.map(s => projectSideSet(s).done)")
    // The group owns the single wash + radius; inner rows drop theirs.
    expect(css).toContain('.setgroup-done{background:var(--acc-soft)')
    expect(css).toContain('.setgroup-done > .setrow.done{background:transparent')
    // Fusion feedback is opacity-only on the project ease; per-row states untouched.
    expect(css).toContain('@keyframes setfuse{from{opacity:.45}to{opacity:1}}')
    expect(css).toContain('.setrow.done{background:var(--acc-soft);border-radius:var(--r-sm)}')
    expect(css).toContain('.setrow.current{box-shadow:inset 0 0 0 1.5px var(--acc-line)')
  })

  it('keeps series steppers fluid single-row with real touch targets', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    // fluid painted keys (bilateral + compact), fluid inner/column gaps, fluid numbers
    expect(css).toContain('.setrow:not(.per-side) .stp button{width:clamp(16px,4vw + 4px,28px)}')
    expect(css).toContain('.setrow.eff3 .stp button,.setrow.timed .stp button,.setrow.per-side .stp button{width:clamp(14px,3.6vw + 4px,24px)}')
    expect(css).toContain('.setrow .stp{gap:clamp(2px,0.5vw + 1px,4px)}')
    expect(css).toContain('column-gap:clamp(2px,1vw + 1px,6px)')
    expect(css).toContain('font-size:clamp(11px,3vw + 3px,15px)')
    // fluid badge/check/padding, header mirroring the row insets
    expect(css).toContain('.setrow .n{')
    expect(css).toContain('width:clamp(20px,5vw + 6px,24px)')
    expect(css).toContain('width:clamp(28px,6vw + 9px,32px)')
    expect(css).toContain('.setgrid-scroll .sethead{padding:0 clamp(2px,1vw - 1px,4px) 6px}')
    // exact 44px targets via centred slop, independent of painted size
    expect(css).toContain('width:44px;height:44px;margin:-22px 0 0 -22px')
    // weight/reps/effort fields share equal tracks; no hard breakpoints added
    expect(css).toContain('repeat(3,minmax(0,1fr))')
    expect(css).not.toContain('@media (max-width:340px)')
    expect(css).not.toContain('inset:-2px -14px')
  })
})
