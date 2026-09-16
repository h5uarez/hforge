#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSemver } from './check-version.mjs'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FRONTEND_DIR = resolve(ROOT_DIR, 'frontend')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeIfChanged(path, content, changed) {
  const previous = readFileSync(path, 'utf8')
  if (previous === content) return
  writeFileSync(path, content)
  changed.push(path)
}

function main() {
  const packagePath = resolve(FRONTEND_DIR, 'package.json')
  const packageJson = readJson(packagePath)
  if (!parseSemver(packageJson.version)) {
    throw new Error(`frontend/package.json must contain a valid SemVer, found ${JSON.stringify(packageJson.version)}`)
  }
  const version = packageJson.version
  const lockPath = resolve(FRONTEND_DIR, 'package-lock.json')
  const lock = readJson(lockPath)
  lock.version = version
  if (!lock.packages || !lock.packages['']) throw new Error('frontend/package-lock.json is missing packages[""]')
  lock.packages[''].version = version

  const changed = []
  writeIfChanged(lockPath, `${JSON.stringify(lock, null, 2)}\n`, changed)
  writeIfChanged(resolve(FRONTEND_DIR, 'public', 'version.json'), `${JSON.stringify({ version })}\n`, changed)

  const serviceWorkerPath = resolve(FRONTEND_DIR, 'public', 'sw.js')
  const serviceWorker = readFileSync(serviceWorkerPath, 'utf8')
  const serviceWorkerPattern = /(const\s+SW_VERSION\s*=\s*['"]hforge-pwa-v)[^'"]+(['"])/u
  if (!serviceWorkerPattern.test(serviceWorker)) throw new Error('frontend/public/sw.js is missing the expected SW_VERSION declaration')
  const updatedServiceWorker = serviceWorker.replace(
    serviceWorkerPattern,
    `$1${version}$2`,
  )
  writeIfChanged(serviceWorkerPath, updatedServiceWorker, changed)

  console.log(`Synchronized Hforge frontend metadata to ${version}.`)
  if (changed.length) changed.forEach(path => console.log(`Updated ${path}`))
  else console.log('No files needed changes.')
}

try {
  main()
} catch (error) {
  console.error(`[sync-version] ${error.message}`)
  process.exitCode = 1
}
