#!/usr/bin/env node

/**
 * Cross-run cache for one verified Orca runtime behavior: a consuming reload
 * reset the requested mobile viewport. This is separate from capability-cache.
 *
 * Contract:
 *   read  --orca-version <v> --platform <p> --arch <a> --ttl-ms <n>
 *         [--cache-root <dir>]
 *   write --orca-version <v> --platform <p> --arch <a> --ttl-ms <n>
 *         --behavior reload_resets_viewport --evidence <opaque-id>
 *         [--cache-root <dir>]
 *
 * A read returns status "observed" only for a fresh, exact-key record. Missing,
 * expired, invalid, corrupt, and unreadable records return status "unknown".
 * Writes are atomic and fail open on storage errors. Evidence is deliberately
 * limited to a short opaque identifier; no source, credential, or path content
 * is stored in the record.
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCHEMA_VERSION = 1
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const MAX_TTL_MS = 7 * DEFAULT_TTL_MS
const MAX_RECORD_BYTES = 8 * 1024
const BEHAVIOR = 'reload_resets_viewport'
const OPTION_NAMES = new Set(['--orca-version', '--platform', '--arch', '--ttl-ms', '--cache-root', '--behavior', '--evidence'])
const RECORD_FIELDS = new Set(['schemaVersion', 'cacheKey', 'behavior', 'orcaVersion', 'platform', 'arch', 'evidence', 'observedAt', 'expiresAt'])

function usage() {
  console.error('Usage: viewport-reset-cache.mjs read --orca-version <v> --platform <p> --arch <a> --ttl-ms <n> [--cache-root <dir>]')
  console.error('Usage: viewport-reset-cache.mjs write --orca-version <v> --platform <p> --arch <a> --ttl-ms <n> --behavior reload_resets_viewport --evidence <opaque-id> [--cache-root <dir>]')
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

function opaqueEvidence(value) {
  if (!value || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value)) throw new Error('Invalid --evidence; use a short opaque identifier')
  return value
}

function ttl(options) {
  const value = Number(required(options, '--ttl-ms'))
  if (!Number.isSafeInteger(value) || value < 1_000 || value > MAX_TTL_MS) throw new Error(`--ttl-ms must be an integer from 1000 to ${MAX_TTL_MS}`)
  return value
}

function context(options) {
  const orcaVersion = safeIdentity(required(options, '--orca-version'), '--orca-version')
  const platform = safeIdentity(required(options, '--platform'), '--platform')
  const arch = safeIdentity(required(options, '--arch'), '--arch')
  const cacheRoot = resolve(options.get('--cache-root') || join(tmpdir(), 'hforge-orca-browser-qa', 'viewport-reset-cache'))
  const cacheKey = createHash('sha256').update(`${orcaVersion}\0${platform}\0${arch}`).digest('hex').slice(0, 32)
  return { orcaVersion, platform, arch, cacheRoot, cacheKey }
}

function recordPath(contextValue) {
  return join(contextValue.cacheRoot, `${contextValue.cacheKey}.${BEHAVIOR}.json`)
}

function unknown(reason, path) {
  return { status: 'unknown', behavior: BEHAVIOR, reason, cachePath: path }
}

function readRecord(contextValue, ttlMs) {
  const path = recordPath(contextValue)
  let bytes
  try {
    bytes = readFileSync(path)
    if (bytes.length > MAX_RECORD_BYTES) return unknown('oversized', path)
  } catch (error) {
    return unknown(error.code === 'ENOENT' ? 'missing' : 'corrupt_or_unreadable', path)
  }

  let record
  try {
    record = JSON.parse(bytes.toString('utf8'))
  } catch {
    return unknown('corrupt_or_unreadable', path)
  }

  const valid = record && typeof record === 'object' && !Array.isArray(record)
    && Object.keys(record).length === RECORD_FIELDS.size
    && Object.keys(record).every(field => RECORD_FIELDS.has(field))
    && record.schemaVersion === SCHEMA_VERSION
    && record.cacheKey === contextValue.cacheKey
    && record.behavior === BEHAVIOR
    && record.orcaVersion === contextValue.orcaVersion
    && record.platform === contextValue.platform
    && record.arch === contextValue.arch
    && typeof record.evidence === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(record.evidence)
    && Number.isSafeInteger(record.observedAt)
    && Number.isSafeInteger(record.expiresAt)
    && record.expiresAt > record.observedAt

  if (!valid) return unknown('invalid', path)
  const now = Date.now()
  if (record.observedAt > now || record.expiresAt - record.observedAt > MAX_TTL_MS) return unknown('invalid_clock_or_ttl', path)
  if (now >= record.expiresAt || now - record.observedAt > ttlMs) return unknown('expired', path)

  return {
    status: 'observed',
    behavior: BEHAVIOR,
    evidence: record.evidence,
    observedAt: record.observedAt,
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

function writeRecord(contextValue, evidence, ttlMs) {
  const path = recordPath(contextValue)
  const observedAt = Date.now()
  const record = {
    schemaVersion: SCHEMA_VERSION,
    cacheKey: contextValue.cacheKey,
    behavior: BEHAVIOR,
    orcaVersion: contextValue.orcaVersion,
    platform: contextValue.platform,
    arch: contextValue.arch,
    evidence,
    observedAt,
    expiresAt: observedAt + ttlMs,
  }
  try {
    mkdirSync(contextValue.cacheRoot, { recursive: true })
    atomicWrite(path, record)
  } catch (error) {
    return {
      status: 'unknown',
      behavior: BEHAVIOR,
      evidence,
      decision: 'cache_write_unavailable',
      reason: 'cache_write_unavailable',
      detail: typeof error?.code === 'string' ? error.code : 'write_failed',
      cachePath: path,
    }
  }
  return { status: 'observed', behavior: BEHAVIOR, evidence, cachePath: path, observedAt, expiresAt: record.expiresAt }
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
  const key = { orcaVersion: contextValue.orcaVersion, platform: contextValue.platform, arch: contextValue.arch }

  if (command === 'read') {
    if (options.has('--behavior') || options.has('--evidence')) throw new Error('read does not accept --behavior or --evidence')
    console.log(JSON.stringify({ ok: true, command, schemaVersion: SCHEMA_VERSION, key, ttlMs, ...readRecord(contextValue, ttlMs) }))
    return
  }

  if (options.get('--behavior') !== BEHAVIOR) throw new Error(`--behavior ${BEHAVIOR} is required`)
  const evidence = opaqueEvidence(required(options, '--evidence'))
  console.log(JSON.stringify({ ok: true, command, schemaVersion: SCHEMA_VERSION, key, ttlMs, ...writeRecord(contextValue, evidence, ttlMs) }))
}

try {
  main()
} catch (error) {
  usage()
  console.error(error.message)
  process.exitCode = 1
}
