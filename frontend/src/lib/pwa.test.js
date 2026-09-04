import { describe, expect, it, vi, beforeEach } from 'vitest'
import { describeUpdateState, displayMode, isStandalone } from './pwa.js'

const win = ({ standaloneMatches = false, fullscreenMatches = false, iosStandalone = undefined } = {}) => ({
  matchMedia: vi.fn(query => ({
    matches: query === '(display-mode: standalone)' ? standaloneMatches
      : query === '(display-mode: fullscreen)' ? fullscreenMatches : false,
  })),
  navigator: iosStandalone === undefined ? {} : { standalone: iosStandalone },
})

describe('isStandalone', () => {
  it('detects the installed display mode', () => {
    expect(isStandalone(win({ standaloneMatches: true }))).toBe(true)
    expect(isStandalone(win({ fullscreenMatches: true }))).toBe(true)
    expect(isStandalone(win())).toBe(false)
  })

  it('covers iOS Safari via navigator.standalone', () => {
    expect(isStandalone(win({ iosStandalone: true }))).toBe(true)
    expect(isStandalone(win({ iosStandalone: false }))).toBe(false)
  })

  it('never throws without a window', () => {
    expect(isStandalone(undefined)).toBe(false)
    expect(displayMode(undefined)).toBe('browser')
    expect(displayMode(win({ standaloneMatches: true }))).toBe('standalone')
  })
})

describe('describeUpdateState', () => {
  it('stays silent without a waiting worker', () => {
    expect(describeUpdateState({ hasUpdate: false, workoutActive: false })).toBe('none')
    expect(describeUpdateState({ hasUpdate: false, workoutActive: true })).toBe('none')
  })

  it('offers the update directly when no workout is running', () => {
    expect(describeUpdateState({ hasUpdate: true, workoutActive: false })).toBe('ready')
  })

  it('defers the reload while a workout is active — never force it', () => {
    expect(describeUpdateState({ hasUpdate: true, workoutActive: true })).toBe('deferred')
  })
})

describe('pwa module without a DOM', () => {
  beforeEach(() => { vi.resetModules() })

  it('registerPwa is a no-op where service workers do not exist', async () => {
    const pwa = await import('./pwa.js')
    expect(() => pwa.registerPwa()).not.toThrow()
  })
})
