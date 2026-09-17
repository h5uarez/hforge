import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeSplashOnNextFrame } from './boot.js'

afterEach(() => vi.unstubAllGlobals())

describe('removeSplashOnNextFrame', () => {
  it('waits for the next animation frame before removing the inline splash', () => {
    const splash = { remove: vi.fn() }
    const requestAnimationFrame = vi.fn()
    vi.stubGlobal('document', { getElementById: vi.fn(() => splash) })
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)

    removeSplashOnNextFrame()

    expect(splash.remove).not.toHaveBeenCalled()
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    requestAnimationFrame.mock.calls[0][0]()
    expect(splash.remove).toHaveBeenCalledTimes(1)
  })

  it('uses a timer when animation frames are unavailable', () => {
    const splash = { remove: vi.fn() }
    const setTimeout = vi.fn()
    vi.stubGlobal('document', { getElementById: vi.fn(() => splash) })
    vi.stubGlobal('requestAnimationFrame', undefined)
    vi.stubGlobal('setTimeout', setTimeout)

    removeSplashOnNextFrame()

    expect(splash.remove).not.toHaveBeenCalled()
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 0)
    setTimeout.mock.calls[0][0]()
    expect(splash.remove).toHaveBeenCalledTimes(1)
  })
})
