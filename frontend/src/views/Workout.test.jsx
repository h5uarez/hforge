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

  it('removes the bottom exercise selector while preserving Previous/Next navigation', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(source).toContain('workout-session-nav')
    expect(source).not.toContain('<select')
    expect(source).not.toContain('session-selector')
    expect(source).not.toContain('const unitIndex = Number(e.target.value)')
    expect(source).not.toContain('session-index')
    expect(css).not.toContain('.workout-session .session-index')
    expect(css).not.toContain('.session-selector')
    expect(css).toContain('.workout-session .session-card{padding:12px')
    expect(css).toContain('.workout-session .session-card .card{padding:12px}')
    expect(css).toContain('.workout-session-nav > button{flex:1 1 0;width:auto}')
  })

  it('keeps Previous/Next jumps on the existing SID focus path', () => {
    expect(source).toContain('onClick={() => jumpTo(units[unitIdx - 1]?.[0])}')
    expect(source).toContain('onClick={() => jumpTo(units[unitIdx + 1]?.[0])}')
    expect(source).not.toContain('jumpTo(Number(e.target.value))')
  })

  it('keeps timed decimal weights and effort rows inside 393/430px mobile scrollports', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const mobileMaxWidth = Number(css.match(/@media \(max-width:(\d+)px\)\{/)?.[1])
    expect(source).toContain('const gridClass =')
    expect(source).toContain("' no-col2'")
    expect(source).toContain("' timed'")
    expect(source).toContain("const loadCol = { f: 'w', step: 2.5, dec: true")
    expect(source).toContain('decimal={col.dec}')
    expect(source).toContain('className="info-sp"')
    expect(css).toContain(' 44px 44px;')
    expect(css).toContain('minmax(108px,1.35fr) minmax(72px,1fr) 44px 44px')
    expect(css).toContain('.setrow.timed .stp.w .val{min-width:calc(4ch + 4px)}')
    expect(css).toContain('.sethead.no-col2.timed,.setrow.no-col2.timed')
    expect(css).toContain('--set-go-col:3;--set-check-col:4')
    expect(css).toContain('.setrow:not(.per-side) > .setgo{grid-column:var(--set-go-col,4);justify-self:center}')
    expect(css).toContain('.setrow:not(.per-side) > .setinfo{grid-column:var(--set-info-col);justify-self:center}')
    expect(css).toContain('.setrow:not(.per-side) > .chk{grid-column:var(--set-check-col);justify-self:center}')
    expect(css).toContain('.setrow.per-side > .side-checks{grid-column:10;')
    expect(css).toContain('grid-template-columns:44px 44px')
    expect(css).not.toContain('min-width:340px')
    expect(css).not.toContain('min-width:386px')
    expect(mobileMaxWidth).toBeGreaterThanOrEqual(430)
    expect(css).not.toContain('@media (max-width:420px)')
    expect(css).toContain('minmax(70px,1.2fr) minmax(54px,1fr) minmax(58px,.85fr) 44px 44px')
    expect(css).toContain('.setrow.eff3 .stp button,.setrow.eff3 .stp.eff button{width:16px}')
    const gridWidth = (tracks, gap) => tracks.reduce((sum, track) => sum + track, 0) + (tracks.length - 1) * gap
    for (const [viewport, scrollport] of [[393, 313], [430, 350]]) {
      expect(mobileMaxWidth).toBeGreaterThanOrEqual(viewport)
      expect(gridWidth([24, 104, 72, 44], 8)).toBeLessThanOrEqual(scrollport)
      expect(gridWidth([24, 108, 72, 44, 44], 5)).toBeLessThanOrEqual(scrollport)
      expect(gridWidth([24, 70, 54, 58, 44, 44], 3)).toBeLessThanOrEqual(scrollport)
    }
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
    expect(session).toContain("block: 'center'")
    expect(session).toContain("inline: 'nearest'")
    expect(session).toContain("behavior: 'auto'")
    expect(source).toContain('attempts++ < 3')
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
    expect(source).toContain('onClick={() => jumpTo(units[unitIdx - 1]?.[0])}')
    expect(source).toContain('onClick={() => jumpTo(units[unitIdx + 1]?.[0])}')
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

  it('gives unilateral controls explicit narrow-width geometry', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).toContain('.setrow.per-side{min-width:560px}')
    expect(css).toContain('.setrow.per-side .stp.w{min-width:104px}')
    expect(css).toContain('.setrow.per-side .stp.r{min-width:84px}')
    expect(css).toContain('.setrow.per-side .side-input{width:2ch;min-width:2ch;flex:0 0 2ch}')
    expect(source).toContain('className="side-input"')
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

  it('keeps approved exclusions out of the active-session renderer', () => {
    expect(source).not.toContain("from '../lib/mobile.js'")
    expect(source).not.toContain('Capacitor')
    expect(source).not.toContain('draggable=')
    expect(source).not.toMatch(/s\.routines\s*=/)
    expect(source).not.toMatch(/s\.dayPlan\s*=/)
    expect(source).not.toContain('delete s.dayPlan')
  })
})
