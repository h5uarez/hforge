import { test, expect } from './fixtures.js'

test('virtual authenticator registers, signs out, and signs in with a passkey', async ({ page, context, openApp }) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })

  await page.route('**/api/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null }) }))
  await page.route('**/api/data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: null }) }))
  await openApp({ state: 'empty', guest: false, realApi: true })
  await page.unroute('**/api/me')
  await page.unroute('**/api/data')
  await page.clock.resume()
  await page.getByRole('button', { name: 'Create new profile' }).click()
  await page.getByPlaceholder('Your name').fill('Browser Tester')
  const optionsResponse = page.waitForResponse('**/api/register/options')
  const verifyResponse = page.waitForResponse('**/api/register/verify')
  await page.getByRole('button', { name: 'Create passkey' }).click()
  expect((await optionsResponse).status()).toBe(200)
  const verification = await verifyResponse
  expect(verification.status(), await verification.text()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Hi Browser Tester' })).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByText('Sign out', { exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign in with passkey' }).click()
  await expect(page.getByRole('heading', { name: 'Hi Browser Tester' })).toBeVisible()
})
