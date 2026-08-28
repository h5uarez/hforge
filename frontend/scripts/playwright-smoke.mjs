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

	// ----- 3.1 reset cookies/storage and prove a clean start (moved to the start of the smoke) -----
	// Replaces the earlier duplicate pre-reset that ran before the routine-editor and active-workout
	// picker journeys: that block asserted "guest entry" / "load starter plan" controls that no
	// longer exist on the Home hero, so the smoke exited 1 at the very first step. The new
	// bootstrap opens the app exactly once, then navigates to Home, clears cookies + localStorage
	// + sessionStorage, forces the English locale, reloads, asserts `gym_state_v1` is empty (or
	// { blocks: [], activeBlock: null }), and only then clicks guest entry + load starter plan
	// once. Every later journey (routine-editor, active-workout picker, persisted block edit,
	// active Today's-plan training, block-rest, 375px lifecycle, legacy fallback) runs against
	// this single, deterministic boot.
	await runStep('open hforge', ['open', baseUrl], signal)
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
	// exercise picker search dialog sizing (exercise-picker-search-dialog-sizing)
	// =========================================================================
	//
	// Spec: at 390x844, the multi-word queries `bench press`, `chest fly`, and `ankle circles`
	// keep their matching results visible AND selectable, and the sheet stays at least 320 CSS
	// pixels high even when results are sparse. A zero-result query outside the Chosen filter
	// renders the localized "No match" state and keeps the Create-your-own action reachable. At
	// 320x568 the empty state is usable inside the viewport (sheet height <= 90vh) with
	// controls reachable by scrolling. This reuses the in-progress workout on /workout after
	// the swipe-dismissal test dismissed the previous picker. The search input is re-used
	// across queries — Playwright `fill` replaces the previous value without reopening the
	// sheet — so each query gets the same `getByPlaceholder` selector.
	await runStep('resize to 390x844 for picker sizing', ['resize', '390', '844'], signal)
	const afterResize390 = await runStep('assert 390x844 viewport', [
		'--raw', 'eval',
		'JSON.stringify({ innerWidth: window.innerWidth, innerHeight: window.innerHeight })'
	], signal)
	let resize390
	try {
		resize390 = JSON.parse(afterResize390.stdout.trim())
		if (typeof resize390 === 'string') resize390 = JSON.parse(resize390)
	} catch {
		throw new Error(`390x844 resize returned invalid JSON${details(afterResize390)}`)
	}
	if (resize390.innerWidth !== 390) throw new Error(`390x844 resize: expected innerWidth 390, got ${resize390.innerWidth}`)
	if (resize390.innerHeight !== 844) throw new Error(`390x844 resize: expected innerHeight 844, got ${resize390.innerHeight}`)

	await runStep('open picker for sizing tests', ['click', "getByRole('button', { name: /Add exercise|Añadir ejercicio/ }).last()"], signal)

	// --- multi-word queries: bench press, chest fly, ankle circles (visible + selectable) ---
	const multiWord = [
		{ query: 'bench press', pick: 'barbell bench press' },
		{ query: 'chest fly', pick: 'cable one arm decline chest fly' },
		{ query: 'ankle circles', pick: 'ankle circles' }
	]
	for (const { query, pick } of multiWord) {
		await runStep(`search ${query} in picker`, ['fill', "getByPlaceholder(/Search.*exercises|Buscar.*ejercicios/)", query], signal)
		const matchVisible = await runStep(`assert ${query} result visible in picker list`, [
			'--raw', 'eval',
			`JSON.stringify({ count: document.querySelectorAll('#modal-root .sheet .item .tt.capitalize').length, hasMatch: [...document.querySelectorAll('#modal-root .sheet .item .tt.capitalize')].some(n => n.textContent.trim() === '${pick}') })`
		], signal)
		let matchState
		try {
			matchState = JSON.parse(matchVisible.stdout.trim())
			if (typeof matchState === 'string') matchState = JSON.parse(matchState)
		} catch {
			throw new Error(`${query} visibility returned invalid JSON${details(matchVisible)}`)
		}
		if (!matchState.hasMatch) throw new Error(`search ${query}: expected matching result '${pick}' visible in picker list; got ${JSON.stringify(matchState)}`)
		// Click proves the result is selectable (ExConfig sheet opens).
		await runStep(`pick ${query} from picker`, ['click', `getByText('${pick}', { exact: true })`], signal)
		await runStep(`confirm ${query} in ExConfig`, ['click', "getByRole('button', { name: /Add to routine|Añadir a la rutina/ })"], signal)
		// Reopen the picker for the next query (the previous selection dismissed it).
		await runStep(`reopen picker after ${query}`, ['click', "getByRole('button', { name: /Add exercise|Añadir ejercicio/ }).last()"], signal)
	}

	// Sparse-result sheet height: with `ankle circles` filtered, sheet height must be >= 320px
	// even when the result list is small. Re-fill (the last query in the loop already opened the
	// picker, so the next fill just narrows the existing open sheet).
	await runStep('refine picker to ankle circles for height check', ['fill', "getByPlaceholder(/Search.*exercises|Buscar.*ejercicios/)", 'ankle circles'], signal)
	const ankleHeight = await runStep('assert sparse sheet height >= 320', [
		'--raw', 'eval',
		"JSON.stringify({ sheetHeight: document.querySelector('#modal-root .sheet').getBoundingClientRect().height, viewportHeight: window.innerHeight })"
	], signal)
	let ankleState
	try {
		ankleState = JSON.parse(ankleHeight.stdout.trim())
		if (typeof ankleState === 'string') ankleState = JSON.parse(ankleState)
	} catch {
		throw new Error(`ankle circles height returned invalid JSON${details(ankleHeight)}`)
	}
	if (ankleState.sheetHeight < 320) throw new Error(`sparse result sheet height: expected >= 320, got ${ankleState.sheetHeight}`)

	// Zero-result state: `zzzzz nothing` must show localized "No match" + Create-your-own
	// and keep the sheet at least 320px high.
	await runStep('search zzzzz nothing for empty state', ['fill', "getByPlaceholder(/Search.*exercises|Buscar.*ejercicios/)", 'zzzzz nothing'], signal)
	const zeroResult = await runStep('assert zero result empty state at 390x844', [
		'--raw', 'eval',
		"JSON.stringify({ noMatch: /\\bNo match\\b|\\bSin resultados\\b/i.test(document.body.innerText), createYourOwn: /Create your own exercise|Crea tu propio ejercicio/i.test(document.body.innerText), sheetHeight: document.querySelector('#modal-root .sheet').getBoundingClientRect().height, pickerH3: [...document.querySelectorAll('#modal-root .sheet h3')].some(h => /^(Add exercise|Añadir ejercicio)$/i.test(h.textContent.trim())) })"
	], signal)
	let zeroState
	try {
		zeroState = JSON.parse(zeroResult.stdout.trim())
		if (typeof zeroState === 'string') zeroState = JSON.parse(zeroState)
	} catch {
		throw new Error(`zero result assertion returned invalid JSON${details(zeroResult)}`)
	}
	if (!zeroState.pickerH3) throw new Error(`zero result: picker sheet h3 missing; got ${JSON.stringify(zeroState)}`)
	if (!zeroState.noMatch) throw new Error(`zero result: localized "No match" text not visible; got ${JSON.stringify(zeroState)}`)
	if (!zeroState.createYourOwn) throw new Error(`zero result: Create your own exercise action not visible; got ${JSON.stringify(zeroState)}`)
	if (zeroState.sheetHeight < 320) throw new Error(`zero result sheet height: expected >= 320, got ${zeroState.sheetHeight}`)

	// --- 320x568 short viewport: zero result still usable inside viewport ---
	await runStep('resize to 320x568 for short viewport test', ['resize', '320', '568'], signal)
	const afterResize320 = await runStep('assert 320x568 viewport', [
		'--raw', 'eval',
		'JSON.stringify({ innerWidth: window.innerWidth, innerHeight: window.innerHeight })'
	], signal)
	let resize320
	try {
		resize320 = JSON.parse(afterResize320.stdout.trim())
		if (typeof resize320 === 'string') resize320 = JSON.parse(resize320)
	} catch {
		throw new Error(`320x568 resize returned invalid JSON${details(afterResize320)}`)
	}
	if (resize320.innerWidth !== 320) throw new Error(`320x568 resize: expected innerWidth 320, got ${resize320.innerWidth}`)
	if (resize320.innerHeight !== 568) throw new Error(`320x568 resize: expected innerHeight 568, got ${resize320.innerHeight}`)

	// Re-assert zero result at 320x568. The picker is still open with `zzzzz nothing`; just
	// re-inspect after the resize because the picker state survives a viewport change.
	const shortState = await runStep('assert short viewport empty state', [
		'--raw', 'eval',
		"JSON.stringify({ sheetHeight: document.querySelector('#modal-root .sheet').getBoundingClientRect().height, viewportHeight: window.innerHeight, noMatch: /\\bNo match\\b|\\bSin resultados\\b/i.test(document.body.innerText), createYourOwn: /Create your own exercise|Crea tu propio ejercicio/i.test(document.body.innerText), pickerH3: [...document.querySelectorAll('#modal-root .sheet h3')].some(h => /^(Add exercise|Añadir ejercicio)$/i.test(h.textContent.trim())) })"
	], signal)
	let short
	try {
		short = JSON.parse(shortState.stdout.trim())
		if (typeof short === 'string') short = JSON.parse(short)
	} catch {
		throw new Error(`short viewport assertion returned invalid JSON${details(shortState)}`)
	}
	if (!short.pickerH3) throw new Error(`short viewport: picker sheet h3 missing; got ${JSON.stringify(short)}`)
	if (!short.noMatch) throw new Error(`short viewport: localized "No match" text not visible; got ${JSON.stringify(short)}`)
	if (!short.createYourOwn) throw new Error(`short viewport: Create your own exercise action not visible; got ${JSON.stringify(short)}`)
	// 90vh cap = 0.9 * 568 = 511.2. Sheet must be at most that and at least 320 to be usable.
	const shortCap = 0.9 * short.viewportHeight
	if (short.sheetHeight > shortCap + 0.5) throw new Error(`short viewport: sheet height ${short.sheetHeight} exceeded 90vh cap ${shortCap.toFixed(1)}`)
	if (short.sheetHeight < 320) throw new Error(`short viewport sheet height: expected >= 320, got ${short.sheetHeight}`)

	// Verify controls and Create action are reachable by scrolling: scroll the sheet to its
	// bottom and verify the Create-your-own item is still in the viewport. This proves the
	// sheet is genuinely scrollable rather than truncated, so a real user at 320x568 can
	// reach the action even when the picker is taller than the visible area.
	await runStep('scroll sheet to bottom in short viewport', [
		'--raw', 'eval',
		"(() => { const sheet = document.querySelector('#modal-root .sheet'); if (!sheet) throw new Error('no #modal-root .sheet found before scroll'); sheet.scrollTop = sheet.scrollHeight; return 'ok'; })()"
	], signal)
	const scrollState = await runStep('assert controls reachable after scroll at 320x568', [
		'--raw', 'eval',
		"JSON.stringify((() => { const sheet = document.querySelector('#modal-root .sheet'); const sheetRect = sheet.getBoundingClientRect(); const create = [...sheet.querySelectorAll('.item')].find(item => /Create your own exercise|Crea tu propio ejercicio/i.test(item.querySelector('.tt')?.textContent || '')); const empty = [...sheet.querySelectorAll('.empty')].find(item => /\\bNo match\\b|\\bSin resultados\\b/i.test(item.textContent)); const viewport = { top: 0, right: window.innerWidth, bottom: window.innerHeight, left: 0 }; const reachable = element => { if (!element) return false; const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.right > Math.max(sheetRect.left, viewport.left) && rect.left < Math.min(sheetRect.right, viewport.right) && rect.bottom > Math.max(sheetRect.top, viewport.top) && rect.top < Math.min(sheetRect.bottom, viewport.bottom); }; return { createYourOwn: /Create your own exercise|Crea tu propio ejercicio/i.test(document.body.innerText), noMatch: /\\bNo match\\b|\\bSin resultados\\b/i.test(document.body.innerText), createReachable: reachable(create), noMatchReachable: reachable(empty), sheetHeight: sheetRect.height, sheetScrollTop: sheet.scrollTop, sheetMaxScroll: sheet.scrollHeight - sheet.clientHeight }; })())"
	], signal)
	let scrolled
	try {
		scrolled = JSON.parse(scrollState.stdout.trim())
		if (typeof scrolled === 'string') scrolled = JSON.parse(scrolled)
	} catch {
		throw new Error(`short viewport scroll assertion returned invalid JSON${details(scrollState)}`)
	}
	if (!scrolled.createYourOwn) throw new Error(`short viewport scroll: Create your own exercise not visible after scrolling; got ${JSON.stringify(scrolled)}`)
	if (!scrolled.noMatch) throw new Error(`short viewport scroll: localized "No match" text not visible after scrolling; got ${JSON.stringify(scrolled)}`)
	if (!scrolled.createReachable) throw new Error(`short viewport scroll: Create your own exercise is not geometrically reachable; got ${JSON.stringify(scrolled)}`)
	if (!scrolled.noMatchReachable) throw new Error(`short viewport scroll: localized "No match" state is not geometrically reachable; got ${JSON.stringify(scrolled)}`)
	if (scrolled.sheetHeight < 320) throw new Error(`short viewport scroll: sheet collapsed below 320 after scrolling; got ${scrolled.sheetHeight}`)

	// Dismiss the picker before the second deterministic reset. Reuse the verified
	// `.mback` backdrop click so we do not depend on Escape, which the picker does not
	// bind. The backdrop is well above the min-height-320 sheet at 320x568.
	const pickerSizingBackdropClick = await runStep('click .mback backdrop to dismiss the picker after sizing', [
		'run-code',
		[
			"async page => {",
			"  const point = await page.evaluate(() => {",
			"    const mback = document.querySelector('.mback');",
			"    if (!mback) throw new Error('No .mback found before sizing-backdrop click');",
			"    const r = mback.getBoundingClientRect();",
			"    if (r.width <= 0 || r.height <= 0) throw new Error('.mback has zero-size bounds');",
			"    return { x: Math.round(r.left + 24), y: Math.round(r.top + 24) };",
			"  });",
			"  await page.mouse.click(point.x, point.y);",
			"  return point;",
			"}"
		].join('\n')
	], signal)
	if (!pickerSizingBackdropClick.stdout.trim()) throw new Error(`picker sizing backdrop click: no point reported from run-code${details(pickerSizingBackdropClick)}`)

	// ----- second deterministic reset (picker-cleanup) -----
	// The earlier picker journeys (desktop routine-editor, mobile workout 375px,
	// keyboard/focus, backdrop, CDP touch swipe) intentionally start Push Day from the
	// workout chooser and leave it as the in-progress active workout. The single 3.1
	// reset at the start of the smoke ran BEFORE those journeys, so it can no longer
	// clean the temporary "Push Day - in progress" state. Re-run the deterministic boot
	// here, immediately before the block lifecycle section, so every later lifecycle
	// assertion (3.2a, 3.2b, 3.2c, 3.3, 3.4, 3.5, 3.5b, 3.6a, 3.6, 3.6b, 3.7, 3.8,
	// 3.9, 3.10, 3.11) starts from the same clean boot. The browser session is already
	// open from the start of the smoke, so a fresh `open baseUrl` is unnecessary; only
	// the navigation, storage clears, locale force, reload, state assertion, guest
	// entry, and starter-plan click are repeated. This reset does NOT seed blocks or
	// routines via localStorage — it only removes the temporary picker state and
	// reloads the starter plan through the UI, leaving every later lifecycle assertion
	// byte-for-byte unchanged.
	await runStep('navigate to home for second reset', ['goto', `${baseUrl}/#/home`], signal)
	await runStep('clear cookies (second reset)', ['cookie-clear'], signal)
	await runStep('clear localStorage (second reset)', ['localstorage-clear'], signal)
	await runStep('force English locale (second reset)', ['localstorage-set', 'gym_lang_v1', 'en'], signal)
	await runStep('clear sessionStorage (second reset)', ['sessionstorage-clear'], signal)
	await runStep('reload after second reset', ['reload'], signal)
	const cleanOut2 = await runStep('inspect gym_state_v1 after second reset', ['--raw', 'eval',
		"(() => { const raw = localStorage.getItem('gym_state_v1'); if (!raw) return { empty: true }; const s = JSON.parse(raw); return { empty: false, blocks: s.blocks, activeBlock: s.activeBlock } })()"
	], signal)
	const cleanParsed2 = JSON.parse(cleanOut2.stdout.trim())
	if (!cleanParsed2.empty && (!Array.isArray(cleanParsed2.blocks) || cleanParsed2.blocks.length !== 0 || cleanParsed2.activeBlock !== null))
		throw new Error(`second reset: gym_state_v1 should be empty or {blocks:[],activeBlock:null}; got ${JSON.stringify(cleanParsed2)}`)
	await runStep('guest entry after second reset', ['click', "getByRole('button', { name: /Continue without account|Continuar sin cuenta/ })"], signal)
	await runStep('load starter plan after second reset', ['click', "getByRole('button', { name: /Load starter plan.*PPL|Cargar plan inicial.*PPL/ })"], signal)

	// =========================================================================
	// block lifecycle smoke (issue: block-lifecycle-playwright-audit, WU2 + verify-remediation + WU4 final remediation)
	// =========================================================================
	//
	// Reset → re-enter guest → add 4th routine via UI → CREATE the 4-week
	// block fixture (4 training days + 3 explicit rest) through the BlockEditor
	// UI (NOT localStorage injection) → activate via UI → reload → assert
	// activeBlock persisted → Plan rows resolve to the block's routine / rest
	// for every weekday → Home weekly denominator = 4 → EDIT the persisted
	// block through the BlockEditor (rename + change a non-today weekday to
	// rest), reload, and assert the edit + the block-sourced rest persisted
	// (resolves via block schedule, not dayPlan override) → DETERMINISTIC
	// workout chooser rest semantics (force today to rest via the day-override
	// UI, then clear) → DETERMINISTIC 3.6 training path: mock the page clock
	// to the current calendar week's Thursday (block-resolved Fourth Day),
	// start the workout from "Today's plan" (NOT "Other routines"), complete
	// it, and assert the finished record retains block attribution
	// { id, name, week } → DETERMINISTIC 3.6b block-sourced rest: mock the
	// page clock to Friday (block-rest day), navigate to the workout chooser,
	// and assert rest/no-start behavior with the rest source being the BLOCK
	// (dayPlan[Friday] undefined; block.weeks[N].days[5] === 'rest') → 375px
	// active lifecycle controls + Pause/Resume at the verified mobile
	// viewport → resize back to desktop → end → invalid save and cancel
	// preserve prior state → 375px no-overflow + manager controls and Plan
	// legacy rows after end. Every assertion reads the persisted
	// `gym_state_v1` shape AND the rendered DOM, never a toast — toasts are
	// not proof of success (design #908). The Plan/Home row assertions are
	// the durable proof that the cross-view schedule effect is real, not just
	// a banner (verify-report #1256 critical finding #2). The clock mocks in
	// 3.6 / 3.6b are the durable proof that gaps #2 and #3 (active-block
	// workout training + active-block rest source) are exercised on a known
	// block-mapped training day and a known block-mapped rest day regardless
	// of the host machine's weekday.
	const readState = async () => {
		const out = await runStep('read gym_state_v1', ['--raw', 'eval', "JSON.parse(localStorage.getItem('gym_state_v1') || 'null')"], signal)
		try { return JSON.parse(out.stdout.trim()) }
		catch { throw new Error('readState: invalid JSON in gym_state_v1' + details(out)) }
	}
	const parseEvalJson = (result, label) => {
		try {
			const value = JSON.parse(result.stdout.trim())
			return typeof value === 'string' ? JSON.parse(value) : value
		} catch {
			throw new Error(`${label}: invalid JSON${details(result)}`)
		}
	}
	// The Plan card title switches between "Training blocks" (no active) and the
	// active block name (after activation). The regex covers both the original
	// "Smoke W" (3.2c–3.5) and the post-edit "Smoke W V2" (3.5b–3.7, before end in
	// 3.8) so the helper stays valid through every lifecycle transition including
	// the 3.5b rename.
	const openBlockManagerFromPlan = async () => {
		await runStep('navigate to plan', ['goto', `${baseUrl}/#/plan`], signal)
		await runStep('open block manager card', ['click', "getByText(/^(Training blocks|Smoke W(?: V2)?|Bloques de entrenamiento)$/)"], signal)
	}

	// ----- 3.2a add a 4th routine ("Fourth Day") via UI so the fixture has 4 distinct routines -----
	// The block fixture maps Thursday → "Fourth Day" (one of four training days in week 1).
	// The previous 3.6b path always started Push Day from "Other routines" so the test was
	// weekday-independent; the new 3.6 path starts the active-block-selected routine from
	// "Today's plan", which is Thursday → "Fourth Day" when the test machine's weekday is
	// Thursday. A routine with no exercises produces an empty active-workout view (no set
	// checkboxes), so the 3.6 finish path would fail. Add push-up to Fourth Day here so
	// every training-day weekday has at least one exercise and the test is deterministic.
	await runStep('navigate to plan for 4th routine', ['goto', `${baseUrl}/#/plan`], signal)
	await runStep('click New to add 4th routine', ['click', "getByRole('button', { name: /^New$/ })"], signal)
	await runStep('rename 4th routine to Fourth Day', ['fill', "input.input", 'Fourth Day'], signal)
	await runStep('open exercise picker for Fourth Day', ['click', "getByRole('button', { name: /Add exercise|Añadir ejercicio/ }).last()"], signal)
	await runStep('narrow Fourth Day picker to push-up', ['fill', "getByPlaceholder(/Search.*exercises|Buscar.*ejercicios/)", 'push-up'], signal)
	await runStep('pick push-up from Fourth Day picker', ['click', "getByText('push-up', { exact: true })"], signal)
	await runStep('confirm push-up in Fourth Day ExConfig', ['click', "getByRole('button', { name: /Add to routine|Añadir a la rutina/ })"], signal)
	await runStep('navigate back to plan after Fourth Day exercises', ['goto', `${baseUrl}/#/plan`], signal)

	// ----- 3.2b create the 4-week block fixture through the BlockEditor UI (4 training days + 3 explicit rest) -----
	// Reading the routine ids verifies the UI-driven 4th routine actually landed.
	const routineIdsOut = await runStep('read routine ids for fixture', ['--raw', 'eval',
		"(() => { const s = JSON.parse(localStorage.getItem('gym_state_v1')||'{}'); const m = {}; (s.routines || []).forEach(r => { m[r.name] = r.id }); return m; })()"
	], signal)
	const routineIds = JSON.parse(routineIdsOut.stdout.trim())
	for (const n of ['Push Day', 'Pull Day', 'Leg Day', 'Fourth Day']) {
		if (!routineIds[n]) throw new Error(`fixture: routine '${n}' missing after starter plan + 4th routine UI path; ids=${JSON.stringify(routineIds)}`)
	}
	// Navigate to /plan and open the block manager (no active block yet — the card title
	// reads "Training blocks" / "Bloques de entrenamiento").
	await runStep('open block manager (no active yet)', ['click', "getByText(/^(Training blocks|Bloques de entrenamiento)$/)"], signal)
	await runStep('Add block via UI', ['click', "getByRole('button', { name: /Add block|Añadir bloque/ })"], signal)
	await runStep('type Smoke W as block name', ['fill', "getByPlaceholder(/Block name|Nombre del bloque/)", 'Smoke W'], signal)
	// The BlockEditor h3 reads "New block" or "Edit block" — scope day clicks + Add week
	// clicks to that sheet so the smoke never picks up an underlying list (Plan routines,
	// routine-editor rows, etc.). Inside the BlockEditor, day rows have `.tt` with the
	// day name; the BlockDayAssign sheet that opens on top has `.lrow-i` items with
	// "Rest" / routine names. The .lrow-i marker is the unique signal that we are on
	// the assign sheet and not the editor day rows.
	const editorSheetSel = ".sheet:has(h3:has-text('New block'))"
	const dayAssignSel = (pick) => pick === 'Rest'
		? ".sheet .list .item:has(.lrow-i):has-text('Rest'):not(:has-text('Rest / skip'))"
		: `.sheet .list .item:has(.lrow-i):has-text('${pick}')`
	// Mon-anchored day order matching the editor's [1,2,3,4,5,6,0] map.
	const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
	const dayAssignments = {
		'Monday': 'Push Day',
		'Tuesday': 'Pull Day',
		'Wednesday': 'Leg Day',
		'Thursday': 'Fourth Day',
		'Friday': 'Rest',
		'Saturday': 'Rest',
		'Sunday': 'Rest',
	}
	for (let weekIdx = 0; weekIdx < 4; weekIdx++) {
		if (weekIdx > 0) {
			await runStep(`add week ${weekIdx + 1}`, ['click', "getByRole('button', { name: /Add week|Añadir semana/ })"], signal)
		}
		for (const dayName of dayOrder) {
			const pick = dayAssignments[dayName]
			await runStep(`open ${dayName} assign w${weekIdx + 1}`, ['click', `${editorSheetSel} .list .item:has-text('${dayName}')`], signal)
			await runStep(`assign ${pick} to ${dayName} w${weekIdx + 1}`, ['click', dayAssignSel(pick)], signal)
		}
	}
	// Save the draft through the UI (the Save button writes to gym_state_v1.blocks). The
	// 4 weeks of cell assignments ARE the "edit" the verify report asks for — the empty
	// draft is being edited into a complete block via the day picker.
	await runStep('save UI-created block', ['click', "getByRole('button', { name: /^Save$|^Guardar$/ }).last()"], signal)
	// Reload to verify the Save path actually wrote the block to gym_state_v1.
	await runStep('reload after UI create', ['reload'], signal)
	const afterCreate = await readState()
	if (!Array.isArray(afterCreate.blocks) || afterCreate.blocks.length === 0) throw new Error('UI create: blocks missing after reload')
	const created = afterCreate.blocks[afterCreate.blocks.length - 1]
	if (created.name !== 'Smoke W') throw new Error(`UI create: blocks[${afterCreate.blocks.length - 1}].name should be 'Smoke W', got '${created.name}'`)
	if (!Array.isArray(created.weeks) || created.weeks.length !== 4) throw new Error(`UI create: blocks[${afterCreate.blocks.length - 1}] should have 4 weeks, got ${created.weeks && created.weeks.length}`)
	const rmap = {}
	;(afterCreate.routines || []).forEach(r => { rmap[r.id] = r.name })
	const expectedW1 = {
		'Monday': 'Push Day', 'Tuesday': 'Pull Day', 'Wednesday': 'Leg Day',
		'Thursday': 'Fourth Day', 'Friday': null, 'Saturday': null, 'Sunday': null,
	}
	const w1 = created.weeks[0].days
	const dayToWd = { 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6, 'Sunday': 0 }
	for (const day of dayOrder) {
		const wd = dayToWd[day]
		const expected = expectedW1[day]
		const actual = w1[wd]
		const actualName = actual === 'rest' ? null : (rmap[actual] || actual)
		if (actualName !== expected) throw new Error(`UI create: week 1 ${day} (wd ${wd}) should resolve to ${expected}, got "${actualName}"`)
	}

	// Capture today's weekday so every conditional assertion is parameterised.
	const weekdayOut = await runStep('read today weekday', ['--raw', 'eval', 'new Date().getDay()'], signal)
	const weekday = parseInt(weekdayOut.stdout.trim())
	const dayNamesEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
	// Block week 1 day map (Mon-anchored): Mon=Push, Tue=Pull, Wed=Leg, Thu=Fourth, Fri/Sat/Sun=rest.
	const expectedForWd = wd => {
		const map = { 1: 'Push Day', 2: 'Pull Day', 3: 'Leg Day', 4: 'Fourth Day' }
		return map[wd] || null
	}
	const todayExpectedRoutine = expectedForWd(weekday)
	const todayIsRestDay = todayExpectedRoutine == null
	// ----- 3.2c activate via UI → reload → assert activeBlock persisted -----
	await runStep('open plan for block activate', ['goto', `${baseUrl}/#/plan`], signal)
	await runStep('open block manager (no active yet)', ['click', "getByText(/^(Training blocks|Bloques de entrenamiento)$/)"], signal)
	await runStep('open Smoke W for activate', ['click', ".list .item:has-text('Smoke W')"], signal)
	await runStep('Save and activate block', ['click', "getByRole('button', { name: /Save & activate|Guardar y activar/ })"], signal)
	await runStep('confirm activate', ['click', "getByRole('button', { name: /^Activate$|^Activar$/ })"], signal)
	await runStep('reload after activate', ['reload'], signal)
	const afterActivate = await readState()
	if (!afterActivate.activeBlock) throw new Error('activate: gym_state_v1.activeBlock is null after reload (lifecycle helper return-value was discarded by update)')
	if (afterActivate.activeBlock.status !== 'active') throw new Error(`activate: status should be 'active', got '${afterActivate.activeBlock.status}'`)
	if (afterActivate.activeBlock.blockId !== afterActivate.blocks[0].id) throw new Error(`activate: activeBlock.blockId (${afterActivate.activeBlock.blockId}) ≠ blocks[0].id (${afterActivate.blocks[0].id})`)
	if (!Array.isArray(afterActivate.blocks[0].weeks) || afterActivate.blocks[0].weeks.length !== 4) throw new Error(`activate: block should have 4 weeks after reload, got ${afterActivate.blocks[0].weeks && afterActivate.blocks[0].weeks.length}`)
	// Deterministic 3.6 training/rest dates: derive the training Thursday from the
	// persisted activation date, selecting the first Thursday on or after activation.
	// This keeps the mocked training date within the block's valid snapshot range when
	// activation occurs on Friday, Saturday, or Sunday. The following Friday remains the
	// fixture's rest day; 3.5b only edits weekdays [1,2].
	const activationDateForDates = new Date(afterActivate.activeBlock.startedOn + 'T12:00:00')
	const activationWdForDates = activationDateForDates.getDay()
	const daysToThursday = (4 - activationWdForDates + 7) % 7
	const trainingThursdayForDates = new Date(activationDateForDates)
	trainingThursdayForDates.setDate(activationDateForDates.getDate() + daysToThursday)
	const deterministicFridayForDates = new Date(trainingThursdayForDates)
	deterministicFridayForDates.setDate(trainingThursdayForDates.getDate() + 1)
	// Local-ISO formatter (matches production todayISO / isoOf in frontend/src/lib/format.js —
	// uses local date components, not UTC, so the smoke date matches what the page sees).
	const localIsoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
	const deterministicThursdayIso = localIsoOf(trainingThursdayForDates)
	const deterministicFridayIso = localIsoOf(deterministicFridayForDates)

	// ----- 3.3 Plan shows the block-resolved routine/rest for every weekday of the current week -----
	// This is the durable assertion the previous smoke was missing. We extract the rendered
	// weekday rows from the DOM (in display order Mon-Sun) and compare each row's tag against
	// the block's resolved day map. A Plan view that silently fell back to legacy S.week would
	// pass the previous banner-only assertion and fail here.
	await runStep('navigate to plan for row assertions', ['goto', `${baseUrl}/#/plan`], signal)
	const planScheduleOut = await runStep('extract plan week schedule rows', ['--raw', 'eval', `
		(() => {
			// Walk the seven weekdays in display order (Mon=1, Tue=2, ..., Sat=6, Sun=0).
			const order = [1, 2, 3, 4, 5, 6, 0];
			const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
			const allItems = [...document.querySelectorAll('.list .item')];
			const rows = [];
			for (const wd of order) {
				const name = dayNames[wd];
				const item = allItems.find(el => el.querySelector('.tt') && el.querySelector('.tt').textContent.trim() === name);
				if (!item) { rows.push({ wd, name, found: false }); continue; }
				const tag = item.querySelector('.tag');
				rows.push({ wd, name, found: true, tag: tag ? tag.textContent.trim() : null, tagAcc: !!(tag && tag.classList.contains('acc')) });
			}
			return rows;
		})()
	`], signal)
	const planRows = JSON.parse(planScheduleOut.stdout.trim())
	for (const row of planRows) {
		if (!row.found) throw new Error(`plan rows: row for ${row.name} (wd ${row.wd}) not found in DOM`)
		const expected = expectedForWd(row.wd)
		if (expected == null) {
			// Rest day: tag should be the localised "Rest" label and must NOT have .acc (which marks a routine tag).
			if (row.tagAcc) throw new Error(`plan rows: ${row.name} (wd ${row.wd}) should be Rest (no .acc), got tag="${row.tag}" with .acc`)
			if (!/Rest/i.test(row.tag || '')) throw new Error(`plan rows: ${row.name} (wd ${row.wd}) should be Rest, got "${row.tag}"`)
		} else {
			// Training day: tag must include the expected routine name and carry .acc.
			if (!row.tagAcc) throw new Error(`plan rows: ${row.name} (wd ${row.wd}) should be ${expected} (with .acc), got tag="${row.tag}" without .acc`)
			if (!row.tag.includes(expected)) throw new Error(`plan rows: ${row.name} (wd ${row.wd}) should be ${expected}, got "${row.tag}"`)
		}
	}

	// ----- 3.4 Home weekly denominator = 4 (blockWeekTrainingDays), today row matches block -----
	await runStep('navigate to home for assertions', ['goto', `${baseUrl}/#/home`], signal)
	const homeOut = await runStep('extract home week + today row', ['--raw', 'eval', `(() => { var bt = document.body.innerText; var m = bt.match(/(\\d+)\\s*\\/\\s*(\\d+)\\s*this week/); var d = m ? Number(m[2]) : null; var tr = document.querySelector('.today-row'); var ttl = tr ? tr.querySelector('.ttl') : null; var tag = tr ? tr.querySelector('.tag') : null; return { denom: d, todayTtl: ttl ? ttl.textContent.trim() : null, todayTag: tag ? tag.textContent.trim() : null, bodyText: bt.slice(0, 1500) }; })()`], signal)
	const homeState = JSON.parse(homeOut.stdout.trim())
	if (homeState.denom !== 4) throw new Error(`home denominator: expected 4 (4 training days in block), got ${homeState.denom}; body="${homeState.bodyText.slice(0, 200)}"`)
	if (todayIsRestDay) {
		if (!/Rest day/i.test(homeState.todayTtl || '')) throw new Error(`home today: expected Rest day for weekday ${weekday} (${dayNamesEn[weekday]}), got "${homeState.todayTtl}"`)
	} else {
		if (!homeState.todayTtl || !homeState.todayTtl.includes(todayExpectedRoutine)) throw new Error(`home today: expected ${todayExpectedRoutine} for weekday ${weekday}, got "${homeState.todayTtl}"`)
	}
	// The compact active-block banner must include the block name and week label.
	const bannerText = homeState.bodyText
	if (!/Smoke W/.test(bannerText)) throw new Error(`home banner: 'Smoke W' missing; got "${bannerText.slice(0, 200)}"`)
	if (!/Active/.test(bannerText)) throw new Error(`home banner: 'Active' status missing; got "${bannerText.slice(0, 200)}"`)

	// ----- 3.5 explicit-rest contract: when today is a rest day, the resolver must NOT fall through -----
	// to legacy S.week. We assert this even when today is a training day by reading the DOM today
	// row + cross-checking the persisted effective routine for today's iso.
	const effectiveOut = await runStep('assert effective routine for today iso', ['--raw', 'eval', `
		(() => {
			const S = JSON.parse(localStorage.getItem('gym_state_v1'));
			const dayMap = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
			const d = new Date();
			const iso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
			const wd = d.getDay();
			const ab = S.activeBlock;
			const block = (S.blocks || []).find(b => b.id === ab.blockId);
			const blockStatus = (isoStr) => {
				const start = ab.startedOn;
				if (isoStr < start) return null;
				const dn = (a, b) => new Date(a + 'T12:00:00');
				let cur = dn(start);
				const target = dn(isoStr);
				let credited = 0;
				while (cur <= target) { credited++; cur.setDate(cur.getDate() + 1); }
				if (credited <= 0) return null;
				return 1 + Math.floor((credited - 1) / 7);
			};
			const wk = blockStatus(iso);
			const w = block.weeks[wk - 1];
			const v = w.days[wd];
			const routine = v && v !== 'rest' ? (S.routines.find(r => r.id === v) || { name: null }) : null;
			return { iso, wd, blockWeek: wk, blockDayValue: v, resolvedRoutineName: routine ? routine.name : null, legacyWeekHasEntry: !!S.week[wd] };
		})()
	`], signal)
	const eff = JSON.parse(effectiveOut.stdout.trim())
	if (todayIsRestDay) {
		// The block maps today to 'rest' — the resolver must return null, NEVER the legacy S.week entry.
		if (eff.resolvedRoutineName !== null) throw new Error(`explicit rest: today (wd ${weekday}) should resolve to rest (null), got routine "${eff.resolvedRoutineName}"`)
		// If the test machine happens to have a legacy S.week entry for this wd, that's the bug the
		// original Plan.jsx had: it would have shown the legacy routine. Assert the block path wins.
		if (eff.legacyWeekHasEntry) {
			// The rendered today row must still show Rest day (block wins), not the legacy routine.
			if (!/Rest day/i.test(homeState.todayTtl || '')) throw new Error(`explicit rest: legacy S.week has entry for wd ${weekday} but Plan/Home today row shows "${homeState.todayTtl}", not "Rest day" — block-resolved rest is being overridden by legacy week`)
		}
	} else {
		if (eff.resolvedRoutineName !== todayExpectedRoutine) throw new Error(`today routine: block should resolve to "${todayExpectedRoutine}", got "${eff.resolvedRoutineName}"`)
	}

	// ----- 3.5b PERSISTED EDIT + BLOCK-SOURCED REST (verify-report #1256 gaps #1 + #3) -----
	// The 3.2b create path builds a fresh block through the BlockEditor UI; the verify report
	// pointed out that the previous smoke never re-opened a *persisted* block, changed a
	// field, and asserted the change survived a reload. This section does exactly that:
	//
	//   1. Reopen the persisted Smoke W (h3 "Edit block" sheet).
	//   2. Rename to "Smoke W V2" (proves the name field round-trips through Update).
	//   3. Click a known non-today training weekday (Mon-Thu in the fixture) and pick "Rest"
	//      in the BlockDayAssign picker (proves the day map round-trips through Update).
	//   4. Click Update (NOT "Save & activate" — that button is hidden when the block is
	//      active per `sheets.jsx` `!isActive && !ab && v.valid`).
	//   5. Reload. Assert both edits persisted on `gym_state_v1` (Gap #1).
	//   6. Resolve the edited weekday's ISO through the canonical block resolver
	//      (replicated in eval) and assert: the resolver returns null (rest), the block's
	//      day map has 'rest' for that weekday, AND S.dayPlan[that_iso] is undefined.
	//      The rest source is the BLOCK, not a dayPlan override (Gap #3).
	//   7. Cross-view check: navigate to /plan and read the row for the edited weekday —
	//      the tag must read "Rest" without .acc, proving the cross-view surface honours
	//      the block edit (not a stale cache, not the legacy S.week fallback).
	//
	// editWd is the first training weekday (Mon-Thu) that is NOT today. Picking a non-today
	// training day leaves today's block resolution untouched, so the 3.6 active-block-selected
	// workout path can still exercise today's "Today's plan" button when today is Mon-Thu.
	const trainingWds = [1, 2, 3, 4]
	const editWd = trainingWds.find(wd => wd !== weekday)
	const editDayName = dayNamesEn[editWd]
	// ISO of the edited weekday in the current local-calendar week (Mon-anchored).
	const editMondayDate = new Date()
	editMondayDate.setDate(editMondayDate.getDate() - ((editMondayDate.getDay() + 6) % 7))
	const editDateObj = new Date(editMondayDate)
	editDateObj.setDate(editMondayDate.getDate() + (editWd === 0 ? 6 : editWd - 1))
	const editIso = localIsoOf(editDateObj)
	await openBlockManagerFromPlan()
	await runStep('open Smoke W for edit (3.5b)', ['click', ".list .item:has-text('Smoke W')"], signal)
	// Rename the block. The TextField uses the Block name placeholder in both English and Spanish.
	await runStep('fill new block name (3.5b)', ['fill', "getByPlaceholder(/Block name|Nombre del bloque/)", 'Smoke W V2'], signal)
	// Editor sheet for an EXISTING block reads h3 "Edit block" (not "New block"). The day rows
	// and the day picker pattern stay the same as the create path.
	const editorEditSel = ".sheet:has(h3:has-text('Edit block'))"
	await runStep(`open ${editDayName} for reassign (3.5b)`, ['click', `${editorEditSel} .list .item:has-text('${editDayName}')`], signal)
	// Click Rest in the BlockDayAssign picker. The .lrow-i marker is unique to the picker sheet
	// and avoids matching the editor's underlying day-row tag.
	await runStep(`assign Rest to ${editDayName} (3.5b)`, ['click', dayAssignSel('Rest')], signal)
	// Update button — block is already active, so "Save & activate" is hidden. .last() guards
	// against any future button named "Update" / "Actualizar" above the editor footer.
	await runStep('click Update (3.5b)', ['click', "getByRole('button', { name: /^Update$|^Actualizar$/ })"], signal)
	await runStep('reload after edit (3.5b)', ['reload'], signal)
	const afterEdit = await readState()
	if (afterEdit.blocks[0].name !== 'Smoke W V2') throw new Error(`persisted edit (3.5b): blocks[0].name should be 'Smoke W V2' after reload, got '${afterEdit.blocks[0].name}'`)
	if (afterEdit.blocks[0].weeks[0].days[editWd] !== 'rest') throw new Error(`persisted edit (3.5b): blocks[0].weeks[0].days[${editWd}] (${editDayName}) should be 'rest' after reload, got '${afterEdit.blocks[0].weeks[0].days[editWd]}'`)
	// Block-sourced rest source check. We replicate the resolver precedence in eval because
	// `effectiveRoutineId` is not exposed on `window`. The check covers both the structure of
	// the block's day map (must be 'rest') AND the absence of a dayPlan override (proves the
	// rest comes from the block, not a stale dayPlan entry). This is the durable proof for
	// verify-report #1256 gap #3 (block-sourced rest, not dayPlan).
	const restSourceOut = await runStep('assert block-sourced rest source (3.5b)', ['--raw', 'eval', `
		(() => {
			const S = JSON.parse(localStorage.getItem('gym_state_v1'));
			const editIso = ${JSON.stringify(editIso)};
			const editWd = ${editWd};
			const dayPlanVal = S.dayPlan && S.dayPlan[editIso];
			const ab = S.activeBlock;
			const block = (S.blocks || []).find(b => b.id === ab.blockId);
			const mondayOf = iso => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
			let blockWeekIdx = null;
			if (ab) {
				const start = ab.startedOn;
				if (start) {
					if (editIso < start && mondayOf(editIso) === mondayOf(start)) {
						blockWeekIdx = 1;
					} else if (editIso >= start) {
						const dn = s => new Date(s + 'T12:00:00');
						let cur = dn(start); const target = dn(editIso); let credited = 0;
						while (cur <= target) { credited++; cur.setDate(cur.getDate() + 1); }
						if (credited > 0) blockWeekIdx = 1 + Math.floor((credited - 1) / 7);
					}
				}
			}
			const w = blockWeekIdx != null ? block.weeks[Math.min(blockWeekIdx, block.weeks.length) - 1] : null;
			const blockDayVal = w ? w.days[editWd] : null;
			const routine = blockDayVal && blockDayVal !== 'rest' ? (S.routines.find(r => r.id === blockDayVal) || { name: null }) : null;
			return {
				dayPlanVal: dayPlanVal === undefined ? null : dayPlanVal,
				dayPlanUndefined: S.dayPlan ? S.dayPlan[editIso] === undefined : true,
				blockWeekIdx,
				blockDayVal,
				resolvedRoutineName: routine ? routine.name : null,
			};
		})()
	`], signal)
	const restSource = JSON.parse(restSourceOut.stdout.trim())
	if (!restSource.dayPlanUndefined) throw new Error(`block-sourced rest (3.5b): dayPlan['${editIso}'] should be undefined (rest source must be the block, not a dayPlan override), got ${JSON.stringify(restSource.dayPlanVal)}`)
	if (restSource.blockDayVal !== 'rest') throw new Error(`block-sourced rest (3.5b): block.weeks[blockWeekIdx-1].days[${editWd}] should be 'rest', got ${JSON.stringify(restSource.blockDayVal)}`)
	if (restSource.resolvedRoutineName !== null) throw new Error(`block-sourced rest (3.5b): resolver should return null (rest) for ${editDayName} ${editIso}, got routine "${restSource.resolvedRoutineName}"`)
	// Cross-view check: the Plan row for the edited weekday must read "Rest" without .acc.
	await runStep('navigate to plan for edit cross-view (3.5b)', ['goto', `${baseUrl}/#/plan`], signal)
	const planEditOut = await runStep('extract plan row for edited weekday (3.5b)', ['--raw', 'eval', `
		(() => {
			const allItems = [...document.querySelectorAll('.list .item')];
			const item = allItems.find(el => el.querySelector('.tt') && el.querySelector('.tt').textContent.trim() === ${JSON.stringify(editDayName)});
			const tag = item ? item.querySelector('.tag') : null;
			return { found: !!item, tag: tag ? tag.textContent.trim() : null, tagAcc: !!(tag && tag.classList.contains('acc')) };
		})()
	`], signal)
	const planEditRow = JSON.parse(planEditOut.stdout.trim())
	if (!planEditRow.found) throw new Error(`block-sourced rest (3.5b): Plan row for ${editDayName} not found after edit`)
	if (planEditRow.tagAcc) throw new Error(`block-sourced rest (3.5b): Plan row for ${editDayName} (wd ${editWd}) should be Rest (no .acc) after edit, got tag="${planEditRow.tag}" with .acc`)
	if (!/Rest/i.test(planEditRow.tag || '')) throw new Error(`block-sourced rest (3.5b): Plan row for ${editDayName} (wd ${editWd}) should be Rest after edit, got "${planEditRow.tag}"`)

	// ----- 3.6a deterministic workout chooser rest semantics (verify-report #1256 gap #3) -----
	// Force today to be a rest day in the chooser by setting `dayPlan[today] = 'rest'` through
	// the day-override UI, regardless of the test machine's weekday. This is the same code
	// path the workout chooser hits on a block-rest day (dayPlan wins over the block), so
	// deterministically exercising it via UI proves the rest branch in every run.
	await runStep('navigate to home for day override', ['goto', `${baseUrl}/#/home`], signal)
	await runStep('open day override for today via date strip', ['click', ".week .wday.today"], signal)
	await runStep('pick Rest / skip this day in override sheet', ['click', ".sheet .list .item:has(.lrow-i):has-text('Rest / skip this day')"], signal)
	await runStep('reload after forcing today to rest', ['reload'], signal)
	const forcedRestState = await readState()
	const todayIso = forcedRestState.dayPlan && Object.keys(forcedRestState.dayPlan).sort().slice(-1)[0]
	if (todayIso !== new Date().toISOString().slice(0, 10) || forcedRestState.dayPlan[todayIso] !== 'rest') {
		throw new Error(`forced rest: dayPlan[today=${todayIso}] should be 'rest', got ${JSON.stringify(forcedRestState.dayPlan)}`)
	}
	await runStep('navigate to workout on forced-rest day', ['goto', `${baseUrl}/#/workout`], signal)
	const restWorkoutOut = await runStep('assert workout chooser rest semantics', ['--raw', 'eval', `
		(() => {
			const t = document.body.innerText;
			// No "Start <routine>" button should be present; the page should reflect the rest semantics.
			const startButtons = [...document.querySelectorAll('button')].filter(b => /^Start [A-Z]|^Empezar [A-Z]/.test((b.textContent || '').trim()));
			return { hasRestDay: /Rest day/i.test(t), startButtons: startButtons.map(b => b.textContent.trim()), text: t.slice(0, 800) };
		})()
	`], signal)
	const restW = JSON.parse(restWorkoutOut.stdout.trim())
	if (restW.startButtons.length > 0) throw new Error(`explicit rest: workout chooser offers ${restW.startButtons.length} routine start(s) on a forced-rest day: ${JSON.stringify(restW.startButtons)}`)
	if (!restW.hasRestDay) throw new Error(`explicit rest: workout screen does not surface 'Rest day' on a forced-rest day; got "${restW.text}"`)
	// Clear the dayPlan override so subsequent assertions use the active block's resolved
	// day map again (the override would otherwise force today to rest everywhere).
	await runStep('navigate to home to clear override', ['goto', `${baseUrl}/#/home`], signal)
	await runStep('open day override again', ['click', ".week .wday.today"], signal)
	await runStep('clear dayPlan via Back to weekly plan', ['click', ".sheet .list .item:has(.lrow-i):has-text('Back to weekly plan')"], signal)
	await runStep('reload after clearing dayPlan override', ['reload'], signal)
	const clearedState = await readState()
	const clearedToday = clearedState.dayPlan && clearedState.dayPlan[new Date().toISOString().slice(0, 10)]
	if (clearedToday !== undefined) throw new Error(`clear override: dayPlan[today] should be undefined, got '${clearedToday}'`)

	// ----- 3.6 ACTIVE-BLOCK-SELECTED WORKOUT (verify-report #1256 gaps #2 + #3) -----
	// Verify-report #1256 critical findings #2 and #3 require deterministic runtime proof:
	//   (a) Start the workout through the routine the active block resolves for today,
	//       NOT from "Other routines" and NOT a manually chosen unrelated routine, and
	//       assert the finished `S.workouts` record retains block {id, name, week}.
	//   (b) Exercise the workout chooser for a date the active block maps to rest, and
	//       assert rest/no-start behavior with the rest source being the BLOCK (not a
	//       dayPlan override).
	//
	// To make BOTH checks deterministic regardless of the host machine's weekday, this
	// section uses `page.clock.setSystemTime()` via run-code to mock the page's clock
	// to a known date, then reloads so `new Date()` in the page returns the mocked date.
	// The two mocked dates are the Thursday and Friday of the host's current local-
	// calendar week:
	//
	//   Thursday (wd=4): always a training day in the fixture (Fourth Day). The 3.5b
	//                    editWd is the first training wd != host weekday, in [1,2] — never 4 —
	//                    so Thursday stays Fourth Day even after 3.5b.
	//   Friday   (wd=5): always a rest day in the fixture. 3.5b only touches [1,2], so
	//                    Friday stays rest.
	//
	// Both dates fall in the same calendar week as the host's today (whatever weekday
	// the host is on), so the block resolver's `currentWeekBlockIndex` override fires
	// and resolves them to block week 1 — even when the mocked date is before startedOn
	// (the Thursday-before-Friday-start case).
	//
	// After this section the block remains active (workout completion only touches
	// S.active and S.workouts, not S.activeBlock, so the block is already in the right
	// state for 3.7).
	//
	// ----- 3.6 TRAINING: active-block-selected workout completion (gap #2) -----
	const clockAtTraining = [
		"async page => {",
		"  await page.clock.setSystemTime(new Date('" + deterministicThursdayIso + "T12:00:00'));",
		"  return 'clock set to " + deterministicThursdayIso + " (Thursday, block training day)';",
		"}"
	].join('\n')
	await runStep('mock clock to block-training Thursday (3.6)', ['run-code', clockAtTraining], signal)
	await runStep('reload with mocked training clock (3.6)', ['reload'], signal)
	const mockedTrainingOut = await runStep('assert page sees mocked Thursday (3.6)', ['--raw', 'eval',
		"(() => { const d = new Date(); return { iso: d.toISOString().slice(0, 10), wd: d.getDay() }; })()"
	], signal)
	const mockedTraining = JSON.parse(mockedTrainingOut.stdout.trim())
	if (mockedTraining.wd !== 4) throw new Error(`3.6 training: page should see weekday 4 (Thursday), got ${JSON.stringify(mockedTraining)}`)
	await runStep('navigate to workout (3.6 training)', ['goto', `${baseUrl}/#/workout`], signal)
	const chooserTrainingOut = await runStep('assert chooser renders active-block Fourth Day (3.6)', ['--raw', 'eval', `
		(() => {
			const t = document.body.innerText;
			const startButtons = [...document.querySelectorAll('button')].filter(b => /^Start [A-Z]|^Empezar [A-Z]/.test((b.textContent || '').trim()));
			return {
				hasTodaysPlan: /Today's plan/.test(t),
				hasFourthDay: /Fourth Day/.test(t),
				startButtons: startButtons.map(b => b.textContent.trim()),
			};
		})()
	`], signal)
	const chooserTraining = JSON.parse(chooserTrainingOut.stdout.trim())
	if (!chooserTraining.hasTodaysPlan) throw new Error(`3.6 training: chooser should render "Today's plan" card on mocked Thursday, got "${chooserTraining.startButtons.join(', ')}"`)
	if (!chooserTraining.hasFourthDay) throw new Error(`3.6 training: chooser should render "Fourth Day" on mocked Thursday`)
	if (!chooserTraining.startButtons.includes('Start Fourth Day')) throw new Error(`3.6 training: chooser should have a "Start Fourth Day" button on mocked Thursday, got ${JSON.stringify(chooserTraining.startButtons)}`)
	// Active-block-selected training: click "Start Fourth Day" in the "Today's plan" card
	// (NOT "Other routines", NOT a manually selected unrelated routine).
	await runStep('click "Start Fourth Day" in Today\'s plan (3.6 training)', ['click', "getByRole('button', { name: /^Start Fourth Day$/ })"], signal)
	await runStep('skip weigh-in (3.6 training)', ['click', "getByRole('button', { name: /Start without weighing in|Empezar sin pesarse/ })"], signal)
	const afterStart = await readState()
	if (!afterStart.active || !afterStart.active.block) throw new Error(`3.6 training: S.active.block missing after starting from Today's plan — block context was not frozen at workout start`)
	if (afterStart.active.block.name !== 'Smoke W V2') throw new Error(`3.6 training: S.active.block.name should be 'Smoke W V2' (renamed in 3.5b), got '${afterStart.active.block.name}'`)
	if (afterStart.active.block.week !== 1) throw new Error(`3.6 training: S.active.block.week should be 1, got '${afterStart.active.block.week}'`)
	if (typeof afterStart.active.block.id !== 'string' || afterStart.active.block.id.length === 0) throw new Error(`3.6 training: S.active.block.id is empty`)
	const blockIdAtStart = afterStart.active.block.id
	// Workout UI banner: the frozen block context appears above the workout list.
	const workoutBlockCtxOut = await runStep('assert workout block context banner (3.6 training)', ['--raw', 'eval',
		"(() => { const t = document.body.innerText; return { hasSmokeW: /Smoke W V2/.test(t), hasWeek1: /Week 1/.test(t) }; })()"
	], signal)
	const workoutCtx = JSON.parse(workoutBlockCtxOut.stdout.trim())
	if (!workoutCtx.hasSmokeW) throw new Error(`3.6 training: frozen block name 'Smoke W V2' missing from workout screen`)
	if (!workoutCtx.hasWeek1) throw new Error(`3.6 training: frozen block week 'Week 1' missing from workout screen`)
	// Check off just the FIRST set of the first exercise — avoids the topWeightSheet
	// prompt (which fires when the last set of a loaded-reps exercise is checked) and
	// keeps the finish path simple. The remaining unchecked sets trigger the "Finish
	// early?" dialog, which is the canonical finish path used in real sessions.
	await runStep('check off first set of first exercise (3.6 training)', ['click', "getByRole('checkbox').first()"], signal)
	await runStep('click Finish workout early (3.6 training)', ['click', "getByRole('button', { name: /Finish workout/ }).last()"], signal)
	await runStep('confirm Finish workout in early dialog (3.6 training)', ['click', "getByRole('button', { name: /^Finish workout$/ }).last()"], signal)
	await runStep('dismiss FinishSummary with Nice! (3.6 training)', ['click', "getByRole('button', { name: /^Nice!$|^¡Genial!$/ })"], signal)
	const afterFinish = await readState()
	if (!Array.isArray(afterFinish.workouts) || afterFinish.workouts.length === 0) throw new Error(`3.6 training: S.workouts should contain the finished record, got ${JSON.stringify(afterFinish.workouts && afterFinish.workouts.length)}`)
	const finished = afterFinish.workouts[afterFinish.workouts.length - 1]
	if (!finished.block) throw new Error(`3.6 training: block attribution missing on the persisted record`)
	if (finished.block.id !== blockIdAtStart) throw new Error(`3.6 training: block.id should match the start snapshot (${blockIdAtStart}), got '${finished.block.id}'`)
	if (finished.block.name !== 'Smoke W V2') throw new Error(`3.6 training: block.name should be 'Smoke W V2', got '${finished.block.name}'`)
	if (finished.block.week !== 1) throw new Error(`3.6 training: block.week should be 1, got '${finished.block.week}'`)
	if (!Array.isArray(finished.entries) || finished.entries.length === 0) throw new Error(`3.6 training: entries missing`)
	const doneSets = finished.entries.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0)
	if (doneSets < 1) throw new Error(`3.6 training: at least one set should be checked, got ${doneSets}`)
	if (afterFinish.active !== null) throw new Error(`3.6 training: S.active should be null after finish`)

	// ----- 3.6b BLOCK-SOURCED REST (verify-report #1256 gap #3 — deterministic) -----
	// Mock the page clock to the current calendar week's Friday (block-rest day). The
	// dayPlan is empty (3.6a only touched dayPlan[host's today] and then cleared it),
	// so the rest source MUST BE the block — not a dayPlan override. The chooser must
	// surface "Rest day" with zero "Start <Routine>" buttons. This is the durable proof
	// that gap #3 (active-block rest source) is closed regardless of the host weekday.
	const clockAtRest = [
		"async page => {",
		"  await page.clock.setSystemTime(new Date('" + deterministicFridayIso + "T12:00:00'));",
		"  return 'clock set to " + deterministicFridayIso + " (Friday, block rest day)';",
		"}"
	].join('\n')
	await runStep('mock clock to block-rest Friday (3.6b)', ['run-code', clockAtRest], signal)
	await runStep('reload with mocked rest clock (3.6b)', ['reload'], signal)
	const mockedRestOut = await runStep('assert page sees mocked Friday (3.6b)', ['--raw', 'eval',
		"(() => { const d = new Date(); return { iso: d.toISOString().slice(0, 10), wd: d.getDay() }; })()"
	], signal)
	const mockedRest = JSON.parse(mockedRestOut.stdout.trim())
	if (mockedRest.wd !== 5) throw new Error(`3.6b rest: page should see weekday 5 (Friday), got ${JSON.stringify(mockedRest)}`)
	await runStep('navigate to workout (3.6b rest)', ['goto', `${baseUrl}/#/workout`], signal)
	const restOut = await runStep('assert block-sourced rest chooser (3.6b)', ['--raw', 'eval', `
		(() => {
			const t = document.body.innerText;
			const startButtons = [...document.querySelectorAll('button')].filter(b => /^Start [A-Z]|^Empezar [A-Z]/.test((b.textContent || '').trim()));
			const S = JSON.parse(localStorage.getItem('gym_state_v1'));
			const fridayIso = ${JSON.stringify(deterministicFridayIso)};
			const dayPlanUndefined = S.dayPlan ? S.dayPlan[fridayIso] === undefined : true;
			// Replicate blockStatus credited-days math in eval so we can prove the rest
			// source is the block even though effectiveRoutineId is not on window.
			const ab = S.activeBlock;
			const block = (S.blocks || []).find(b => b.id === ab.blockId);
			const dn = s => new Date(s + 'T12:00:00');
			let cur = dn(ab.startedOn); const target = dn(fridayIso); let credited = 0;
			while (cur <= target) { credited++; cur.setDate(cur.getDate() + 1); }
			const wk = 1 + Math.floor((credited - 1) / 7);
			const w = block.weeks[Math.min(wk, block.weeks.length) - 1];
			const blockDayVal = w ? w.days[5] : null;
			return {
				hasRestDay: /rest day/i.test(t),
				startButtons: startButtons.map(b => b.textContent.trim()),
				dayPlanUndefined,
				blockDayVal,
			};
		})()
	`], signal)
	const rest = JSON.parse(restOut.stdout.trim())
	if (rest.startButtons.length > 0) throw new Error(`3.6b rest: chooser should have zero Start buttons on a block-rest day, got ${JSON.stringify(rest.startButtons)}`)
	if (!rest.hasRestDay) throw new Error(`3.6b rest: chooser body should mention "rest day" on a block-rest day`)
	if (!rest.dayPlanUndefined) throw new Error(`3.6b rest: dayPlan[${deterministicFridayIso}] should be undefined (rest source is the block, not a dayPlan override)`)
	if (rest.blockDayVal !== 'rest') throw new Error(`3.6b rest: block.weeks[N].days[5] (Friday) should be 'rest', got '${rest.blockDayVal}'`)

	// ----- 3.7 375x812 active lifecycle controls (verify-report #1256 gap #4) -----
	// Block is active (status='active') after 3.6 — 3.6 completes a workout (or asserts
	// block-sourced rest) without touching the block, so the block is still active here.
	// Resize to 375, open the block manager, assert Pause + End block controls are visible
	// and actionable, then exercise Pause/Resume at 375 to prove the controls render AND
	// work at the verified mobile viewport. After Resume, the block returns to 'active'
	// for the desktop lifecycle sections (3.8+) to continue from a known baseline.
	await runStep('resize to 375 for active lifecycle check', ['resize', '375', '812'], signal)
	const dims375 = await runStep('assert 375 viewport before lifecycle check', ['--raw', 'eval',
		'({ innerWidth: window.innerWidth, innerHeight: window.innerHeight })'
	], signal)
	const dims375Parsed = JSON.parse(dims375.stdout.trim())
	if (dims375Parsed.innerWidth !== 375) throw new Error(`375 lifecycle: innerWidth should be 375, got ${dims375Parsed.innerWidth}`)
	if (dims375Parsed.innerHeight !== 812) throw new Error(`375 lifecycle: innerHeight should be 812, got ${dims375Parsed.innerHeight}`)
	await openBlockManagerFromPlan()
	const activeCtrlOut = await runStep('assert active lifecycle controls at 375', ['--raw', 'eval', `
		(() => {
			const buttons = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim());
			const hasPause = buttons.some(b => /^(Pause|Pausar)$/.test(b));
			const hasEnd = buttons.some(b => /End block|Finalizar bloque/.test(b));
			const hasResume = buttons.some(b => /^(Resume|Seguir)$/.test(b));
			return { hasPause, hasEnd, hasResume, scrollWidth: document.body.scrollWidth, innerWidth: window.innerWidth };
		})()
	`], signal)
	const activeCtrl = JSON.parse(activeCtrlOut.stdout.trim())
	if (!activeCtrl.hasPause) throw new Error('375 lifecycle: Pause button missing while block is active')
	if (!activeCtrl.hasEnd) throw new Error('375 lifecycle: End block button missing while block is active')
	if (activeCtrl.scrollWidth > activeCtrl.innerWidth) throw new Error(`375 lifecycle: horizontal overflow in manager sheet: scrollWidth=${activeCtrl.scrollWidth} > innerWidth=${activeCtrl.innerWidth}`)
	// Click Pause at 375 (the manager sheet's button), confirm in the center confirmSheet.
	await runStep('tap Pause at 375', ['click', "getByRole('button', { name: /^Pause$|^Pausar$/ })"], signal)
	await runStep('confirm Pause at 375', ['click', "getByRole('button', { name: /^Pause$|^Pausar$/ }).last()"], signal)
	await runStep('reload after pause at 375', ['reload'], signal)
	const afterPauseAt375 = await readState()
	if (!afterPauseAt375.activeBlock || afterPauseAt375.activeBlock.status !== 'paused') throw new Error(`375 lifecycle pause: status should be 'paused', got '${afterPauseAt375.activeBlock && afterPauseAt375.activeBlock.status}'`)
	if (!afterPauseAt375.activeBlock.pausedOn) throw new Error(`375 lifecycle pause: pausedOn should be set, got '${afterPauseAt375.activeBlock.pausedOn}'`)
	// Resume from 375 — proves Resume + End controls are visible AND actionable when paused.
	await openBlockManagerFromPlan()
	const pausedCtrlOut = await runStep('assert Resume + End controls at 375', ['--raw', 'eval', `
		(() => {
			const buttons = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim());
			return { hasResume: buttons.some(b => /^(Resume|Seguir)$/.test(b)), hasEnd: buttons.some(b => /End block|Finalizar bloque/.test(b)), scrollWidth: document.body.scrollWidth, innerWidth: window.innerWidth };
		})()
	`], signal)
	const pausedCtrl = JSON.parse(pausedCtrlOut.stdout.trim())
	if (!pausedCtrl.hasResume) throw new Error('375 lifecycle: Resume button missing while block is paused')
	if (!pausedCtrl.hasEnd) throw new Error('375 lifecycle: End block button missing while block is paused')
	if (pausedCtrl.scrollWidth > pausedCtrl.innerWidth) throw new Error(`375 lifecycle: horizontal overflow in paused manager sheet: scrollWidth=${pausedCtrl.scrollWidth} > innerWidth=${pausedCtrl.innerWidth}`)
	await runStep('tap Resume at 375', ['click', "getByRole('button', { name: /^Resume$|^Seguir$/ })"], signal)
	await runStep('confirm Resume at 375', ['click', "getByRole('button', { name: /^Resume$|^Seguir$/ }).last()"], signal)
	await runStep('reload after resume at 375', ['reload'], signal)
	const afterResumeAt375 = await readState()
	if (!afterResumeAt375.activeBlock || afterResumeAt375.activeBlock.status !== 'active') throw new Error(`375 lifecycle resume: status should be 'active', got '${afterResumeAt375.activeBlock && afterResumeAt375.activeBlock.status}'`)
	if (!Array.isArray(afterResumeAt375.activeBlock.pausedRanges) || afterResumeAt375.activeBlock.pausedRanges.length !== 1) throw new Error(`375 lifecycle resume: pausedRanges should have 1 closed entry, got ${JSON.stringify(afterResumeAt375.activeBlock.pausedRanges)}`)
	// Restore desktop layout for the next sections.
	await runStep('resize back to desktop after 375 lifecycle', ['resize', '1280', '720'], signal)
	const desktopRestore = await runStep('assert desktop viewport after 375 lifecycle', ['--raw', 'eval',
		'({ innerWidth: window.innerWidth, innerHeight: window.innerHeight })'
	], signal)
	const desktopRestoreParsed = JSON.parse(desktopRestore.stdout.trim())
	if (desktopRestoreParsed.innerWidth !== 1280) throw new Error(`375 lifecycle restore: innerWidth should be 1280, got ${desktopRestoreParsed.innerWidth}`)
	if (desktopRestoreParsed.innerHeight !== 720) throw new Error(`375 lifecycle restore: innerHeight should be 720, got ${desktopRestoreParsed.innerHeight}`)

	// ----- 3.8 end, reload, assert activeBlock === null and legacy resolution restored -----
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
	// After end, Plan rows must revert to legacy S.week/dayPlan (block override is gone). Walk the
	// rows and assert each matches what S.week[d] says (or Rest when no entry).
	await runStep('navigate to plan after end for legacy fallback', ['goto', `${baseUrl}/#/plan`], signal)
	const planLegacyOut = await runStep('extract plan rows after end', ['--raw', 'eval', `
		(() => {
			const order = [1, 2, 3, 4, 5, 6, 0];
			const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
			const allItems = [...document.querySelectorAll('.list .item')];
			const rows = [];
			for (const wd of order) {
				const name = dayNames[wd];
				const item = allItems.find(el => el.querySelector('.tt') && el.querySelector('.tt').textContent.trim() === name);
				const tag = item ? item.querySelector('.tag') : null;
				rows.push({ wd, name, tag: tag ? tag.textContent.trim() : null, tagAcc: !!(tag && tag.classList.contains('acc')) });
			}
			return rows;
		})()
	`], signal)
	const planLegacyRows = JSON.parse(planLegacyOut.stdout.trim())
	const SafterEnd = afterEnd
	for (const row of planLegacyRows) {
		const legacyRoutineId = SafterEnd.week[row.wd]
		const legacyRoutine = legacyRoutineId ? SafterEnd.routines.find(r => r.id === legacyRoutineId) : null
		if (legacyRoutine) {
			if (!row.tagAcc || !row.tag.includes(legacyRoutine.name)) throw new Error(`legacy fallback: ${row.name} (wd ${row.wd}) should show "${legacyRoutine.name}" after end, got "${row.tag}"`)
		} else {
			if (row.tagAcc) throw new Error(`legacy fallback: ${row.name} (wd ${row.wd}) should be Rest after end (no legacy entry), got "${row.tag}"`)
		}
	}

	// ----- 3.9 invalid save preserves prior state (blank name) -----
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

	// ----- 3.10 cancel preserves prior state -----
	// The 3.5b edit renamed the block to "Smoke W V2", so the cancel test must accept that
	// as the pre-cancel baseline. It still proves the cancel path leaves the persisted state
	// untouched — the post-3.5b name is preserved across the cancelled edit.
	await openBlockManagerFromPlan()
	await runStep('open Smoke W V2 for cancel test', ['click', ".list .item:has-text('Smoke W V2')"], signal)
	await runStep('fill new name (will cancel)', ['fill', "getByPlaceholder(/Block name|Nombre del bloque/)", 'Modified Smoke W V2'], signal)
	await runStep('cancel the edit', ['click', "getByRole('button', { name: /^Cancel$|^Cancelar$/ })"], signal)
	await runStep('reload after cancel', ['reload'], signal)
	const afterCancel = await readState()
	if (afterCancel.blocks[0].name !== 'Smoke W V2') throw new Error(`cancel: blocks[0].name should remain 'Smoke W V2' (the post-3.5b rename), got '${afterCancel.blocks[0].name}'`)

	// ----- 3.11 375x812 no overflow + manager controls + Plan rows still render -----
	// Note on the missing "duplicate activate" assertion: the BlockEditor hides the "Save &
	// activate" button whenever another block is already active (`!isActive && !ab && v.valid`),
	// so the duplicate-activation failure feedback ("End the active block first") is unreachable
	// from the UI. The activateBlock helper itself throws on duplicate activation — that contract
	// is pinned by the unit tests in useStore.test.js. Here the lifecycle actions are already
	// covered end-to-end by 3.2c (activate), 3.7 (pause), 3.8 (resume), 3.9 (end), 3.10 (invalid
	// save), and 3.11 (cancel), so we move directly to the responsive check.
	await runStep('resize to mobile 375x812', ['resize', '375', '812'], signal)
	const dimsOut = await runStep('assert 375 viewport + no overflow', ['--raw', 'eval',
		'({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, scrollWidth: document.documentElement.scrollWidth })'
	], signal)
	const dims = JSON.parse(dimsOut.stdout.trim())
	if (dims.innerWidth !== 375) throw new Error(`375: innerWidth should be 375, got ${dims.innerWidth}`)
	if (dims.innerHeight !== 812) throw new Error(`375: innerHeight should be 812, got ${dims.innerHeight}`)
	if (dims.scrollWidth > dims.innerWidth) throw new Error(`375: horizontal overflow: scrollWidth=${dims.scrollWidth} > innerWidth=${dims.innerWidth}`)
	// The block manager at 375 must stay usable: the "Add block" + "Done" footer controls, the
	// stored-block list, and the active-block lifecycle card (Pause/End) all need to render
	// without horizontal overflow. We are inside the end-of-block state at this point in the
	// smoke (3.9 ended the block, 3.10/3.11 only added and removed a throwaway draft), so the
	// lifecycle card is absent — we assert the manager's always-present footer + list instead.
	await openBlockManagerFromPlan()
	const mobileOut = await runStep('assert manager controls visible at 375', ['--raw', 'eval',
		"({ hasAdd: /Add block|Añadir bloque/.test(document.body.innerText), hasDone: /Done|Listo/.test(document.body.innerText), hasStoredBlock: /Smoke W/.test(document.body.innerText), scrollWidth: document.body.scrollWidth, innerWidth: window.innerWidth })"
	], signal)
	const mobile = JSON.parse(mobileOut.stdout.trim())
	if (!mobile.hasAdd) throw new Error('375: Add block control is not visible in the block manager')
	if (!mobile.hasDone) throw new Error('375: Done control is not visible in the block manager')
	if (!mobile.hasStoredBlock) throw new Error('375: stored block (Smoke W) is not visible in the block manager list')
	if (mobile.scrollWidth > mobile.innerWidth) throw new Error(`375: body overflow in manager sheet: scrollWidth=${mobile.scrollWidth} > innerWidth=${mobile.innerWidth}`)
	// Plan rows on the 375 layout must still render each weekday without horizontal overflow.
	// The block was ended in 3.9, so the Plan view is now in legacy S.week resolution. The
	// content check uses the persisted legacy S.week to verify each weekday's tag matches the
	// resolved legacy routine (or "Rest" when no entry). The layout claim is not coverage
	// without a content check.
	await runStep('navigate to plan at 375 for layout content check', ['goto', `${baseUrl}/#/plan`], signal)
	const plan375Out = await runStep('extract plan rows at 375', ['--raw', 'eval', `
		(() => {
			const order = [1, 2, 3, 4, 5, 6, 0];
			const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
			const allItems = [...document.querySelectorAll('.list .item')];
			const rows = [];
			for (const wd of order) {
				const name = dayNames[wd];
				const item = allItems.find(el => el.querySelector('.tt') && el.querySelector('.tt').textContent.trim() === name);
				const tag = item ? item.querySelector('.tag') : null;
				rows.push({ wd, name, found: !!item, tag: tag ? tag.textContent.trim() : null });
			}
			const st = JSON.parse(localStorage.getItem('gym_state_v1') || 'null');
			const week = (st && st.week) || {};
			const rmap = {};
			((st && st.routines) || []).forEach(r => { rmap[r.id] = r.name; });
			const legacy = {};
			for (const k of Object.keys(week)) {
				const id = week[k];
				legacy[k] = rmap[id] || null;
			}
			return { rows, legacy, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
		})()
	`], signal)
	const plan375 = JSON.parse(plan375Out.stdout.trim())
	if (plan375.scrollWidth > plan375.innerWidth) throw new Error(`375: horizontal overflow on Plan: scrollWidth=${plan375.scrollWidth} > innerWidth=${plan375.innerWidth}`)
	for (const row of plan375.rows) {
		if (!row.found) throw new Error(`375: Plan row for ${row.name} missing`)
		const expectedLegacy = plan375.legacy[String(row.wd)]
		if (expectedLegacy && !(row.tag || '').includes(expectedLegacy)) throw new Error(`375: Plan row for ${row.name} (wd ${row.wd}) should be ${expectedLegacy} (legacy), got "${row.tag}"`)
	}

	// =========================================================================
	// programmed-effort journey (issue: programmed-effort-ui-coverage, WU3)
	// =========================================================================
	//
	// Covers the three scenarios the verify report flagged as untested:
	//   P1 — distinct per-set RIR targets (set via the routine editor's UI
	//        target steppers, persisted by Save) reveal as a read-only
	//        disclosure in the workout, and the actual-effort stepper records
	//        a separate value that does not mutate the planned target.
	//   P2 — changing the profile metric (RIR → RPE) through Settings hides the
	//        existing RIR targets without conversion; explicitly editing the
	//        routine again in the new metric persists only current-metric
	//        values, with no RIR slot left behind.
	//   P3 — when the active metric mismatches the saved target, the disclosure
	//        is not rendered (no .setinfo button) and the actual-effort stepper
	//        is still editable and persists its value.
	// Each scenario exercises the live UI for every behaviour change; state is
	// only read (via --raw eval or readState) to verify outcomes. No feature
	// state is seeded into gym_state_v1 — every persistent write goes through
	// the actual user flow.
	// ----- P0 reset state, set English locale, reload, re-enter guest + plan -----
	await runStep('navigate to home before programmed-effort reset', ['goto', `${baseUrl}/#/home`], signal)
	await runStep('clear cookies (programmed effort reset)', ['cookie-clear'], signal)
	await runStep('clear localStorage (programmed effort reset)', ['localstorage-clear'], signal)
	await runStep('force English locale (programmed effort)', ['localstorage-set', 'gym_lang_v1', 'en'], signal)
	await runStep('clear sessionStorage (programmed effort)', ['sessionstorage-clear'], signal)
	await runStep('reload after programmed-effort reset', ['reload'], signal)
	await runStep('guest entry (programmed effort)', ['click', "getByRole('button', { name: /Continue without account|Continuar sin cuenta/ })"], signal)
	await runStep('load starter plan (programmed effort)', ['click', "getByRole('button', { name: /Load starter plan.*PPL|Cargar plan inicial.*PPL/ })"], signal)

	// ----- P1 scenario: enable programmedEffort, set per-set RIR targets, start workout, reveal target, record actual -----
	// Configure the metric and the opt-in toggle through the Settings UI. The RIR pill is a
	// button in the "Effort per set" Segmented; the programmedEffort toggle is a Switch inside
	// the row titled "Programmed targets per set". Both clicks must result in persisted state.
	await runStep('open settings (programmed effort)', ['goto', `${baseUrl}/#/settings`], signal)
	await runStep('select RIR metric', ['click', "getByRole('button', { name: 'RIR', exact: true })"], signal)
	// Locate the Switch by scoping to the row whose title text is "Programmed targets per set";
	// the Switch has no accessible name of its own, so role+name queries miss it.
	await runStep('enable programmedEffort toggle', ['run-code', [
		"async page => {",
		"  const row = page.locator('.lrow').filter({ hasText: /Programmed targets per set|Objetivos programados por serie/ });",
		"  const sw = row.locator('[role=\"switch\"]').first();",
		"  await sw.click();",
		"  return 'toggled';",
		"}"
	].join('\n')], signal)
	const effort0 = await runStep('assert metric + toggle persisted', ['--raw', 'eval',
		"JSON.stringify({ effort: (JSON.parse(localStorage.getItem('gym_state_v1') || '{}')).effort, programmedEffort: (JSON.parse(localStorage.getItem('gym_state_v1') || '{}')).programmedEffort })"
	], signal)
	const effort0State = parseEvalJson(effort0, 'P1 Settings state')
	if (effort0State.effort !== 'rir') throw new Error(`P1: Settings.effort should be 'rir' after clicking RIR; got ${JSON.stringify(effort0State)}`)
	if (effort0State.programmedEffort !== true) throw new Error(`P1: Settings.programmedEffort should be true after toggling; got ${JSON.stringify(effort0State)}`)

	// Open the Push Day routine editor and tap the first exercise (bench press, catalog id
	// 0025) to open ExConfig.
	await runStep('navigate to plan (P1)', ['goto', `${baseUrl}/#/plan`], signal)
	await runStep('open Push Day routine (P1)', ['click', "getByText('Push Day', { exact: true }).last()"], signal)
	// Bench press is the first exercise in the starter Push Day; clicking the first list
	// item in the routine editor opens its ExConfig sheet.
	await runStep('open bench-press in ExConfig (P1)', ['run-code', [
		"async page => {",
		"  await page.locator('.list .item').first().click();",
		"  return 'opened';",
		"}"
	].join('\n')], signal)
	// Inside ExConfig the per-set TargetStepper row renders one .stp per set; each .stp has a
	// Decrease button, a NumberField input with class `num`, and an Increase button. Set
	// distinct RIR values for sets 1 and 2 via the input so the test does not depend on
	// stepEffort's click-count behaviour. Inputs use the existing NumberField commit path,
	// which calls capEffort(kind, v) and writes through the same onChange ExConfig uses.
	const setBenchTargetsP1 = await runStep('set per-set RIR targets on bench (P1)', ['run-code', [
		"async page => {",
		"  const heading = page.getByRole('heading', { name: /Programmed target|Objetivo programado/ }).first();",
		"  const steppers = heading.locator('xpath=following-sibling::div[2]').locator('.stp');",
		"  const count = await steppers.count();",
		"  if (count < 2) throw new Error('P1: expected at least 2 target steppers in ExConfig, found ' + count);",
		"  // Set 1 → RIR 2",
		"  const in0 = steppers.nth(0).locator('input.num');",
		"  await in0.click();",
		"  await in0.fill('2');",
		"  await in0.press('Tab');",
		"  // Set 2 → RIR 1",
		"  const in1 = steppers.nth(1).locator('input.num');",
		"  await in1.click();",
		"  await in1.fill('1');",
		"  await in1.press('Tab');",
		"  return 'targets-set';",
		"}"
	].join('\n')], signal)
	if (!/targets-set/.test(setBenchTargetsP1.stdout)) throw new Error(`P1: setting per-set RIR targets failed${details(setBenchTargetsP1)}`)
	// Save closes the ExConfig sheet and persists the routine entry; the Save button label is
	// translated, so the regex covers both languages.
	await runStep('save bench-press ExConfig (P1)', ['click', "getByRole('button', { name: /^Save$|^Guardar$/ })"], signal)
	// Read the routine to confirm the targets survived validation+normalization and landed on
	// the routine entry as the source of truth for buildSets.
	const routineP1 = await readState()
	const benchP1 = routineP1.routines.find(r => r.name === 'Push Day').ex.find(e => e.id === '0025')
	if (!Array.isArray(benchP1.programmedEffort) || benchP1.programmedEffort.length < 2)
		throw new Error(`P1: bench.programmedEffort should be saved with distinct per-set targets; got ${JSON.stringify(benchP1.programmedEffort)}`)
	if (benchP1.programmedEffort[0] == null || benchP1.programmedEffort[0].metric !== 'rir' || benchP1.programmedEffort[0].value !== 2)
		throw new Error(`P1: set 1 target should be {metric:'rir',value:2}; got ${JSON.stringify(benchP1.programmedEffort[0])}`)
	if (benchP1.programmedEffort[1] == null || benchP1.programmedEffort[1].metric !== 'rir' || benchP1.programmedEffort[1].value !== 1)
		throw new Error(`P1: set 2 target should be {metric:'rir',value:1}; got ${JSON.stringify(benchP1.programmedEffort[1])}`)
	// Sets 3 and 4 may stay null (no target configured) or be filled with the last real target
	// by normalizeTargets; either way, no RIR slot may drift to the wrong metric.
	if (benchP1.programmedEffort.some(s => s != null && s.metric !== 'rir'))
		throw new Error(`P1: every saved target should keep metric 'rir'; got ${JSON.stringify(benchP1.programmedEffort)}`)

	// Today (Thursday) is not Push Day's scheduled weekday in the starter plan, so Push Day
	// appears under "Other routines" with a click handler that calls startFlow. Clicking the
	// item div exercises the same chooser path the "Start Push Day" button uses on Mondays.
	await runStep('open workout chooser (P1)', ['goto', `${baseUrl}/#/workout`], signal)
	await runStep('start Push Day from chooser (P1)', ['click', ".list .item:has-text('Push Day')"], signal)
	await runStep('skip weigh-in (P1)', ['click', "getByRole('button', { name: /Start without weighing in|Empezar sin pesarse/ })"], signal)

	// Read-only probe: confirm buildSets snapshotted the matching plannedEffort onto the
	// active workout sets. buildSets runs at beginWorkout — the same code path the user
	// hits — so this assertion exercises real feature behaviour, not seeded state.
	const probeBenchInWorkout = await runStep('probe bench entry after workout start (P1)', ['--raw', 'eval',
		"(() => { const s = JSON.parse(localStorage.getItem('gym_state_v1') || '{}'); const bench = s.active && s.active.entries && s.active.entries.find(e => e.id === '0025'); return { effort: s.effort, benchSets: bench && bench.sets && bench.sets.map(s => ({ plannedEffort: s.plannedEffort, w: s.w, r: s.r })) }; })()"
	], signal)
	console.log('bench entry after start P1:', probeBenchInWorkout.stdout.trim())
	const afterStartP1 = await readState()
	const benchEntry = afterStartP1.active && afterStartP1.active.entries.find(e => e.id === '0025')
	if (!benchEntry || !benchEntry.sets || benchEntry.sets.length < 2) throw new Error('P1: bench-press entry not present in active workout sets')
	if (!benchEntry.sets[0].plannedEffort || benchEntry.sets[0].plannedEffort.metric !== 'rir' || benchEntry.sets[0].plannedEffort.value !== 2)
		throw new Error(`P1: workout set 0 should snapshot a RIR=2 plannedEffort from buildSets; got ${JSON.stringify(benchEntry.sets[0].plannedEffort)}`)
	if (!benchEntry.sets[1].plannedEffort || benchEntry.sets[1].plannedEffort.metric !== 'rir' || benchEntry.sets[1].plannedEffort.value !== 1)
		throw new Error(`P1: workout set 1 should snapshot a RIR=1 plannedEffort from buildSets; got ${JSON.stringify(benchEntry.sets[1].plannedEffort)}`)

	// Sanity probe before clicking the info button: the .setinfo buttons must exist for sets
	// that carry a matching plannedEffort. The probe is read-only.
	const beforeRevealP1 = await runStep('probe workout setrows + buttons (P1)', ['--raw', 'eval',
		"(() => { const sets = [...document.querySelectorAll('.setrow')]; const infoBtns = [...document.querySelectorAll('.setinfo')]; const incBtns = [...document.querySelectorAll('button[aria-label=\"Increase\"]')]; const firstSetText = sets[0] ? sets[0].innerText.slice(0, 200) : ''; return { setrowCount: sets.length, infoButtonCount: infoBtns.length, incButtonCount: incBtns.length, firstSetText: firstSetText, exerciseH3s: [...document.querySelectorAll('h3')].map(h => h.textContent.trim()) }; })()"
	], signal)
	const beforeP1 = JSON.parse(beforeRevealP1.stdout.trim())
	if (beforeP1.infoButtonCount < 1) throw new Error(`P1: at least one .setinfo button should render before reveal; got ${beforeP1.infoButtonCount}`)
	console.log('before reveal P1:', beforeRevealP1.stdout.trim())
	// The .setinfo button is role=button with aria-label "Show programmed target" when closed
	// and "Hide programmed target" when open. Clicking the first one opens the disclosure.
	await runStep('reveal programmed target on set 1', ['click', "getByRole('button', { name: /Show programmed target|Mostrar objetivo programado/ }).first()"], signal)
	const afterRevealP1 = await runStep('assert programmed-target disclosure is read-only', [
		'--raw', 'eval',
		"(() => { const reg = document.querySelector('[role=region][aria-label=\"Programmed target\"]'); const dim = reg ? reg.querySelector('.dim') : null; return { hasRegion: !!reg, hasReadOnlyHint: !!(dim && /read-only|schreibgeschützt|solo lectura|lecture seule|只读|только|tолько чтение|salt okunur|odczytu/i.test(dim.textContent)), ariaExpanded: document.querySelector('.setinfo') && document.querySelector('.setinfo').getAttribute('aria-expanded') } })()"
	], signal)
	const revealP1 = JSON.parse(afterRevealP1.stdout.trim())
	if (!revealP1.hasRegion) throw new Error(`P1: no [role=region][aria-label="Programmed target"] after reveal; got ${JSON.stringify(revealP1)}`)
	if (!revealP1.hasReadOnlyHint) throw new Error(`P1: disclosure region has no read-only hint; got ${JSON.stringify(revealP1)}`)
	if (revealP1.ariaExpanded !== 'true') throw new Error(`P1: aria-expanded should be 'true'; got ${revealP1.ariaExpanded}`)

	// Record a separate actual RIR on set 1 via the actual-effort stepper. The actual-effort
	// stepper is the right-most `.eff-sp` column on each row; its Increase button is the last
	// aria-label="Increase" inside the row.
	const recordActual = await runStep('record actual RIR on set 1 (P1)', ['run-code', [
		"async page => {",
		"  const sets = await page.locator('.setrow').all();",
		"  if (sets.length < 1) throw new Error('P1: no .setrow found');",
		"  const first = sets[0];",
		"  const inc = first.getByRole('button', { name: 'Increase' }).last();",
		"  await inc.click();",
		"  return 'incremented';",
		"}"
	].join('\n')], signal)
	if (!/incremented/.test(recordActual.stdout)) throw new Error(`P1: actual-effort increment did not report success${details(recordActual)}`)

	const afterActualP1 = await readState()
	const set0 = afterActualP1.active.entries.find(e => e.id === '0025').sets[0]
	if (set0.plannedEffort.value !== 2 || set0.plannedEffort.metric !== 'rir') throw new Error(`P1: plannedEffort was mutated by actual-effort entry; got ${JSON.stringify(set0.plannedEffort)}`)
	if (typeof set0.rir !== 'number' || set0.rir < 0 || set0.rir > 10) throw new Error(`P1: actual rir should be a number in RIR range; got ${JSON.stringify(set0.rir)}`)

	// Discard the active workout so P2/P3 start clean. Same two-step pattern as the block
	// lifecycle smoke: the icon button (aria-label=Discard) and the confirm-sheet button
	// (text=Discard).
	await runStep('discard active workout after P1', ['run-code', [
		"async page => {",
		"  await page.getByRole('button', { name: 'Discard', exact: true }).first().click();",
		"  await page.getByRole('button', { name: 'Discard', exact: true }).last().click();",
		"  return 'discarded';",
		"}"
	].join('\n')], signal)

	// ----- P2 scenario: change profile metric RIR → RPE through Settings; old RIR targets hidden without conversion -----
	// Settings UI flips the metric to RPE. With the metric now RPE, the bench routine entry
	// (which still carries RIR targets from P1) is hidden by the no-conversion rule. Reopen
	// the routine and explicitly edit the targets in the new metric; Save writes only RPE
	// slots and never carries the old RIR slots forward.
	await runStep('open settings (P2)', ['goto', `${baseUrl}/#/settings`], signal)
	await runStep('switch metric to RPE', ['click', "getByRole('button', { name: 'RPE', exact: true })"], signal)
	const effort2 = await runStep('assert metric persisted to RPE', ['--raw', 'eval',
		"JSON.stringify({ effort: (JSON.parse(localStorage.getItem('gym_state_v1') || '{}')).effort })"
	], signal)
	if (parseEvalJson(effort2, 'P2 Settings state').effort !== 'rpe') throw new Error(`P2: Settings.effort should be 'rpe' after clicking RPE; got ${effort2.stdout.trim()}`)

	// Reopen the Push Day routine in the editor. After the metric flip, the bench entry
	// still carries RIR targets, so the slot values should render as empty cells (mismatch
	// hides the value, not converts it).
	await runStep('navigate to plan (P2)', ['goto', `${baseUrl}/#/plan`], signal)
	await runStep('open Push Day routine (P2)', ['click', "getByText('Push Day', { exact: true }).last()"], signal)
	await runStep('open bench-press in ExConfig (P2)', ['run-code', [
		"async page => {",
		"  await page.locator('.list .item').first().click();",
		"  return 'opened';",
		"}"
	].join('\n')], signal)
	// Read-only probe: assert every slot input shows empty because the saved RIR targets
	// no longer match the new metric. This is the "no conversion" rule made visible.
	const preFillP2 = await runStep('probe RIR slots render empty under RPE (P2)', ['--raw', 'eval',
		"(() => { const heading = [...document.querySelectorAll('h4.sec')].find(h => /Programmed target|Objetivo programado/i.test(h.textContent)); const row = heading && heading.nextElementSibling && heading.nextElementSibling.nextElementSibling; const inputs = row ? [...row.querySelectorAll('.stp input.num')] : []; return { stepperCount: inputs.length, inputValues: inputs.map(i => i.value) }; })()"
	], signal)
	const preFillP2State = parseEvalJson(preFillP2, 'P2 target inputs')
	if (preFillP2State.stepperCount < 2) throw new Error(`P2: expected at least 2 target steppers; got ${preFillP2State.stepperCount}`)
	if (preFillP2State.inputValues.slice(0, 2).some(v => v !== ''))
		throw new Error(`P2: saved RIR targets should render as empty cells under RPE metric; got ${JSON.stringify(preFillP2State.inputValues)}`)
	// Now explicitly fill RPE values into the first two slots and save. The setSlot path
	// overwrites the underlying array, and validation on save drops any non-RPE entry, so the
	// persisted routine carries only RPE slots — no RIR slot survives.
	const setBenchTargetsP2 = await runStep('set per-set RPE targets on bench (P2)', ['run-code', [
		"async page => {",
		"  const heading = page.getByRole('heading', { name: /Programmed target|Objetivo programado/ }).first();",
		"  const steppers = heading.locator('xpath=following-sibling::div[2]').locator('.stp');",
		"  // Set 1 → RPE 8",
		"  const in0 = steppers.nth(0).locator('input.num');",
		"  await in0.click();",
		"  await in0.fill('8');",
		"  await in0.press('Tab');",
		"  // Set 2 → RPE 8.5",
		"  const in1 = steppers.nth(1).locator('input.num');",
		"  await in1.click();",
		"  await in1.fill('8.5');",
		"  await in1.press('Tab');",
		"  return 'targets-set';",
		"}"
	].join('\n')], signal)
	if (!/targets-set/.test(setBenchTargetsP2.stdout)) throw new Error(`P2: setting per-set RPE targets failed${details(setBenchTargetsP2)}`)
	await runStep('save bench-press ExConfig (P2)', ['click', "getByRole('button', { name: /^Save$|^Guardar$/ })"], signal)

	// Read the routine after the explicit edit. P2 asserts:
	//   - bench.programmedEffort is present (explicit edit wrote it)
	//   - slot 0 carries the new RPE metric and value 8
	//   - slot 1 carries RPE value 8.5
	//   - NO RIR slot survives (the no-conversion guarantee)
	const afterP2 = await readState()
	const benchP2 = afterP2.routines.find(r => r.name === 'Push Day').ex.find(e => e.id === '0025')
	if (!Array.isArray(benchP2.programmedEffort) || benchP2.programmedEffort.length < 2)
		throw new Error(`P2: bench-press should carry programmedEffort after explicit edit; got ${JSON.stringify(benchP2.programmedEffort)}`)
	if (benchP2.programmedEffort[0] == null || benchP2.programmedEffort[0].metric !== 'rpe')
		throw new Error(`P2: saved target metric should be 'rpe'; got ${JSON.stringify(benchP2.programmedEffort[0])}`)
	if (typeof benchP2.programmedEffort[0].value !== 'number' || benchP2.programmedEffort[0].value < 6 || benchP2.programmedEffort[0].value > 10)
		throw new Error(`P2: saved RPE target value should be in [6..10]; got ${benchP2.programmedEffort[0].value}`)
	if (Math.abs(benchP2.programmedEffort[0].value - 8) > 0.01)
		throw new Error(`P2: saved slot 0 RPE value should be 8; got ${benchP2.programmedEffort[0].value}`)
	if (benchP2.programmedEffort[1] == null || Math.abs(benchP2.programmedEffort[1].value - 8.5) > 0.01)
		throw new Error(`P2: saved slot 1 RPE value should be 8.5; got ${JSON.stringify(benchP2.programmedEffort[1])}`)
	if (benchP2.programmedEffort.some(s => s != null && s.metric === 'rir'))
		throw new Error(`P2: explicit RPE edit must not leave any RIR slot behind; got ${JSON.stringify(benchP2.programmedEffort)}`)

	// ----- P3 scenario: switch metric back to RIR; the workout set shows no info button, but the actual-effort stepper is still editable -----
	// The bench.programmedEffort still carries RPE targets from P2, but the active profile
	// metric is now RIR — the exact mismatch state the spec demands. We exercise the actual
	// workout UI to verify the disclosure is hidden and the actual-effort stepper remains
	// editable and persists.
	await runStep('open settings (P3)', ['goto', `${baseUrl}/#/settings`], signal)
	await runStep('switch metric back to RIR', ['click', "getByRole('button', { name: 'RIR', exact: true })"], signal)
	const effort3 = await runStep('assert metric persisted to RIR (P3)', ['--raw', 'eval',
		"JSON.stringify({ effort: (JSON.parse(localStorage.getItem('gym_state_v1') || '{}')).effort })"
	], signal)
	if (parseEvalJson(effort3, 'P3 Settings state').effort !== 'rir') throw new Error(`P3: Settings.effort should be 'rir' after re-clicking RIR; got ${effort3.stdout.trim()}`)

	await runStep('open workout chooser (P3)', ['goto', `${baseUrl}/#/workout`], signal)
	await runStep('start Push Day from chooser (P3)', ['click', ".list .item:has-text('Push Day')"], signal)
	await runStep('skip weigh-in (P3)', ['click', "getByRole('button', { name: /Start without weighing in|Empezar sin pesarse/ })"], signal)

	const afterStartP3 = await readState()
	const benchP3 = afterStartP3.active && afterStartP3.active.entries.find(e => e.id === '0025')
	if (!benchP3 || !benchP3.sets || benchP3.sets.length < 2) throw new Error('P3: bench-press entry missing from active workout sets')
	// Active sets must NOT carry a plannedEffort snapshot when the saved metric mismatches
	// the active profile metric — that is the no-conversion rule at workout start. Every
	// set's plannedEffort key is omitted (undefined).
	if (benchP3.sets.some(s => s.plannedEffort))
		throw new Error(`P3: mismatched-target workout sets should not snapshot plannedEffort; got ${JSON.stringify(benchP3.sets.map(s => s.plannedEffort))}`)
	// Live DOM: the .setinfo button must be absent for every bench-press set row (no
	// disclosure rendered), and the actual-effort stepper column must remain visible and
	// editable. The orchestrator's spec for scenario 3 demands the assertion cover the
	// exact UI state, not localStorage alone.
	const p3Dom = await runStep('assert no info button + actual stepper editable (P3 UI)', [
		'--raw', 'eval',
		"(() => { const sets = [...document.querySelectorAll('.setrow')]; const infoButtons = [...document.querySelectorAll('.setinfo')]; return { totalSets: sets.length, infoButtonCount: infoButtons.length, hasActualStepperFirst: !!sets[0] && !!sets[0].querySelector('.stp.eff'), firstSetActualButtons: sets[0] ? sets[0].querySelectorAll('.stp.eff button[aria-label=\"Increase\"]').length : 0 } })()"
	], signal)
	const p3State = parseEvalJson(p3Dom, 'P3 workout DOM state')
	if (p3State.infoButtonCount !== 0) throw new Error(`P3: no .setinfo buttons should render when targets mismatch; got ${p3State.infoButtonCount}`)
	if (!p3State.hasActualStepperFirst) throw new Error('P3: actual-effort stepper column should remain visible on first set')
	if (p3State.firstSetActualButtons < 1) throw new Error(`P3: actual-effort Increase button must be present on first set; got ${p3State.firstSetActualButtons}`)
	// Increment the actual RIR on the first bench-press set; the change must persist.
	await runStep('record actual RIR on P3 set 1', ['run-code', [
		"async page => {",
		"  const sets = await page.locator('.setrow').all();",
		"  if (sets.length < 1) throw new Error('no .setrow found in P3');",
		"  const first = sets[0];",
		"  const inc = first.getByRole('button', { name: 'Increase' }).last();",
		"  await inc.click();",
		"  return 'incremented';",
		"}"
	].join('\n')], signal)
	const afterP3Actual = await readState()
	const benchP3b = afterP3Actual.active.entries.find(e => e.id === '0025')
	if (typeof benchP3b.sets[0].rir !== 'number' || benchP3b.sets[0].rir < 0 || benchP3b.sets[0].rir > 10)
		throw new Error(`P3: actual rir should still be recordable when target is mismatched; got ${JSON.stringify(benchP3b.sets[0])}`)
	if (benchP3b.sets[0].plannedEffort !== undefined)
		throw new Error(`P3: plannedEffort must remain absent for mismatched sets; got ${JSON.stringify(benchP3b.sets[0].plannedEffort)}`)

	console.log('Playwright smoke passed: picker dismissal (desktop routine-editor, mobile workout 375px, keyboard/focus, backdrop, CDP touch swipe) + block lifecycle (3.1 reset, 3.2-3.7 activate/edit/pause/resume/end persisted across reload, 3.3 Plan/Home show block, 3.4 workout freezes block context, 3.8 invalid save preserves state, 3.9 cancel preserves state, 3.10 375px no overflow + lifecycle controls visible) + programmed-effort journey (P1 Settings UI enables metric + opt-in toggle, routine editor sets distinct per-set RIR targets via TargetSteppers, workout reveal reads as read-only region + actual effort recorded separately + plannedEffort unchanged, P2 Settings UI flips metric RIR→RPE and old RIR targets render as empty cells, routine editor saves only current-metric RPE slots with no RIR slot surviving, P3 Settings UI flips metric back to RIR, workout hides info button for mismatched targets and actual-effort stepper remains editable and persists).')
	console.log('Playwright smoke passed: picker dismissal (desktop routine-editor, mobile workout 375px, keyboard/focus, backdrop, CDP touch swipe) + block lifecycle (3.1 reset, 3.2a add 4th routine via UI, 3.2b create 4-week block via BlockEditor UI (4 training days + 3 rest), 3.2c activate via UI, 3.3 Plan rows resolve to block routine/rest for every weekday of the start week, 3.4 Home denominator = 4 training days + today row matches block, 3.5 explicit rest remains rest, 3.5b PERSISTED EDIT + BLOCK-SOURCED REST (rename to "Smoke W V2" + change a non-today weekday to rest via BlockEditor Update round-trip across reload, resolver returns null for the edited iso with dayPlan undefined = rest source is the block, Plan row for the edited weekday reads "Rest"), 3.6a deterministic workout chooser rest semantics via day-override UI, 3.6 TRAINING (mock clock to Thursday: click "Start Fourth Day" in Today\'s plan card, skip weigh-in, complete, finished record carries block { id, name: "Smoke W V2", week: 1 }), 3.6b BLOCK-SOURCED REST (mock clock to Friday: chooser surfaces "Rest day" with zero Start buttons, dayPlan[Friday] is undefined, block.weeks[N].days[5] === "rest"), 3.7 375px active lifecycle controls (Pause/End visible + Pause/Resume actionable at 375), 3.8 end persisted across reload + legacy fallback restored, 3.9 invalid save preserves state, 3.10 cancel preserves state, 3.11 375px no overflow + manager controls + Plan legacy rows).')
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
