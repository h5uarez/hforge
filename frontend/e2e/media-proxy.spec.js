import { test, expect } from './fixtures.js'

test('serves valid image and GIF fixtures through the Vite media proxy', async ({ page, request }) => {
  const image = await request.get('/img/0025-EIeI8Vf.jpg')
  expect(image.status()).toBe(200)
  expect(image.headers()['content-type']).toBe('image/jpeg')
  expect((await image.body()).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))

  const animation = await request.get('/gif/0025-EIeI8Vf.gif')
  expect(animation.status()).toBe(200)
  expect(animation.headers()['content-type']).toBe('image/gif')
  expect((await animation.body()).subarray(0, 6).toString('ascii')).toBe('GIF89a')

  await page.setContent('<img id="still" src="http://localhost:4173/img/0025-EIeI8Vf.jpg"><img id="animation" src="http://localhost:4173/gif/0025-EIeI8Vf.gif">')
  await Promise.all([page.locator('#still').evaluate(image => image.decode()), page.locator('#animation').evaluate(image => image.decode())])
  await expect(page.locator('#still')).toHaveJSProperty('naturalWidth', 640)
  await expect(page.locator('#animation')).toHaveJSProperty('naturalWidth', 160)
})
