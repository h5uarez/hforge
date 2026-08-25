#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = dirname(scriptDir)
const cliPath = join(frontendDir, 'node_modules', '@playwright', 'cli', 'playwright-cli.js')
const sessionArgs = ['-s=hforge-playwright-smoke']
const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080'
const visiblePauseMs = 3000

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: frontendDir,
      env: { ...process.env, CI: '1' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', error => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    child.once('close', code => {
      if (!settled) {
        settled = true
        resolve({ code, stdout, stderr })
      }
    })
  })
}

function details(result) {
  const output = `${result.stderr}\n${result.stdout}`.trim()
  return output ? `: ${output.slice(-500)}` : ''
}

async function runStep(stage, args) {
  const result = await runCli([...sessionArgs, ...args])
  if (result.code !== 0) throw new Error(`${stage} failed (exit ${result.code})${details(result)}`)
  return result
}

let failed = false

try {
  await runStep('open hforge', ['open', baseUrl, '--headed'])
  await runStep('guest entry', ['click', "getByRole('button', { name: /Continue without account|Continuar sin cuenta/ })"])
  await runStep('load starter plan', ['click', "getByRole('button', { name: /Load starter plan.*PPL|Cargar plan inicial.*PPL/ })"])
  await runStep('open workout chooser', ['goto', `${baseUrl}/#/workout`])
  await runStep('select Push Day', ['click', "getByText('Push Day', { exact: true })"])
  await runStep('skip weigh-in', ['click', "getByRole('button', { name: /Start without weighing in|Empezar sin pesarse/ })"])

  const page = await runStep('inspect active workout', [
    '--raw',
    'eval',
    'JSON.stringify({ hash: location.hash, text: document.body.innerText })'
  ])
  let state
  try {
    state = JSON.parse(page.stdout.trim())
    if (typeof state === 'string') state = JSON.parse(state)
  } catch {
    throw new Error(`active workout returned invalid JSON${details(page)}`)
  }
  if (state.hash !== '#/workout') throw new Error(`expected #/workout, got ${state.hash}`)
  if (!state.text.includes('Push Day')) throw new Error('active workout does not expose Push Day')

  console.log('Playwright smoke passed: guest reached the Push Day workout.')
  await new Promise(resolve => setTimeout(resolve, visiblePauseMs))
} catch (error) {
  failed = true
  console.error(`Playwright smoke failed: ${error.message}`)
} finally {
  try {
    const closed = await runCli([...sessionArgs, 'close'])
    if (closed.code !== 0) throw new Error(`close exited with code ${closed.code}${details(closed)}`)
  } catch (error) {
    failed = true
    console.error(`Playwright smoke cleanup failed: ${error.message}`)
  }
}

if (failed) process.exitCode = 1
