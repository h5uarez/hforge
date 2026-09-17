#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const runId = args.get('--run-id')
const requestedRoot = args.get('--worktree-root') || process.cwd()
const maxCandidates = Number(args.get('--candidates') || 8)
const startupMs = Number(args.get('--startup-ms') || 60_000)
const HTTP_READY_POLL_MS = 250
const LISTENER_OWNER_POLL_MS = 1_000
const LISTENER_PID_TIMEOUT_MS = 3_000
const LISTENER_PROBE_CLOSE_TIMEOUT_MS = 1_000
if (!runId || !/^[A-Za-z0-9._-]{1,80}$/.test(runId)) throw new Error('Pass a filesystem-safe --run-id (1-80 characters)')
if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 16) throw new Error('--candidates must be an integer from 1 to 16')
if (!Number.isFinite(startupMs) || startupMs < 1_000 || startupMs > 120_000) throw new Error('--startup-ms must be between 1000 and 120000')
const startupDeadlineAt = Date.now() + startupMs

const canonicalRoot = realpathSync.native(resolve(requestedRoot)).replaceAll('\\', '/')
const frontendDir = join(canonicalRoot, 'frontend')
const viteCli = join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js')
if (!existsSync(viteCli)) throw new Error(`Missing local Vite CLI: ${viteCli}`)

const tempRoot = join(tmpdir(), 'hforge-orca-browser-qa')
const leaseRoot = join(tempRoot, 'leases')
const runDir = join(tempRoot, runId)
mkdirSync(leaseRoot, { recursive: true })
mkdirSync(runDir, { recursive: true })
const manifestPath = join(runDir, 'manifest.json')
const logPath = join(runDir, 'vite.log')
const worktreeHash = createHash('sha256').update(canonicalRoot.toLowerCase()).digest('hex').slice(0, 16)
const seed = createHash('sha256').update(`${canonicalRoot.toLowerCase()}\0frontend\0${runId}`).digest()
const rangeStart = 24_000
const rangeSize = 20_000
const offset = seed.readUInt32BE(0) % rangeSize
const step = (seed.readUInt16BE(4) | 1) % rangeSize || 1

let child = null
let leasePath = null
let selectedPort = null
let shuttingDown = false
const activeListenerProbes = new Set()
const attempts = []
const startedAt = new Date().toISOString()
let manifest = {
  schemaVersion: 1,
  state: 'allocating',
  runId,
  service: 'frontend',
  canonicalWorktreeRoot: canonicalRoot,
  worktreeHash,
  startedAt,
  startupDeadlineAt: new Date(startupDeadlineAt).toISOString(),
  allocation: { strategy: 'worktree-run-hash-bounded-probe', rangeStart, rangeSize, maxCandidates, attempts },
  selectedPorts: {},
  targetUrl: null,
  leasePath: null,
  launch: null,
  ownership: null,
  readiness: null,
  receipts: { manifestPath, logPath },
}

function persist(extra = {}) {
  manifest = { ...manifest, ...extra, updatedAt: new Date().toISOString() }
  const pending = `${manifestPath}.${process.pid}.tmp`
  writeFileSync(pending, `${JSON.stringify(manifest, null, 2)}\n`)
  rmSync(manifestPath, { force: true })
  renameSync(pending, manifestPath)
}

function delay(ms) { return new Promise(resolvePromise => setTimeout(resolvePromise, ms)) }

function probeFree(port) {
  return new Promise(resolvePromise => {
    const server = createServer()
    server.unref()
    server.once('error', error => resolvePromise({ free: false, reason: error.code || error.message }))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolvePromise({ free: true })))
  })
}

function acquireLease(port) {
  const path = join(leaseRoot, `port-${port}.json`)
  try {
    const fd = openSync(path, 'wx')
    writeFileSync(fd, `${JSON.stringify({ runId, canonicalRoot, worktreeHash, service: 'frontend', port, supervisorPid: process.pid, createdAt: new Date().toISOString() })}\n`)
    closeSync(fd)
    return path
  } catch (error) {
    if (error.code === 'EEXIST') return null
    throw error
  }
}

function stopChild() {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true, timeout: 5_000 })
  else child.kill('SIGTERM')
}

function releaseLease() {
  if (!leasePath) return
  try {
    const lease = JSON.parse(readFileSync(leasePath, 'utf8'))
    if (lease.runId === runId && lease.supervisorPid === process.pid) rmSync(leasePath, { force: true })
  } catch {}
  leasePath = null
}

function listenerPid(port, timeoutMs = LISTENER_PID_TIMEOUT_MS) {
  if (process.platform === 'win32') {
    const script = `$x=Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if($x){$x}`
    return listenerPidAsync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], timeoutMs)
  }
  return listenerPidAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], timeoutMs)
}

function terminateListenerProbe(probe, force = false) {
  if (!probe || probe.exitCode !== null || probe.signalCode) return
  try {
    if (process.platform === 'win32' && force && Number.isInteger(probe.pid)) {
      spawnSync('taskkill', ['/pid', String(probe.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: LISTENER_PROBE_CLOSE_TIMEOUT_MS })
    } else {
      probe.kill(process.platform === 'win32' ? undefined : force ? 'SIGKILL' : 'SIGTERM')
    }
  } catch {}
}

function listenerPidAsync(command, argv, timeoutMs) {
  let probe = null
  let timer = null
  let settled = false
  let closed = false
  let cancelPromise = null
  let resolvePromise
  let resolveClose
  const promise = new Promise(resolvePromiseValue => { resolvePromise = resolvePromiseValue })
  const closePromise = new Promise(resolveCloseValue => { resolveClose = resolveCloseValue })
  const finish = value => {
    if (settled) return
    settled = true
    if (timer) clearTimeout(timer)
    resolvePromise(value)
  }
  const markClosed = () => {
    if (closed) return
    closed = true
    if (timer) clearTimeout(timer)
    activeListenerProbes.delete(handle)
    resolveClose()
  }
  const waitForClose = () => new Promise(resolvePromiseValue => {
    const closeTimer = setTimeout(() => resolvePromiseValue(false), LISTENER_PROBE_CLOSE_TIMEOUT_MS)
    closePromise.then(() => {
      clearTimeout(closeTimer)
      resolvePromiseValue(true)
    })
  })
  const handle = {
    promise,
    cancel() {
      if (cancelPromise) return cancelPromise
      cancelPromise = (async () => {
        finish(null)
        terminateListenerProbe(probe)
        if (await waitForClose()) return
        terminateListenerProbe(probe, true)
        await waitForClose()
      })()
      return cancelPromise
    },
  }
  try {
    probe = spawn(command, argv, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    activeListenerProbes.add(handle)
    let stdout = ''
    timer = setTimeout(() => { void handle.cancel() }, timeoutMs)
    probe.stdout.on('data', chunk => { stdout += chunk.toString() })
    probe.once('error', () => {})
    probe.once('close', () => {
      const pid = Number(stdout.trim().split(/\s+/)[0])
      finish(Number.isInteger(pid) && pid > 0 ? pid : null)
      markClosed()
    })
  } catch {
    finish(null)
    markClosed()
  }
  return handle
}

async function ready(port, pid, deadline) {
  let ownerPid = null
  let ownerProbe = null
  let nextOwnerProbeAt = 0
  const cancelOwnerProbe = async () => {
    const handle = ownerProbe
    ownerProbe = null
    if (handle) await handle.cancel()
  }
  while (Date.now() < deadline) {
    if (shuttingDown) { await cancelOwnerProbe(); return { ok: false, reason: 'shutdown' } }
    if (child.exitCode !== null) { await cancelOwnerProbe(); return { ok: false, reason: `vite_exited_${child.exitCode}` } }
    const now = Date.now()
    if (!ownerProbe && now >= nextOwnerProbeAt) {
      nextOwnerProbeAt = now + LISTENER_OWNER_POLL_MS
      const handle = listenerPid(port)
      ownerProbe = handle
      handle.promise.then(result => { ownerPid = result }).catch(() => { ownerPid = null }).finally(() => { if (ownerProbe === handle) ownerProbe = null })
    }
    if (ownerPid && ownerPid !== pid) { await cancelOwnerProbe(); return { ok: false, reason: 'listener_owned_by_other_process', listenerPid: ownerPid } }
    if (ownerPid === pid) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) break
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(Math.min(2_000, remainingMs)) })
        if (response.status === 200) {
          const finalRemainingMs = deadline - Date.now()
          if (finalRemainingMs <= 0) break
          await cancelOwnerProbe()
          const finalOwnerProbe = listenerPid(port, Math.min(LISTENER_PID_TIMEOUT_MS, finalRemainingMs))
          const finalOwnerPid = await finalOwnerProbe.promise
          await finalOwnerProbe.cancel()
          if (child.exitCode !== null) return { ok: false, reason: `vite_exited_${child.exitCode}` }
          if (finalOwnerPid && finalOwnerPid !== pid) return { ok: false, reason: 'listener_owned_by_other_process', listenerPid: finalOwnerPid }
          if (finalOwnerPid === pid) return { ok: true, listenerPid: finalOwnerPid, httpStatus: response.status }
          ownerPid = null
        }
      } catch {}
    }
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    await delay(Math.min(HTTP_READY_POLL_MS, remainingMs))
  }
  await cancelOwnerProbe()
  return { ok: false, reason: 'startup_timeout' }
}

async function cancelActiveListenerProbes() {
  await Promise.allSettled([...activeListenerProbes].map(handle => handle.cancel()))
}

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  await cancelActiveListenerProbes()
  stopChild()
  releaseLease()
  persist({ state: 'stopped', stoppedAt: new Date().toISOString(), stopReason: reason })
  process.exit(exitCode)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('uncaughtException', error => { console.error(error); void shutdown(`uncaughtException:${error.message}`, 1) })

for (let index = 0; index < maxCandidates; index++) {
  if (Date.now() >= startupDeadlineAt) break
  const port = rangeStart + ((offset + index * step) % rangeSize)
  const attempt = { index: index + 1, port, at: new Date().toISOString() }
  const candidateLease = acquireLease(port)
  if (!candidateLease) {
    attempt.result = 'lease_exists'
    attempts.push(attempt)
    persist()
    continue
  }
  leasePath = candidateLease
  if (Date.now() >= startupDeadlineAt) {
    attempt.result = 'startup_timeout'
    attempts.push(attempt)
    releaseLease()
    persist()
    break
  }
  const probe = await probeFree(port)
  if (!probe.free) {
    attempt.result = `bind_probe_${probe.reason}`
    attempts.push(attempt)
    releaseLease()
    persist()
    continue
  }

  if (Date.now() >= startupDeadlineAt) {
    attempt.result = 'startup_timeout'
    attempts.push(attempt)
    releaseLease()
    persist()
    break
  }

  const argv = [viteCli, '--host', '127.0.0.1', '--port', String(port), '--strictPort']
  const logFd = openSync(logPath, 'a')
  if (Date.now() >= startupDeadlineAt) {
    closeSync(logFd)
    attempt.result = 'startup_timeout'
    attempts.push(attempt)
    releaseLease()
    persist()
    break
  }
  selectedPort = port
  child = spawn(process.execPath, argv, { cwd: frontendDir, env: { ...process.env }, stdio: ['ignore', logFd, logFd], windowsHide: true })
  closeSync(logFd)
  attempt.result = 'launched'
  attempts.push(attempt)
  persist({
    state: 'starting',
    selectedPorts: { frontend: port },
    targetUrl: `http://127.0.0.1:${port}/#/home`,
    leasePath,
    launch: { executable: process.execPath, argv, cwd: frontendDir.replaceAll('\\', '/'), supervisorPid: process.pid, childPid: child.pid, strictPort: true },
  })

  const result = await ready(port, child.pid, startupDeadlineAt)
  if (result.ok) {
    persist({
      state: 'ready',
      readyAt: new Date().toISOString(),
      ownership: { verified: true, listenerPid: result.listenerPid, expectedPid: child.pid, exactPidMatch: true, canonicalWorktreeRoot: canonicalRoot },
      readiness: { ok: true, httpStatus: result.httpStatus, url: `http://127.0.0.1:${port}/` },
    })
    console.log(JSON.stringify({ ok: true, manifestPath, targetUrl: manifest.targetUrl, port, supervisorPid: process.pid, childPid: child.pid }))
    child.once('exit', (code, signal) => void shutdown(`vite_exit:${code ?? signal}`, code || 0))
    await new Promise(() => {})
  }

  attempt.result = result.reason
  attempt.listenerPid = result.listenerPid || null
  stopChild()
  releaseLease()
  child = null
  selectedPort = null
  persist({ state: 'allocating', selectedPorts: {}, targetUrl: null, leasePath: null, launch: null, ownership: { verified: false, ...result } })
}

persist({ state: 'failed', failedAt: new Date().toISOString(), failure: 'no_candidate_became_ready' })
console.error(JSON.stringify({ ok: false, manifestPath, attempts }))
process.exit(1)
