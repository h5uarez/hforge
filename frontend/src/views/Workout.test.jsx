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

  it('uses a compact localized selector near navigation and compact cards without changing type sizes', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(source).toContain('workout-session-nav')
    expect(source).toContain('<select aria-label={t(\'Exercises\')}')
    expect(source).toContain('const unitIndex = Number(e.target.value)')
    expect(source).toContain('jumpTo(units[unitIndex]?.[0])')
    expect(source).toContain('members.map(i => exerciseName(exOr(A.entries[i].id))).join(\' + \')')
    expect(source).not.toContain('session-index')
    expect(css).not.toContain('.workout-session .session-index')
    expect(css).toContain('.workout-session .session-card{padding:12px')
    expect(css).toContain('.workout-session .session-card .card{padding:12px}')
    expect(css).toContain('.session-selector select{')
    expect(css).toContain('min-height:44px')
  })

  it('maps a selected superset unit to its first entry before jumping', () => {
    expect(source).toContain('const unitIndex = Number(e.target.value)')
    expect(source).toContain('jumpTo(units[unitIndex]?.[0])')
    expect(source).not.toContain('jumpTo(Number(e.target.value))')
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
