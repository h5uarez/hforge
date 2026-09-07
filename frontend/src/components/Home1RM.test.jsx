import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(process.cwd(), 'src/components/Home1RM.jsx'), 'utf8')
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
const home = readFileSync(resolve(process.cwd(), 'src/views/Home.jsx'), 'utf8')
const settings = readFileSync(resolve(process.cwd(), 'src/views/Settings.jsx'), 'utf8')

describe('Home1RM source contracts', () => {
  it('renders collapsed by default with an expandable headline', () => {
    expect(src).toContain('open: false')
    expect(src).toContain('useState(initial.open)')
    expect(src).toContain('aria-expanded={open}')
    expect(src).toContain('aria-controls="home1rm-body"')
    expect(src).toContain('id="home1rm-body"')
    expect(src).toContain('hidden={!open}')
    expect(src).toContain("open ? 'chevronUp' : 'chevronDown'")
  })

  it('steps weight by 2.5 and reps by 1 with a small Calcular button', () => {
    expect(src).toContain('step={2.5}')
    expect(src).toContain('step={1}')
    expect(src).toContain('decimal={false}')
    expect(src).toContain('size="sm"')
    expect(src).toContain("t('Calcular')")
    expect(src).toContain('≈ {fmtNum(res.est)}')
  })

  it('lays weight, reps and effort out in one grid row with a full-width Calcular button', () => {
    expect(src).toContain('home1rm-grid')
    expect(src).toContain("display: 'grid'")
    expect(src).toContain('repeat(3')
    expect(src).toContain("width: '100%'")
    expect(src).toContain("t(kind === 'rpe' ? 'RPE' : 'RIR')")
  })

  it('keeps the effort stepper conditional on the profile effort mode', () => {
    expect(src).toContain('effortOf(S)')
    expect(src).toContain('showEffort &&')
    expect(src).toContain('rirOf')
    expect(src).toContain('toScale')
    expect(src).toContain('step={0.5}')
  })

  it('shows confidence tiers and a static caveat line', () => {
    expect(src).toContain("'HIGH'")
    expect(src).toContain("'MEDIUM'")
    expect(src).toContain("'unreliable'")
    expect(src).toContain('failureAssumed')
    expect(src).toContain('isolation lifts vary more')
  })

  it('places the conditional info control beside the calculated result', () => {
    expect(src).toContain("useUI(s => s.openSheet)")
    expect(src).toContain("{ kind: 'center' }")
    expect(src).toContain('home1rm-result')
    expect(src).toContain('home1rm-info')
    expect(src).toContain("name=\"info\"")
    expect(src).toContain("t('Show estimated 1RM table')")
    expect(src).toContain('disabled={!res}')
    expect(src).toContain('if (!res) return')
    expect(src.indexOf('home1rm-info')).toBeGreaterThan(src.indexOf('home1rm-result'))
    expect(src).not.toContain('home1rm-head')
    expect(css).toContain('width:44px;height:44px')
    expect(css).toContain('.home1rm-result-value{flex:1;min-width:0;flex-wrap:wrap}')
    expect(src).toContain('aria-controls="home1rm-body"')
  })

  it('hydrates and persists the draft outside the server-synced store', () => {
    expect(src).toContain('HOME_1RM_STORAGE_KEY')
    expect(src).toContain('loadCalculatorState')
    expect(src).toContain('saveCalculatorState')
    expect(src).toContain('sanitizeHome1RMState')
    expect(src).toContain('useEffect(() =>')
  })

  it('renders the current source context, translated empty state, and four-column RM table', () => {
    expect(src).toContain('OneRMTableDialog')
    expect(src).toContain("t('Weight ({0})', unit)")
    expect(src).toContain("t('Estimated 1RM')")
    expect(src).toContain("t('Enter a valid weight and reps.')")
    expect(src).toContain('onerm-rm-table')
    expect(src).toContain('estimateRMTable')
    expect(css).toContain('.onerm-rm-table')
    expect(css).toContain('table-layout:fixed')
    expect(css).toContain('width:25%')
    expect(css).toContain('var(--surface-2)')
  })

  it('guards the no-selector override: no exercise-group tokens anywhere', () => {
    expect(src).not.toContain('DL')
    expect(src).not.toContain('Biceps')
    expect(src).not.toContain('group')
    expect(src).not.toContain('SQ')
  })

  it('wires the Home gate and the Settings toggle', () => {
    expect(home).toContain('S.home1rmCardEnabled !== false')
    expect(home).toContain('<Home1RM />')
    expect(settings).toContain("t('Show 1RM calculator')")
    expect(settings).toContain('S.home1rmCardEnabled !== false')
    expect(settings).toContain('s.home1rmCardEnabled = !!v')
  })
})
