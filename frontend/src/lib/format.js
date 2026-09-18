// Formatting + date helpers (ported from the vanilla app, unit taken from the store where needed).
import { dateLocale, t } from './i18n.js'
export const todayISO = () => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
export const isoOf = d =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

export const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function fmtDate(iso, long) {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(dateLocale(), long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' })
}
export function fmtDur(ms) {
  const m = Math.floor(ms / 60000)
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min'
}
// Imported history has no clock — an unknown duration is left out rather than shown as "0 min".
export const durPart = ms => (ms >= 60000 ? [fmtDur(ms)] : [])
// Numbers follow the UI language, like the dates above — a hardcoded locale put Swiss
// apostrophes ("7'535 kg") in front of every user, in every language.
export const fmtNum = n => (Math.round(n * 10) / 10).toLocaleString(dateLocale())
// Volume stays in the profile's unit throughout: the old shorthand turned anything over
// 10 000 into "t", which is wrong for a pound profile and made one list mix "18.8t" with
// "7'535 kg" — two numbers you can't compare at a glance.
export const fmtVol = (v, unit) => fmtNum(v) + ' ' + unit
// Plural forms are not automatic when the English string is the key.
export const exCount = n => t(n === 1 ? '{0} exercise' : '{0} exercises', n)

export function weekKey(d) {
  const dt = new Date(d + 'T12:00:00')
  const day = (dt.getDay() + 6) % 7
  dt.setDate(dt.getDate() - day + 3)
  const jan4 = new Date(dt.getFullYear(), 0, 4)
  const week = 1 + Math.round(((dt - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
  return dt.getFullYear() + '-' + week
}

export const localTZ = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
// Single source of truth for the 6 canonical accent pairs (HEX-immutable): `a`
// is the light-mode accent, `b` the dark-mode accent (shown on the picker's
// split swatch). index.css maps each key to per-mode roles (--acc/--on-acc)
// and duplicates the hexes on purpose — accessibility.test.js drift-guards
// registry ↔ CSS.
export const ACCENTS = {
  default: { a: '#007AFF', b: '#0A84FF' },
  ultraviolet: { a: '#8A5A00', b: '#EAC66B' },
  dragonfruit: { a: '#0E6B3C', b: '#6FD3A0' },
  ghost: { a: '#4D7C0F', b: '#D7F338' },
  cobalt: { a: '#B4128F', b: '#F07FC4' },
  ember: { a: '#A31621', b: '#F2A18E' },
}
// Legacy 8-key accents → canonical pair. Applied wherever stored appearance is
// resolved and duplicated by the pre-paint inline script in index.html (drift-guarded).
export const ACCENT_MIGRATION = { lime: 'ultraviolet', sky: 'cobalt', orange: 'ember', violet: 'ultraviolet', pink: 'dragonfruit', red: 'dragonfruit', teal: 'cobalt', gold: 'ember' }
// Stored accents resolve to a canonical pair; unknown values fall back to
// default. Legacy values keep their explicit migration targets.
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
export const resolveAccent = a => hasOwn(ACCENTS, a) ? a : (hasOwn(ACCENT_MIGRATION, a) ? ACCENT_MIGRATION[a] : 'default')
// Eligible accents inside the neutral Default palette (HEX-immutable): each entry
// carries its per-mode pair (light = dark ink on light field, dark = light field
// with a tinted dark ink) so --on-acc always clears 4.5:1 against --acc in both
// modes (measured 5.02-11.40 across the eight pairs).
// This namespace is independent from ACCENTS/ACCENT_MIGRATION: keys may read like
// legacy accent names (orange/teal) but only ever resolve through
// resolveDefaultAccent, never through resolveAccent.
// Red (#C81E1E/#FF8A80) is interactive-only, never status: danger keeps the fixed
// --red token + danger styles, so a red button never reads as an error.
// Yellow is amber-graded (#B45309 light, #FFD60A dark): pure yellow on white
// cannot clear 4.5:1, so light mode carries the depth while dark mode carries
// the glow. Lilac (#9333EA/#D8B4FE) SUBSTITUTES violet (hues 271° vs 263° — too
// close to coexist in one row); the wheel keeps Blue/Teal/Emerald/Orange/Rose.
export const DEFAULT_ACCENTS = {
  blue: { light: '#0B69E3', dark: '#53A6FF', onLight: '#FFFFFF', onDark: '#04121F' },
  teal: { light: '#0E7490', dark: '#22D3EE', onLight: '#FFFFFF', onDark: '#03202A' },
  emerald: { light: '#047857', dark: '#34D399', onLight: '#FFFFFF', onDark: '#022016' },
  yellow: { light: '#B45309', dark: '#FFD60A', onLight: '#FFFFFF', onDark: '#2A2000' },
  orange: { light: '#C2410C', dark: '#FB923C', onLight: '#FFFFFF', onDark: '#1F1002' },
  red: { light: '#C81E1E', dark: '#FF8A80', onLight: '#FFFFFF', onDark: '#420D09' },
  rose: { light: '#BE185D', dark: '#F472B6', onLight: '#FFFFFF', onDark: '#2A0A1A' },
  lilac: { light: '#9333EA', dark: '#D8B4FE', onLight: '#FFFFFF', onDark: '#250A44' },
}
// Stored default-accent choice; unknown values fall back to blue.
export const resolveDefaultAccent = a => hasOwn(DEFAULT_ACCENTS, a) ? a : 'blue'
