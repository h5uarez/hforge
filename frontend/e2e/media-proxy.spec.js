import { test, expect } from './fixtures.js'

test('serves image, GIF, and rangeable MP4 fixtures through the Vite media proxy', async ({ page, request }) => {
  const image = await request.get('/img/79D0BB3A.jpg')
  expect(image.status()).toBe(200)
  expect(image.headers()['content-type']).toBe('image/jpeg')
  expect((await image.body()).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))

  const animation = await request.get('/gif/0025-EIeI8Vf.gif')
  expect(animation.status()).toBe(200)
  expect(animation.headers()['content-type']).toBe('image/gif')
  expect((await animation.body()).subarray(0, 6).toString('ascii')).toBe('GIF89a')

  const video = await request.get('/video/D57C2EC7.mp4')
  expect(video.status()).toBe(200)
  expect(video.headers()['content-type']).toBe('video/mp4')
  expect(video.headers()['accept-ranges']).toBe('bytes')
  expect((await video.body()).subarray(4, 8).toString('ascii')).toBe('ftyp')

  const range = await request.get('/video/D57C2EC7.mp4', { headers: { Range: 'bytes=4-7' } })
  expect(range.status()).toBe(206)
  expect(range.headers()['content-range']).toMatch(/^bytes 4-7\//)
  expect((await range.body()).toString('ascii')).toBe('ftyp')

  await page.setContent('<img id="still" src="http://localhost:4173/img/79D0BB3A.jpg"><img id="animation" src="http://localhost:4173/gif/0025-EIeI8Vf.gif">')
  await Promise.all([page.locator('#still').evaluate(image => image.decode()), page.locator('#animation').evaluate(image => image.decode())])
  await expect(page.locator('#still')).toHaveJSProperty('naturalWidth', 640)
  await expect(page.locator('#animation')).toHaveJSProperty('naturalWidth', 160)
})

test('keeps MP4 exercise media bounded at phone and desktop widths', async ({ page }) => {
  for (const viewport of [{ width: 320, normalHeight: '210px' }, { width: 1440, normalHeight: '380px' }]) {
    await page.setViewportSize({ width: viewport.width, height: 800 })
    await page.setContent(`
      <link rel="stylesheet" href="http://localhost:4173/src/index.css">
      <main id="app">
        <div class="exmedia" id="normal"><video></video></div>
        <div class="exmedia compact" id="compact"><video></video></div>
        <div class="exmedia mini" id="mini"><video></video></div>
      </main>
    `)
    await page.locator('link').evaluate(link => link.sheet ? true : new Promise(resolve => link.addEventListener('load', () => resolve(true), { once: true })))

    const styles = await page.locator('#normal video').evaluate(video => {
      const style = getComputedStyle(video)
      const parent = video.parentElement.getBoundingClientRect()
      const box = video.getBoundingClientRect()
      return {
        display: style.display,
        objectFit: style.objectFit,
        width: style.width,
        height: style.height,
        boxWidth: box.width,
        parentWidth: parent.width,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
      }
    })
    expect(styles).toMatchObject({ display: 'block', objectFit: 'contain', width: expect.stringMatching(/px$/), height: viewport.normalHeight })
    expect(styles.boxWidth).toBeLessThanOrEqual(styles.parentWidth + 1)
    expect(styles.documentWidth).toBeLessThanOrEqual(viewport.width + 1)
    expect(styles.bodyWidth).toBeLessThanOrEqual(viewport.width + 1)
    await expect(page.locator('#compact video')).toHaveCSS('height', '120px')
    await expect(page.locator('#mini video')).toHaveCSS('height', '84px')
  }
})
