// Guards locale key parity and the source-English-key contract.  The source scan is
// intentionally limited to frontend-owned UI files; API data, user/catalog data,
// units, brand text, generated instructions, and deliberate English fallbacks are
// not translation keys and are documented here rather than guessed at runtime.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = dirname(scriptDir)
const localesDir = join(frontendDir, 'src', 'locales')
const sourceFiles = [
  'src/views/Login.jsx', 'src/views/Settings.jsx', 'src/views/Home.jsx',
  'src/views/RoutineEdit.jsx', 'src/views/Workout.jsx', 'src/views/Stats.jsx', 'src/views/Admin.jsx',
  'src/components/ui.jsx', 'src/sheets.jsx'
]

// Values in these forms are intentionally not source-English UI keys:
// brand text (Hforge), user/catalog values, units and side markers, generated
// instruction content, and intentional English fallback text.
export const documentedExclusions = [
  'brand text: Hforge',
  'user-owned and catalog-owned values rendered from state/data',
  'units and side markers: kg, lb, L, R',
  'generated exercise instructions in src/instr/',
  'intentional English instruction fallbacks when an instruction pack is absent'
]

const lineOf = (source, index) => source.slice(0, index).split('\n').length
const literalValue = raw => raw.slice(1, -1)

export function findMissingSourceKeys(source, spanishKeys, file = 'source') {
  const missing = []
  const keyPattern = /\bt\s*\(\s*(['"])([^'"\n]+)\1/g
  for (const match of source.matchAll(keyPattern)) {
    const key = match[2]
    if (!spanishKeys.has(key)) missing.push({ key, file, line: lineOf(source, match.index) })
  }
  return missing
}

export function findRawAccessibilityLiterals(source, spanishKeys, file = 'source') {
  const raw = []
  const attrPattern = /\b(?:aria-label|aria-description|title|placeholder)\s*=\s*(['"])([^'"\n]+)\1/g
  for (const match of source.matchAll(attrPattern)) {
    const value = literalValue(match[0].slice(match[0].indexOf(match[1])))
    if (value === 'Hforge' || /^[A-Z]$/.test(value) || /^(kg|lb)$/.test(value)) continue
    raw.push({ key: value, file, line: lineOf(source, match.index), hasSpanishEntry: spanishKeys.has(value) })
  }
  return raw
}

export async function runChecks({ cwd = frontendDir, log = console } = {}) {
  const files = readdirSync(join(cwd, 'src', 'locales')).filter(f => f.endsWith('.js')).sort()
  if (!files.length) throw new Error(`No locale files found in ${join(cwd, 'src', 'locales')}`)
  const locales = new Map()
  for (const file of files) {
    const { default: dict } = await import(/* @vite-ignore */ pathToFileURL(join(cwd, 'src', 'locales', file)).href + `?guard=${Date.now()}`)
    if (!dict || typeof dict !== 'object') throw new Error(`${file}: no default-exported object`)
    locales.set(file.replace(/\.js$/, ''), new Set(Object.keys(dict)))
  }

  const seen = new Map()
  for (const keys of locales.values()) for (const key of keys) seen.set(key, (seen.get(key) || 0) + 1)
  const union = [...seen.keys()]
  const errors = []
  for (const [lang, keys] of locales) {
    const missing = union.filter(key => !keys.has(key))
    const orphans = union.filter(key => seen.get(key) === 1)
    if (missing.length || orphans.length) errors.push(`${lang}.js: missing ${missing.join(', ')}; only here ${orphans.join(', ')}`)
  }
  const spanishKeys = locales.get('es')
  if (!spanishKeys) errors.push('es.js: Spanish locale is required')
  else for (const file of sourceFiles) {
    const path = join(cwd, file)
    const source = readFileSync(path, 'utf8')
    for (const issue of findMissingSourceKeys(source, spanishKeys, relative(cwd, path)))
      errors.push(`${issue.file}:${issue.line}: missing Spanish key ${JSON.stringify(issue.key)}`)
    for (const issue of findRawAccessibilityLiterals(source, spanishKeys, relative(cwd, path)))
      errors.push(`${issue.file}:${issue.line}: raw accessibility literal ${JSON.stringify(issue.key)}; use t()`)
  }
  if (errors.length) {
    for (const error of errors) log.error(`\n${error}`)
    throw new Error('Locale/source completeness checks failed')
  }
  log.log(`${locales.size} locales, ${union.length} keys each — in sync; ${sourceFiles.length} source files checked for Spanish keys and raw accessibility literals.`)
  return { localeCount: locales.size, keyCount: union.length, sourceFileCount: sourceFiles.length }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { await runChecks() } catch { process.exitCode = 1 }
}
