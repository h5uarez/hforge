// Tiny dependency-free i18n. English source strings are the keys; locale files in
// src/locales/ map them to translations and are lazy-loaded (Vite code-splits each
// import.meta.glob entry), so the initial bundle stays English-only.
// Exercise instructions come from separately generated packs in src/instr/ (one per
// language, from source exercise data) — also lazy-loaded on language switch.
import { useSyncExternalStore } from 'react'

// UI languages. de/pt have no instruction pack — instructions fall back to English.
export const LANGS = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano',
  pt: 'Português', pl: 'Polski', tr: 'Türkçe', ru: 'Русский', zh: '中文',
  ko: '한국어', hi: 'हिन्दी'
}
export const INSTR_LANGS = ['en', 'es', 'fr', 'it', 'tr', 'ru', 'zh', 'hi', 'pl', 'ko']
const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN'
}

export const LANG_PREF_KEY = 'gym_lang_v1'
export const NOTE_KEYS = [
  'Add exercise notes', 'Edit exercise note', 'Optional note for this workout. You can add context to each exercise.',
  'Note for {0}', 'Note must be 280 characters or fewer.', 'Has note', 'Note'
]
const STATE_KEY = 'gym_state_v1'
const localePacks = import.meta.glob('../locales/*.js')
const instrPacks = import.meta.glob('../instr/*.js')

const hasLang = value => Object.prototype.hasOwnProperty.call(LANGS, value)

// Browser APIs are deliberately read through small guards: i18n is also imported by build-time
// tooling, and private browsing can make localStorage throw even when the property exists.
const storageValue = key => {
  try { return globalThis.localStorage?.getItem(key) || null } catch { return null }
}

export function normalizeLang(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replaceAll('_', '-').toLowerCase()
  if (!normalized) return null
  if (hasLang(normalized)) return normalized
  const primary = normalized.split('-')[0]
  return hasLang(primary) ? primary : null
}

// Match in the order supplied by the browser. navigator.languages is already ordered by user
// preference, and matching both the full tag and its primary subtag handles values such as
// `es-MX` without adding regional variants to the app's language registry.
export function matchLang(values) {
  const candidates = Array.isArray(values) ? values : [values]
  for (const value of candidates) {
    const matched = normalizeLang(value)
    if (matched) return matched
  }
  return null
}

export function getExplicitLang() {
  return normalizeLang(storageValue(LANG_PREF_KEY))
}

function persistedStateLang() {
  try {
    const state = JSON.parse(storageValue(STATE_KEY) || 'null')
    return normalizeLang(state?.lang)
  } catch { return null }
}

function browserLang() {
  try {
    // A Node runtime may expose navigator without being a browser. Requiring window keeps unit
    // tests and SSR deterministic while still covering regular browsers and Capacitor WebViews.
    if (typeof window === 'undefined') return null
    const nav = window.navigator || globalThis.navigator
    return matchLang([...(Array.isArray(nav?.languages) ? nav.languages : []), nav?.language])
  } catch { return null }
}

// Preference order matters: a deliberate local choice wins over the legacy profile state, and
// only a profile with no language setting falls through to the browser/device language.
export function getInitialLang() {
  return getExplicitLang() || persistedStateLang() || browserLang() || 'en'
}

export function saveLangPreference(value) {
  const selected = normalizeLang(value) || 'en'
  try { globalThis.localStorage?.setItem(LANG_PREF_KEY, selected) } catch { /* ignore */ }
  return selected
}

let lang = getInitialLang()
let dict = {}
let instr = null            // { exId: [steps] } for the current language, null = English
let version = 0
const subs = new Set()
const notify = () => { version++; subs.forEach(f => f()) }

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'en-GB'

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}
// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []

const PACK_TIMEOUT_MS = 4000
function loadPack(loader) {
  const pending = Promise.resolve().then(loader)
  if (typeof setTimeout !== 'function') return pending
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('locale pack timed out')), PACK_TIMEOUT_MS)
  })
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer))
}

export async function setLang(l) {
  const selected = normalizeLang(l) || 'en'
  if (selected === lang && version > 0) return lang
  const request = ++setLang.request
  lang = selected
  try {
    const nextDict = selected === 'en' ? {} : (await loadPack(() => localePacks['../locales/' + selected + '.js']())).default
    let nextInstr = null
    if (selected !== 'en' && INSTR_LANGS.includes(selected)) {
      try { nextInstr = (await loadPack(() => instrPacks['../instr/' + selected + '.js']())).default } catch { /* English instruction fallback */ }
    }
    if (request !== setLang.request) return lang
    dict = nextDict
    instr = nextInstr
  } catch (e) {
    if (request !== setLang.request) return lang
    // A failed initial chunk must not leave the app claiming a language whose strings are absent.
    lang = 'en'
    dict = {}
    instr = null
  }
  if (request !== setLang.request) return lang
  notify()
  return lang
}
setLang.request = 0

// User-facing controls call this instead of setLang so browser detection remains non-persistent
// while an intentional choice survives sign-out, profile reset, and local state cleanup.
export async function setLangPreference(value) {
  const selected = saveLangPreference(value)
  return setLang(selected)
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, () => version)
}
