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

test('keeps exercise media full-width while preserving expanded and minimized behavior', async ({ page }) => {
  const wideImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#30d158"/></svg>')
  for (const width of [320, 375, 414, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 })
    await page.setContent(`
      <link rel="stylesheet" href="http://localhost:4173/src/index.css">
      <main id="app">
        <div class="exmedia" id="normal" style="--media-ratio:2"><img src="${wideImage}" alt=""></div>
        <div class="exmedia compact" id="compact" style="--media-ratio:2"><img src="${wideImage}" alt=""></div>
        <div class="exmedia mini" id="mini" style="--media-ratio:2"><img src="${wideImage}" alt=""></div>
      </main>
    `)
    await page.locator('link').evaluate(link => link.sheet ? true : new Promise(resolve => link.addEventListener('load', () => resolve(true), { once: true })))
    await Promise.all((await page.locator('.exmedia img').all()).map(image => image.evaluate(node => node.decode())))

    const boxes = await page.locator('.exmedia').evaluateAll(nodes => nodes.map(node => {
      const media = node.firstElementChild.getBoundingClientRect()
      const box = node.getBoundingClientRect()
      const style = getComputedStyle(node.firstElementChild)
      const container = node.closest('#app')
      const containerStyle = getComputedStyle(container)
      return {
        boxWidth: box.width,
        boxHeight: box.height,
        mediaWidth: media.width,
        mediaHeight: media.height,
        containerWidth: container.clientWidth - Number.parseFloat(containerStyle.paddingLeft) - Number.parseFloat(containerStyle.paddingRight),
        objectFit: style.objectFit,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
      }
    }))
    for (const box of boxes) {
      expect(box.boxWidth).toBeCloseTo(box.containerWidth, 0)
      expect(box.mediaWidth).toBeCloseTo(box.boxWidth, 0)
      expect(box.mediaHeight).toBeCloseTo(box.boxHeight, 0)
      expect(box.objectFit).toBe('contain')
      expect(box.documentWidth).toBeLessThanOrEqual(width + 1)
      expect(box.bodyWidth).toBeLessThanOrEqual(width + 1)
    }
    expect(boxes[0].boxWidth / boxes[0].boxHeight).toBeCloseTo(2, 2)
    expect(boxes[1].boxHeight).toBeCloseTo(120, 0)
    expect(boxes[2].boxHeight).toBeCloseTo(Math.min(120, Math.max(84, width * .15)), 0)
  }
})
