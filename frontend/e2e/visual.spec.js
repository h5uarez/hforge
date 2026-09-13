import { test, expect, assertCriticalVisible, assertNoHorizontalOverflow } from './fixtures.js'

const views = [
  { name: 'home-rich', route: '/home', state: 'rich', heading: 'Hforge' },
  { name: 'home-empty', route: '/home', state: 'empty', heading: 'Hforge' },
  { name: 'plan-rich', route: '/plan', state: 'rich', heading: 'Plan' },
  { name: 'workout-active', route: '/workout', state: 'active', heading: /Push|Workout/ },
  { name: 'stats-rich', route: '/stats', state: 'rich', heading: 'Stats' },
  { name: 'history-rich', route: '/history', state: 'rich', heading: 'History' },
  { name: 'library-rich', route: '/library', state: 'rich', heading: 'Exercises' },
  { name: 'settings-rich', route: '/settings', state: 'rich', heading: 'Settings' },
]

for (const view of views) {
  test(`${view.name} canonical viewport`, async ({ page, openApp }) => {
    await openApp(view)
    await assertCriticalVisible(page.getByRole('heading', { name: view.heading, exact: typeof view.heading === 'string' }).first())
    await assertCriticalVisible(page.locator('#tabbar'))
    await assertNoHorizontalOverflow(page)
    await expect(page).toHaveScreenshot(`${view.name}.png`, { fullPage: false })
  })
}

test('login passkey presentation canonical viewport', async ({ page, openApp }) => {
  await openApp({ route: '/home', state: 'empty', guest: false })
  await assertCriticalVisible(page.getByRole('heading', { name: 'Hforge' }))
  await assertCriticalVisible(page.getByRole('button', { name: 'Sign in with passkey' }))
  await expect(page.locator('#tabbar')).toHaveCount(0)
  await assertNoHorizontalOverflow(page)
  await expect(page).toHaveScreenshot('login-passkey.png', { fullPage: false })
})

test('plan assignment overlay canonical viewport', async ({ page, openApp }) => {
  await openApp({ route: '/plan', state: 'rich' })
  await page.getByText('Monday', { exact: true }).click()
  const dialog = page.getByRole('dialog')
  await assertCriticalVisible(dialog)
  await assertCriticalVisible(dialog.getByRole('heading'))
  await assertNoHorizontalOverflow(page)
  await expect(page).toHaveScreenshot('plan-assignment-overlay.png', { fullPage: false })
})

test('historical workout editor remains readable at phone widths', async ({ page, openApp }) => {
  for (const width of [320, 375, 414]) {
    await page.setViewportSize({ width, height: 760 })
    await openApp({ route: '/history', state: 'rich' })
    await page.getByRole('button', { name: /Push Day/ }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Edit workout', exact: true }).click()
    const editor = page.locator('main.workout-session')
    await expect(page).toHaveURL(/#\/workout$/)
    await expect(editor.getByText('Edit workout', { exact: true })).toBeVisible()
    await expect(editor.getByRole('button', { name: 'Save changes', exact: true }).first()).toBeVisible()
    await assertCriticalVisible(editor)
    await assertNoHorizontalOverflow(page)
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
})
