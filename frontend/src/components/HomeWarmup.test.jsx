import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(process.cwd(), 'src/components/HomeWarmup.jsx'), 'utf8')
const home = readFileSync(resolve(process.cwd(), 'src/views/Home.jsx'), 'utf8')
const settings = readFileSync(resolve(process.cwd(), 'src/views/Settings.jsx'), 'utf8')

describe('HomeWarmup source contracts', () => {
  it('renders collapsed by default with an expandable headline', () => {
    expect(src).toContain('useState(false)')
    expect(src).toContain('aria-expanded={open}')
    expect(src).toContain('aria-controls="homewarmup-body"')
    expect(src).toContain('id="homewarmup-body"')
    expect(src).toContain('hidden={!open}')
    expect(src).toContain("open ? 'chevronUp' : 'chevronDown'")
  })

  it('titles the card as a warmup calculator with a dumbbell headline', () => {
    expect(src).toContain("t('Warmup calculator')")
    expect(src).toContain('name="dumbbell"')
  })

  it('picks the lift from a full-width exercise selector', () => {
    expect(src).toContain('SelectRow')
    expect(src).toContain("t('Exercise')")
    expect(src).toContain('WARMUP_OPTIONS')
    expect(src).toContain("bench: 'Bench press'")
    expect(src).toContain("squat: 'Squat'")
    expect(src).toContain("deadlift: 'Deadlift'")
    expect(src).toContain("ohp: 'Overhead press'")
    expect(src).toContain("pullup: 'Pull-ups'")
    expect(src).toContain("dip: 'Dips'")
  })

  it('steps weight by 2.5 and reps by 1 with a small Calcular button', () => {
    expect(src).toContain('step={2.5}')
    expect(src).toContain('step={1}')
    expect(src).toContain('decimal={false}')
    expect(src).toContain('size="sm"')
    expect(src).toContain("t('Calcular')")
  })

  it('asks for added weight instead of bar weight on bodyweight lifts', () => {
    expect(src).toContain("t('Added weight ({0})'")
    expect(src).toContain('isBodyweightKind')
    expect(src).toContain('addedKg')
  })

  it('lays the steppers out in one grid row with a full-width Calcular button', () => {
    expect(src).toContain('homewarmup-grid')
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

  it('delegates the ladder to buildWarmup and renders sets, rests and the main set', () => {
    expect(src).toContain('buildWarmup')
    expect(src).toContain("t('Warmup sets')")
    expect(src).toContain("t('Rest {0}s'")
    expect(src).toContain("t('Main set')")
    expect(src).toContain("t('Save your strength for the top set.')")
    expect(src).toContain("t('No warmup needed")
  })

  it('wires the Home gate and the Settings toggle plus the configure sheet', () => {
    expect(home).toContain('S.homeWarmupCardEnabled !== false')
    expect(home).toContain('<HomeWarmup />')
    expect(settings).toContain("t('Show warmup calculator')")
    expect(settings).toContain('S.homeWarmupCardEnabled !== false')
    expect(settings).toContain('s.homeWarmupCardEnabled = !!v')
    expect(settings).toContain("t('Configure warmup')")
    expect(settings).toContain('WarmupSettingsForm')
    expect(settings).toContain("kind: 'sheet'")
  })

  it('configures experience, bar, rounding, pace and deadlift mode in one sheet', () => {
    expect(src).toContain('WarmupSettingsForm')
    expect(src).toContain("t('Experience')")
    expect(src).toContain("t('Beginner')")
    expect(src).toContain("t('Intermediate')")
    expect(src).toContain("t('Advanced')")
    expect(src).toContain("t('Bar weight')")
    expect(src).toContain("t('Rounding')")
    expect(src).toContain("t('Pace')")
    expect(src).toContain("t('Conservative')")
    expect(src).toContain("t('Aggressive')")
    expect(src).toContain("t('Deadlift mode')")
    expect(src).toContain("t('With reps')")
    expect(src).toContain("t('Singles')")
    expect(src).toContain('s.warmupConfig')
  })
})
