import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let values

const setNavigator = value =>
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })

function fakeBrowser() {
  values = new Map()
  globalThis.window = {}
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    },
  })
  setNavigator({ languages: ['en-US'], language: 'en-US' })
}

beforeEach(() => { fakeBrowser(); vi.resetModules() })
afterEach(() => { delete globalThis.localStorage; delete globalThis.navigator; delete globalThis.window })

describe('language matching', () => {
  it('normalizes regional and underscore-separated language tags', async () => {
    const { normalizeLang } = await import('./i18n.js')
    expect(normalizeLang('es-MX')).toBe('es')
    expect(normalizeLang('ES_mx')).toBe('es')
    expect(normalizeLang('en-US')).toBe('en')
    expect(normalizeLang('nl-NL')).toBeNull()
  })

  it('rejects removed legacy languages', async () => {
    const { normalizeLang } = await import('./i18n.js')
    for (const legacy of ['de', 'de-DE', 'fr', 'pt-BR', 'it', 'zh-TW', 'ko', 'hi', 'pl', 'tr', 'ru']) {
      expect(normalizeLang(legacy)).toBeNull()
    }
  })
})

describe('initial language selection', () => {
  it('prefers an explicit app choice over profile state and browser language', async () => {
    values.set('gym_lang_v1', 'en')
    values.set('gym_state_v1', JSON.stringify({ lang: 'es' }))
    setNavigator({ languages: ['es-ES'], language: 'es-ES' })
    const { getInitialLang, getLang } = await import('./i18n.js')
    expect(getInitialLang()).toBe('en')
    expect(getLang()).toBe('en')
  })

  it('ignores stale removed-language prefs and falls through to profile, then Spanish', async () => {
    values.set('gym_lang_v1', 'de')
    values.set('gym_state_v1', JSON.stringify({ lang: 'es' }))
    const { getInitialLang } = await import('./i18n.js')
    expect(getInitialLang()).toBe('es')
    values.delete('gym_state_v1')
    expect(getInitialLang()).toBe('es')
  })

  it('uses a legacy persisted profile language before the Spanish default', async () => {
    values.set('gym_state_v1', JSON.stringify({ lang: 'es' }))
    const { getInitialLang } = await import('./i18n.js')
    expect(getInitialLang()).toBe('es')
  })

  it('defaults new users to Spanish without explicit or profile language', async () => {
    setNavigator({ languages: ['en-US'], language: 'en-US' })
    const { getInitialLang } = await import('./i18n.js')
    expect(getInitialLang()).toBe('es')
  })

  it('persists normalized explicit choices independently of profile state', async () => {
    const { getExplicitLang, saveLangPreference } = await import('./i18n.js')
    expect(saveLangPreference('es-ES')).toBe('es')
    expect(getExplicitLang()).toBe('es')
    expect(values.get('gym_lang_v1')).toBe('es')
    expect(saveLangPreference('de')).toBe('en')
    expect(values.get('gym_lang_v1')).toBe('en')
  })
})

describe('Spanish translation and instruction contracts', () => {
  it('looks up Spanish values and interpolates source-key arguments', async () => {
    const { setLang, t } = await import('./i18n.js')
    await setLang('es')
    expect(t('Start {0}', 'Push Day')).toBe('Empezar Push Day')
    expect(t('Exercise')).toBe('Ejercicio')
    expect(t('Exercise note')).toBe('Nota del ejercicio')
    expect(t('Workout note')).toBe('Nota del entrenamiento')
    expect(t('Only this completed history record will change. Saved routines and your active workout are untouched.'))
      .toBe('Solo cambiará este registro completado del historial. Las rutinas guardadas y tu entrenamiento activo no se modificarán.')
    expect(t('a key absent from every locale')).toBe('a key absent from every locale')
  })

  it('localizes unilateral markers and accessible side names without changing side keys', async () => {
    const { setLang, sideLabel } = await import('./i18n.js')
    expect(sideLabel('left', 'en')).toEqual({ marker: 'L', name: 'Left' })
    expect(sideLabel('right', 'fr')).toEqual({ marker: 'R', name: 'Right' })
    await setLang('es')
    expect(sideLabel('left')).toEqual({ marker: 'I', name: 'Izquierda' })
    expect(sideLabel('right')).toEqual({ marker: 'D', name: 'Derecha' })
    expect(sideLabel('unknown', 'es')).toEqual({ marker: '', name: '' })
  })

  it('formats decimal set counts with the active locale', async () => {
    const { setLang, t } = await import('./i18n.js')
    const { fmtNum } = await import('./format.js')
    await setLang('es')
    expect(t('{0} sets', fmtNum(49.8))).toBe('49,8 series')
  })

  it('keeps generated Spanish instructions and intentional English fallback behavior', async () => {
    const { setLang, instrFor } = await import('./i18n.js')
    const exercise = { id: '4F5866F8', st: ['Stand up and move.'] }
    const legacyProductionIds = ['0007', '1436', '1435', '0175', '0184', '1323', '0241', '0311', '0410', '0582', '0584', '1349', '0739']
    await setLang('es')
    expect(instrFor(exercise)[0]).toBe('Colócate en una máquina de extensión lumbar. Apoya las caderas y los muslos contra el acolchado y bloquea los tobillos en el soporte para los pies.')
    for (const id of legacyProductionIds) expect(instrFor({ id, st: ['English fallback'] }), id).not.toEqual(['English fallback'])
    await setLang('de')
    expect(instrFor(exercise)).toEqual(exercise.st)
    await setLang('es')
    expect(instrFor({ id: 'E23F1F2B', st: [] })).toEqual([])
  })
})

describe('source completeness guard', () => {
  it('reports the missing source key with an actionable file and line', async () => {
    const { findMissingSourceKeys } = await import('../../scripts/check-locales.mjs')
    const issues = findMissingSourceKeys("const x = t('Missing source key')", new Set(), 'Fixture.jsx')
    expect(issues).toEqual([{ key: 'Missing source key', file: 'Fixture.jsx', line: 1 }])
  })

  it('does not classify documented unit or brand literals as raw accessibility UI', async () => {
    const { findRawAccessibilityLiterals } = await import('../../scripts/check-locales.mjs')
    const issues = findRawAccessibilityLiterals('<button aria-label="L" title="Hforge" />', new Set(), 'Fixture.jsx')
    expect(issues).toEqual([])
  })
})
