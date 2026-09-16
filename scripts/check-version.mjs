#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FRONTEND_DIR = resolve(ROOT_DIR, 'frontend')
const SW_VERSION_RE = /\bconst\s+SW_VERSION\s*=\s*['"]hforge-pwa-v([^'"]+)['"]/u
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u
const NUMERIC_IDENTIFIER_RE = /^\d+$/u
const GIT_HASH_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu

export const BUMP_LEVELS = Object.freeze({ none: 0, prerelease: 0, patch: 1, minor: 2, major: 3 })

const PATCH_TYPES = new Set(['build', 'chore', 'config', 'deps', 'fix', 'perf', 'refactor', 'revert', 'style'])
const NO_RELEASE_TYPES = new Set(['ci', 'docs', 'test'])

function normalizePath(path) {
  return path.replaceAll('\\', '/')
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} could not be read as JSON: ${error.message}`)
  }
}

function displayValue(value) {
  return value === undefined ? '<missing>' : JSON.stringify(value)
}

export function parseSemver(value) {
  if (typeof value !== 'string') return null
  const match = value.match(SEMVER_RE)
  if (!match) return null
  const prerelease = match[4] ? match[4].split('.') : []
  if (prerelease.some(identifier => NUMERIC_IDENTIFIER_RE.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))) return null
  return {
    raw: value,
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease,
    build: match[5] ? match[5].split('.') : [],
  }
}

function compareNumericIdentifiers(left, right) {
  const normalizedLeft = left.replace(/^0+/u, '') || '0'
  const normalizedRight = right.replace(/^0+/u, '') || '0'
  if (normalizedLeft.length !== normalizedRight.length) return normalizedLeft.length < normalizedRight.length ? -1 : 1
  if (normalizedLeft === normalizedRight) return 0
  return normalizedLeft < normalizedRight ? -1 : 1
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0
  if (!left.length) return 1
  if (!right.length) return -1
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const aNumeric = NUMERIC_IDENTIFIER_RE.test(a)
    const bNumeric = NUMERIC_IDENTIFIER_RE.test(b)
    if (aNumeric && bNumeric) return compareNumericIdentifiers(a, b)
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a < b ? -1 : 1
  }
  return 0
}

export function compareVersions(leftValue, rightValue) {
  const left = parseSemver(leftValue)
  const right = parseSemver(rightValue)
  if (!left) throw new Error(`Invalid SemVer: ${displayValue(leftValue)}`)
  if (!right) throw new Error(`Invalid SemVer: ${displayValue(rightValue)}`)
  for (const key of ['major', 'minor', 'patch']) {
    const comparison = compareNumericIdentifiers(left[key], right[key])
    if (comparison !== 0) return comparison
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

function bumpLevel(previous, current) {
  if (compareNumericIdentifiers(current.major, previous.major) !== 0) return 'major'
  if (compareNumericIdentifiers(current.minor, previous.minor) !== 0) return 'minor'
  if (compareNumericIdentifiers(current.patch, previous.patch) !== 0) return 'patch'
  if (!current.prerelease.length && previous.prerelease.length) return 'patch'
  return 'prerelease'
}

function metadataEntries(rootDir) {
  const frontendDir = resolve(rootDir, 'frontend')
  const packageJsonPath = resolve(frontendDir, 'package.json')
  const packageLockPath = resolve(frontendDir, 'package-lock.json')
  const versionJsonPath = resolve(frontendDir, 'public', 'version.json')
  const serviceWorkerPath = resolve(frontendDir, 'public', 'sw.js')
  const errors = []
  const entries = []

  let packageJson
  try {
    packageJson = readJson(packageJsonPath, 'frontend/package.json')
  } catch (error) {
    errors.push(error.message)
    packageJson = {}
  }
  entries.push({ path: 'frontend/package.json', value: packageJson.version })

  let packageLock
  try {
    packageLock = readJson(packageLockPath, 'frontend/package-lock.json')
  } catch (error) {
    errors.push(error.message)
    packageLock = {}
  }
  entries.push({ path: 'frontend/package-lock.json (top-level)', value: packageLock.version })
  entries.push({ path: 'frontend/package-lock.json packages[""]', value: packageLock.packages?.['']?.version })

  let versionJson
  try {
    versionJson = readJson(versionJsonPath, 'frontend/public/version.json')
  } catch (error) {
    errors.push(error.message)
    versionJson = {}
  }
  entries.push({ path: 'frontend/public/version.json', value: versionJson.version })

  let serviceWorker
  try {
    serviceWorker = readFileSync(serviceWorkerPath, 'utf8')
  } catch (error) {
    errors.push(`frontend/public/sw.js could not be read: ${error.message}`)
    serviceWorker = ''
  }
  const serviceWorkerMatch = serviceWorker.match(SW_VERSION_RE)
  entries.push({ path: 'frontend/public/sw.js (SW_VERSION)', value: serviceWorkerMatch?.[1] })

  const canonicalVersion = entries[0].value
  for (const entry of entries) {
    if (!parseSemver(entry.value)) {
      errors.push(`${entry.path} must contain a valid SemVer, found ${displayValue(entry.value)}`)
    }
  }
  if (parseSemver(canonicalVersion)) {
    for (const entry of entries.slice(1)) {
      if (entry.value !== canonicalVersion) {
        errors.push(`${entry.path} is ${displayValue(entry.value)} but frontend/package.json is ${canonicalVersion}`)
      }
    }
  }

  return { canonicalVersion, entries, errors }
}

export function getVersionMetadata(rootDir = ROOT_DIR) {
  return metadataEntries(rootDir)
}

export function assertVersionMetadata(rootDir = ROOT_DIR) {
  const metadata = getVersionMetadata(rootDir)
  if (metadata.errors.length) {
    throw new Error([
      'Version metadata is inconsistent.',
      ...metadata.errors.map(error => `- ${error}`),
      'Fix frontend/package.json first (it is the canonical version), then run `node scripts/sync-version.mjs` and `node scripts/check-version.mjs`.',
    ].join('\n'))
  }
  return metadata
}

export function isDocumentationPath(path) {
  const normalized = normalizePath(path).toLowerCase()
  return normalized.startsWith('docs/') || /\.(md|mdx|adoc|txt)$/u.test(normalized)
}

export function isTestPath(path) {
  const normalized = normalizePath(path).toLowerCase()
  return /(^|\/)(?:__tests__|tests?|test-results)\//u.test(normalized) ||
    /\.(?:test|spec)\.[^/]+$/u.test(normalized)
}

export function isCiPath(path) {
  const normalized = normalizePath(path).toLowerCase()
  return normalized.startsWith('.github/')
}

export function isCheckerPath(path) {
  return /^scripts\/(?:check|sync)-version(?:\.test)?\.mjs$/u.test(normalizePath(path))
}

export function isExemptPath(path) {
  return isDocumentationPath(path) || isTestPath(path) || isCiPath(path) || isCheckerPath(path)
}

export function parseConventionalCommit(subject, body = '') {
  const match = String(subject).match(/^([a-z]+)(?:\([^)]*\))?(!)?:\s/u)
  const type = match?.[1]?.toLowerCase() || null
  const breaking = match?.[2] === '!' || /\bBREAKING CHANGE\b/u.test(`${subject}\n${body}`)
  return { subject: String(subject), type, breaking }
}

function hasReleaseRelevantPath(commit) {
  if (!commit || typeof commit !== 'object' || !Array.isArray(commit.paths)) return true
  return commit.paths.some(path => !isExemptPath(path))
}

export function classifyReleaseChange(changedPaths, commits = []) {
  const normalizedPaths = [...new Set(changedPaths.map(normalizePath))]
  const releaseRelevantPaths = normalizedPaths.filter(path => !isExemptPath(path))
  const exemptPaths = normalizedPaths.filter(path => isExemptPath(path))
  if (!releaseRelevantPaths.length) {
    return {
      requiredLevel: 'none',
      releaseRelevantPaths,
      exemptPaths,
      reasons: ['Only documentation, tests, CI, or version-checker files changed.'],
    }
  }

  let requiredLevel = 'patch'
  const reasons = []
  const releaseRelevantCommits = commits.filter(hasReleaseRelevantPath)
  for (const commit of releaseRelevantCommits) {
    const parsed = parseConventionalCommit(commit.subject ?? commit, commit.body ?? '')
    if (parsed.breaking) {
      requiredLevel = 'major'
      reasons.push(`${parsed.subject} (breaking change)`)
      continue
    }
    if (parsed.type === 'feat') {
      if (BUMP_LEVELS[requiredLevel] < BUMP_LEVELS.minor) requiredLevel = 'minor'
      reasons.push(`${parsed.subject} (feature)`)
      continue
    }
    if (PATCH_TYPES.has(parsed.type)) {
      reasons.push(`${parsed.subject} (patch-level change)`)
      continue
    }
    if (NO_RELEASE_TYPES.has(parsed.type)) {
      reasons.push(`${parsed.subject} (release-relevant path changed; patch required)`)
      continue
    }
    reasons.push(`${parsed.subject} (no conventional type; patch required)`)
  }
  if (!releaseRelevantCommits.length) {
    reasons.push(commits.length
      ? 'Release-relevant paths changed without applicable commit subjects; patch required.'
      : 'Release-relevant paths changed without commit subjects; patch required.')
  }
  return { requiredLevel, releaseRelevantPaths, exemptPaths, reasons }
}

function git(args, rootDir) {
  try {
    return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const detail = String(error.stderr || error.message).trim()
    throw new Error(`Git command failed (${args.join(' ')}): ${detail}`)
  }
}

function resolveBaseRef(baseRef, rootDir) {
  return git(['rev-parse', '--verify', `${baseRef}^{commit}`], rootDir).trim()
}

function baseVersion(baseSha, rootDir) {
  let packageJson
  try {
    packageJson = JSON.parse(git(['show', `${baseSha}:frontend/package.json`], rootDir))
  } catch (error) {
    throw new Error(`Could not read frontend/package.json at Git base ${baseSha}: ${error.message}`)
  }
  if (!parseSemver(packageJson.version)) {
    throw new Error(`Git base ${baseSha} has an invalid frontend/package.json version: ${displayValue(packageJson.version)}`)
  }
  return packageJson.version
}

function gitCommitPaths(commitHash, rootDir) {
  const output = git(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', '-z', commitHash], rootDir)
  return output.split('\0').filter(Boolean)
}

function gitChangeSet(baseSha, rootDir) {
  const changedOutput = git(['diff', '--name-only', '-z', `${baseSha}...HEAD`], rootDir)
  const changedPaths = changedOutput.split('\0').filter(Boolean)
  const commitOutput = git(['log', '--format=%H%x00%s%x00%b%x00', `${baseSha}..HEAD`], rootDir)
  const fields = commitOutput.split('\0')
  const commits = []
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const hash = fields[index].trim()
    if (!hash) continue
    if (!GIT_HASH_RE.test(hash)) throw new Error(`Git log returned an invalid commit hash: ${JSON.stringify(fields[index])}`)
    commits.push({
      hash,
      subject: fields[index + 1],
      body: fields[index + 2],
      paths: gitCommitPaths(hash, rootDir),
    })
  }
  return { changedPaths, commits }
}

export function assertReleaseBump({ previousVersion, currentVersion, classification }) {
  const previous = parseSemver(previousVersion)
  const current = parseSemver(currentVersion)
  if (!previous) throw new Error(`Invalid base SemVer: ${displayValue(previousVersion)}`)
  if (!current) throw new Error(`Invalid current SemVer: ${displayValue(currentVersion)}`)
  if (classification.requiredLevel === 'none') {
    return { requiredLevel: 'none', actualLevel: 'none', comparison: compareVersions(currentVersion, previousVersion) }
  }

  const comparison = compareVersions(currentVersion, previousVersion)
  if (comparison === 0) {
    throw new Error([
      `Version ${currentVersion} is unchanged from Git base ${previousVersion}.`,
      `Release-relevant changes require at least a ${classification.requiredLevel} bump.`,
      'Update frontend/package.json (the canonical source), then run `node scripts/sync-version.mjs` to synchronize package-lock.json, version.json, and the service-worker cache namespace.',
    ].join('\n'))
  }
  if (comparison < 0) {
    throw new Error([
      `Version ${currentVersion} is lower than Git base ${previousVersion}.`,
      `Release-relevant changes require at least a ${classification.requiredLevel} bump; versions must increase, never decrease.`,
      'Update frontend/package.json (the canonical source), then run `node scripts/sync-version.mjs` to synchronize package-lock.json, version.json, and the service-worker cache namespace.',
    ].join('\n'))
  }

  const actualLevel = bumpLevel(previous, current)
  if (BUMP_LEVELS[actualLevel] < BUMP_LEVELS[classification.requiredLevel]) {
    throw new Error([
      `Release-relevant changes require at least a ${classification.requiredLevel} version bump, but ${previousVersion} -> ${currentVersion} is only a ${actualLevel} bump.`,
      `Detected paths: ${classification.releaseRelevantPaths.join(', ')}`,
      `Detected commit subjects: ${classification.reasons.join('; ')}`,
      'Update frontend/package.json (the canonical source), then run `node scripts/sync-version.mjs` to synchronize package-lock.json, version.json, and the service-worker cache namespace.',
    ].join('\n'))
  }
  return { requiredLevel: classification.requiredLevel, actualLevel, comparison }
}

export function runVersionCheck({ rootDir = ROOT_DIR, baseRef } = {}) {
  const metadata = assertVersionMetadata(rootDir)
  if (!baseRef) return { metadata, baseRef: null, comparison: null }

  const baseSha = resolveBaseRef(baseRef, rootDir)
  const previousVersion = baseVersion(baseSha, rootDir)
  const changes = gitChangeSet(baseSha, rootDir)
  const classification = classifyReleaseChange(changes.changedPaths, changes.commits)
  const comparison = assertReleaseBump({ previousVersion, currentVersion: metadata.canonicalVersion, classification })
  return { metadata, baseRef: baseSha, previousVersion, changes, classification, comparison }
}

function parseArgs(args) {
  let baseRef
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') return { help: true }
    if (argument === '--base-ref' || argument === '--base') {
      baseRef = args[index + 1]
      if (!baseRef || baseRef.startsWith('-')) throw new Error(`${argument} requires a Git base ref`)
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return { baseRef, help: false }
}

function printHelp() {
  console.log('Usage: node scripts/check-version.mjs [--base-ref <git-ref>]')
  console.log('Validates frontend version metadata and optionally enforces the release bump for commits since the base ref.')
}

export function main(args = process.argv.slice(2), rootDir = ROOT_DIR) {
  const options = parseArgs(args)
  if (options.help) {
    printHelp()
    return
  }
  const result = runVersionCheck({ rootDir, baseRef: options.baseRef })
  console.log(`Version metadata is consistent: ${result.metadata.canonicalVersion}`)
  if (!result.baseRef) {
    console.log('Release bump comparison skipped: no Git base ref supplied (expected for manual deployment).')
    return
  }
  if (result.classification.requiredLevel === 'none') {
    console.log('No release-relevant paths changed; no version bump is required.')
    return
  }
  console.log(`Release bump check passed: ${result.previousVersion} -> ${result.metadata.canonicalVersion} (${result.comparison.actualLevel}; required ${result.classification.requiredLevel}).`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  try {
    main()
  } catch (error) {
    console.error(`::error::${error.message.split('\n')[0]}`)
    console.error(error.message)
    process.exitCode = 1
  }
}
