#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { basename } from 'node:path'

const DEFAULT_TIMEOUT_MS = 120_000
const CLEANUP_TIMEOUT_MS = 10_000
const PROCESS_TREE_GRACE_MS = 5_000
const TIMEOUT_EXIT_CODE = 124

function usage() {
  return [
    'Usage:',
    '  node with-timeout.mjs [--timeout-ms=<positive-ms>] [--session=<name>] -- <command> [args...]',
    '',
    'The command and every argument after -- are passed without a shell.'
  ].join('\n')
}

function positiveInteger(value, option) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${option} must be a positive integer in milliseconds`)
  }
  return number
}

function parseInvocation(argv) {
  const separator = argv.indexOf('--')
  if (separator < 0) throw new Error(`Missing -- before the command\n\n${usage()}`)

  let timeoutMs = DEFAULT_TIMEOUT_MS
  let session
  for (let index = 0; index < separator; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      console.log(usage())
      process.exit(0)
    }
    if (argument === '--timeout-ms') {
      timeoutMs = positiveInteger(argv[++index], '--timeout-ms')
      continue
    }
    if (argument.startsWith('--timeout-ms=')) {
      timeoutMs = positiveInteger(argument.slice('--timeout-ms='.length), '--timeout-ms')
      continue
    }
    if (argument === '--session') {
      session = argv[++index]
      continue
    }
    if (argument.startsWith('--session=')) {
      session = argument.slice('--session='.length)
      continue
    }
    throw new Error(`Unknown wrapper option: ${argument}\n\n${usage()}`)
  }

  const command = argv[separator + 1]
  const commandArgs = argv.slice(separator + 2)
  if (!command) throw new Error(`Missing command after --\n\n${usage()}`)
  if (session !== undefined && (!session || /[\0\r\n]/u.test(session))) {
    throw new Error('--session must be a non-empty name without control characters')
  }

  return { command, commandArgs, session, timeoutMs }
}

function startProcess(command, args, { detached = process.platform !== 'win32', stdio = 'inherit' } = {}) {
  let child
  try {
    child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env },
      shell: false,
      windowsHide: true,
      detached,
      stdio
    })
  } catch (error) {
    return { child: null, exited: Promise.resolve({ error }) }
  }

  let resolveExit
  const exited = new Promise(resolve => { resolveExit = resolve })
  let settled = false
  const finish = result => {
    if (settled) return
    settled = true
    resolveExit(result)
  }
  child.once('error', error => finish({ error }))
  child.once('exit', (code, signal) => finish({ code, signal }))
  return { child, exited }
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise(resolve => {
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      child.removeListener('error', onError)
      resolve(value)
    }
    const onExit = () => finish(true)
    const onError = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

async function runFixedProcess(command, args, timeoutMs) {
  const running = startProcess(command, args, { detached: false, stdio: 'ignore' })
  if (!running.child) return await running.exited

  let timer
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
  })
  const result = await Promise.race([running.exited, timeout])
  clearTimeout(timer)
  if (result.timedOut) {
    running.child.kill()
    await waitForExit(running.child, PROCESS_TREE_GRACE_MS)
  }
  return result
}

async function terminateProcessTree(child) {
  if (!child?.pid) return

  if (process.platform === 'win32') {
    const result = await runFixedProcess('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], PROCESS_TREE_GRACE_MS)
    if (result.error || result.timedOut || result.code !== 0) child.kill()
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
    if (!(await waitForExit(child, PROCESS_TREE_GRACE_MS))) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
  }

  await waitForExit(child, PROCESS_TREE_GRACE_MS)
  child.unref()
}

function commandName(command) {
  return basename(command).toLowerCase().replace(/\.(cmd|bat)$/u, '')
}

function isNodeCommand(command) {
  return commandName(command) === 'node' || commandName(command) === 'nodejs'
}

function isPlaywrightCliToken(argument) {
  const name = commandName(argument)
  return name === 'playwright-cli' || name === 'playwright-cli.js' || argument === '@playwright/cli'
}

function cleanupInvocation(command, args, session) {
  if (commandName(command) === 'playwright-cli' || commandName(command) === 'playwright-cli.js') {
    return { command, args: [`-s=${session}`, 'close'] }
  }

  if (isNodeCommand(command)) {
    const scriptIndex = args.findIndex(argument => commandName(argument) === 'playwright-cli.js')
    if (scriptIndex >= 0) {
      return { command, args: [...args.slice(0, scriptIndex + 1), `-s=${session}`, 'close'] }
    }
  }

  const launcherIndex = args.findIndex((argument, index) =>
    isPlaywrightCliToken(argument) || (argument === 'cli' && args[index - 1] === 'playwright')
  )
  if (launcherIndex >= 0) {
    return { command, args: [...args.slice(0, launcherIndex + 1), `-s=${session}`, 'close'] }
  }

  return null
}

async function closeNamedSession(command, args, session) {
  const cleanup = cleanupInvocation(command, args, session)
  if (!cleanup) {
    console.error(`[with-timeout] Could not derive a Playwright close command; session "${session}" was not closed.`)
    return
  }

  console.error(`[with-timeout] Closing named Playwright session "${session}".`)
  const result = await runFixedProcess(cleanup.command, cleanup.args, CLEANUP_TIMEOUT_MS)
  if (result.timedOut) {
    console.error(`[with-timeout] Session close timed out after ${CLEANUP_TIMEOUT_MS} ms; no retry will be attempted.`)
  } else if (result.error) {
    console.error(`[with-timeout] Session close failed: ${result.error.message}`)
  } else if (result.code !== 0) {
    console.error(`[with-timeout] Session close exited with code ${result.code ?? 'unknown'}.`)
  }
}

async function main() {
  const invocation = parseInvocation(process.argv.slice(2))
  const running = startProcess(invocation.command, invocation.commandArgs)
  if (!running.child) {
    const error = (await running.exited).error
    console.error(`[with-timeout] Could not start command: ${error.message}`)
    process.exitCode = 1
    return
  }

  let timer
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ timedOut: true }), invocation.timeoutMs)
  })
  const result = await Promise.race([running.exited, timeout])
  clearTimeout(timer)

  if (!result.timedOut) {
    if (result.error) {
      console.error(`[with-timeout] Command failed to start: ${result.error.message}`)
      process.exitCode = 1
    } else {
      process.exitCode = typeof result.code === 'number' ? result.code : 1
    }
    return
  }

  console.error(`[with-timeout] Playwright CLI command timed out after ${invocation.timeoutMs} ms; it will not be retried.`)
  await terminateProcessTree(running.child)
  if (invocation.session) {
    await closeNamedSession(invocation.command, invocation.commandArgs, invocation.session)
  } else {
    console.error('[with-timeout] No named session was specified; no Playwright session was closed.')
  }
  process.exitCode = TIMEOUT_EXIT_CODE
}

try {
  await main()
} catch (error) {
  console.error(`[with-timeout] ${error.message}`)
  process.exitCode = 1
}
