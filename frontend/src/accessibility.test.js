import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = name => readFileSync(resolve(process.cwd(), 'src', name), 'utf8')

describe('mobile accessibility and layout contracts', () => {
  it('keeps shared controls and navigation semantic', () => {
    const ui = source('components/ui.jsx')
    const tabs = source('components/TabBar.jsx')
    const workout = source('views/Workout.jsx')
    expect(ui).toContain('role="switch"')
    expect(ui).toContain('role="checkbox"')
    expect(ui).toContain('role="slider"')
    expect(ui).toContain('aria-pressed={o.value === value}')
    expect(tabs).toContain('aria-current={on(k) ? \'page\' : undefined}')
    expect(workout).toContain('aria-label={t(\'Sets\')')
  })

  it('keeps narrow controls and fixed navigation clear of content', () => {
    const css = source('index.css')
    const home = source('views/Home.jsx')
    expect(css).toContain('flex-wrap:wrap')
    expect(css).toContain('min-height:44px')
    expect(css).toContain('calc(180px + var(--sab))')
    expect(css).toContain('bottom:calc(96px + var(--sab))')
    expect(css).toContain('.calendar-nav{padding-inline:44px}')
    expect(home).toContain('style={{ width: 44, height: 44, fontSize: 15 }}')
  })

  it('keeps exercise and workout note boxes independently discoverable and collapsible', () => {
    const sheets = source('sheets.jsx')
    const workout = source('views/Workout.jsx')
    expect(sheets).toContain("t('Exercise note')")
    expect(sheets).not.toContain("t('Trainer note')")
    expect(sheets).toContain('const [planNoteOpen, setPlanNoteOpen] = useState(true)')
    expect(sheets).toContain('aria-expanded={planNoteOpen}')
    expect(sheets).toContain('aria-controls="exercise-plan-note-content"')
    expect(sheets).toContain('<div id="exercise-plan-note-content" hidden={!planNoteOpen}>')
    expect(sheets).toContain("<Icon name={planNoteOpen ? 'chevronUp' : 'chevronDown'} />")
    expect(sheets).toContain('id="exercise-plan-note"')
    expect(workout).toContain("t('Exercise note')")
    expect(workout).not.toContain("t('Trainer note')")
    expect(workout).toContain('const [workoutNoteOpen, setWorkoutNoteOpen] = useState(true)')
    expect(workout).toContain('aria-expanded={workoutNoteOpen}')
    expect(workout).toContain('aria-controls={workoutNoteContentId}')
    expect(workout).toContain('hidden={!workoutNoteOpen}')
    expect(workout).toContain("<Icon name={workoutNoteOpen ? 'chevronUp' : 'chevronDown'} />")
    expect(workout).toContain("const workoutNoteId = 'workout-note-' + entryIdx")
  })

  it('guards unlocked dismissal while preserving locked dialogs', () => {
    const modal = source('components/Modals.jsx')
    expect(modal).toContain("e.key === 'Escape' && !sheet.locked")
    expect(modal).toContain("!sheet.locked && <button type=\"button\" className=\"iconbtn modal-close\"")
    expect(modal).toContain('returnFocus.current.focus()')
  })

  it('uses native buttons for the audited Home and scheduling actions', () => {
    const home = source('views/Home.jsx')
    const sheets = source('sheets.jsx')
    expect(home).toContain('<button type="button" key={i} className={\'wday\'')
    expect(home).toContain('<button type="button" className="today-row"')
    expect(home).toContain('className="card tappable interactive-card"')
    expect(sheets).toContain('<button type="button" key={r.id} className="item"')
    expect(sheets).toContain("className=\"item\" onClick={() => set('rest')}")
  })

  it('announces the single mobile toast without changing its store behavior', () => {
    const toast = source('components/Toast.jsx')
    const css = source('index.css')
    expect(toast).toContain('role="status" aria-live="polite"')
    expect(css).toContain('max-width:calc(100vw - 2 * var(--pad))')
    expect(css).toContain('overflow-wrap:anywhere')
  })

  it('keeps passkey diagnostics in the console and localizes user-facing failures', () => {
    const settings = source('views/Settings.jsx')
    expect(settings).toContain("console.error('Passkey sign-in failed:', e)")
    expect(settings).toContain("toast(t('Sign-in failed'))")
    expect(settings).not.toContain("toast(e.message || t('Sign-in failed'))")
  })
})
