import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { EXDB } from '../src/lib/exercises-data.js'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(frontend, '..')
const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'hforge-playwright-'))
const dataRoot = resolve(temporaryRoot, 'data')
const mediaRoot = resolve(temporaryRoot, 'media')
const children = []
let stopping = false

const gif = createSyntheticGif()

const delay = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))

function createSyntheticGif(size = 160) {
  const pixels = new Uint8Array(size * size)
  const scale = size / 160
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - size / 2
      const dy = y - size / 2
      const ring = Math.hypot(dx, dy) >= 11 * scale && Math.hypot(dx, dy) <= 16 * scale
      const bar = x >= 40 * scale && x <= 120 * scale && Math.abs(dy) <= 3.5 * scale
      const plates = ((Math.abs(x - 55 * scale) <= 3.5 * scale) || (Math.abs(x - 105 * scale) <= 3.5 * scale))
        && y >= 62 * scale && y <= 98 * scale
      if (ring || bar || plates) pixels[y * size + x] = 1
    }
  }

  // A clear code after every two pixels keeps the LZW code width fixed at three bits.
  // The payload stays compact while avoiding an encoder dependency in the test harness.
  const compressed = []
  let pending = 0
  let pendingBits = 0
  const emit = code => {
    pending |= code << pendingBits
    pendingBits += 3
    while (pendingBits >= 8) {
      compressed.push(pending & 0xff)
      pending >>= 8
      pendingBits -= 8
    }
  }
  for (let index = 0; index < pixels.length; index += 2) {
    emit(4)
    emit(pixels[index])
    if (index + 1 < pixels.length) emit(pixels[index + 1])
  }
  emit(5)
  if (pendingBits > 0) compressed.push(pending & 0xff)

  const logicalScreen = Buffer.alloc(7)
  logicalScreen.writeUInt16LE(size, 0)
  logicalScreen.writeUInt16LE(size, 2)
  logicalScreen[4] = 0x80
  const descriptor = Buffer.alloc(10)
  descriptor[0] = 0x2c
  descriptor.writeUInt16LE(size, 5)
  descriptor.writeUInt16LE(size, 7)
  const blocks = []
  for (let offset = 0; offset < compressed.length; offset += 255) {
    const block = Buffer.from(compressed.slice(offset, offset + 255))
    blocks.push(Buffer.from([block.length]), block)
  }
  return Buffer.concat([
    Buffer.from('GIF89a', 'ascii'),
    logicalScreen,
    Buffer.from([0x17, 0x17, 0x19, 0x30, 0xd1, 0x58]),
    descriptor,
    Buffer.from([2]),
    ...blocks,
    Buffer.from([0, 0x3b]),
  ])
}

async function createSyntheticMedia() {
  await Promise.all([mkdir(dataRoot), mkdir(resolve(mediaRoot, 'img'), { recursive: true }), mkdir(resolve(mediaRoot, 'gif'), { recursive: true })])
  const browser = await chromium.launch()
  let jpeg
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 640 } })
    await page.setContent('<style>html,body{margin:0;background:#171719}</style><svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><rect width="640" height="640" fill="#171719"/><path d="M160 320h320M220 250v140M420 250v140" stroke="#30d158" stroke-width="28" stroke-linecap="round"/><circle cx="320" cy="320" r="52" fill="none" stroke="#30d158" stroke-width="18"/></svg>')
    jpeg = await page.screenshot({ type: 'jpeg', quality: 90 })
  } finally {
    await browser.close()
  }
  const imageNames = new Set(EXDB.map(exercise => exercise.img).filter(Boolean))
  const gifNames = new Set(EXDB.map(exercise => exercise.gif).filter(Boolean))
  // Keep aliases independent: NTFS limits hard links per source file, while these compact
  // synthetic payloads remain bounded and avoid any dependency on an operator media library.
  for (const name of imageNames) await writeFile(resolve(mediaRoot, 'img', name), jpeg)
  for (const name of gifNames) await writeFile(resolve(mediaRoot, 'gif', name), gif)
}

function start(name, command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: false,
    stdio: 'inherit',
  })
  child.name = name
  child.exited = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })))
  children.push(child)
  child.exited.then(({ code, signal }) => {
    if (stopping) return
    console.error(`${name} exited before the Playwright stack stopped (${signal || code})`)
    void stop(1)
  })
  return child
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode) return
  child.kill()
  const exited = await Promise.race([child.exited.then(() => true), delay(2_000).then(() => false)])
  if (exited) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    child.kill('SIGKILL')
  }
  await Promise.race([child.exited, delay(2_000)])
}

async function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  await Promise.all([...children].reverse().map(stopChild))
  await rm(temporaryRoot, { recursive: true, force: true })
  process.exit(exitCode)
}

async function waitFor(url, validate, label) {
  let lastError
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const response = await fetch(url)
      const body = Buffer.from(await response.arrayBuffer())
      if (response.ok && validate(response, body)) return
      lastError = new Error(`${response.status} ${response.headers.get('content-type') || 'no content type'}`)
    } catch (error) { lastError = error }
    await delay(25)
  }
  throw new Error(`${label} did not become ready: ${lastError?.message || 'unknown error'}`)
}

function isJpeg(response, body) {
  return response.headers.get('content-type') === 'image/jpeg' && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
}

function isGif(response, body) {
  return response.headers.get('content-type') === 'image/gif' && body.subarray(0, 6).toString('ascii') === 'GIF89a'
}

async function main() {
  await createSyntheticMedia()
  start('media server', process.execPath, [resolve(root, 'scripts/serve-media.mjs')], root, {
    MEDIA_ROOT: mediaRoot,
    MEDIA_PORT: '4175',
  })
  await waitFor('http://127.0.0.1:4175/img/0025-EIeI8Vf.jpg', isJpeg, 'media server')

  start('API server', process.execPath, ['server.js'], resolve(root, 'api'), {
    DATA_DIR: dataRoot,
    PORT: '4174',
    RP_ID: 'localhost',
    RP_NAME: 'Hforge Browser Tests',
    ORIGIN: 'http://localhost:4173',
    SESSION_SECRET: 'playwright-only-session-secret',
    INVITE_ONLY: 'false',
  })
  await waitFor('http://127.0.0.1:4174/api/health', response => response.headers.get('content-type')?.startsWith('application/json'), 'API server')

  start('Vite server', process.execPath, [resolve(frontend, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4173', '--strictPort'], frontend, {
    API_TARGET: 'http://127.0.0.1:4174',
    MEDIA_TARGET: 'http://127.0.0.1:4175',
  })
  await waitFor('http://127.0.0.1:4173/img/0025-EIeI8Vf.jpg', isJpeg, 'Vite image proxy')
  await waitFor('http://127.0.0.1:4173/gif/0025-EIeI8Vf.gif', isGif, 'Vite GIF proxy')
  console.log('Playwright API, media, and Vite proxy stack is ready')
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop(0) })
process.on('uncaughtException', error => { console.error(error); void stop(1) })
process.on('unhandledRejection', error => { console.error(error); void stop(1) })
process.on('exit', () => {
  for (const child of children) if (child.exitCode === null && !child.signalCode) child.kill()
})

main().catch(error => {
  console.error(error)
  void stop(1)
})
await new Promise(() => {})
