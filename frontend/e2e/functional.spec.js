import { test, expect, assertCriticalVisible, assertNoHorizontalOverflow } from './fixtures.js'
import { activeState, richState } from './synthetic-data.js'
import { normalizeExerciseIds } from '../src/lib/exercise-ids.js'

test('responsive navigation reaches every primary view', async ({ page, openApp }) => {
  await openApp({ state: 'rich' })
  const journeys = [
    ['Plan', 'Plan'],
    ['Stats', 'Stats'],
    ['Exercises', 'Exercises'],
    ['Home', 'Hforge'],
  ]
  for (const [button, heading] of journeys) {
    await page.locator('#tabbar').getByRole('button', { name: button, exact: true }).click()
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible()
    await expect(page.locator('#tabbar button[aria-current="page"]')).toContainText(button)
    await assertNoHorizontalOverflow(page)
  }
})

test('library search, filters, and detail overlay remain interactive', async ({ page, openApp }) => {
  await openApp({ route: '/library', state: 'rich' })
  const search = page.getByRole('textbox', { name: 'Search…' })
  await search.fill('bench press')
  await expect(page.getByText('Bench Press (Barbell)', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Filters' }).click()
  await expect(page.getByRole('group', { name: 'Filters' })).toBeVisible()
  await page.getByText('Bench Press (Barbell)', { exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await assertCriticalVisible(dialog)
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('settings interaction persists across reload and keyboard focus is visible', async ({ page, openApp }) => {
  await openApp({ route: '/settings', state: 'rich' })
  const sounds = page.getByRole('switch', { name: 'Sounds' })
  await expect(sounds).toHaveAttribute('aria-checked', 'false')
  await sounds.click()
  await expect(sounds).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Sounds' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Tab')
  const focus = page.locator(':focus')
  await expect(focus).toBeVisible()
  expect(await focus.evaluate(element => getComputedStyle(element).outlineStyle !== 'none' || getComputedStyle(element).boxShadow !== 'none')).toBe(true)
})

test('active workout records a set without overflow', async ({ page, openApp }) => {
  await openApp({ route: '/workout', state: 'active' })
  const pending = page.getByRole('checkbox', { name: /Sets 2$/ }).first()
  await pending.check()
  await expect(pending).toBeChecked()
  await assertNoHorizontalOverflow(page)
})

test('active workout sticky band covers the viewport edge after scrolling', async ({ page, openApp }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await openApp({ route: '/workout', state: 'active' })
  await page.evaluate(() => {
    // Exercise the same safe-area math on a deterministic non-zero inset; the
    // production browser supplies --sat through env(safe-area-inset-top).
    document.documentElement.style.setProperty('--sat', '24px')
    window.scrollTo(0, 320)
  })
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  const band = page.locator('.workout-sticky-head')
  const progress = page.locator('.wprog')
  await expect(band).toBeVisible()
  const metrics = await band.evaluate(el => {
    const box = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const app = getComputedStyle(document.querySelector('#app'))
    const point = document.elementFromPoint(box.left + box.width / 2, 1)
    return {
      top: box.top,
      background: style.backgroundColor,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      position: style.position,
      zIndex: style.zIndex,
      isolation: style.isolation,
      appPaddingTop: app.paddingTop,
      marginTop: style.marginTop,
      paddingTop: style.paddingTop,
      pointWithinBand: point === el || point?.closest('.workout-sticky-head') === el,
    }
  })
  expect(metrics.top).toBeGreaterThanOrEqual(-1)
  expect(metrics.top).toBeLessThanOrEqual(1)
  expect(metrics.background).toBe(metrics.bodyBackground)
  expect(metrics.position).toBe('sticky')
  expect(metrics.zIndex).toBe('20')
  expect(metrics.isolation).toBe('isolate')
  expect(metrics.appPaddingTop).toBe('32px')
  expect(metrics.marginTop).toBe('-32px')
  expect(metrics.paddingTop).toBe('32px')
  expect(metrics.pointWithinBand).toBe(true)

  const progressStyles = await progress.evaluate(el => {
    const style = getComputedStyle(el)
    return {
      position: style.position,
      zIndex: style.zIndex,
      transform: style.transform,
      backfaceVisibility: style.backfaceVisibility,
      willChange: style.willChange,
      height: style.height,
    }
  })
  expect(progressStyles.position).toBe('static')
  expect(progressStyles.zIndex).toBe('auto')
  expect(progressStyles.transform).toBe('none')
  expect(progressStyles.backfaceVisibility).toBe('visible')
  expect(progressStyles.willChange).toBe('auto')
  expect(progressStyles.height).toBe('4px')
})

test('active workout routine picker excludes the current routine and cancels cleanly', async ({ page, openApp }) => {
  await openApp({ route: '/workout', state: 'active' })
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click()

  const exercisePicker = page.getByRole('dialog').last()
  await expect(exercisePicker.getByRole('heading', { name: 'Add exercise', exact: true })).toBeVisible()
  await exercisePicker.getByRole('button', { name: 'Add exercises from another routine', exact: true }).click()

  const routinePicker = page.getByRole('dialog').last()
  await expect(routinePicker.getByRole('heading', { name: 'Add from another routine', exact: true })).toBeVisible()
  await expect(routinePicker.getByRole('button', { name: /Push Day/ })).toHaveCount(0)
  await expect(routinePicker.getByRole('button', { name: /Pull Day/ })).toBeVisible()

  await routinePicker.getByRole('button', { name: 'Close', exact: true }).click()
  const restoredPicker = page.getByRole('dialog').last()
  await expect(restoredPicker.getByRole('heading', { name: 'Add exercise', exact: true })).toBeVisible()
  await assertNoHorizontalOverflow(page)
})

test('active workout imports a selected routine through the rendered picker', async ({ page, openApp }) => {
  await openApp({ route: '/workout', state: 'active' })
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click()
  await page.getByRole('dialog').last().getByRole('button', { name: 'Add exercises from another routine', exact: true }).click()
  await page.getByRole('dialog').last().getByRole('button', { name: /Pull Day/ }).click()

  const confirm = page.getByRole('dialog').last()
  await expect(confirm.getByRole('heading', { name: 'Add routine to workout?', exact: true })).toBeVisible()
  await confirm.getByRole('button', { name: 'Add exercises', exact: true }).click()

  await expect(page.getByText('3 exercises added to this workout', { exact: true })).toBeVisible()
  await expect(page.locator('.session-card')).toHaveCount(5)
  await expect(page.locator('.session-card h2')).toHaveCount(5)
  await expect(page.locator('.session-card h2').first()).toBeVisible()
  await assertNoHorizontalOverflow(page)
})

test('starting a routine keeps fresh exercise weights at the routine values', async ({ page, openApp }) => {
  await openApp({ route: '/workout', state: 'rich' })
  await page.getByText('Push Day', { exact: true }).click()

  const confirm = page.getByRole('dialog').last()
  await expect(confirm.getByRole('heading', { name: 'Start workout?', exact: true })).toBeVisible()
  await confirm.getByRole('button', { name: 'Start', exact: true }).click()

  const checkIn = page.getByRole('dialog').last()
  await expect(checkIn.getByRole('heading', { name: 'Quick check-in', exact: true })).toBeVisible()
  await checkIn.getByRole('button', { name: 'Start without weighing in', exact: true }).click()

  await expect(page.locator('.session-card h2')).toHaveCount(3)
  await expect(page.locator('.session-card h2').first()).toBeVisible()
  const weights = page.locator('input[aria-label^="Sets "][aria-label$="Weight (kg)"]')
  await expect(weights).toHaveCount(10)
  expect(await weights.evaluateAll(inputs => inputs.map(input => input.value))).toEqual(Array(10).fill('0'))
  await expect(page.locator('.history-hint')).toHaveCount(20)
  await assertNoHorizontalOverflow(page)
})

test('imports a backup through the file chooser and replaces local data', async ({ page, openApp }) => {
  await openApp({ route: '/settings', state: 'rich' })
  const imported = JSON.parse(JSON.stringify(richState))
  imported.routines = [imported.routines[0]]
  imported.week = { 1: imported.routines[0].id }
  imported.workouts = [imported.workouts[0]]
  imported.bodyweight = imported.bodyweight.slice(0, 1)
  imported.active = null

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import backup', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'hforge-test-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  })

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Import backup?', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Import', exact: true }).click()

  await page.goto('/#/history')
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
  await expect(page.getByText('1 workouts', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Push Day/ }).first()).toBeVisible()
})

test('finishing early creates history that survives reload', async ({ page, openApp }) => {
  await openApp({ route: '/workout', state: 'active' })
  await page.getByRole('button', { name: /Finish workout early/ }).click()

  const confirm = page.getByRole('dialog')
  await expect(confirm.getByRole('heading', { name: 'Finish early?', exact: true })).toBeVisible()
  await confirm.getByRole('button', { name: 'Finish workout', exact: true }).click()

  const summary = page.getByRole('dialog')
  await expect(summary.getByRole('heading', { name: 'Workout complete!', exact: true })).toBeVisible()
  await summary.getByRole('button', { name: 'Nice!', exact: true }).click()
  await page.goto('/#/history')
  await expect(page.getByRole('button', { name: /Push Day/ }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByText('13 workouts', { exact: true })).toBeVisible()
})

test('discarding an active workout clears it without touching history', async ({ page, openApp }) => {
  await openApp({ route: '/workout', state: 'active' })
  await page.getByRole('button', { name: 'Discard', exact: true }).click()

  const confirm = page.getByRole('dialog')
  await expect(confirm.getByRole('heading', { name: 'Discard workout?', exact: true })).toBeVisible()
  await confirm.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page).toHaveURL(/#\/home$/)
  await expect(page.getByRole('heading', { name: 'Hforge', exact: true }).first()).toBeVisible()

  await page.goto('/#/history')
  await expect(page.getByText('12 workouts', { exact: true })).toBeVisible()
  await page.goto('/#/workout')
  await expect(page.getByRole('heading', { name: 'Start workout', exact: true })).toBeVisible()
})

test('history opens a workout detail dialog', async ({ page, openApp }) => {
  await openApp({ route: '/history', state: 'rich' })
  await page.getByRole('button', { name: /Push Day/ }).first().click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Push Day', exact: true })).toBeVisible()
  const benchPress = dialog.getByText('Bench Press (Barbell)', { exact: true })
  await expect(benchPress).toBeVisible()
  await expect(benchPress.locator('..').getByText('PR', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Delete workout', exact: true })).toBeVisible()
})

test('historical workout opens the time-only editor without changing the route', async ({ page, openApp }) => {
  await openApp({ route: '/history', state: 'rich' })
  await page.getByRole('button', { name: /Push Day/ }).first().click()
  const detail = page.getByRole('dialog')
  await expect(detail.getByText('Only this completed history record will change.')).toBeVisible()
  await detail.getByRole('button', { name: 'Edit workout', exact: true }).click()

  await expect(page).toHaveURL(/#\/history$/)
  await expect(detail.locator('input[type="time"]')).toHaveCount(2)
  await expect(detail.locator('input[type="datetime-local"]')).toHaveCount(0)
  await expect(detail.getByText('Only the time changes. The date stays the same.', { exact: true })).toBeVisible()
  await expect(detail.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible()
  await detail.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(detail.getByRole('button', { name: 'Edit workout', exact: true })).toBeVisible()
  await assertNoHorizontalOverflow(page)
})

test('historical workout saves edited times and reports local persistence failures', async ({ page, openApp }) => {
  await openApp({ route: '/history', state: 'rich' })
  await page.getByRole('button', { name: /Push Day/ }).first().click()
  const detail = page.getByRole('dialog')
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('gym_state_v1')).workouts.find(workout => workout.name === 'Push Day' && workout.d === '2026-08-24'))
  await detail.getByRole('button', { name: 'Edit workout', exact: true }).click()
  await detail.locator('input[type="time"]').nth(1).fill('20:00')
  await detail.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Workout timestamps updated', { exact: true })).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gym_state_v1')).workouts.find(workout => workout.name === 'Push Day' && workout.d === '2026-08-24'))
  expect(saved.d).toBe(original.d)
  expect(saved.start).toBe(original.start)
  expect(saved.end).not.toBe(original.end)

  await detail.getByRole('button', { name: 'Edit workout', exact: true }).click()
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'gym_state_v1') throw new Error('quota')
      return original.call(this, key, value)
    }
  })
  await detail.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(detail.getByRole('alert')).toContainText('Could not save your workout')
})

test('historical time editing preserves an already active workout', async ({ page, openApp }) => {
  await openApp({ route: '/history', state: 'active' })
  await page.getByRole('button', { name: /Push Day/ }).first().click()
  const detail = page.getByRole('dialog')
  await detail.getByRole('button', { name: 'Edit workout', exact: true }).click()
  await expect(detail.locator('input[type="time"]')).toHaveCount(2)
  await detail.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Workout timestamps updated', { exact: true })).toBeVisible()

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gym_state_v1')))
  expect(saved.active).toEqual(normalizeExerciseIds(activeState).active)
})

test('historical time editing cannot add exercises or mutate protected state', async ({ page, openApp }) => {
  await openApp({ route: '/history', state: 'rich' })
  await page.getByRole('button', { name: /Push Day/ }).first().click()
  const detail = page.getByRole('dialog')
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('gym_state_v1')))
  await detail.getByRole('button', { name: 'Edit workout', exact: true }).click()
  await expect(detail.locator('input[type="time"]')).toHaveCount(2)
  await expect(detail.getByRole('button', { name: 'Add exercise', exact: true })).toHaveCount(0)
  await detail.locator('input[type="time"]').nth(1).fill('20:00')
  await detail.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Workout timestamps updated', { exact: true })).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gym_state_v1')))
  expect(saved.routines).toEqual(normalizeExerciseIds(before).routines)
  expect(saved.active).toBeNull()
  expect(saved.workouts.find(workout => workout.name === 'Push Day' && workout.d === '2026-08-24').entries)
    .toEqual(normalizeExerciseIds(before).workouts.find(workout => workout.name === 'Push Day' && workout.d === '2026-08-24').entries)
})

test('active workout stays within a narrow mobile viewport', async ({ page, openApp }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await openApp({ route: '/workout', state: 'active' })
  await expect(page.locator('.session-card h2')).toHaveCount(2)
  await expect(page.locator('.session-card h2').first()).toBeVisible()
  await assertNoHorizontalOverflow(page)
})
