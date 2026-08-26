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

	// ----- routine editor picker journey (desktop, task 4.2 / spec scenario 1) -----
	// ui-playwright-audit: explicitly resize to the verified desktop layout before the
	// routine-editor journey so the desktop click path is the one being exercised.
	await runStep('resize to desktop for routine editor', ['resize', '1280', '720'], signal)
	await runStep('navigate to plan', ['goto', `${baseUrl}/#/plan`], signal)
	// The plan page shows "Push Day" twice — once as a tag in the weekly schedule, once in
	// the routines list — so the routine entry is always the last matching element.
	await runStep('open Push Day routine', ['click', "getByText('Push Day', { exact: true }).last()"], signal)
	const afterOpenRoutine = await runStep('inspect routine editor', [
		'--raw',
		'eval',
		"JSON.stringify({ hash: location.hash, text: document.body.innerText })"
	], signal)
	let routineState
	try {
		routineState = JSON.parse(afterOpenRoutine.stdout.trim())
		if (typeof routineState === 'string') routineState = JSON.parse(routineState)
	} catch {
		throw new Error(`routine editor returned invalid JSON${details(afterOpenRoutine)}`)
	}
	if (!/^#\/plan\/r\//.test(routineState.hash)) throw new Error(`routine editor: expected #/plan/r/<id>, got ${routineState.hash}`)

	await runStep('open routine picker', ['click', "getByRole('button', { name: /Add exercise|Añadir ejercicio/ }).last()"], signal)
	await runStep('narrow routine picker to push-up', ['fill', "getByPlaceholder(/Search.*exercises|Buscar.*ejercicios/)", 'push-up'], signal)
	await runStep('pick push-up from routine picker', ['click', "getByText('push-up', { exact: true })"], signal)
	await runStep('confirm push-up in routine ExConfig', ['click', "getByRole('button', { name: /Add to routine|Añadir a la rutina/ })"], signal)
	const afterRoutinePick = await runStep('inspect routine picker dismissal', [
		'--raw',
		'eval',
		"JSON.stringify({ hash: location.hash, hasPickerH3: [...document.querySelectorAll('h3')].some(h => /^(Add exercise|Añadir ejercicio)$/i.test(h.textContent.trim())), text: document.body.innerText })"
	], signal)
	let routinePickState
	try {
		routinePickState = JSON.parse(afterRoutinePick.stdout.trim())
		if (typeof routinePickState === 'string') routinePickState = JSON.parse(routinePickState)
	} catch {
		throw new Error(`routine picker dismissal returned invalid JSON${details(afterRoutinePick)}`)
	}
	if (!/^#\/plan\/r\//.test(routinePickState.hash)) throw new Error(`routine picker dismissal: expected #/plan/r/<id>, got ${routinePickState.hash}`)
	if (routinePickState.hasPickerH3) throw new Error('routine picker dismissal: the picker sheet is still visible (h3 still present)')
	if (!routinePickState.text.toLowerCase().includes('push-up')) throw new Error('routine picker dismissal: push-up was not added to the routine')

	// ----- active-workout picker journey (mobile, task 4.1 / spec scenario 2) -----
	// ui-playwright-audit: explicitly resize to the verified 375px mobile layout, then
	// assert innerWidth === 375 before opening the picker. The eval makes the layout
	// claim falsifiable — without it the resize request alone is not coverage.
	await runStep('resize to mobile for workout picker', ['resize', '375', '812'], signal)
	const afterResizeMobile = await runStep('assert mobile viewport (375x812)', [
		'--raw',
		'eval',
		'JSON.stringify({ innerWidth: window.innerWidth, innerHeight: window.innerHeight })'
	], signal)
	let mobileResizeState
	try {
		mobileResizeState = JSON.parse(afterResizeMobile.stdout.trim())
		if (typeof mobileResizeState === 'string') mobileResizeState = JSON.parse(mobileResizeState)
	} catch {
		throw new Error(`mobile resize returned invalid JSON${details(afterResizeMobile)}`)
	}
	if (mobileResizeState.innerWidth !== 375) throw new Error(`mobile resize: expected innerWidth 375, got ${mobileResizeState.innerWidth}`)
	if (mobileResizeState.innerHeight !== 812) throw new Error(`mobile resize: expected innerHeight 812, got ${mobileResizeState.innerHeight}`)

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

	// The bottom "Add exercise" button is the only role match on the active workout page;
	// .last() guards against any other button labelled the same way. Search narrows the
	// picker to a single row so we do not depend on its default ordering.
	await runStep('open workout picker', ['click', "getByRole('button', { name: /Add exercise|Añadir ejercicio/ }).last()"], signal)
	await runStep('narrow picker to push-up', ['fill', "getByPlaceholder(/Search.*exercises|Buscar.*ejercicios/)", 'push-up'], signal)
	await runStep('pick push-up from workout picker', ['click', "getByText('push-up', { exact: true })"], signal)
	await runStep('confirm push-up in workout ExConfig', ['click', "getByRole('button', { name: /Add to routine|Añadir a la rutina/ })"], signal)
	const afterWorkoutPick = await runStep('inspect workout picker dismissal', [
		'--raw',
		'eval',
		"JSON.stringify({ hash: location.hash, hasPickerH3: [...document.querySelectorAll('h3')].some(h => /^(Add exercise|Añadir ejercicio)$/i.test(h.textContent.trim())), text: document.body.innerText })"
	], signal)
	let workoutState
	try {
		workoutState = JSON.parse(afterWorkoutPick.stdout.trim())
		if (typeof workoutState === 'string') workoutState = JSON.parse(workoutState)
	} catch {
		throw new Error(`workout picker dismissal returned invalid JSON${details(afterWorkoutPick)}`)
	}
	if (workoutState.hash !== '#/workout') throw new Error(`workout picker dismissal: expected #/workout, got ${workoutState.hash}`)
	if (workoutState.hasPickerH3) throw new Error('workout picker dismissal: the picker sheet is still visible (h3 still present)')
	if (!workoutState.text.toLowerCase().includes('push-up')) throw new Error('workout picker dismissal: push-up was not added to the active workout')

	// ----- spec scenario 6: existing dismissal and focus behavior is preserved -----
	// Resize back to the verified desktop layout so keyboard/focus + backdrop assertions
	// exercise the desktop click path. The picker is reopened on /workout (the active
	// workout keeps an "Add exercise" button after the previous selection).
	await runStep('resize back to desktop for dismissal test', ['resize', '1280', '720'], signal)
	await runStep('open picker for keyboard/focus test', ['click', "getByRole('button', { name: /Add exercise|Añadir ejercicio/ }).last()"], signal)
	await runStep('focus the picker search input', ['click', "getByPlaceholder(/Search.*exercises|Buscar.*ejercicios/)"], signal)
	await runStep('Tab from the picker search input', ['press', 'Tab'], signal)
	const focusAssertion = await runStep('assert focus stays inside the open sheet', [
		'--raw',
		'eval',
		"JSON.stringify({ hash: location.hash, tag: (document.activeElement && document.activeElement.tagName) || null, insideSheet: !!(document.activeElement && document.activeElement.closest('#modal-root .sheet')) })"
	], signal)
	let focusState
	try {
		focusState = JSON.parse(focusAssertion.stdout.trim())
		if (typeof focusState === 'string') focusState = JSON.parse(focusState)
	} catch {
		throw new Error(`focus assertion returned invalid JSON${details(focusAssertion)}`)
	}
	if (!focusState.insideSheet) throw new Error(`picker focus: active element <${focusState.tag}> is outside the open sheet (focus leaked out of the picker)`)
	if (focusState.hash !== '#/workout') throw new Error(`focus assertion: route changed to ${focusState.hash}, expected #/workout`)

	// Click the actual `.mback` backdrop element. The picker sheet is positioned at the
	// bottom of the viewport, so the center of `.mback` is covered by sheet items and a
	// default center click is intercepted. Use `run-code` with `page.mouse.click` at a
	// verified backdrop coordinate (above the sheet) so the click lands on `.mback` itself.
	const backdropClickCode = [
		"async page => {",
		"  const point = await page.evaluate(() => {",
		"    const mback = document.querySelector('.mback');",
		"    if (!mback) throw new Error('No .mback found before backdrop click');",
		"    const r = mback.getBoundingClientRect();",
		"    if (r.width <= 0 || r.height <= 0) throw new Error('.mback has zero-size bounds');",
		"    return { x: Math.round(r.left + 24), y: Math.round(r.top + 24) };",
		"  });",
		"  await page.mouse.click(point.x, point.y);",
		"  return point;",
		"}"
	].join('\n')
	const backdropClick = await runStep('click .mback backdrop to dismiss the picker', ['run-code', backdropClickCode], signal)
	if (!backdropClick.stdout.trim()) throw new Error(`backdrop click: no point reported from run-code${details(backdropClick)}`)
	const afterBackdrop = await runStep('inspect backdrop dismissal', [
		'--raw',
		'eval',
		"JSON.stringify({ hash: location.hash, sheetCount: document.querySelectorAll('#modal-root .sheet').length, hasPickerH3: [...document.querySelectorAll('h3')].some(h => /^(Add exercise|Añadir ejercicio)$/i.test(h.textContent.trim())), hasError: /Something went wrong|Algo salió mal/i.test(document.body.innerText) })"
	], signal)
	let backdropState
	try {
		backdropState = JSON.parse(afterBackdrop.stdout.trim())
		if (typeof backdropState === 'string') backdropState = JSON.parse(backdropState)
	} catch {
		throw new Error(`backdrop dismissal returned invalid JSON${details(afterBackdrop)}`)
	}
	if (backdropState.sheetCount > 0) throw new Error(`backdrop dismissal: ${backdropState.sheetCount} sheet(s) still visible after .mback click`)
	if (backdropState.hasPickerH3) throw new Error('backdrop dismissal: picker heading is still present after .mback click')
	if (backdropState.hash !== '#/workout') throw new Error(`backdrop dismissal: route changed to ${backdropState.hash}, expected #/workout`)
	if (backdropState.hasError) throw new Error('backdrop dismissal: error view is visible after .mback click')

	// Mobile swipe dismissal: reopen the workout picker on the verified 375px layout and
	// exercise the real Sheet touch handler via Chromium CDP. The smoke script MUST fail
	// nonzero if run-code, CDP touch dispatch, or the swipe sequence cannot execute.
	await runStep('resize to mobile for swipe test', ['resize', '375', '812'], signal)
	const afterReopenMobile = await runStep('assert mobile viewport before swipe', [
		'--raw',
		'eval',
		'JSON.stringify({ innerWidth: window.innerWidth })'
	], signal)
	let reopenMobileState
	try {
		reopenMobileState = JSON.parse(afterReopenMobile.stdout.trim())
		if (typeof reopenMobileState === 'string') reopenMobileState = JSON.parse(reopenMobileState)
	} catch {
		throw new Error(`mobile viewport before swipe returned invalid JSON${details(afterReopenMobile)}`)
	}
	if (reopenMobileState.innerWidth !== 375) throw new Error(`mobile viewport before swipe: expected innerWidth 375, got ${reopenMobileState.innerWidth}`)
	await runStep('open picker for mobile swipe test', ['click', "getByRole('button', { name: /Add exercise|Añadir ejercicio/ }).last()"], signal)

	const swipeRunCode = [
		"async page => {",
		"  const cdpsession = await page.context().newCDPSession(page);",
		"  await cdpsession.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });",
		"  const start = await page.evaluate(() => {",
		"    const sheet = document.querySelector('#modal-root .sheet');",
		"    if (!sheet) throw new Error('No #modal-root .sheet found before swipe');",
		"    sheet.scrollTop = 0;",
		"    const r = sheet.getBoundingClientRect();",
		"    return { x: r.left + r.width / 2, y: r.top + 40 };",
		"  });",
		"  const dy = 200;",
		"  await cdpsession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] });",
		"  for (let i = 1; i <= 5; i++) {",
		"    await page.waitForTimeout(20);",
		"    await cdpsession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x, y: start.y + (dy * i / 5), id: 1 }] });",
		"  }",
		"  await page.waitForTimeout(50);",
		"  await cdpsession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });",
		"  await page.waitForFunction(() => !document.querySelector('#modal-root .sheet'), null, { timeout: 1500 });",
		"  return 'dismissed';",
		"}"
	].join('\n')
	const swipeResult = await runStep('swipe-dismiss mobile picker via Chromium CDP touch', ['run-code', swipeRunCode], signal)
	if (!/dismissed/.test(swipeResult.stdout)) throw new Error(`swipe dismissal: CDP touch did not report dismissed${details(swipeResult)}`)

	const afterSwipe = await runStep('inspect swipe dismissal', [
		'--raw',
		'eval',
		"JSON.stringify({ hash: location.hash, sheetCount: document.querySelectorAll('#modal-root .sheet').length, hasError: /Something went wrong|Algo salió mal/i.test(document.body.innerText) })"
	], signal)
	let swipeState
	try {
		swipeState = JSON.parse(afterSwipe.stdout.trim())
		if (typeof swipeState === 'string') swipeState = JSON.parse(swipeState)
	} catch {
		throw new Error(`swipe dismissal returned invalid JSON${details(afterSwipe)}`)
	}
	if (swipeState.sheetCount > 0) throw new Error(`swipe dismissal: ${swipeState.sheetCount} sheet(s) still visible after CDP touch swipe`)
	if (swipeState.hash !== '#/workout') throw new Error(`swipe dismissal: route changed to ${swipeState.hash}, expected #/workout`)
	if (swipeState.hasError) throw new Error('swipe dismissal: error view is visible after CDP touch swipe')

	// =========================================================================
	// block lifecycle smoke (issue: block-lifecycle-playwright-audit, WU2)
	// =========================================================================
	//
	// Reset → re-enter guest → load starter plan → create+activate a 2-week
	// block → reload → assert activeBlock persisted → edit + assign today's
	// weekday to Push Day → reload → Plan/Home show block schedule → start
	// scheduled workout and assert frozen block context → discard → pause/
	// resume/end → invalid save and cancel preserve prior state → 375px
	// responsive check. Every assertion reads the persisted `gym_state_v1`
	// shape, never a toast — toasts are not proof of success (design #908).
	const readState = async () => {
		const out = await runStep('read gym_state_v1', ['--raw', 'eval', "JSON.parse(localStorage.getItem('gym_state_v1') || 'null')"], signal)
		try { return JSON.parse(out.stdout.trim()) }
		catch { throw new Error('readState: invalid JSON in gym_state_v1' + details(out)) }
	}
	// The Plan card title switches between "Training blocks" (no active) and the
	// active block name (after activation). The regex covers both so the helper
	// stays valid through every lifecycle transition.
	const openBlockManagerFromPlan = async () => {
		await runStep('navigate to plan', ['goto', `${baseUrl}/#/plan`], signal)
		await runStep('open block manager card', ['click', "getByText(/^(Training blocks|Smoke W|Bloques de entrenamiento)$/)"], signal)
	}

	// ----- 3.1 reset cookies/storage and prove a clean start -----
	await runStep('navigate to home before reset', ['goto', `${baseUrl}/#/home`], signal)
	await runStep('clear cookies', ['cookie-clear'], signal)
	await runStep('clear localStorage', ['localstorage-clear'], signal)
	// Force the English locale for deterministic assertions. The block-lifecycle smoke relies on
	// exact text matches against "Active", "Discard" (aria-label), "Save", "Update", "Pause",
	// "Resume", "End block" and the validation card; their Spanish variants are correct in the
	// app but switching on every test machine makes the journey brittle. The previous locale
	// was wiped by `localstorage-clear`; the reload below reads gym_lang_v1 = 'en' and binds
	// the i18n module to English.
	await runStep('force English locale (deterministic i18n)', ['localstorage-set', 'gym_lang_v1', 'en'], signal)
	await runStep('clear sessionStorage', ['sessionstorage-clear'], signal)
	await runStep('reload after reset', ['reload'], signal)
	const cleanOut = await runStep('inspect gym_state_v1 after reset', ['--raw', 'eval',
		"(() => { const raw = localStorage.getItem('gym_state_v1'); if (!raw) return { empty: true }; const s = JSON.parse(raw); return { empty: false, blocks: s.blocks, activeBlock: s.activeBlock } })()"
	], signal)
	const cleanParsed = JSON.parse(cleanOut.stdout.trim())
	if (!cleanParsed.empty && (!Array.isArray(cleanParsed.blocks) || cleanParsed.blocks.length !== 0 || cleanParsed.activeBlock !== null))
		throw new Error(`reset: gym_state_v1 should be empty or {blocks:[],activeBlock:null}; got ${JSON.stringify(cleanParsed)}`)
	await runStep('guest entry after reset', ['click', "getByRole('button', { name: /Continue without account|Continuar sin cuenta/ })"], signal)
	await runStep('load starter plan after reset', ['click', "getByRole('button', { name: /Load starter plan.*PPL|Cargar plan inicial.*PPL/ })"], signal)

	// ----- 3.2 create a 2-week block, activate, reload, assert persisted -----
	await runStep('open plan for block create', ['goto', `${baseUrl}/#/plan`], signal)
	await runStep('open block manager (no active yet)', ['click', "getByText(/^(Training blocks|Bloques de entrenamiento)$/)"], signal)
	await runStep('tap Add block', ['click', "getByRole('button', { name: /Add block|Añadir bloque/ })"], signal)
	await runStep('fill block name', ['fill', "getByPlaceholder(/Block name|Nombre del bloque/)", 'Smoke W'], signal)
	await runStep('add a second week (multi-week)', ['click', "getByRole('button', { name: /Add week|Añadir semana/ })"], signal)
	await runStep('Save and activate block', ['click', "getByRole('button', { name: /Save & activate|Guardar y activar/ })"], signal)
	await runStep('confirm activate', ['click', "getByRole('button', { name: /^Activate$|^Activar$/ })"], signal)
	await runStep('reload after activate', ['reload'], signal)
	const afterActivate = await readState()
	if (!afterActivate.activeBlock) throw new Error('activate: gym_state_v1.activeBlock is null after reload (lifecycle helper return-value was discarded by update)')
	if (afterActivate.activeBlock.status !== 'active') throw new Error(`activate: status should be 'active', got '${afterActivate.activeBlock.status}'`)
	if (afterActivate.activeBlock.blockId !== afterActivate.blocks[0].id) throw new Error(`activate: activeBlock.blockId (${afterActivate.activeBlock.blockId}) ≠ blocks[0].id (${afterActivate.blocks[0].id})`)

	// ----- 3.3 edit (assign today's weekday to Push Day) + reload + Plan/Home show block -----
	const weekdayOut = await runStep('read today weekday', ['--raw', 'eval', 'new Date().getDay()'], signal)
	const weekday = parseInt(weekdayOut.stdout.trim())
	const dayNamesEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
	await openBlockManagerFromPlan()
	await runStep('open Smoke W for edit', ['click', ".list .item:has-text('Smoke W')"], signal)
	await runStep(`open ${dayNamesEn[weekday]} day assign`, ['click', `#modal-root .list .item:has-text('${dayNamesEn[weekday]}')`], signal)
	await runStep('assign Push Day to today', ['click', "#modal-root .list .item:has-text('Push Day')"], signal)
	await runStep('Update block', ['click', "getByRole('button', { name: /^Update$|^Actualizar$/ })"], signal)
	await runStep('reload after edit', ['reload'], signal)
	const afterEdit = await readState()
	const blockDays = afterEdit.blocks[0].weeks[0].days
	if (!Object.values(blockDays).some(d => d && d !== 'rest'))
		throw new Error(`edit: block has no routine assigned in week 1; days=${JSON.stringify(blockDays)}`)
	const planBanner = await runStep('plan banner shows block', ['--raw', 'eval', "({ text: document.body.innerText })"], signal)
	const planText = JSON.parse(planBanner.stdout.trim()).text
	if (!/Smoke W/.test(planText) || !/Active/.test(planText))
		throw new Error(`plan banner: 'Smoke W' or 'Active' missing; got "${planText.slice(0, 200)}"`)
	await runStep('navigate to home', ['goto', `${baseUrl}/#/home`], signal)
	const homeBanner = await runStep('home banner shows block', ['--raw', 'eval', "({ text: document.body.innerText })"], signal)
	const homeText = JSON.parse(homeBanner.stdout.trim()).text
	if (!/Smoke W/.test(homeText)) throw new Error(`home banner: 'Smoke W' missing; got "${homeText.slice(0, 200)}"`)

	// ----- 3.4 start scheduled workout and assert frozen block context -----
	await runStep('open workout chooser', ['goto', `${baseUrl}/#/workout`], signal)
	await runStep('start today plan workout', ['click', "getByRole('button', { name: /^Start Push Day$|^Empezar Push Day$/ })"], signal)
	await runStep('skip weigh-in', ['click', "getByRole('button', { name: /Start without weighing in|Empezar sin pesarse/ })"], signal)
	const afterStart = await readState()
	if (!afterStart.active || !afterStart.active.block) throw new Error('workout: S.active.block is missing — block context was not frozen at workout start')
	if (afterStart.active.block.name !== 'Smoke W') throw new Error(`workout: S.active.block.name should be 'Smoke W', got '${afterStart.active.block.name}'`)
	if (afterStart.active.block.week !== 1) throw new Error(`workout: S.active.block.week should be 1, got ${afterStart.active.block.week}`)
	// Discard the active workout so the lifecycle actions can run cleanly. Two clicks:
	// first the X iconbtn (aria-label=Discard), then the confirm-sheet button (text=Discard).
	await runStep('discard active workout', ['run-code', [
		"async page => {",
		"  await page.getByRole('button', { name: 'Discard', exact: true }).first().click();",
		"  await page.getByRole('button', { name: 'Discard', exact: true }).last().click();",
		"  return 'discarded';",
		"}"
	].join('\n')], signal)

	// ----- 3.5 pause, reload, assert status === 'paused' and pausedOn set -----
	await openBlockManagerFromPlan()
	await runStep('tap Pause button', ['click', "getByRole('button', { name: /^Pause$|^Pausar$/ })"], signal)
	await runStep('confirm Pause', ['click', "getByRole('button', { name: /^Pause$|^Pausar$/ }).last()"], signal)
	await runStep('reload after pause', ['reload'], signal)
	const afterPause = await readState()
	if (!afterPause.activeBlock || afterPause.activeBlock.status !== 'paused') throw new Error(`pause: status should be 'paused', got '${afterPause.activeBlock && afterPause.activeBlock.status}'`)
	if (!afterPause.activeBlock.pausedOn) throw new Error(`pause: pausedOn should be set, got '${afterPause.activeBlock.pausedOn}'`)

	// ----- 3.6 resume, reload, assert status === 'active' and pausedRanges closed -----
	await openBlockManagerFromPlan()
	await runStep('tap Resume button', ['click', "getByRole('button', { name: /^Resume$|^Seguir$/ })"], signal)
	await runStep('confirm Resume', ['click', "getByRole('button', { name: /^Resume$|^Seguir$/ }).last()"], signal)
	await runStep('reload after resume', ['reload'], signal)
	const afterResume = await readState()
	if (!afterResume.activeBlock || afterResume.activeBlock.status !== 'active') throw new Error(`resume: status should be 'active', got '${afterResume.activeBlock && afterResume.activeBlock.status}'`)
	if (!Array.isArray(afterResume.activeBlock.pausedRanges) || afterResume.activeBlock.pausedRanges.length !== 1) throw new Error(`resume: pausedRanges should have 1 closed entry, got ${JSON.stringify(afterResume.activeBlock.pausedRanges)}`)

	// ----- 3.7 end, reload, assert activeBlock === null and legacy resolution restored -----
	await openBlockManagerFromPlan()
	await runStep('tap End block button', ['click', "getByRole('button', { name: /End block|Finalizar bloque/ })"], signal)
	await runStep('confirm End block', ['click', "getByRole('button', { name: /End block|Finalizar bloque/ }).last()"], signal)
	await runStep('reload after end', ['reload'], signal)
	const afterEnd = await readState()
	if (afterEnd.activeBlock !== null) throw new Error(`end: activeBlock should be null, got ${JSON.stringify(afterEnd.activeBlock)}`)
	const legacyOut = await runStep('assert legacy resolution restored', ['--raw', 'eval',
		"(() => { const S = JSON.parse(localStorage.getItem('gym_state_v1')||'null'); const wd = Object.keys(S.week || {}).find(d => S.week[d]); const r = wd && S.routines.find(r => r.id === S.week[wd]); return { weekday: wd ? Number(wd) : null, weekId: wd ? S.week[wd] : null, routineName: r ? r.name : null } })()"
	], signal)
	const legacy = JSON.parse(legacyOut.stdout.trim())
	if (!legacy.weekId) throw new Error(`legacy resolution: a scheduled legacy weekday should resolve via S.week, got ${JSON.stringify(legacy)}`)

	// ----- 3.8 invalid save preserves prior state (blank name) -----
	const baselineBlocks = afterEnd.blocks.length
	await openBlockManagerFromPlan()
	await runStep('Add block for invalid save', ['click', "getByRole('button', { name: /Add block|Añadir bloque/ })"], signal)
	// Save & activate is hidden when v.valid is false (design: error stays hidden until
	// user taps Save once). Use Save (the always-visible button) to trigger validation.
	await runStep('Save with blank name (invalid)', ['click', "getByRole('button', { name: /^Save$|^Guardar$/ })"], signal)
	const invalidOut = await runStep('assert validation errors shown', ['--raw', 'eval',
		"({ hasErrorCard: /Fix these to save|Corrige estos errores para guardar/.test(document.body.innerText), hash: location.hash })"
	], signal)
	const invalidState = JSON.parse(invalidOut.stdout.trim())
	if (!invalidState.hasErrorCard) throw new Error('invalid save: validation error card did not appear; the editor accepted blank input')
	await runStep('Cancel invalid editor', ['click', "getByRole('button', { name: /^Cancel$|^Cancelar$/ })"], signal)
	await runStep('reload after invalid save', ['reload'], signal)
	const afterInvalid = await readState()
	if (afterInvalid.blocks.length !== baselineBlocks) throw new Error(`invalid save: blocks count changed from ${baselineBlocks} to ${afterInvalid.blocks.length} (partial persistence)`)

	// ----- 3.9 cancel preserves prior state -----
	await openBlockManagerFromPlan()
	await runStep('open Smoke W for cancel test', ['click', ".list .item:has-text('Smoke W')"], signal)
	await runStep('fill new name (will cancel)', ['fill', "getByPlaceholder(/Block name|Nombre del bloque/)", 'Modified Smoke W'], signal)
	await runStep('cancel the edit', ['click', "getByRole('button', { name: /^Cancel$|^Cancelar$/ })"], signal)
	await runStep('reload after cancel', ['reload'], signal)
	const afterCancel = await readState()
	if (afterCancel.blocks[0].name !== 'Smoke W') throw new Error(`cancel: blocks[0].name should remain 'Smoke W', got '${afterCancel.blocks[0].name}'`)

	// ----- 3.10 375x812 no overflow + lifecycle controls visible -----
	await openBlockManagerFromPlan()
	await runStep('reopen Smoke W to re-activate', ['click', ".list .item:has-text('Smoke W')"], signal)
	await runStep('Save and re-activate', ['click', "getByRole('button', { name: /Save & activate|Guardar y activar/ })"], signal)
	await runStep('confirm re-activate', ['click', "getByRole('button', { name: /^Activate$|^Activar$/ })"], signal)
	await runStep('resize to mobile 375x812', ['resize', '375', '812'], signal)
	const dimsOut = await runStep('assert 375 viewport + no overflow', ['--raw', 'eval',
		'({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, scrollWidth: document.documentElement.scrollWidth })'
	], signal)
	const dims = JSON.parse(dimsOut.stdout.trim())
	if (dims.innerWidth !== 375) throw new Error(`375: innerWidth should be 375, got ${dims.innerWidth}`)
	if (dims.innerHeight !== 812) throw new Error(`375: innerHeight should be 812, got ${dims.innerHeight}`)
	if (dims.scrollWidth > dims.innerWidth) throw new Error(`375: horizontal overflow: scrollWidth=${dims.scrollWidth} > innerWidth=${dims.innerWidth}`)
	await openBlockManagerFromPlan()
	const mobileOut = await runStep('assert lifecycle controls visible at 375', ['--raw', 'eval',
		"({ hasPause: /Pause|Pausar/.test(document.body.innerText), hasEnd: /End block|Finalizar bloque/.test(document.body.innerText), scrollWidth: document.body.scrollWidth, innerWidth: window.innerWidth })"
	], signal)
	const mobile = JSON.parse(mobileOut.stdout.trim())
	if (!mobile.hasEnd) throw new Error('375: End block control is not visible in the block manager')
	if (mobile.scrollWidth > mobile.innerWidth) throw new Error(`375: body overflow in manager sheet: scrollWidth=${mobile.scrollWidth} > innerWidth=${mobile.innerWidth}`)

	console.log('Playwright smoke passed: picker dismissal (desktop routine-editor, mobile workout 375px, keyboard/focus, backdrop, CDP touch swipe) + block lifecycle (3.1 reset, 3.2-3.7 activate/edit/pause/resume/end persisted across reload, 3.3 Plan/Home show block, 3.4 workout freezes block context, 3.8 invalid save preserves state, 3.9 cancel preserves state, 3.10 375px no overflow + lifecycle controls visible).')
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
