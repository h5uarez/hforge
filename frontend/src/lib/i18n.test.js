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
