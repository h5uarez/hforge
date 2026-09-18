import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FOCUS_REF_RETRY_LIMIT, focusRefRetryDecision, restoreFocusedEntry, moveSessionUnit } from '../lib/session.js'

const srcPath = relative => fileURLToPath(new URL('../' + relative, import.meta.url))
const source = readFileSync(srcPath('views/Workout.jsx'), 'utf8')
const session = readFileSync(srcPath('lib/session.js'), 'utf8')
const media = readFileSync(srcPath('components/Media.jsx'), 'utf8')
const sheets = readFileSync(srcPath('sheets.jsx'), 'utf8')

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

  it('uses intrinsic media ratios and exposes a reliable size-toggle state', () => {
    const css = readFileSync(srcPath('index.css'), 'utf8')
    expect(media).toContain('const [mediaRatio, setMediaRatio] = useState(null)')
    expect(media).toContain('const gifSize = useStore(s => s.S.gifSize)')
    expect(media).not.toContain('const gifSize = useStore(s => s.gifSize)')
    expect(media).toContain('naturalWidth')
    expect(media).toContain('videoWidth')
    expect(media).toContain('onLoadedMetadata')
    expect(media).toContain('type="button" className="giftoggle"')
    expect(media).toContain('aria-pressed={mini}')
    expect(media).toContain('type="button" className="gifhint"')
    expect(media).toContain('aria-pressed={mediaPlaying}')
    expect(media).not.toContain('{!mini && (hasVideo || ex.gif)')
    expect(media).toContain("s.gifSize === 'mini' ? 'full' : 'mini'")
    expect(media).toContain('const expanding = mini')
    expect(media).toContain('if (expanding && workoutScoped && workoutMediaEnabled && !reduced) setPlaying(true)')
    expect(css).toContain('--media-ratio:1.333333')
    expect(css).toContain('width:100%;max-width:100%')
    expect(css).toContain('width:100%;height:var(--media-max-height);aspect-ratio:auto')
    expect(css).toContain('aspect-ratio:var(--media-ratio)')
    expect(css).toContain('height:100%')
    expect(css).toContain('.exmedia.compact{--media-max-height:120px}')
    expect(css).toContain('.exmedia.mini{--media-max-height:clamp(84px,15vw,120px)}')
    expect(css).toContain('min-height:44px')
    expect(css).not.toContain('.exmedia:not(.compact):not(.mini){aspect-ratio:4/3}')
    expect(css).not.toContain('.exmedia img,.exmedia video,.exmedia .exmedia-x{height:')
  })

  it('scopes the persisted animation preference to active workout media', () => {
    expect(source).toContain('<Media ex={ex} key={entry.id} compact={compact} minimizable priority={priority} />')
    expect(media).toContain('const workoutScoped = !!minimizable')
    expect(media).toContain('const workoutMediaEnabled = useStore(s => workoutScoped ? s.S.workoutMediaEnabled !== false : true)')
    expect(media).toContain('setPlaying(workoutMediaEnabled && !reduced)')
    expect(media).toContain('const mediaPlaying = workoutScoped ? workoutMediaEnabled && playing : playing')
    expect(media).toContain('autoPlay={!reduced && mediaPlaying}')
    expect(media).toContain('src={mediaPlaying ? gifSrc(ex) : imgSrc(ex)}')
    expect(media).toContain('s.workoutMediaEnabled = next')
    expect(media).toContain('onClick={togglePlaying}')
    expect(sheets).toContain('<Media ex={ex} />')
  })

  it('keeps empty note disclosure collapsed while preserving editable content and semantics', () => {
    expect(source).toContain('hidden={!workoutNoteOpen}')
    expect(source).toContain("value={typeof entry.note === 'string' ? entry.note : ''}")
    expect(source).toContain("t(workoutNoteOpen ? 'Hide {0}' : 'Show {0}'")
    expect(source).toContain('aria-expanded={workoutNoteOpen}')
    expect(source).toContain('entry.note.trim().length > 0')
  })

  it('renders all exercises without bottom navigation', () => {
    const css = readFileSync(srcPath('index.css'), 'utf8')
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
    const css = readFileSync(srcPath('index.css'), 'utf8')
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

  it('keeps active-session-only workout edits out of the remote save queue', () => {
    // Set logging mutates only the browser-local active session. The remote snapshot strips active,
    // so scheduling /api/data for each set can report a false save failure while localStorage is safe.
    // The /workout screen is active-session only: no historical-edit branches may reappear here.
    const activeMutationBlock = source.match(/const mutEntry[\s\S]*?const toggle/)
    expect(activeMutationBlock?.[0]).toContain('const mutEntry')
    expect(activeMutationBlock?.[0]).toContain('}, false)')
    expect(source).not.toContain('isHistorical')
    expect(source).not.toContain('historicalEdit')
    expect(source).not.toContain('cancelHistorical')
    expect(source).not.toContain('saveHistorical')
    const pickerMutationBlock = source.match(/const pickExercise[\s\S]*?return <main/)
    expect(pickerMutationBlock?.[0]).toContain('}, false), closePicker)')
    const topWeightBlock = sheets.match(/function TopWeight[\s\S]*?export const workoutCompleteSheet/)
    expect(topWeightBlock?.[0]).toContain('else update(s => { s.active.cur = units[unitIdx + 1][0] }, false)')
    const topWeightCommit = topWeightBlock?.[0].match(/const commit = advance =>[\s\S]*?close\(\)/)?.[0]
    expect(topWeightCommit).toContain('s.exWeights[entry.id] = { w: Math.max(n, cur ? cur.w : 0), d: todayISO() }')
    expect(topWeightCommit).toContain('}, false)')
  })

  it('keeps set completion anchored and lets sheets own completion focus', () => {
    const toggleBlock = source.match(/const toggle = [\s\S]*?\/\/ Live-presence/)
    const ui = readFileSync(srcPath('components/ui.jsx'), 'utf8')
    const flashBlock = ui.match(/export function scheduleSetRowFlash[\s\S]*?export function Check/)
    // Checking a set must not run the exercise-card focus/scroll path; only the expected
    // top-weight or whole-workout sheet may take focus after the state update.
    expect(toggleBlock?.[0]).not.toContain('focusEntry(')
    expect(toggleBlock?.[0]).toContain('if (askTop) topWeightSheet(idx)')
    expect(toggleBlock?.[0]).toContain('else if (workoutDone) workoutCompleteSheet()')
    expect(flashBlock?.[0]).not.toContain('scrollIntoView')
    // Row keys remain index-stable while the done-run wrapper owns only the visual fusion.
    expect(source).toContain('return <Fragment key={i}>')
    expect(source).toContain("key={'g' + k + '-' + j}")
  })

  it('restores only sid-keyed rest metadata and keeps work timer separate', () => {
    expect(source).toContain('useUI.getState().resumeRest()')
    expect(source).toContain('startRest(S.restSec, A.entries[idx].sid)')
    expect(readFileSync(srcPath('store/useUI.js'), 'utf8')).toContain('state.active.restResume')
    expect(readFileSync(srcPath('store/useUI.js'), 'utf8')).toContain('work: null')
  })

  it('provides index jumps, deterministic restoration, and an options menu per unit', () => {
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
    // reorder moved off the card: one dots button per unit opens the menu,
    // the counter stays, and the commit lives in the reorder sheet
    expect(source).toContain("t('Exercise options')")
    expect(source).toContain('exerciseMenuSheet')
    expect(source).toContain('name="dots"')
    expect(source).not.toContain("t('Move up')")
    expect(source).not.toContain("t('Move down')")
    expect(source).not.toContain('moveSessionUnit')
    expect(source).not.toContain('aria-live="polite"')
    expect(sheets).toContain('moveSessionUnit')
    expect(sheets).toContain('remapCur')
    expect(sheets).toContain('touchActiveRecord')
    expect(sheets).toContain('reorderExercisesSheet')
    expect(sheets).toContain('aria-live="polite"')
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

  it('scrolls the resumed card while retaining the explicit no-scroll focus mode', () => {
    const calls = []
    const target = {
      focus: options => calls.push(['focus', options]),
      scrollIntoView: options => calls.push(['scroll', options])
    }
    expect(restoreFocusedEntry(target, false)).toBe(true)
    expect(calls.map(([kind]) => kind)).toEqual(['focus', 'focus'])
    expect(source).toContain('focusEntry(A.entries[cur].sid)')
    expect(source).not.toContain('focusEntry(A.entries[cur].sid, false)')
    expect(source).toContain('if (focusSid) focusEntry(focusSid)')
    // reorder keeps focus on the dragged handle: rows are keyed by sid so the
    // grip node (and its pointer capture) survives the live commit, and the
    // sheet never steals focus through the card restore path
    expect(sheets).toContain('key={first.sid}')
    expect(sheets).toContain('setPointerCapture')
    expect(sheets).not.toContain('focusEntry(')
  })

  it('stacks unilateral sides with fluid sub-rows at every width', () => {
    const css = readFileSync(srcPath('index.css'), 'utf8')
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
    expect(source).toContain("const sideInputClass = 'side-input ' + effortProps.className")
    expect(source).toContain("className={col.f === 'w' ? sideInputClass + ' weight-input' : sideInputClass}")
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

  it('keeps the workout wrapper as the only sticky and composited surface', () => {
    const css = readFileSync(srcPath('index.css'), 'utf8')
    const stickyRule = css.match(/\.workout-session \.workout-sticky-head\{([^}]*)\}/)?.[1] || ''
    const stickyAfterRule = css.match(/\.workout-session \.workout-sticky-head::after\{([^}]*)\}/)?.[1] || ''
    const progressRule = css.match(/\.workout-session \.wprog\{([^}]*)\}/)?.[1] || ''
    expect(source).toContain('className="workout-sticky-head"')
    expect(source).toContain('className="wprog"')
    expect(stickyRule).toContain('position:sticky')
    expect(stickyRule).toContain('isolation:isolate')
    expect(stickyRule).toContain('transform:translateZ(0);backface-visibility:hidden;will-change:transform')
    expect(stickyAfterRule).toContain("content:''")
    expect(stickyAfterRule).toContain('position:absolute')
    expect(stickyAfterRule).toContain('left:0')
    expect(stickyAfterRule).toContain('right:0')
    expect(stickyAfterRule).toContain('bottom:-24px')
    expect(stickyAfterRule).toContain('height:24px')
    expect(stickyAfterRule).toContain('background:linear-gradient(to bottom,var(--sep-op),transparent)')
    expect(stickyAfterRule).toContain('filter:blur(6px)')
    expect(stickyAfterRule).toContain('pointer-events:none')
    expect(progressRule).not.toContain('position:sticky')
    expect(progressRule).not.toContain('top:var(--sat)')
    expect(progressRule).not.toContain('z-index:20')
    expect(progressRule).not.toContain('transform:translateZ(0)')
    expect(progressRule).not.toContain('backface-visibility:hidden')
    expect(progressRule).not.toContain('will-change:transform')
    expect(progressRule).not.toMatch(/(?:^|;)(?:position|top|right|bottom|left|z-index|transform|backface-visibility|will-change):/)
    expect(css).toContain('.wprog{height:4px;')
    expect(css).toContain('.wprog i{display:block;height:100%;background:var(--acc);border-radius:99px;transition:width var(--med) var(--ease)}')
    expect(source).not.toContain('draggable=')
    // pointer-based DnD owns reorder: no draggable attribute anywhere, the
    // grip captures the pointer and commits through moveSessionUnit
    expect(sheets).not.toContain('draggable=')
    expect(sheets).toContain('onPointerDown')
    expect(sheets).toContain('setPointerCapture')
    expect(sheets).toContain('moveSessionUnit')
  })

  it('anchors the sticky workout band to the physical viewport edge', () => {
    const css = readFileSync(srcPath('index.css'), 'utf8')
    const appRule = css.match(/#app\{([^}]*)\}/)?.[1] || ''
    const stickyRule = css.match(/\.workout-session \.workout-sticky-head\{([^}]*)\}/)?.[1] || ''
    expect(appRule).toContain('padding:calc(var(--sat) + 8px)')
    expect(stickyRule).toContain('position:sticky')
    expect(stickyRule).toContain('top:0')
    expect(stickyRule).toContain('margin-top:calc(-1 * var(--sat) - 8px)')
    expect(stickyRule).toContain('padding-top:calc(var(--sat) + 8px)')
    expect(stickyRule).toContain('z-index:20')
    expect(stickyRule).toContain('isolation:isolate')
    expect(stickyRule).toContain('background:var(--bg)')
    expect(stickyRule).not.toContain('top:var(--sat)')
  })

  it('keeps mode-specific inputs, timers, notes, completion, and lifecycle actions wired', () => {
    for (const token of ["mode === 'cardio'", "mode === 'time'", 'isBw(cfg)', 'startRest', 'onStartTimed',
      'Workout note', 'projectSideSet(s).done', 'finishWorkout', "t('Discard')", 'confirmSheet']) {
      expect(source).toContain(token)
    }
  })

  it('localizes unilateral markers and keeps prior history visual-only', () => {
    const css = readFileSync(srcPath('index.css'), 'utf8')
    expect(source).toContain("import { t, sideLabel } from '../lib/i18n.js'")
    expect(source).toContain('previousSetValue(last, i, col.f)')
    expect(source).toContain('previousSetValue(last, i, col.f, side)')
    expect(source).toContain('historyInputValue')
    expect(source).toContain('historyInputValue(s[col.f])')
    expect(source).toContain('historyInputValue(s[side][col.f])')
    expect(source).toContain('historyEdited.current.has')
    expect(source).toContain('historyPreview.current')
    expect(source).toContain("className={'history-hint' + (col.f === 'w' ? ' weight-history-hint' : '')}")
    expect(css).toContain('.stp .val:focus-within .history-hint{display:none}')
    expect(source).toContain('value={value}')
    expect(source).toContain("sideLabel('left').marker")
    expect(source).toContain("sideLabel('right').marker")
    expect(source).toContain('sideText.name')
    expect(source).toContain('aria-hidden="true"')
    expect(source).not.toContain('>L</span>')
    expect(source).not.toContain('>R</span>')
  })

  it('scopes the muted placeholder treatment to weight fields in every set layout', () => {
    const css = readFileSync(srcPath('index.css'), 'utf8')
    const cellBlock = source.match(/const cell = [\s\S]*?\/\/ Effort steps/)?.[0] || ''
    expect(source).toContain("const loadCol = { f: 'w', step: 2.5")
    expect(source).toContain("(bw && !added) ? repCol : loadCol")
    expect(source).toContain("timed ? ((bw && !added) ? null : loadCol)")
    expect(source).toContain("const added = bw && entry.sets.some")
    expect(source).toContain("sideCell(s, i, 'left', col1, 'w')")
    expect(source).toContain("sideCell(s, i, 'right', col1, 'w')")
    expect(source).toContain("className={col.f === 'w' ? 'weight-input' : effortProps.className}")
    expect(source).toContain("className={'history-hint' + (col.f === 'w' ? ' weight-history-hint' : '')}")
    expect(cellBlock).toContain('value={value}')
    expect(css).toContain('.stp .num.weight-input::placeholder,.stp .history-hint.weight-history-hint{color:var(--label-4);opacity:1}')
    expect(css).toContain('.stp .num::placeholder{color:var(--label-3);opacity:1}')
    expect(css).not.toContain('.stp .num.reps-input::placeholder')
    expect(css).not.toContain('.stp .num.effort-input::placeholder')
  })

  it('marks only workout-record mutations and clears the active reminder lifecycle', () => {
    expect(source).toContain('touchActiveRecord')
    expect(source).toContain('s.active = null')
    expect(source).toContain('Discard workout?')
    expect(readFileSync(srcPath('components/InactivityReminder.jsx'), 'utf8')).toContain('visibilitychange')
  })

  it('keeps approved exclusions out of the active-session renderer', () => {
    expect(source).not.toContain("from '../lib/mobile.js'")
    expect(source).not.toContain('Capacitor')
    expect(source).not.toContain('draggable=')
    expect(sheets).not.toContain('draggable=')
    expect(source).not.toMatch(/s\.routines\s*=/)
    expect(source).not.toMatch(/s\.dayPlan\s*=/)
    expect(source).not.toContain('delete s.dayPlan')
  })

  it('fuses consecutive done sets into one card while loners stay bare', () => {
    const css = readFileSync(srcPath('index.css'), 'utf8')
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
    const css = readFileSync(srcPath('index.css'), 'utf8')
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

describe('exercise options menu and reorder screen', () => {
  it('gives every unit a dots button that opens the menu with its members', () => {
    expect(source).toContain("aria-label={t('Exercise options')}")
    expect(source).toContain('exerciseMenuSheet({')
    expect(source).toContain('members: members.map(idx =>')
    expect(source).toContain('onEdit: editExercise')
    expect(source).toContain('onRemove: removeExercise')
    expect(source).toContain('unitTotal: units.length')
    // the counter stays next to the menu button
    expect(source).toContain("t('Exercise {0} / {1}', unitIndex + 1, units.length)")
    expect(source).toContain("t('Superset {0} / {1}', unitIndex + 1, units.length)")
  })

  it('lets the exercise title own the full row with ellipsis at 320px', () => {
    expect(source).toContain('session-ex-title')
    // edit travels through the unit menu now: no card-header buttons, the menu
    // owns the edit row and Workout wires it to the rebuilt config flow
    expect(source).toContain('onEdit: editExercise')
    expect(source).toContain('const editExercise = idx =>')
    expect(source).toContain('rebuildActiveEntry(current, live, cfg')
    expect(source).toContain('exConfigSheet(ex, entry.target, cfg =>')
    expect(source).not.toContain("t('Details')")
    expect(source).not.toContain('session-remove')
    const css = readFileSync(srcPath('index.css'), 'utf8')
    expect(css).toContain('.session-ex-title{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}')
  })

  it('opens each menu action after closing the menu first', () => {
    // edit → config sheet, info → detail sheet, reorder → reorder screen, delete → existing remove flow
    expect(sheets).toContain('exerciseMenuSheet')
    expect(sheets).toContain("t('Edit exercise')")
    expect(sheets).toContain("t('Exercise information')")
    expect(sheets).toContain("t('Reorder exercises')")
    expect(sheets).toContain("t('Delete exercise')")
    expect(sheets).toContain('const openEdit = entryIdx => { close(); onEdit(entryIdx) }')
    expect(sheets).toContain("const openInfo = id => { close(); exerciseDetailSheet(exOr(id), { hideAddToPlan: true }) }")
    expect(sheets).toContain('const openReorder = () => { close(); reorderExercisesSheet() }')
    expect(sheets).toContain('const askRemove = entryIdx => { close(); onRemove(entryIdx) }')
    expect(sheets).toContain('className="item danger"')
    // superset units repeat the per-exercise rows around the shared reorder row
    expect(sheets).toContain("t('Superset {0} / {1}', unitIndex + 1, unitTotal)")
  })

  it('hides the plan button when the detail opens from the active workout', () => {
    // the exercise is already in the plan there; library and other callers keep the button
    expect(sheets).toContain('hideAddToPlan')
    expect(sheets).toContain('{!hideAddToPlan && <Button variant="primary" icon="plus"')
    expect(sheets).toContain("t('Add to my plan')")
  })

  it('renders the reorder screen tall with handles, live position, and Done', () => {
    expect(sheets).toContain('reorderExercisesSheet')
    expect(sheets).toContain("{ tall: true }")
    expect(sheets).toContain("t('Reorder')")
    expect(sheets).toContain("t('Done')")
    expect(sheets).toContain('<Thumb ex={ex} />')
    expect(sheets).toContain('name="grip"')
    expect(sheets).toContain('data-nodrag')
    expect(sheets).toContain("onKeyDown={keys}")
    expect(sheets).toContain("e.key === 'ArrowUp'")
    expect(sheets).toContain("e.key === 'ArrowDown'")
    expect(sheets).toContain("e.key === 'Home'")
    expect(sheets).toContain("e.key === 'End'")
    expect(sheets).toContain('role="status"')
    expect(sheets).toContain('className="sr-only"')
    const css = readFileSync(srcPath('index.css'), 'utf8')
    expect(css).toContain('.regrip{touch-action:none')
    expect(css).toContain('.sr-only{position:absolute')
    expect(css).toContain('.item.danger{color:var(--red)}')
  })

  it('commits reorder moves to the persisted session snapshot only', () => {
    // local-only persist (same boundary the old chevrons used): never the routines
    expect(sheets).toContain('s.active.entries = moved.entries')
    expect(sheets).toContain('s.active.cur = remapCur(before, s.active.cur, moved.entries)')
    expect(sheets).toContain('touchActiveRecord(s.active)')
    const commit = sheets.match(/export function commitUnitMove[\s\S]*?\n\}/)?.[0] || ''
    expect(commit).toContain('}, false)')
    expect(commit).not.toContain('s.routines')
    expect(commit).not.toContain('s.dayPlan')
  })

  it('moves whole units through moveSessionUnit, the path the sheet commits', () => {
    const entries = [
      { sid: 'a', id: 'bench' }, { sid: 'b', id: 'row' }, { sid: 'c', id: 'squat' },
    ]
    const first = moveSessionUnit(entries, 0, 1)
    expect(first.changed).toBe(true)
    expect(first.entries.map(e => e.sid)).toEqual(['b', 'a', 'c'])
    expect(first.position).toBe(1)
    // a superset block travels together
    const sg = [
      { sid: 'a', id: 'bench', sg: 'g1' }, { sid: 'b', id: 'row', sg: 'g1' }, { sid: 'c', id: 'squat' },
    ]
    const block = moveSessionUnit(sg, 0, 1)
    expect(block.changed).toBe(true)
    expect(block.entries.map(e => e.sid)).toEqual(['c', 'a', 'b'])
    // out-of-range moves change nothing, so no phantom persist happens
    expect(moveSessionUnit(entries, 0, -1).changed).toBe(false)
    expect(moveSessionUnit(entries, 2, 1).changed).toBe(false)
  })

  it('translates every new user-facing string to Spanish', () => {
    const spanish = readFileSync(srcPath('locales/es.js'), 'utf8')
    for (const key of ['Exercise options', 'Edit exercise', 'Exercise information', 'Reorder exercises', 'Reorder',
      'Drag with the handle, or focus it and use the arrow keys to reorder.', 'Done', 'Delete exercise']) {
      expect(spanish).toContain("'" + key + "'")
    }
  })
})
