import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(process.cwd(), 'src/components/Home1RM.jsx'), 'utf8')
const home = readFileSync(resolve(process.cwd(), 'src/views/Home.jsx'), 'utf8')
const settings = readFileSync(resolve(process.cwd(), 'src/views/Settings.jsx'), 'utf8')

describe('Home1RM source contracts', () => {
  it('renders collapsed by default with an expandable headline', () => {
    expect(src).toContain('useState(false)')
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