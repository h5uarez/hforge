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
    expect(css).toContain('flex-wrap:wrap')
    expect(css).toContain('min-height:44px')
    expect(css).toContain('calc(180px + var(--sab))')
    expect(css).toContain('bottom:calc(96px + var(--sab))')
  })

  it('guards unlocked dismissal while preserving locked dialogs', () => {
    const modal = source('components/Modals.jsx')
    expect(modal).toContain("isDismissKey(e.key) && !sheet.locked")
    expect(modal).toContain("key === 'Escape' || key === 'Esc'")
    expect(modal).toContain("!sheet.locked && <button className=\"iconbtn modal-close\"")
    expect(modal).toContain('returnFocus.current.focus()')
  })

  it('covers translated note labels, errors, focus, and resilient presentation', () => {
    const sheets = source('sheets.jsx')
    const ui = source('components/ui.jsx')
    const modal = source('components/Modals.jsx')
    const css = source('index.css')
    expect(sheets).toContain('aria-describedby')
    expect(sheets).toContain('aria-invalid={!!error}')
    expect(sheets).toContain("t('Has note')")
    expect(sheets).toContain("t('Note must be 280 characters or fewer.')")
    expect(ui).toContain('forwardRef(function TextArea')
    expect(modal).toContain("e.key === 'Tab'")
    expect(modal).toContain('sheet.onDismiss?.()')
    expect(modal).toContain('onClick={dismiss}')
    expect(modal).toContain('dismiss()')
    expect(css).toContain('.sr-only')
    expect(css).toContain('.note-indicator')
    expect(css).toContain('overflow-y:auto')
    expect(css).toContain('max-height:90vh')
  })
})
