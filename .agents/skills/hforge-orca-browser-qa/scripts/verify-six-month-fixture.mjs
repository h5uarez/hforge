#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(scriptDir, '..', 'assets', 'gym-state-v1-six-month-2026-09-07.json')
const generatorPath = resolve(scriptDir, '..', 'assets', 'generate-six-month-fixture.mjs')
const repoRoot = resolve(scriptDir, '..', '..', '..', '..')

const EXPECTED = {
  bytes: 92_921,
  sha256: '2304a0e89c19a60541d08bb1069782908d1a9bff8f0807c5c15a888906a9e31b',
  fixtureId: 'hforge-six-month-2026-09-07-v1',
  schemaVersion: 1,
  weeks: 26,
  workouts: 26,
  routines: 3,
  bodyweight: 52,
  weekStart: '2026-03-16',
  weekEnd: '2026-09-07',
  bodyweightEnd: '2026-09-10',
}

const MAX_GENERATOR_OUTPUT_BYTES = 256 * 1024
const GENERATOR_TIMEOUT_MS = 10_000

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = message => { throw new Error(`Six-month fixture verification failed: ${message}`) }
const expectEqual = (actual, expected, label) => {
  if (actual !== expected) fail(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
}
const expectArrayLength = (value, expected, label) => {
  if (!Array.isArray(value)) fail(`${label}: expected an array`)
  expectEqual(value.length, expected, `${label}.length`)
}

const validatePayload = payload => {
  if (!payload || typeof payload !== 'object') fail('payload is not an object')
  if (!payload.fixtureMeta || typeof payload.fixtureMeta !== 'object') fail('fixtureMeta is missing')

  expectEqual(payload.fixtureMeta.id, EXPECTED.fixtureId, 'fixtureMeta.id')
  expectEqual(payload.fixtureMeta.schemaVersion, EXPECTED.schemaVersion, 'fixtureMeta.schemaVersion')
  expectEqual(payload.fixtureMeta.weeks, EXPECTED.weeks, 'fixtureMeta.weeks')
  expectEqual(payload.fixtureMeta.workoutCount, EXPECTED.workouts, 'fixtureMeta.workoutCount')
  expectEqual(payload.fixtureMeta.weekStart, EXPECTED.weekStart, 'fixtureMeta.weekStart')
  expectEqual(payload.fixtureMeta.weekEnd, EXPECTED.weekEnd, 'fixtureMeta.weekEnd')
  expectEqual(payload.fixtureMeta.deterministic, true, 'fixtureMeta.deterministic')
  expectArrayLength(payload.routines, EXPECTED.routines, 'routines')
  expectArrayLength(payload.workouts, EXPECTED.workouts, 'workouts')
  expectArrayLength(payload.bodyweight, EXPECTED.bodyweight, 'bodyweight')
  expectEqual(payload.workouts[0]?.d, EXPECTED.weekStart, 'workouts[0].d')
  expectEqual(payload.workouts.at(-1)?.d, EXPECTED.weekEnd, 'workouts[last].d')
  expectEqual(payload.bodyweight[0]?.d, EXPECTED.weekStart, 'bodyweight[0].d')
  expectEqual(payload.bodyweight.at(-1)?.d, EXPECTED.bodyweightEnd, 'bodyweight[last].d')
  expectEqual(payload.active, null, 'active')
}

const runGenerator = () => new Promise((resolvePromise, rejectPromise) => {
  const child = spawn(process.execPath, [generatorPath], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const stdout = []
  const stderr = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let settled = false

  const finish = (error, bytes) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    if (error) rejectPromise(error)
    else resolvePromise(bytes)
  }

  const timeout = setTimeout(() => {
    child.kill()
    finish(new Error(`generator exceeded ${GENERATOR_TIMEOUT_MS}ms`))
  }, GENERATOR_TIMEOUT_MS)

  child.stdout.on('data', chunk => {
    stdoutBytes += chunk.length
    if (stdoutBytes > MAX_GENERATOR_OUTPUT_BYTES) {
      child.kill()
      finish(new Error(`generator stdout exceeded ${MAX_GENERATOR_OUTPUT_BYTES} bytes`))
      return
    }
    stdout.push(chunk)
  })

  child.stderr.on('data', chunk => {
    stderrBytes += chunk.length
    if (stderrBytes <= 16 * 1024) stderr.push(chunk)
  })

  child.on('error', error => finish(error))
  child.on('close', (code, signal) => {
    if (code !== 0) {
      const detail = Buffer.concat(stderr).toString('utf8').trim()
      finish(new Error(`generator exited with ${signal || `code ${code}`}${detail ? `: ${detail}` : ''}`))
      return
    }
    finish(null, Buffer.concat(stdout))
  })
})

const main = async () => {
  const committedBytes = await readFile(fixturePath)
  expectEqual(committedBytes.length, EXPECTED.bytes, 'committed byte count')
  expectEqual(sha256(committedBytes), EXPECTED.sha256, 'committed SHA-256')

  let payload
  try {
    payload = JSON.parse(committedBytes.toString('utf8'))
  } catch (error) {
    fail(`committed file is not valid JSON: ${error.message}`)
  }
  validatePayload(payload)

  const generatedBytes = await runGenerator()
  if (!committedBytes.equals(generatedBytes)) {
    fail(`committed bytes differ from fresh generator stdout (fresh ${generatedBytes.length} bytes, SHA-256 ${sha256(generatedBytes)})`)
  }

  console.log(`Verified ${fixturePath}`)
  console.log(`  ${committedBytes.length} bytes; SHA-256 ${EXPECTED.sha256}`)
  console.log(`  ${EXPECTED.fixtureId}; ${EXPECTED.weeks} weeks; ${EXPECTED.workouts} workouts; ${EXPECTED.routines} routines; ${EXPECTED.bodyweight} bodyweight rows; active:null`)
  console.log(`  generator stdout matches committed bytes exactly`)
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
