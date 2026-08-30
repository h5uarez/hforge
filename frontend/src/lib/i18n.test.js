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
  it('normalizes regional and underscore-separated browser tags', async () => {
    const { normalizeLang } = await import('./i18n.js')
    expect(normalizeLang('es-MX')).toBe('es')
    expect(normalizeLang('ZH_hant_TW')).toBe('zh')
    expect(normalizeLang('nl-NL')).toBeNull()
  })

  it('uses the first supported language in the browser preference order', async () => {
    const { matchLang } = await import('./i18n.js')
    expect(matchLang(['nl-NL', 'pt-BR', 'es-ES'])).toBe('pt')
  })
})

describe('initial language selection', () => {
  it('prefers an explicit app choice over profile state and browser language', async () => {
    values.set('gym_lang_v1', 'fr')
    values.set('gym_state_v1', JSON.stringify({ lang: 'es' }))
    setNavigator({ languages: ['de-DE'], language: 'de-DE' })
    const { getInitialLang, getLang } = await import('./i18n.js')
    expect(getInitialLang()).toBe('fr')
    expect(getLang()).toBe('fr')
  })

  it('uses a legacy persisted profile language before browser detection', async () => {
    values.set('gym_state_v1', JSON.stringify({ lang: 'es' }))
    setNavigator({ languages: ['de-DE'], language: 'de-DE' })
    const { getInitialLang } = await import('./i18n.js')
    expect(getInitialLang()).toBe('es')
  })

  it('falls back to the first supported browser language and then English', async () => {
    setNavigator({ languages: ['nl-NL', 'es-MX'], language: 'nl-NL' })
    const { getInitialLang } = await import('./i18n.js')
    expect(getInitialLang()).toBe('es')
    setNavigator({ languages: ['nl-NL'], language: 'nl-NL' })
    expect(getInitialLang()).toBe('en')
  })

  it('persists normalized explicit choices independently of profile state', async () => {
    const { getExplicitLang, saveLangPreference } = await import('./i18n.js')
    expect(saveLangPreference('es-ES')).toBe('es')
    expect(getExplicitLang()).toBe('es')
    expect(values.get('gym_lang_v1')).toBe('es')
  })
})

describe('Spanish translation and instruction contracts', () => {
  it('looks up Spanish values and interpolates source-key arguments', async () => {
    const { setLang, t } = await import('./i18n.js')
    await setLang('es')
    expect(t('Start {0}', 'Push Day')).toBe('Empezar Push Day')
    expect(t('Exercise')).toBe('Ejercicio')
    expect(t('a key absent from every locale')).toBe('a key absent from every locale')
  })

  it('formats decimal set counts with the active locale', async () => {
    const { setLang, t } = await import('./i18n.js')
    const { fmtNum } = await import('./format.js')
    await setLang('es')
    expect(t('{0} sets', fmtNum(49.8))).toBe('49,8 series')
  })

  it('keeps generated Spanish instructions and intentional English fallback behavior', async () => {
    const { setLang, instrFor } = await import('./i18n.js')
    const exercise = { id: '1000', st: ['Stand up and move.'] }
    await setLang('es')
    expect(instrFor(exercise)[0]).toBe('Ponte de pie con los pies separados a la altura de las caderas y coloca la banda alrededor de la base de los dedos del pie.')
    await setLang('pt')
    expect(instrFor(exercise)).toEqual(exercise.st)
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
