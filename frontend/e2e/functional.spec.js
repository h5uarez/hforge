import { test, expect, assertCriticalVisible, assertNoHorizontalOverflow } from './fixtures.js'
import { richState } from './synthetic-data.js'
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
  await expect(page.getByRole('heading', { name: 'Exercise 3 / 5', exact: true })).toBeVisible()
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

  await expect(page.getByRole('heading', { name: 'Exercise 1 / 3', exact: true })).toBeVisible()
  const weights = page.locator('input[aria-label^="Sets "][aria-label$="Weight (kg)"]')
  await expect(weights).toHaveCount(10)
  expect(await weights.evaluateAll(inputs => inputs.map(input => input.value))).toEqual(Array(10).fill('0'))
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
  await expect(dialog.getByText('Bench Press (Barbell) PR', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Delete workout', exact: true })).toBeVisible()
})

test('historical editor exposes scoped keyboard-accessible mode controls and cancellation', async ({ page, openApp }) => {
  await openApp({ route: '/history', state: 'rich' })
  await page.getByRole('button', { name: /Push Day/ }).first().click()
  const detail = page.getByRole('dialog')
  await expect(detail.getByText('Only this completed history record will change.')).toBeVisible()
  await detail.getByRole('button', { name: 'Edit exercises', exact: true }).click()

  const editor = page.getByRole('dialog')
  await expect(editor.getByRole('heading', { name: 'Edit exercises', exact: true })).toBeVisible()
  await expect(editor.getByText('Only this completed history record changes. Routines and the active workout are untouched.')).toBeVisible()
  const mode = editor.getByLabel('Mode').first()
  await mode.selectOption('time')
  await mode.selectOption('cardio')
  await mode.selectOption('reps')
  const sets = editor.locator('input[id$="-sets"]').first()
  await sets.fill('-1')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('Fix the highlighted history fields before saving.')
  await sets.fill('4')
  await editor.getByRole('button', { name: 'Remove exercise' }).first().click()
  const removal = page.getByRole('dialog').last()
  await expect(removal.getByRole('heading', { name: 'Remove exercise?', exact: true })).toBeVisible()
  await removal.getByRole('button', { name: 'Cancel', exact: true }).click()
  await editor.getByRole('button', { name: 'Add exercise', exact: true }).click()
  const picker = page.getByRole('dialog').last()
  await expect(picker.getByRole('heading', { name: 'Add exercise', exact: true })).toBeVisible()
  await picker.getByRole('button', { name: 'Close', exact: true }).click()
  await editor.getByRole('button', { name: 'Add exercise', exact: true }).focus()
  await expect(page.locator(':focus')).toBeVisible()
  await assertNoHorizontalOverflow(page)
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('historical editor saves a mode-specific change and announces recovery choices', async ({ page, openApp }) => {
  await openApp({ route: '/history', state: 'rich' })
  await page.getByRole('button', { name: /Push Day/ }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Edit exercises', exact: true }).click()
  const editor = page.getByRole('dialog')
  await editor.getByLabel('Exercise note').first().fill('Corrected historical note')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Historical workout draft saved', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /Push Day/ }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Edit exercises', exact: true }).click()
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'gym_state_v1') throw new Error('quota')
      return original.call(this, key, value)
    }
  })
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Retry')
  await expect(page.getByRole('alert')).toContainText('Undo')
  await expect(page.getByRole('alert')).toContainText('Cancel')
})

test('historical editor persists additions without mutating protected state', async ({ page, openApp }) => {
  await openApp({ route: '/history', state: 'rich' })
  await page.getByRole('button', { name: /Push Day/ }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Edit exercises', exact: true }).click()

  const editor = page.getByRole('dialog')
  const initialEntries = await editor.locator('.history-entry').count()
  await editor.getByRole('button', { name: 'Add exercise', exact: true }).click()
  const picker = page.getByRole('dialog').last()
  await picker.getByRole('textbox', { name: /Search/ }).fill('barbell bench press')
  await picker.getByRole('button', { name: 'Add Bench Press (Barbell)', exact: true }).click()
  const added = editor.getByRole('region', { name: `Exercise ${initialEntries + 1}` })
  await added.getByRole('checkbox', { name: 'Completed', exact: true }).first().check()
  await expect(editor.locator('.history-entry')).toHaveCount(initialEntries + 1)

  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Historical workout draft saved', { exact: true })).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gym_state_v1')))
  expect(saved.routines).toEqual(normalizeExerciseIds(richState).routines)
  expect(saved.active).toBeNull()
  expect(saved.workouts.some(workout => workout.name === 'Push Day' && workout.entries.filter(entry => entry.id === '0025').length === 2)).toBe(true)
})

test('active workout stays within a narrow mobile viewport', async ({ page, openApp }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await openApp({ route: '/workout', state: 'active' })
  await expect(page.getByRole('heading', { name: 'Exercise 1 / 2', exact: true })).toBeVisible()
  await assertNoHorizontalOverflow(page)
})
