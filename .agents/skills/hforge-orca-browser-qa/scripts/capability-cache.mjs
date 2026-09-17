#!/usr/bin/env node

/**
 * Cross-run cache for optional Orca capability failures only.
 *
 * Contract:
 *   read  --orca-version <v> --platform <p> --arch <a> --ttl-ms <n> [--cache-root <dir>]
 *   write --orca-version <v> --platform <p> --arch <a> --ttl-ms <n>
 *         --capability <snapshot|browser_screenshot> --outcome <timeout|error>
 *         --failure-domain capability [--cache-root <dir>]
 *
 * `read` always exits successfully with `status: "unknown"` when the entry is
 * missing, expired, invalid, or unreadable. A fresh negative entry returns
 * `status: "negative"` and is the only result that may skip a probe. `write`
 * rejects successes and control-plane failures. Cache read and write storage
 * failures fail open: a write failure returns `status: "unknown"` with
 * `decision: "cache_write_unavailable"` and never a cached negative result.
 * Each capability has its own atomically replaced record, so concurrent
 * snapshot and screenshot writes do not overwrite one another.
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCHEMA_VERSION = 1
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const MAX_TTL_MS = 7 * DEFAULT_TTL_MS
const CAPABILITIES = new Set(['snapshot', 'browser_screenshot'])
const OPTION_NAMES = new Set(['--orca-version', '--platform', '--arch', '--ttl-ms', '--cache-root', '--capability', '--outcome', '--failure-domain'])

function usage() {
  console.error('Usage: capability-cache.mjs read --orca-version <v> --platform <p> --arch <a> --ttl-ms <n> [--cache-root <dir>]')
  console.error('Usage: capability-cache.mjs write --orca-version <v> --platform <p> --arch <a> --ttl-ms <n> --capability <snapshot|browser_screenshot> --outcome <timeout|error> --failure-domain capability [--cache-root <dir>]')
  console.error(`Options: --ttl-ms <1000-${MAX_TTL_MS}>; storage failures are non-blocking for QA`)
}

function parseOptions(argv) {
  const options = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) throw new Error(`Invalid option near ${name || '<end>'}`)
    if (!OPTION_NAMES.has(name)) throw new Error(`Unknown option: ${name}`)
    options.set(name, value)
  }
  return options
}

function required(options, name) {
  const value = options.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function safeIdentity(value, name) {
  if (!value || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`Invalid ${name}`)
  return value
}

function ttl(options) {
  const value = Number(options.has('--ttl-ms') ? options.get('--ttl-ms') : DEFAULT_TTL_MS)
  if (!Number.isSafeInteger(value) || value < 1_000 || value > MAX_TTL_MS) throw new Error(`--ttl-ms must be an integer from 1000 to ${MAX_TTL_MS}`)
  return value
}

function context(options) {
  const orcaVersion = safeIdentity(required(options, '--orca-version'), '--orca-version')
  const platform = safeIdentity(options.has('--platform') ? options.get('--platform') : process.platform, '--platform')
  const arch = safeIdentity(options.has('--arch') ? options.get('--arch') : process.arch, '--arch')
  const cacheRoot = resolve(options.get('--cache-root') || join(tmpdir(), 'hforge-orca-browser-qa', 'capability-cache'))
  const cacheKey = createHash('sha256').update(`${orcaVersion}\0${platform}\0${arch}`).digest('hex').slice(0, 32)
  return { orcaVersion, platform, arch, cacheRoot, cacheKey }
}

function recordPath(contextValue, capability) {
  return join(contextValue.cacheRoot, `${contextValue.cacheKey}.${capability}.json`)
}

function unknown(reason, path) {
  return { status: 'unknown', reason, cachePath: path }
}

function readRecord(contextValue, capability, ttlMs) {
  const path = recordPath(contextValue, capability)
  let record
  try {
    record = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return unknown(error.code === 'ENOENT' ? 'missing' : 'corrupt_or_unreadable', path)
  }

  const valid = record && typeof record === 'object'
    && record.schemaVersion === SCHEMA_VERSION
    && record.cacheKey === contextValue.cacheKey
    && record.capability === capability
    && record.failureDomain === 'capability'
    && (record.outcome === 'timeout' || record.outcome === 'error')
    && record.orcaVersion === contextValue.orcaVersion
    && record.platform === contextValue.platform
    && record.arch === contextValue.arch
    && Number.isSafeInteger(record.recordedAt)
    && Number.isSafeInteger(record.expiresAt)
    && record.expiresAt > record.recordedAt

  if (!valid) return unknown('invalid', path)
  const now = Date.now()
  if (record.recordedAt > now || record.expiresAt - record.recordedAt > MAX_TTL_MS) return unknown('invalid_clock_or_ttl', path)
  if (now >= record.expiresAt || now - record.recordedAt > ttlMs) return unknown('expired', path)

  return {
    status: 'negative',
    decision: 'not_run_cached_known_unavailable',
    outcome: record.outcome,
    recordedAt: record.recordedAt,
    expiresAt: record.expiresAt,
    cachePath: path,
  }
}

function atomicWrite(path, record) {
  const pending = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(pending, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(pending, path)
  } finally {
    rmSync(pending, { force: true })
  }
}

function boundedReason(error) {
  const code = typeof error?.code === 'string' ? error.code : 'write_failed'
  const detail = String(error?.message || error).replace(/\s+/gu, ' ').trim()
  return `${code}: ${detail}`.slice(0, 240)
}

function writeRecord(contextValue, capability, outcome, ttlMs) {
  const path = recordPath(contextValue, capability)
  const recordedAt = Date.now()
  const record = {
    schemaVersion: SCHEMA_VERSION,
    cacheKey: contextValue.cacheKey,
    capability,
    failureDomain: 'capability',
    outcome,
    orcaVersion: contextValue.orcaVersion,
    platform: contextValue.platform,
    arch: contextValue.arch,
    recordedAt,
    expiresAt: recordedAt + ttlMs,
  }
  try {
    mkdirSync(contextValue.cacheRoot, { recursive: true })
    atomicWrite(path, record)
  } catch (error) {
    return {
      status: 'unknown',
      decision: 'cache_write_unavailable',
      capability,
      outcome,
      cachePath: path,
      reason: boundedReason(error),
    }
  }
  return { status: 'negative', capability, outcome, cachePath: path, recordedAt, expiresAt: record.expiresAt }
}

function main() {
  const command = process.argv[2]
  if (command === '--help' || command === undefined) {
    usage()
    return
  }
  if (command !== 'read' && command !== 'write') throw new Error(`Unknown command: ${command}`)

  const options = parseOptions(process.argv.slice(3))
  const contextValue = context(options)
  const ttlMs = ttl(options)

  if (command === 'read') {
    const capabilities = Object.fromEntries([...CAPABILITIES].map(capability => [capability, readRecord(contextValue, capability, ttlMs)]))
    console.log(JSON.stringify({ ok: true, command, schemaVersion: SCHEMA_VERSION, cacheKey: contextValue.cacheKey, key: { orcaVersion: contextValue.orcaVersion, platform: contextValue.platform, arch: contextValue.arch }, ttlMs, capabilities }))
    return
  }

  const capability = required(options, '--capability')
  if (!CAPABILITIES.has(capability)) throw new Error(`Unsupported capability: ${capability}`)
  const outcome = required(options, '--outcome')
  if (outcome !== 'timeout' && outcome !== 'error') throw new Error('--outcome must be timeout or error; successes are never cached')
  if (options.get('--failure-domain') !== 'capability') throw new Error('--failure-domain capability is required; control-plane failures are never cached')
  console.log(JSON.stringify({ ok: true, command, schemaVersion: SCHEMA_VERSION, cacheKey: contextValue.cacheKey, key: { orcaVersion: contextValue.orcaVersion, platform: contextValue.platform, arch: contextValue.arch }, ttlMs, ...writeRecord(contextValue, capability, outcome, ttlMs) }))
}

try {
  main()
} catch (error) {
  usage()
  console.error(error.message)
  process.exitCode = 1
}
