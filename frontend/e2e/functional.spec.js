import { test, expect, assertCriticalVisible, assertNoHorizontalOverflow } from './fixtures.js'

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
