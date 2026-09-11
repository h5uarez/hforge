import { test as base, expect } from '@playwright/test'
import { activeState, emptyState, FIXED_NOW, richState } from './synthetic-data.js'

const states = { empty: emptyState, rich: richState, active: activeState }

export const test = base.extend({
  browserSignals: [async ({ page }, use) => {
    const errors = []
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
    page.on('console', message => {
      if (message.type() === 'error' && !message.text().includes('Viewport argument key "interactive-widget" not recognized and ignored.')) {
        errors.push(`console.error: ${message.text()}`)
      }
    })
    await use(errors)
    expect(errors, errors.join('\n')).toEqual([])
  }, { auto: true }],
  openApp: async ({ page }, use) => {
    await page.clock.install({ time: FIXED_NOW })
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important} video{visibility:hidden!important}' }).catch(() => {})
    await use(async ({ route = '/home', state = 'rich', guest = true, realApi = false } = {}) => {
      const payload = states[state]
      if (!realApi) {
        await page.route('**/api/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null }) }))
        await page.route('**/api/data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: null }) }))
      }
      await page.addInitScript(({ payload, guest }) => {
        if (sessionStorage.getItem('hforge_e2e_seeded') === '1') return
        localStorage.clear()
        localStorage.setItem('gym_state_v1', JSON.stringify(payload))
        localStorage.setItem('gym_lang_explicit_v1', 'en')
        if (guest) localStorage.setItem('gym_guest', '1')
        sessionStorage.setItem('hforge_e2e_seeded', '1')
      }, { payload, guest })
      await page.goto(`/#${route}`)
      await page.locator('#app').waitFor({ state: 'visible' })
      await page.evaluate(() => document.fonts.ready)
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important} caret-color:transparent!important;' })
    })
  },
})

export { expect }

export async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1)
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1)
}

export async function assertCriticalVisible(locator) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box.width).toBeGreaterThan(0)
  expect(box.height).toBeGreaterThan(0)
}
