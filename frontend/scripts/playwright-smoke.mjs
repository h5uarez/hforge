#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = dirname(scriptDir)
const repoDir = dirname(frontendDir)
const cliPath = join(frontendDir, 'node_modules', '@playwright', 'cli', 'playwright-cli.js')
const launcherPath = join(repoDir, 'start-local.bat')
const sessionArgs = ['-s=hforge-playwright-smoke']
const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080'
const services = [
	{ name: 'frontend', url: baseUrl },
	{ name: 'API', url: 'http://localhost:3000' },
	{ name: 'media', url: 'http://localhost:8888' }
]
const probeTimeoutMs = 1000
// Readiness allows extra time for local services and first-run startup.
const readinessTimeoutMs = 60000
const readinessPollMs = 500
const cliTimeoutMs = readTimeout('PLAYWRIGHT_CLI_TIMEOUT_MS', 45000)
const smokeTimeoutMs = readTimeout('PLAYWRIGHT_SMOKE_TIMEOUT_MS', 300000)
const processTreeTimeoutMs = 5000
// Keep this aligned with start-local.bat: it means the named mutex is already owned.
const launcherAlreadyRunningExitCode = 75
const launcherOwnedMarker = 'Hforge local launcher acquired the mutex.'

function readTimeout(name, fallback) {
	const value = Number(process.env[name])
	return Number.isFinite(value) && value > 0 ? value : fallback
}

function signalError(signal) {
	const reason = signal?.reason
	return reason instanceof Error ? reason : new Error('Playwright smoke was aborted')
}

function throwIfAborted(signal) {
	if (signal?.aborted) throw signalError(signal)
}

function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		let settled = false
		let timer
		const onAbort = () => finish(() => reject(signalError(signal)))
		const finish = callback => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			signal?.removeEventListener('abort', onAbort)
			callback()
		}
		timer = setTimeout(() => finish(resolve), ms)
		if (signal?.aborted) onAbort()
		else signal?.addEventListener('abort', onAbort, { once: true })
	})
}

async function probeService(service, signal) {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), probeTimeoutMs)
	const onAbort = () => controller.abort(signal.reason)
	if (signal?.aborted) onAbort()
	else signal?.addEventListener('abort', onAbort, { once: true })
	try {
		await fetch(service.url, { signal: controller.signal })
		return true
	} catch {
		if (signal?.aborted) throw signalError(signal)
		return false
	} finally {
		clearTimeout(timeout)
		signal?.removeEventListener('abort', onAbort)
	}
}

async function probeServices(signal) {
	return Promise.all(services.map(async service => ({
		...service,
		available: await probeService(service, signal)
	})))
}

function serviceSummary(results) {
	return results.map(service => `${service.name}=${service.available ? 'ready' : 'unavailable'}`).join(', ')
}

function unavailableServices(results) {
	return results.filter(service => !service.available).map(service => `${service.name} (${service.url})`).join(', ')
}

function startLocalServices() {
	const launcher = {
		child: spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'call', launcherPath, '--smoke'], {
			cwd: repoDir,
			env: { ...process.env },
			shell: false,
			detached: false,
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe']
		}),
		stdout: '',
		stderr: '',
		error: null,
		state: 'pending',
		owned: false
	}
	launcher.child.stdout.setEncoding('utf8')
	launcher.child.stdout.on('data', chunk => {
		launcher.stdout += chunk
		updateLauncherState(launcher)
	})
	launcher.child.stderr.setEncoding('utf8')
	launcher.child.stderr.on('data', chunk => {
		launcher.stderr += chunk
		updateLauncherState(launcher)
	})
	launcher.child.once('error', error => { launcher.error = error })
	return launcher
}

function launcherDetails(launcher) {
	const output = `${launcher.stderr}\n${launcher.stdout}`.trim()
	return output ? `: ${output.slice(-500)}` : ''
}

function updateLauncherState(launcher) {
	if (launcher.state !== 'pending') return
	const output = `${launcher.stderr}\n${launcher.stdout}`
	if (output.includes(launcherOwnedMarker)) {
		launcher.state = 'owned'
		launcher.owned = true
	} else if (launcher.child.exitCode === launcherAlreadyRunningExitCode) {
		launcher.state = 'already-running'
	}
}

async function waitForServices(launcher, signal) {
	const deadline = Date.now() + readinessTimeoutMs
	let results = await probeServices(signal)
	let reportedAlreadyRunning = false
	while (Date.now() < deadline) {
		throwIfAborted(signal)
		updateLauncherState(launcher)
		if (launcher.error) {
			throw new Error(`start-local.bat could not be started: ${launcher.error.message}${launcherDetails(launcher)}`)
		}
		if (launcher.state === 'already-running') {
			if (!reportedAlreadyRunning) {
				console.log(`start-local.bat is already running (exit ${launcherAlreadyRunningExitCode}); waiting for its services.`)
				reportedAlreadyRunning = true
			}
			if (results.every(service => service.available)) {
				console.log(`Reusing already-running local Hforge services (${serviceSummary(results)}).`)
				return false
			}
		} else if (launcher.state === 'owned' && results.every(service => service.available)) {
			console.log(`Local Hforge services are ready (${serviceSummary(results)}).`)
			return true
		} else if (launcher.child.exitCode !== null) {
			throw new Error(`start-local.bat exited with code ${launcher.child.exitCode} before all services were ready (${serviceSummary(results)})${launcherDetails(launcher)}`)
		}
		await sleep(readinessPollMs, signal)
		results = await probeServices(signal)
	}
	throwIfAborted(signal)
	if (launcher.state === 'pending') {
		throw new Error(`Timed out after ${readinessTimeoutMs / 1000}s waiting for start-local.bat mutex ownership (${serviceSummary(results)})${launcherDetails(launcher)}`)
	}
	throw new Error(`Timed out after ${readinessTimeoutMs / 1000}s waiting for local services: ${unavailableServices(results)}`)
}

function terminateProcessTreeByPid(pid) {
	return new Promise((resolve, reject) => {
		const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
			windowsHide: true,
			stdio: ['ignore', 'ignore', 'pipe']
		})
		let stderr = ''
		let settled = false
		let timeout
		const finish = callback => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			callback()
		}
		timeout = setTimeout(() => {
			if (killer.exitCode === null) killer.kill()
			finish(() => reject(new Error(`taskkill timed out after ${processTreeTimeoutMs}ms`)))
		}, processTreeTimeoutMs)
		killer.stderr.setEncoding('utf8')
		killer.stderr.on('data', chunk => { stderr += chunk })
		killer.once('error', error => finish(() => reject(error)))
		killer.once('close', code => {
			if (code === 0) return finish(resolve)
			finish(() => reject(new Error(`taskkill exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)))
		})
	})
}

function terminateChildProcessTree(child) {
	if (!child || child.exitCode !== null) return Promise.resolve()
	if (process.platform !== 'win32') {
		child.kill('SIGTERM')
		return Promise.resolve()
	}
	return terminateProcessTreeByPid(child.pid)
}

function terminateProcessTree(launcher) {
	if (!launcher?.owned || launcher.child.exitCode !== null) return Promise.resolve()
	return terminateChildProcessTree(launcher.child)
}

function runCli(args, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signalError(signal))
		const child = spawn(process.execPath, [cliPath, ...args], {
			cwd: frontendDir,
			env: { ...process.env, CI: '1' },
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe']
		})
		let stdout = ''
		let stderr = ''
		let settled = false
		let terminating = false
		let timeout
		const onAbort = () => terminate(signalError(signal))
		const finish = callback => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			signal?.removeEventListener('abort', onAbort)
			callback()
		}
		const terminate = reason => {
			if (settled || terminating) return
			terminating = true
			void terminateChildProcessTree(child)
				.catch(() => {})
				.finally(() => finish(() => reject(reason)))
		}
		timeout = setTimeout(() => {
			terminate(new Error(`Playwright CLI timed out after ${cliTimeoutMs}ms`))
		}, cliTimeoutMs)

		child.stdout.setEncoding('utf8')
		child.stderr.setEncoding('utf8')
		child.stdout.on('data', chunk => { stdout += chunk })
		child.stderr.on('data', chunk => { stderr += chunk })
		child.once('error', error => {
			if (!terminating) finish(() => reject(error))
		})
		child.once('close', code => {
			if (!terminating) finish(() => resolve({ code, stdout, stderr }))
		})
		signal?.addEventListener('abort', onAbort, { once: true })
		if (signal?.aborted) onAbort()
	})
}

function details(result) {
  const output = `${result.stderr}\n${result.stdout}`.trim()
  return output ? `: ${output.slice(-500)}` : ''
}

async function runStep(stage, args, signal) {
	const result = await runCli([...sessionArgs, ...args], signal)
	if (result.code !== 0) throw new Error(`${stage} failed (exit ${result.code})${details(result)}`)
	return result
}

let failed = false
let startedBySmoke = false
let launcher = null

async function runSmoke(signal) {
	const initialServices = await probeServices(signal)
	if (initialServices.every(service => service.available)) {
		console.log(`Reusing already-running local Hforge services (${serviceSummary(initialServices)}).`)
	} else if (initialServices.some(service => service.available)) {
		throw new Error(`Local services are only partially available (${serviceSummary(initialServices)}); start-local.bat was not run to avoid disturbing existing services.`)
	} else {
		launcher = startLocalServices()
		startedBySmoke = await waitForServices(launcher, signal)
	}

	await runStep('open hforge', ['open', baseUrl], signal)
	await runStep('guest entry', ['click', "getByRole('button', { name: /Continue without account|Continuar sin cuenta/ })"], signal)
	await runStep('load starter plan', ['click', "getByRole('button', { name: /Load starter plan.*PPL|Cargar plan inicial.*PPL/ })"], signal)
	await runStep('open workout chooser', ['goto', `${baseUrl}/#/workout`], signal)
	await runStep('select Push Day', ['click', "getByText('Push Day', { exact: true })"], signal)
	await runStep('skip weigh-in', ['click', "getByRole('button', { name: /Start without weighing in|Empezar sin pesarse/ })"], signal)

	const page = await runStep('inspect active workout', [
		'--raw',
		'eval',
		'JSON.stringify({ hash: location.hash, text: document.body.innerText })'
	], signal)
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
}

const smokeController = new AbortController()
const smokeTimeoutError = new Error(`Playwright smoke timed out after ${smokeTimeoutMs}ms`)
const smokeTimer = setTimeout(() => smokeController.abort(smokeTimeoutError), smokeTimeoutMs)

try {
	await runSmoke(smokeController.signal)
} catch (error) {
	failed = true
	console.error(`Playwright smoke failed: ${error.message}`)
} finally {
	clearTimeout(smokeTimer)
	try {
		const closed = await runCli([...sessionArgs, 'close'])
		if (closed.code !== 0) throw new Error(`close exited with code ${closed.code}${details(closed)}`)
	} catch (error) {
		failed = true
		console.error(`Playwright smoke cleanup failed: ${error.message}`)
	}
	if (startedBySmoke || launcher?.owned) {
		try {
			await terminateProcessTree(launcher)
		} catch (error) {
			failed = true
			console.error(`Local service cleanup failed: ${error.message}`)
		}
	}
}

if (failed) process.exitCode = 1
