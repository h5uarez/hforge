import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const capacitor = JSON.parse(readFileSync(resolve(frontendDir, 'capacitor.config.json'), 'utf8'))
const packageId = capacitor.appId
const activity = `${packageId}/.MainActivity`
const orcaCommand = process.env.ORCA_CLI_COMMAND || 'orca'
const commandTimeoutMs = boundedNumber(process.env.ANDROID_SMOKE_COMMAND_TIMEOUT_MS, 10_000, 2_000, 60_000)
const overallTimeoutMs = boundedNumber(process.env.ANDROID_SMOKE_TIMEOUT_MS, 45_000, 5_000, 120_000)

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function delay(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))
}

function cleanOutput(value) {
  return String(value || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

function findCommand(command) {
  const direct = spawnSync(command, ['--help'], { stdio: 'ignore', windowsHide: true, timeout: 2_000 })
  if (!direct.error) return command

  const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(lookup, [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 2_000 })
  const match = result.stdout?.trim().split(/\r?\n/)[0]
  return match || null
}

function findAdb() {
  if (process.env.ADB_PATH && existsSync(process.env.ADB_PATH)) return process.env.ADB_PATH
  const sdkRoots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'), join(homedir(), 'Android', 'Sdk'), join(homedir(), 'Library', 'Android', 'sdk')]
  const suffix = process.platform === 'win32' ? '.exe' : ''
  for (const root of sdkRoots.filter(Boolean)) {
    const candidate = join(root, 'platform-tools', `adb${suffix}`)
    if (existsSync(candidate)) return candidate
  }
  return findCommand('adb')
}

function run(command, args, label, timeoutMs = commandTimeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: frontendDir, shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      terminate(child)
      reject(new Error(`${label} timed out after ${timeoutMs} ms`))
    }, timeoutMs)

    child.stdout?.on('data', chunk => { stdout += chunk.toString() })
    child.stderr?.on('data', chunk => { stderr += chunk.toString() })
    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`${label} could not start: ${error.message}`))
    })
    child.once('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const output = cleanOutput(stdout)
      const errorOutput = cleanOutput(stderr)
      if (code !== 0) {
        reject(new Error(`${label} failed with exit code ${code}\n${errorOutput || output || 'no output'}`))
        return
      }
      resolvePromise({ stdout: output, stderr: errorOutput })
    })
  })
}

function terminate(child) {
  if (child.exitCode !== null || child.signalCode) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 2_000 })
  } else child.kill('SIGTERM')
}

async function runJson(command, args, label) {
  const result = await run(command, args, label)
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}\n${result.stdout.slice(0, 1_000)}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
  console.log(`PASS ${message}`)
}

function findNode(root, predicate) {
  if (!root || typeof root !== 'object') return null
  if (predicate(root)) return root
  for (const child of root.children || []) {
    const match = findNode(child, predicate)
    if (match) return match
  }
  return null
}

function parseOrcaDevices(payload) {
  return Array.isArray(payload?.result) ? payload.result : []
}

function parseAdbDevices(output) {
  return output.split(/\r?\n/)
    .map(line => line.trim().match(/^([^\s]+)\s+device$/)?.[1])
    .filter(Boolean)
}

async function waitForForeground(adb, serial) {
  let last = ''
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await run(adb, ['-s', serial, 'shell', 'dumpsys', 'activity', 'activities'], 'Android foreground check')
    last = result.stdout
    if (last.includes(packageId)) return last
    await delay(250)
  }
  throw new Error(`Assertion failed: ${packageId} was not foreground after 5 seconds\n${last.slice(0, 2_000)}`)
}

async function smokeWithAdb(adb, serial) {
  const foreground = await waitForForeground(adb, serial)
  assert(foreground.includes(packageId), `${packageId} is the foreground Android application`)

  const size = await run(adb, ['-s', serial, 'shell', 'wm', 'size'], 'Android display-size check')
  const dimensions = size.stdout.match(/(?:Physical size|Override size):\s*(\d+)x(\d+)/)
  assert(dimensions && Number(dimensions[1]) > 0 && Number(dimensions[2]) > 0, 'Android reports a non-zero display size')

  await run(adb, ['-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/hforge-window.xml'], 'Android accessibility dump')
  const xml = await run(adb, ['-s', serial, 'shell', 'cat', '/sdcard/hforge-window.xml'], 'Android accessibility-tree read')
  assert(xml.stdout.includes('android.webkit.WebView'), 'Hforge exposes its Capacitor WebView to Android')
  assert(xml.stdout.includes(packageId), `Android accessibility tree belongs to ${packageId}`)

  const logcat = await run(adb, ['-s', serial, 'logcat', '-d', '-t', '200'], 'Android logcat check')
  assert(!(/FATAL EXCEPTION/i.test(logcat.stdout) && logcat.stdout.includes(packageId)), `${packageId} has no fatal exception in recent logcat`)
}

async function smokeWithOrca(orca) {
  const ax = await runJson(orca, ['emulator', 'ax', '--json'], 'Orca Android accessibility snapshot')
  const root = ax?.result
  const webView = findNode(root, node => node.className === 'android.webkit.WebView' && node.packageName === packageId)
  assert(!!webView, `Orca sees the ${packageId} WebView`)
  assert(webView.bounds?.right > webView.bounds?.left && webView.bounds?.bottom > webView.bounds?.top, 'Orca sees a visible WebView with non-zero bounds')

  const logcat = await runJson(orca, ['emulator', 'logcat', '--lines', '200', '--json'], 'Orca Android logcat check')
  const text = JSON.stringify(logcat)
  assert(!(/FATAL EXCEPTION/i.test(text) && text.includes(packageId)), `${packageId} has no fatal exception in recent Orca logcat`)
}

function skip(message) {
  console.log(`SKIP: Android smoke did not run: ${message}`)
  console.log('Use Android Studio/SDK plus a booted emulator, then rerun `npm run test:android`.')
  return 2
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: npm run test:android')
    console.log('Prerequisites: Orca with a booted Android emulator, or adb with a booted device.')
    console.log('An unavailable device is reported as SKIP and exits with code 2; failed smoke assertions exit with code 1.')
    console.log('The harness never stops the emulator or backgrounds Hforge after a successful run.')
    return 0
  }

  const orca = findCommand(orcaCommand)
  const adb = findAdb()
  let serial = process.env.ANDROID_SERIAL || null
  let backend = null

  if (orca) {
    try {
      const devices = parseOrcaDevices(await runJson(orca, ['emulator', 'devices', '--json'], 'Orca Android device discovery'))
      const device = devices.find(item => item.backend === 'android' && item.state === 'booted' && item.isAvailable)
      if (device) {
        serial = serial || device.id
        backend = 'orca'
        console.log(`Using Orca Android device ${serial} (${device.name})`)
      } else console.log('Orca is available, but it reports no booted Android device.')
    } catch (error) {
      console.log(`Orca discovery unavailable: ${error.message}`)
    }
  } else console.log(`Orca is unavailable (${orcaCommand}); checking adb directly.`)

  if (!serial && adb) {
    const devices = await run(adb, ['devices'], 'adb device discovery')
    serial = parseAdbDevices(devices.stdout).find(item => item.startsWith('emulator-')) || parseAdbDevices(devices.stdout)[0] || null
    if (serial) {
      backend = 'adb'
      console.log(`Using adb Android device ${serial}`)
    }
  }

  if (!serial || !backend) return skip(orca ? 'no booted Android device is visible to Orca or adb' : 'Orca and adb are unavailable')

  if (backend === 'orca') {
    try {
      await runJson(orca, ['emulator', 'attach', serial, '--json'], 'Orca Android attach')
      await runJson(orca, ['emulator', 'launch', packageId, '--device', serial, '--json'], `Orca launch of ${packageId}`)
    } catch (error) {
      if (!adb) throw error
      console.log(`Orca launch failed; falling back to adb: ${error.message}`)
      backend = 'adb'
    }
  }
  if (backend === 'adb') await run(adb, ['-s', serial, 'shell', 'am', 'start', '-n', activity], `adb launch of ${packageId}`)

  if (adb) await smokeWithAdb(adb, serial)
  if (backend === 'orca') await smokeWithOrca(orca)

  console.log(`PASS Android smoke completed for ${packageId}; Hforge remains visible on ${serial}.`)
  return 0
}

const guard = setTimeout(() => {
  console.error(`FAIL Android smoke exceeded its ${overallTimeoutMs} ms overall timeout`)
  process.exitCode = 1
}, overallTimeoutMs)

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`FAIL Android smoke: ${error.message}`)
  process.exitCode = 1
} finally {
  clearTimeout(guard)
}
