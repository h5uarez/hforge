import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ACCENTS, ACCENT_MIGRATION, DEFAULT_ACCENTS, DEFAULT_ACCENT_MIGRATION, resolveAccent, resolveDefaultAccent } from './lib/format.js'

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

  it('keeps language selection out of login and available in Settings', () => {
    const login = source('views/Login.jsx')
    const settings = source('views/Settings.jsx')
    const css = source('index.css')
    expect(login).not.toContain('login-language')
    expect(login).not.toContain('LANGS')
    expect(login).not.toContain('setLangPreference')
    expect(settings).toContain("title={t('Language')}")
    expect(settings).toContain('Object.entries(LANGS)')
    expect(css).not.toContain('.login-lang')
  })

  it('keeps narrow controls and fixed navigation clear of content', () => {
    const css = source('index.css')
    const home = source('views/Home.jsx')
    expect(css).toContain('flex-wrap:wrap')
    expect(css).toContain('min-height:44px')
    expect(css).toContain('calc(100px + var(--sab))')
    expect(css).toContain('bottom:calc(96px + var(--sab))')
    expect(css).toContain('.calendar-nav{padding-right:44px')
    expect(css).toContain('.calendar-nav h3{flex:1;min-width:0')
    expect(home).toContain('style={{ width: 44, height: 44, fontSize: 15 }}')
  })

  it('aligns the active indicator to the padded five-button track on mobile and desktop', () => {
    const css = source('index.css')
    const tabs = source('components/TabBar.jsx')
    expect(css).toMatch(/#tabbar\{[^}]*--tabbar-x-inset:6px/)
    expect(css).toContain('left:var(--tabbar-x-inset)')
    expect(css).toContain('width:calc((100% - var(--tabbar-x-inset) - var(--tabbar-x-inset))/5)')
    expect(css).toMatch(/@media \(min-width:1000px\)[\s\S]*?#tabbar\{[^}]*--tabbar-x-inset:10px/)
    expect(tabs).toContain('const TAB_INDEX = { home: 0, plan: 1, stats: 3, library: 4 }')
  })

  it('preserves fixed anchoring, desktop centering, route restoration, and keyboard handling', () => {
    const css = source('index.css')
    const tabs = source('components/TabBar.jsx')
    expect(css).toMatch(/#tabbar\{[^}]*position:fixed/)
    expect(css).toContain('bottom:calc(10px + var(--sab))')
    expect(css).toContain('z-index:50')
    expect(css).toContain('transform:translateX(-50%)')
    expect(css).toContain('calc(100px + var(--sab))')
    expect(css).toContain('body.kb-open #tabbar')
    expect(tabs).toContain('window.visualViewport')
    expect(tabs).toContain("document.body.classList.toggle('kb-open'")
    expect(tabs).toContain('scrollMem.set(from, window.scrollY || 0)')
    expect(tabs).toContain('window.scrollTo(0, scrollMem.get(to) || 0)')
  })

  it('compacts the whole navbar directionally without changing indicator geometry', () => {
    const css = source('index.css')
    const tabs = source('components/TabBar.jsx')
    const compactRule = css.match(/#tabbar\.is-compact\{([^}]*)\}/)?.[1] || ''
    const compactButtonRule = css.match(/#tabbar\.is-compact button\{([^}]*)\}/)?.[1] || ''
    expect(tabs).toContain('useScrollDirection')
    expect(tabs).toContain("compact ? 'is-compact' : ''")
    expect(css).toContain('transform-origin:center bottom;scale:1')
    expect(compactRule).toContain('scale:.88')
    expect(compactRule).not.toContain('transform')
    expect(compactButtonRule).toContain('min-width:50px;min-height:50px')
    expect(compactButtonRule).not.toMatch(/(?:^|;)width:/)
    expect(compactButtonRule).not.toMatch(/(?:^|;)height:/)
    expect(css).toContain('transition:scale var(--motion-tab) var(--ease)')
    expect(css).toContain('transition:color var(--fast)')
  })

  it('keeps page-header scrolling separation soft and faded', () => {
    const css = source('index.css')
    const pageAfter = css.match(/\.hdr\.page::after\{([^}]*)\}/)?.[1] || ''
    expect(css).toContain('--motion-tab:200ms')
    expect(pageAfter).toContain('linear-gradient(to bottom,var(--sep-op),transparent)')
    expect(pageAfter).toContain('bottom:-24px')
    expect(pageAfter).toContain('height:24px')
    expect(pageAfter).toContain('filter:blur(6px)')
    expect(pageAfter).toContain('pointer-events:none')
    expect(pageAfter).not.toContain('height:var(--hair)')
  })

  it('uses a passive rAF document signal and excludes nested sheet scrolling', () => {
    const ui = source('components/ui.jsx')
    const tabs = source('components/TabBar.jsx')
    expect(ui).toContain('export function useScrollDirection')
    expect(ui).toContain('nextScrollState')
    expect(ui).toContain('requestAnimationFrame(read)')
    expect(ui).toContain("document.addEventListener('scroll', onScroll, { passive: true })")
    expect(ui).toContain("document.removeEventListener('scroll', onScroll)")
    expect(ui).toContain('scrolling a nested .sheet')
    expect(tabs).not.toContain('useScrolled')
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
    expect(workout).toContain("const [workoutNoteOpen, setWorkoutNoteOpen] = useState(() => typeof entry.note === 'string' && entry.note.trim().length > 0)")
    expect(workout).toContain("entry.note.trim().length > 0")
    expect(workout).toContain('aria-expanded={workoutNoteOpen}')
    expect(workout).toContain('aria-controls={workoutNoteContentId}')
    expect(workout).toContain('hidden={!workoutNoteOpen}')
    expect(workout).toContain("<Icon name={workoutNoteOpen ? 'chevronUp' : 'chevronDown'} />")
    expect(workout).toContain("const workoutNoteId = 'workout-note-' + sid")
  })

  it('renders all exercises without bottom session navigation', () => {
    const css = source('index.css')
    const workout = source('views/Workout.jsx')
    expect(workout).not.toContain('workout-session-nav')
    expect(workout).not.toContain('<select')
    expect(workout).not.toContain('session-selector')
    expect(workout).not.toContain('session-index')
    expect(css).not.toContain('.workout-session .session-index')
    expect(css).not.toContain('.session-selector')
    expect(css).toContain('.workout-session-nav > button{flex:1 1 0;width:auto}')
  })

  it('guards unlocked dismissal while preserving locked dialogs', () => {
    const modal = source('components/Modals.jsx')
    expect(modal).toContain("e.key === 'Escape' && !sheet.locked")
    expect(modal).toContain("!sheet.locked && <button type=\"button\" className=\"iconbtn modal-close\"")
    expect(modal).toContain('returnFocus.current.focus({ preventScroll: true })')
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

  it('keeps selective export dates accessible and limited to trained days', () => {
    const home = source('views/Home.jsx')
    const sheets = source('sheets.jsx')
    expect(home).toContain("onClick={() => workoutExportSheet()}")
    expect(home).toContain("aria-label={t('Export')}")
    expect(sheets).toContain('disabled={!available} aria-pressed={on}')
    expect(sheets).toContain("aria-label={t(on ? 'Deselect {0}' : 'Select {0}'")
    expect(sheets).toContain('disabled={!selected.size || busy}')
    expect(sheets).toContain('createWorkoutBackup(st, selected)')
  })

  it('announces the single mobile toast without changing its store behavior', () => {
    const toast = source('components/Toast.jsx')
    const css = source('index.css')
    expect(toast).toContain('role="status" aria-live="polite"')
    expect(css).toContain('max-width:calc(100% - 2 * var(--pad))')
    expect(css).toContain('overflow-wrap:anywhere')
  })

  it('keeps workout grids aligned and editable at narrow widths', () => {
    const css = source('index.css')
    const ui = source('components/ui.jsx')
    const workout = source('views/Workout.jsx')
    const sheets = source('sheets.jsx')
    expect(css).toContain('--set-grid-template')
    expect(css).toContain('minmax(0,1.35fr)')
    expect(css).toContain('.setgrid-scroll{width:100%;max-width:100%;overflow:visible}')
    const scrollRule = css.match(/\.setgrid-scroll\{[^}]*\}/)?.[0] || ''
    expect(scrollRule).not.toContain('overflow-x')
    expect(scrollRule).not.toContain('scrollbar')
    expect(css).toContain('.setrow.per-side,.sethead.per-side')
    expect(css).toContain('.setrow.per-side > .side-checks{display:contents}')
    expect(css).toContain('.setrow:not(.per-side) > .chk{grid-column:var(--set-check-col);justify-self:center}')
    expect(css).toContain('.sethead .eff-toggle')
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
    expect(css).toContain('.sethead.no-col2.timed,.setrow.no-col2.timed')
    expect(css).toContain('--set-go-col:3;--set-check-col:4')
    expect(css).not.toContain('min-width:340px')
    expect(css).not.toContain('min-width:386px')
    expect(css).not.toContain('minmax(104px')
    expect(css).not.toContain('minmax(120px')
    expect(css).toContain('@media (max-width:430px)')
    // single-row contract (user requirement): no ≤340px effort sub-row —
    // effort stays inline at every width, compact sizing owns the fit.
    expect(css).not.toContain('@media (max-width:340px)')
    expect(css).toContain('repeat(3,minmax(0,1fr)) minmax(36px,40px)')
    expect(css).toContain('font-size:clamp(12px,6.25vw - 8px,13px)')
    expect(css).toContain('scroll-margin-top')
    expect(workout).toContain('className="setgrid-scroll"')
    expect(workout).not.toContain('side-sp')
    // the delete string moved off the card into the options menu (sheets.jsx);
    // Workout.jsx only opens the menu and owns the confirm flow
    expect(workout).not.toContain("t('Remove exercise')")
    expect(workout).toContain('exerciseMenuSheet')
    expect(sheets).toContain("t('Delete exercise')")
    expect(workout).toContain('const [targetOpen, setTargetOpen] = useState(false)')
    expect(workout).toContain('const effortHeader = col3 && <span className="eff-sp">')
    expect(workout).toContain('const effortToggle = col3 && <span className="eff-info-sp">')
    expect(workout).toContain('{col3 ? effortToggle : <span className="ck-sp" />}')
    expect(workout).toContain('aria-expanded={targetAvailable ? targetOpen : false}')
    expect(workout).toContain('disabled={!targetAvailable}')
    expect(workout).toContain("t('No programmed target')")
    expect(workout).toContain('const effortInputProps = s =>')
    expect(workout).toContain('const target = setTarget(s)')
    expect(workout).toContain("placeholder: target ? fmtNum(target.value) : col3 ? '–' : undefined")
    expect(workout).toContain("className: target ? 'planned-effort-placeholder' : ''")
    expect(workout).toContain('effortInputProps(s)')
    expect(workout).toContain('aria-controls={targetAvailable ? targetRegionIds : undefined}')
    expect(workout).toContain('className="setrow-info"')
    expect(workout).toContain('hidden={!targetOpen}')
    expect(workout).toContain('role="region"')
    expect(workout).not.toContain('setinfo')
    expect(workout).not.toContain('onPointerDown')
    expect(sheets).toContain('onPointerDown')
    expect(sheets).toContain('setPointerCapture')
    expect(css).toContain('repeat(3,minmax(0,1fr))')
    // the reorder live region moved with the commit into the reorder sheet
    expect(workout).not.toContain('aria-live="polite"')
    expect(sheets).toContain('aria-live="polite"')
    expect(sheets).toContain('role="status"')
    expect(ui).toContain('parseNumberDraft')
    expect(ui).toContain('if (!result.valid) return')
    expect(ui).toContain('setDraft(raw)')
    expect(ui).toContain('nullable ? null : 0')
  })

  it('contains long shared selector labels and values without losing row affordances', () => {
    const css = source('index.css')
    const ui = source('components/ui.jsx')
    const stats = source('views/Stats.jsx')
    const routine = source('views/RoutineEdit.jsx')
    const sheets = source('sheets.jsx')
    expect(css).toContain('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')
    expect(css).toContain('flex:1 1 auto;min-width:0')
    expect(css).not.toContain('max-width:50%')
    expect(ui).toContain('{subtitle && <span className="lrow-s">{subtitle}</span>}')
    expect(ui).toContain("accessory === 'chevron'")
    expect(stats).toContain("<SelectRow className=\"exercise-progress-row\" title={t('Exercise')}")
    expect(routine).toContain("<SelectRow icon=\"chartLine\" title={t('Progression')}")
    expect(sheets).toContain("<SelectRow title={t('Rule')")
    expect(sheets).toContain("t('Follow the routine ({0})',")
  })

  it('keeps mobile workout summaries, dates, and exercise progress readable', () => {
    const css = source('index.css')
    const workout = source('views/Workout.jsx')
    const sheets = source('sheets.jsx')
    const stats = source('views/Stats.jsx')
    const ui = source('components/ui.jsx')
    expect(workout).not.toContain('history-date-control')
    expect(workout).not.toContain('type="date"')
    expect(sheets).toContain('className="exercise-summary small"')
    expect(sheets).toContain('className="exercise-summary-best"')
    expect(sheets).toContain('className="exercise-summary-last"')
    expect(sheets).toContain('className="exercise-summary-sets"')
    expect(sheets).toContain('className="exercise-summary-set"')
    expect(sheets).toContain('role="list"')
    expect(sheets).toContain('role="listitem"')
    expect(css).toContain('.exercise-summary-value{flex:none;white-space:nowrap}')
    expect(css).toContain('.exercise-summary-sets{display:flex;flex-wrap:wrap')
    expect(css).toContain('.exercise-summary-set{')
    expect(css).toContain('overflow-wrap:anywhere')
    expect(stats).toContain('className="card exercise-progress"')
    expect(stats).toContain('className="exercise-progress-row"')
    expect(ui).toContain('sheetTitle, className = \'\'')
    expect(ui).toContain('className={className} />')
    expect(css).toContain('.exercise-progress-row .lrow-m{flex:0 1 auto;max-width:42%;min-width:0}')
    expect(css).toContain('.exercise-progress-row .lrow-v{flex:1 1 0;min-width:0;white-space:normal')
  })

  it('keeps landmarks, focus, targets, and overlay clearance explicit', () => {
    const css = source('index.css')
    const workout = source('views/Workout.jsx')
    const sheets = source('sheets.jsx')
    expect(workout).toContain('<main')
    expect(workout).toContain('aria-labelledby={\'session-heading-\' + entry.sid}')
    expect(workout).toContain("aria-label={t('Exercise options')}")
    // reorder handles carry the keyboard contract now (arrows/Home/End on the
    // grip) with a polite live region announcing the new position
    expect(sheets).toContain("e.key === 'ArrowUp'")
    expect(sheets).toContain("e.key === 'ArrowDown'")
    expect(sheets).toContain('aria-live="polite"')
    const appRule = css.match(/#app\{([^}]*)\}/)?.[1] || ''
    const stickyRule = css.match(/\.workout-session \.workout-sticky-head\{([^}]*)\}/)?.[1] || ''
    const progressRule = css.match(/\.workout-session \.wprog\{([^}]*)\}/)?.[1] || ''
    expect(appRule).toContain('padding:calc(var(--sat) + 8px)')
    expect(stickyRule).toContain('position:sticky')
    expect(stickyRule).toContain('top:0')
    expect(stickyRule).toContain('z-index:20')
    expect(stickyRule).toContain('isolation:isolate')
    expect(stickyRule).toContain('background:var(--bg)')
    expect(stickyRule).toContain('margin-top:calc(-1 * var(--sat) - 8px)')
    expect(stickyRule).toContain('padding-top:calc(var(--sat) + 8px)')
    expect(stickyRule).toContain('transform:translateZ(0);backface-visibility:hidden;will-change:transform')
    expect(progressRule).not.toContain('position:sticky')
    expect(progressRule).not.toContain('top:var(--sat)')
    expect(progressRule).not.toContain('z-index:20')
    expect(progressRule).not.toContain('transform:translateZ(0)')
    expect(progressRule).not.toContain('backface-visibility:hidden')
    expect(progressRule).not.toContain('will-change:transform')
    expect(progressRule).not.toMatch(/(?:^|;)(?:position|top|right|bottom|left|z-index|transform|backface-visibility|will-change):/)
    expect(css).toContain('bottom:calc(96px + var(--sab))')
    expect(css).toContain('calc(100px + var(--sab))')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('min-width:44px;min-height:44px')
    expect(css).toContain('@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}')
  })

  it('keeps localized controls and non-runtime evidence contracts explicit', () => {
    const workout = source('views/Workout.jsx')
    const routine = source('views/RoutineEdit.jsx')
    const sheets = source('sheets.jsx')
    const spanish = source('locales/es.js')
    // card chevrons moved into the reorder sheet; the routine editor keeps the
    // Move up/down strings alive, the menu owns the new exercise strings
    expect(routine).toContain("t('Move up')")
    expect(routine).toContain("t('Move down')")
    expect(workout).toContain("t('Exercise options')")
    expect(sheets).toContain("t('Reorder exercises')")
    expect(workout).toContain("t('Discard')")
    expect(spanish).toContain("'Move up'")
    expect(spanish).toContain("'Move down'")
    expect(spanish).toContain("'Exercise options'")
    expect(spanish).toContain("'Edit exercise'")
    expect(spanish).toContain("'Exercise information'")
    expect(spanish).toContain("'Reorder exercises'")
    expect(spanish).toContain("'Reorder'")
    expect(spanish).toContain("'Discard'")
    expect(source('index.css')).toContain('@media (prefers-reduced-motion: reduce)')
    expect(workout).not.toContain('navigator.userAgent')
  })

  it('keeps passkey diagnostics in the console and localizes user-facing failures', () => {
    const settings = source('views/Settings.jsx')
    expect(settings).toContain("console.error('Passkey sign-in failed:', e)")
    expect(settings).toContain("toast(t('Sign-in failed'))")
    expect(settings).not.toContain("toast(e.message || t('Sign-in failed'))")
  })
})

describe('accent palette system (theme-palette-redesign)', () => {
  const css = source('index.css')
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
  const manifest = readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf8')

  // WCAG 2.x relative luminance (sRGB linearization) + contrast ratio.
  const srgb = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const lum = hex => {
    const n = parseInt(hex.slice(1), 16)
    return 0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255)
  }
  const ratio = (a, b) => {
    const x = lum(a), y = lum(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  // Raw declaration block of one pair×mode rule (dark = unthemed :root rule,
  // light = the higher-specificity [data-theme="light"] rule). The .pal-prev
  // selector appended to each rule shares the same block, so locks cover both.
  const ruleBody = (key, light) => {
    const sel = light
      ? `:root[data-theme="light"][data-accent="${key}"]`
      : `:root[data-accent="${key}"]`
    const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{([^}]*)\\}'))
    expect(m).toBeTruthy()
    return m[1]
  }
  const token = (body, name) => {
    const part = body.split(';').find(p => p.trim().startsWith(name + ':'))
    expect(part).toBeTruthy()
    return part.split(':').slice(1).join(':').trim()
  }
  const paletteBg = src => {
    // one nesting level: {"pair":{"dark":"…","light":"…"},…} — stops at the
    // matching close brace instead of running into later statements
    const m = src.match(/PALETTE_BG\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\})/)
    expect(m).toBeTruthy()
    return JSON.parse(m[1])
  }

  it('locks the 12 pair×mode full token tables', () => {
    // dark rules — --acc/--acc-2/--on-acc prefix byte-identical, then the full
    // 11-token visual system (bg/surface ramp + neutral labels/seps)
    expect(css).toContain(':root[data-accent="default"],.pal-prev[data-accent="default"]{--acc:#0A84FF;--acc-2:color-mix(in srgb,var(--acc) 82%,#000);--on-acc:#fff;--bg:#000000;--bg-el:#0e0e10;--surface:#1c1c1e;--surface-2:#2c2c2e;--surface-3:#3a3a3c;--label:#ffffff;--label-2:rgba(235,235,245,.60);--label-3:rgba(235,235,245,.32);--label-4:rgba(235,235,245,.18);--sep:rgba(84,84,88,.60);--sep-op:rgba(84,84,88,.34)}')
    expect(css).toContain(':root[data-accent="ultraviolet"],.pal-prev[data-accent="ultraviolet"]{--acc:#EAC66B;--acc-2:color-mix(in srgb,var(--acc) 82%,#000);--on-acc:#201800;--bg:#10163A;--bg-el:#151C48;--surface:#181F4B;--surface-2:#29326A;--surface-3:#36417E;--label:#ffffff;--label-2:rgba(235,235,245,.60);--label-3:rgba(235,235,245,.32);--label-4:rgba(235,235,245,.18);--sep:rgba(84,84,88,.60);--sep-op:rgba(84,84,88,.34)}')
    expect(css).toContain(':root[data-accent="dragonfruit"],.pal-prev[data-accent="dragonfruit"]{--acc:#6FD3A0;--acc-2:color-mix(in srgb,var(--acc) 82%,#000);--on-acc:#062316;--bg:#0C1F16;--bg-el:#10261B;--surface:#10271D;--surface-2:#204C37;--surface-3:#2B6347;--label:#ffffff;--label-2:rgba(235,235,245,.60);--label-3:rgba(235,235,245,.32);--label-4:rgba(235,235,245,.18);--sep:rgba(84,84,88,.60);--sep-op:rgba(84,84,88,.34)}')
    expect(css).toContain(':root[data-accent="ghost"],.pal-prev[data-accent="ghost"]{--acc:#D7F338;--acc-2:color-mix(in srgb,var(--acc) 82%,#000);--on-acc:#1A2E05;--bg:#1A1E0C;--bg-el:#202411;--surface:#202513;--surface-2:#404A25;--surface-3:#525E31;--label:#ffffff;--label-2:rgba(235,235,245,.60);--label-3:rgba(235,235,245,.32);--label-4:rgba(235,235,245,.18);--sep:rgba(84,84,88,.60);--sep-op:rgba(84,84,88,.34)}')
    expect(css).toContain(':root[data-accent="cobalt"],.pal-prev[data-accent="cobalt"]{--acc:#F07FC4;--acc-2:color-mix(in srgb,var(--acc) 82%,#000);--on-acc:#3A0A1E;--bg:#241016;--bg-el:#2E1520;--surface:#371A28;--surface-2:#522639;--surface-3:#6B3349;--label:#ffffff;--label-2:rgba(235,235,245,.60);--label-3:rgba(235,235,245,.32);--label-4:rgba(235,235,245,.18);--sep:rgba(84,84,88,.60);--sep-op:rgba(84,84,88,.34)}')
    expect(css).toContain(':root[data-accent="ember"],.pal-prev[data-accent="ember"]{--acc:#F2A18E;--acc-2:color-mix(in srgb,var(--acc) 82%,#000);--on-acc:#3A0D04;--bg:#2E1510;--bg-el:#382016;--surface:#3A1A13;--surface-2:#5F2E22;--surface-3:#77402E;--label:#ffffff;--label-2:rgba(235,235,245,.60);--label-3:rgba(235,235,245,.32);--label-4:rgba(235,235,245,.18);--sep:rgba(84,84,88,.60);--sep-op:rgba(84,84,88,.34)}')
    // light rules — dragonfruit/ghost invert roles, ember keeps black ink
    expect(css).toContain(':root[data-theme="light"][data-accent="default"],.pal-prev[data-accent="default"][data-theme="light"]{--acc:#007AFF;--acc-2:color-mix(in srgb,var(--acc) 82%,#000);--on-acc:#fff;--bg:#ffffff;--bg-el:#f7f7f8;--surface:#f7f7f8;--surface-2:#ececef;--surface-3:#e3e3e8;--label:#000000;--label-2:rgba(60,60,67,.80);--label-3:rgba(60,60,67,.77);--label-4:rgba(60,60,67,.16);--sep:rgba(60,60,67,.29);--sep-op:rgba(60,60,67,.20)}')
    expect(css).toContain(':root[data-theme="light"][data-accent="ultraviolet"],.pal-prev[data-accent="ultraviolet"][data-theme="light"]{--acc:#8A5A00;--acc-2:color-mix(in srgb,var(--acc) 82%,#000);--on-acc:#fff;--bg:#E4E7FA;--bg-el:#EFF1FD;--surface:#F2F4FD;--surface-2:#D8DCF4;--surface-3:#C2C8EA;--label:#000000;--label-2:rgba(60,60,67,.80);--label-3:rgba(60,60,67,.77);--label-4:rgba(60,60,67,.16);--sep:rgba(60,60,67,.29);--sep-op:rgba(60,60,67,.20)}')
    expect(css).toContain(':root[data-theme="light"][data-accent="dragonfruit"],.pal-prev[data-accent="dragonfruit"][data-theme="light"]{--acc:#0E6B3C;--acc-2:color-mix(in srgb,var(--acc) 82%,#000);--on-acc:#fff;--bg:#DCEFE2;--bg-el:#EAF6EE;--surface:#EFF8F2;--surface-2:#CFE5D5;--surface-3:#B8D8C0;--label:#000000;--label-2:rgba(60,60,67,.80);--label-3:rgba(60,60,67,.77);--label-4:rgba(60,60,67,.16);--sep:rgba(60,60,67,.29);--sep-op:rgba(60,60,67,.20)}')
    expect(css).toContain(':root[data-theme="light"][data-accent="ghost"],.pal-prev[data-accent="ghost"][data-theme="light"]{--acc:#4D7C0F;--acc-2:color-mix(in srgb,var(--acc) 82%,#000);--on-acc:#fff;--bg:#E2E6CF;--bg-el:#EFF2E2;--surface:#F2F5E7;--surface-2:#D6DCBC;--surface-3:#C2C9A4;--label:#000000;--label-2:rgba(60,60,67,.80);--label-3:rgba(60,60,67,.77);--label-4:rgba(60,60,67,.16);--sep:rgba(60,60,67,.29);--sep-op:rgba(60,60,67,.20)}')
    expect(css).toContain(':root[data-theme="light"][data-accent="cobalt"],.pal-prev[data-accent="cobalt"][data-theme="light"]{--acc:#B4128F;--acc-2:color-mix(in srgb,var(--acc) 82%,#000);--on-acc:#fff;--bg:#FBE4EF;--bg-el:#FDF0F6;--surface:#FDF2F7;--surface-2:#F3C9DD;--surface-3:#E9A9C7;--label:#000000;--label-2:rgba(60,60,67,.80);--label-3:rgba(60,60,67,.77);--label-4:rgba(60,60,67,.16);--sep:rgba(60,60,67,.29);--sep-op:rgba(60,60,67,.20)}')
    expect(css).toContain(':root[data-theme="light"][data-accent="ember"],.pal-prev[data-accent="ember"][data-theme="light"]{--acc:#A31621;--acc-2:color-mix(in srgb,var(--acc) 82%,#000);--on-acc:#fff;--bg:#F5E1C6;--bg-el:#F9EBD9;--surface:#F8E8D4;--surface-2:#EAD0A8;--surface-3:#DCBE96;--label:#000000;--label-2:rgba(60,60,67,.80);--label-3:rgba(60,60,67,.77);--label-4:rgba(60,60,67,.16);--sep:rgba(60,60,67,.29);--sep-op:rgba(60,60,67,.20)}')
    // icon-ink override scope — exactly the two combos failing 3:1 on bare surfaces
    // (sakura pink clears 6.37 dark / 4.15+ light, so cobalt left this scope)
    expect(css).toContain('[data-theme="dark"][data-accent="ultraviolet"]')
    expect(css).not.toContain('[data-accent="cobalt"] :is(.acc-ink')
    expect(css).toContain('[data-theme="light"][data-accent="ember"]')
    expect(css).not.toContain('[data-theme="light"][data-accent="ultraviolet"] :is(.acc-ink')
    expect(css).not.toContain('[data-theme="dark"][data-accent="ember"] :is(.acc-ink')
    // preview dots resolve purely from tokens — no hard-coded ink in the dot CSS
    expect(css).toContain('.pal-prev .d-bg{background:var(--bg)}')
    expect(css).toContain('.pal-prev .d-sf{background:var(--surface)}')
    expect(css).toContain('.pal-prev .d-tx{background:var(--label)}')
    expect(css).toContain('.pal-prev .d-ac{background:var(--acc)}')
  })

  it('keeps body contrast ≥4.5:1 inside the measured luminance windows', () => {
    for (const key of Object.keys(ACCENTS)) {
      const dark = ruleBody(key, false)
      const dbg = token(dark, '--bg'), dsf = token(dark, '--surface')
      expect(lum(dbg)).toBeLessThanOrEqual(0.016)
      expect(lum(dsf)).toBeLessThanOrEqual(0.020)
      expect(ratio('#ffffff', dbg)).toBeGreaterThanOrEqual(4.5)
      expect(ratio('#ffffff', dsf)).toBeGreaterThanOrEqual(4.5)
      const light = ruleBody(key, true)
      const lbg = token(light, '--bg'), lsf = token(light, '--surface')
      expect(lum(lbg)).toBeGreaterThanOrEqual(0.70)
      expect(ratio('#000000', lbg)).toBeGreaterThanOrEqual(4.5)
      expect(ratio('#000000', lsf)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the CSS↔html↔App palette bg map in sync', () => {
    const app = readFileSync(resolve(process.cwd(), 'src', 'App.jsx'), 'utf8')
    const fromHtml = paletteBg(html)
    expect(paletteBg(app)).toEqual(fromHtml)
    expect(Object.keys(fromHtml).sort()).toEqual(Object.keys(ACCENTS).sort())
    for (const key of Object.keys(ACCENTS)) {
      expect(token(ruleBody(key, false), '--bg').toLowerCase()).toBe(fromHtml[key].dark.toLowerCase())
      expect(token(ruleBody(key, true), '--bg').toLowerCase()).toBe(fromHtml[key].light.toLowerCase())
    }
  })

  it('keeps status colors legible on every tinted background (split gate)', () => {
    // fixed status hues are never re-tinted per palette; knob/modal tokens stay out too
    for (const key of Object.keys(ACCENTS)) {
      for (const light of [false, true]) {
        const body = ruleBody(key, light)
        expect(body).not.toMatch(/--(red|yellow|orange|green)\s*:/)
        expect(body).not.toContain('--knob')
      }
    }
    // dark: all four fixed status HEXes clear 4.5:1 on --bg AND --surface
    const darkStatus = { red: '#ff453a', yellow: '#ffd60a', orange: '#ff9f0a', green: '#30d158' }
    for (const key of Object.keys(ACCENTS)) {
      const bg = token(ruleBody(key, false), '--bg')
      const sf = token(ruleBody(key, false), '--surface')
      for (const hex of Object.values(darkStatus)) {
        expect(ratio(hex, bg)).toBeGreaterThanOrEqual(4.5)
        expect(ratio(hex, sf)).toBeGreaterThanOrEqual(4.5)
      }
    }
    // light: absolute 4.5:1 is impossible (neutral #f2f2f7 itself scores 1.35-3.18),
    // so red danger text must clear an absolute ≥2.6 floor on --bg while every
    // status holds ≥0.84× its neutral baseline (no tint may regress legibility
    // beyond the clarito budget), and black chip ink on every fixed status must
    // clear 4.5:1. WAIVER (user-approved 2026-09-16): danger text lives on
    // near-white --surface at 3.20+ regardless of bg tint, so the bg ratio is
    // advisory — the old ≥3.0 floor is relaxed to ≥2.6, and the parity gate from
    // 0.95× to 0.84× because WCAG parity is luminance-only
    // ((Lbg+0.05)/0.941): the five premium lights are saturated papers, so all
    // sit at parity 0.87-0.93× (measured 0.909/0.929/0.927/0.880/0.874 on
    // ultraviolet/dragonfruit/cobalt/ember/ghost; classic white
    // default sits above parity at 1.12 — white can only raise light-status
    // ratios vs #f2f2f7). Yellow/orange/
    // green cannot take the absolute floor — they sit 1.35/1.97/1.99 on plain
    // #f2f2f7 itself, so parity is their gate and the relaxed ≥2.6 rule binds
    // red only (measured 2.78-2.95 on the five premium light bgs;
    // classic white default measures 3.55).
    const lightStatus = { red: '#ff3b30', yellow: '#ffcc00', orange: '#ff9500', green: '#34c759' }
    const neutral = '#f2f2f7'
    for (const key of Object.keys(ACCENTS)) {
      const bg = token(ruleBody(key, true), '--bg')
      expect(ratio(lightStatus.red, bg)).toBeGreaterThanOrEqual(2.6)
      // classic white default clears 3.0+ outright (measured 3.547 on #ffffff)
      if (key === 'default') expect(ratio(lightStatus.red, bg)).toBeGreaterThanOrEqual(3.5)
      for (const hex of Object.values(lightStatus)) {
        expect(ratio(hex, bg)).toBeGreaterThanOrEqual(0.84 * ratio(hex, neutral))
        expect(ratio('#000000', hex)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('removes the legacy 8-key accent rules and overrides', () => {
    for (const key of ['lime', 'sky', 'orange', 'violet', 'pink', 'red', 'teal', 'gold']) {
      expect(css).not.toContain(`data-accent="${key}"`)
    }
  })

  it('keeps every registry hex present in the CSS rule table', () => {
    for (const p of Object.values(ACCENTS)) {
      expect(css).toContain(p.a)
      expect(css).toContain(p.b)
    }
  })

  it('keeps the pre-paint migration map in sync with ACCENT_MIGRATION', () => {
    const app = source('App.jsx')
    expect(html).toContain('html,body{background:var(--boot-bg,#ffffff)}')
    expect(html).toContain("document.documentElement.style.setProperty('--boot-bg', bg)")
    expect(html).not.toContain('html[data-theme="dark"] body{background:#000000}')
    expect(app).toContain("de.style.setProperty('--boot-bg', bg)")
    const map = html.match(/var MIGRATE\s*=\s*(\{[^}]+\})/)
    expect(map).toBeTruthy()
    expect(JSON.parse(map[1].replace(/'/g, '"'))).toEqual(ACCENT_MIGRATION)
    const daccMap = html.match(/var DACC_MIGRATE\s*=\s*(\{[^}]+\})/)
    expect(daccMap).toBeTruthy()
    expect(JSON.parse(daccMap[1].replace(/'/g, '"'))).toEqual(DEFAULT_ACCENT_MIGRATION)
    expect(html).toContain("var KNOWN_DACC = ['blue','teal','emerald','yellow','red','lilac']")
    expect(html).toContain("localStorage.getItem('gym_state_v1')")
    expect(html).toContain("st.theme === 'light' || st.theme === 'dark'")
    expect(html).toContain("Object.prototype.hasOwnProperty.call(MIGRATE, rawAccent)")
    expect(html).toContain("Object.prototype.hasOwnProperty.call(DACC_MIGRATE, rawDacc)")
    expect(html).toContain("document.documentElement.dataset.theme = 'light'")
    expect(html).toContain("document.documentElement.dataset.accent = 'default'")
    expect(html).toContain("? MIGRATE[rawAccent] : 'default'")
    expect(html).toContain("? DACC_MIGRATE[rawDacc] : 'blue'")
    expect(html).toContain("|| PALETTE_BG.default.light")
    expect(html).toContain('<meta name="theme-color" content="#ffffff">')
    expect(html).toContain('splash-light.svg')
    expect(html).toContain('splash-dark.svg')
    expect(html).not.toContain('<g fill="#050505">')
    expect(manifest).toContain('"background_color": "#ffffff"')
    expect(manifest).toContain('"theme_color": "#ffffff"')
  })

  it('resolves legacy and unknown stored accents', () => {
    expect(ACCENT_MIGRATION).toEqual({ lime: 'ultraviolet', sky: 'cobalt', orange: 'ember', violet: 'ultraviolet', pink: 'dragonfruit', red: 'dragonfruit', teal: 'cobalt', gold: 'ember' })
    expect(resolveAccent('pink')).toBe('dragonfruit')
    expect(resolveAccent('lime')).toBe('ultraviolet')
    expect(resolveAccent('magenta')).toBe('default')
    expect(resolveAccent('ember')).toBe('ember')
  })

  it('keeps the store defaults light and on the default palette', () => {
    const store = source('store/useStore.js')
    expect(store).toContain("theme: 'light', accent: 'default'")
  })

  it('keeps the default-neutral sub-accents at ≥4.5:1 with fixed neutral shells', () => {
    // Raw declaration block of one default+sub-accent override rule.
    const daccBody = (key, light) => {
      const sel = light
        ? `:root[data-theme="light"][data-accent="default"][data-default-accent="${key}"]`
        : `:root[data-accent="default"][data-default-accent="${key}"]`
      const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{([^}]*)\\}'))
      expect(m).toBeTruthy()
      return m[1]
    }
    expect(Object.keys(DEFAULT_ACCENTS).sort()).toEqual(['blue', 'emerald', 'lilac', 'red', 'teal', 'yellow'])
    for (const key of ['orange', 'rose']) {
      expect(css).not.toContain(`data-default-accent="${key}"`)
    }
    // CSS uses #fff shorthand for white registry hexes — expand before comparing.
    const normHex = h => {
      const m = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(h)
      return (m ? '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3] : h).toLowerCase()
    }
    const cssHas = hex => css.toLowerCase().includes(hex.toLowerCase()) || css.toLowerCase().includes(normHex(hex))
    for (const [key, c] of Object.entries(DEFAULT_ACCENTS)) {
      // every registry hex lands in the CSS override table
      expect(cssHas(c.light)).toBe(true)
      expect(cssHas(c.dark)).toBe(true)
      expect(cssHas(c.onLight)).toBe(true)
      expect(cssHas(c.onDark)).toBe(true)
      // each pair clears 4.5:1 in both modes (Red-light included at 5.74, Yellow-light
      // amber-graded at 5.02 — pure yellow on white cannot pass, so this is amber by design)
      expect(ratio(c.light, c.onLight)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(c.dark, c.onDark)).toBeGreaterThanOrEqual(4.5)
      for (const light of [false, true]) {
        const body = daccBody(key, light)
        expect(normHex(token(body, '--acc'))).toBe(normHex(light ? c.light : c.dark))
        expect(normHex(token(body, '--on-acc'))).toBe(normHex(light ? c.onLight : c.onDark))
        // the sub-row ONLY rewrites accent roles — the neutral Default shell
        // (bg/surfaces/labels/seps) is never redeclared here, so PALETTE_BG
        // keeps one bg per mode for every sub-accent
        for (const name of ['--bg', '--bg-el', '--surface', '--surface-2', '--surface-3', '--label', '--label-2', '--label-3', '--label-4', '--sep', '--sep-op']) {
          expect(body.split(';').find(p => p.trim().startsWith(name + ':'))).toBeFalsy()
        }
      }
    }
  })

  it('resolves the default sub-accent without touching palette plumbing', () => {
    expect(resolveDefaultAccent('teal')).toBe('teal')
    expect(resolveDefaultAccent('red')).toBe('red')
    expect(DEFAULT_ACCENT_MIGRATION).toEqual({ orange: 'yellow', rose: 'red' })
    expect(resolveDefaultAccent('orange')).toBe('yellow')
    expect(resolveDefaultAccent('rose')).toBe('red')
    expect(resolveDefaultAccent('magenta')).toBe('blue')
    expect(resolveDefaultAccent(undefined)).toBe('blue')
    // the sub-accent namespace never consults the unrelated 8→6 palette migration
    expect(resolveDefaultAccent('lime')).toBe('blue')
    const store = source('store/useStore.js')
    expect(store).toContain("defaultAccent: 'blue'")
    expect(store).toContain('next.defaultAccent = resolveDefaultAccent(next.defaultAccent)')
    const app = source('App.jsx')
    expect(app).toContain('de.dataset.defaultAccent = resolveDefaultAccent(defaultAccent)')
    expect(app).toContain('applyPrefs(S.theme, S.accent, S.defaultAccent)')
    expect(html).toContain('document.documentElement.dataset.defaultAccent = dacc')
    expect(html).toContain("document.documentElement.dataset.defaultAccent = 'blue'")
    const settings = source('views/Settings.jsx')
    expect(settings).toContain("if (resolveAccent(S.accent) !== 'default') return null")
    expect(settings).toContain('<DefaultAccentSubRow S={S} update={update} />')
    expect(settings).toContain("const DEFAULT_ACCENT_ORDER = ['blue', 'teal', 'emerald', 'yellow', 'red', 'lilac']")
    expect(settings).toContain("const DEFAULT_ACCENT_LABEL = { blue: 'Blue', teal: 'Cyan', emerald: 'Green', yellow: 'Yellow', red: 'Red', lilac: 'Purple' }")
    expect(settings).toContain('aria-pressed={on}')
    // quarantine: series on the dedicated token, grid/labels/goal unchanged
    const chart = source('components/LineChart.jsx')
    expect(chart).toContain("color = 'var(--chart-series)'")
    expect(chart).toContain('stroke="var(--sep-op)"')
    expect(chart).toContain('fill="var(--label-2)"')
    expect(chart).toContain('stroke="var(--yellow)"')
    expect(css).toContain('--chart-series:#79AFFF')
    expect(css).toContain('--chart-series:#0B69E3')
    // quarantine: fixed skin ramp per mode, heat still on the accent scale
    expect(css).toContain('--bm-base:#2e3138')
    expect(css).toContain('--bm-base:#d9d9de')
    expect(css).toContain('.bm-sil{fill:var(--bm-sil)}')
    expect(css).toContain('.bm-m.l4{fill:var(--acc)}')
  })
})
