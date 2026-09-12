import { existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const viteCli = resolve(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js')
const capacitorCli = resolve(frontendDir, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor')
const COMMAND_TIMEOUT_MS = 120_000

function terminate(child) {
  if (child.exitCode !== null || child.signalCode) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true, timeout: 2_000 })
  } else child.kill('SIGTERM')
}

function runStep(label, script, args, env) {
  return new Promise(resolvePromise => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: frontendDir,
      env,
      stdio: 'inherit',
      windowsHide: true,
    })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      terminate(child)
      resolvePromise({ code: 1, timedOut: true })
    }, COMMAND_TIMEOUT_MS)
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(result)
    }
    child.once('error', error => finish({ code: 1, error }))
    child.once('close', (code, signal) => finish({ code: code ?? 1, signal }))
  }).then(result => {
    if (result.timedOut) throw new Error(`${label} timed out after ${COMMAND_TIMEOUT_MS} ms`)
    if (result.error) throw new Error(`${label} could not start: ${result.error.message}`)
    if (result.signal) throw new Error(`${label} was terminated by ${result.signal}`)
    if (result.code !== 0) {
      const error = new Error(`${label} failed with exit code ${result.code}`)
      error.exitCode = result.code > 0 && result.code <= 255 ? result.code : 1
      throw error
    }
  })
}

function assertLocalCli(path, name) {
  if (!existsSync(path)) throw new Error(`Missing local ${name} CLI at ${path}; run npm install first`)
}

async function main() {
  assertLocalCli(viteCli, 'Vite')
  assertLocalCli(capacitorCli, 'Capacitor')

  // Do not mutate process.env: VITE_MOBILE is intended for Vite only, never for Capacitor sync.
  const viteEnv = { ...process.env, VITE_MOBILE: '1' }
  const syncEnv = { ...process.env }
  delete syncEnv.VITE_MOBILE

  await runStep('Vite mobile build', viteCli, ['build'], viteEnv)
  await runStep('Capacitor Android sync', capacitorCli, ['sync', 'android'], syncEnv)
}

try {
  await main()
} catch (error) {
  console.error(`[build:mobile] ${error.message}`)
  process.exitCode = error.exitCode || 1
}
