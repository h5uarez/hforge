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
if (!runId || !/^[A-Za-z0-9._-]{1,80}$/.test(runId)) throw new Error('Pass a filesystem-safe --run-id (1-80 characters)')
if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 16) throw new Error('--candidates must be an integer from 1 to 16')
if (!Number.isFinite(startupMs) || startupMs < 1_000 || startupMs > 120_000) throw new Error('--startup-ms must be between 1000 and 120000')

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
  startupDeadlineAt: new Date(Date.now() + startupMs).toISOString(),
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

function listenerPid(port) {
  if (process.platform === 'win32') {
    const script = `$x=Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if($x){$x}`
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 3_000 })
    const pid = Number(result.stdout.trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  }
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', timeout: 3_000 })
  const pid = Number(result.stdout.trim().split(/\s+/)[0])
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

async function ready(port, pid, deadline) {
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return { ok: false, reason: `vite_exited_${child.exitCode}` }
    const ownerPid = listenerPid(port)
    if (ownerPid && ownerPid !== pid) return { ok: false, reason: 'listener_owned_by_other_process', listenerPid: ownerPid }
    if (ownerPid === pid) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2_000) })
        if (response.status === 200) return { ok: true, listenerPid: ownerPid, httpStatus: response.status }
      } catch {}
    }
    await delay(250)
  }
  return { ok: false, reason: 'startup_timeout' }
}

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  stopChild()
  releaseLease()
  persist({ state: 'stopped', stoppedAt: new Date().toISOString(), stopReason: reason })
  process.exit(exitCode)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('uncaughtException', error => { console.error(error); void shutdown(`uncaughtException:${error.message}`, 1) })

for (let index = 0; index < maxCandidates; index++) {
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
  const probe = await probeFree(port)
  if (!probe.free) {
    attempt.result = `bind_probe_${probe.reason}`
    attempts.push(attempt)
    releaseLease()
    persist()
    continue
  }

  selectedPort = port
  const argv = [viteCli, '--host', '127.0.0.1', '--port', String(port), '--strictPort']
  const logFd = openSync(logPath, 'a')
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

  const result = await ready(port, child.pid, Date.now() + startupMs)
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
