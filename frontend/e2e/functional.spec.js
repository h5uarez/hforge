import { test, expect, assertCriticalVisible, assertNoHorizontalOverflow } from './fixtures.js'
import { richState } from './synthetic-data.js'

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
  await expect(page.getByText('barbell bench press', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Filters' }).click()
  await expect(page.getByRole('group', { name: 'Filters' })).toBeVisible()
  await page.getByText('barbell bench press', { exact: true }).first().click()
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
  await expect(dialog.getByText(/barbell bench press/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Delete workout', exact: true })).toBeVisible()
})

test('active workout stays within a narrow mobile viewport', async ({ page, openApp }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await openApp({ route: '/workout', state: 'active' })
  await expect(page.getByRole('heading', { name: 'Exercise 1 / 2', exact: true })).toBeVisible()
  await assertNoHorizontalOverflow(page)
})
