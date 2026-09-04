import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describeUpdateState, displayMode, isStandalone } from './pwa.js'

const src = name => readFileSync(resolve(process.cwd(), name), 'utf8')

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

describe('install/update UI contracts (source)', () => {
  it('banner renders both update states and never reloads on its own', () => {
    const banner = src('src/components/PwaUpdateBanner.jsx')
    expect(banner).toContain('describeUpdateState')
    expect(banner).toContain('data-state="deferred"')
    expect(banner).toContain('data-state="ready"')
    expect(banner).toContain('role="status"')
    // Activation is user-gesture only: no reload/timer paths in the banner.
    expect(banner).not.toMatch(/location\.reload|controllerchange|setTimeout/)
    expect(banner).toContain('onClick={() => applyWaitingUpdate()}')
  })

  it('settings install UX branches on real signals without inventing APIs', () => {
    const settings = src('src/views/Settings.jsx')
    expect(settings).toContain('isStandalone()')
    expect(settings).toContain('canInstall()')
    expect(settings).toContain('onCanInstall(')
    expect(settings).toContain('promptInstall()')
    expect(settings).toContain('Installed — running full-screen')
    expect(settings).toContain('Install Hforge')
    expect(settings).toContain('Add to Home Screen')
    // No synthetic prompt construction: the event comes from Chromium or not at all.
    expect(settings).not.toMatch(/new Event\(['"]beforeinstallprompt|dispatchEvent/)
  })

  it('pwa.js captures the native prompt instead of synthesizing one', () => {
    const pwa = src('src/lib/pwa.js')
    expect(pwa).toContain("addEventListener('beforeinstallprompt'")
    expect(pwa).toContain('e.preventDefault()')
    expect(pwa).not.toMatch(/new Event\(|dispatchEvent/)
    // Reload happens only after the user confirmed, on controller change.
    expect(pwa).toContain("addEventListener('controllerchange'")
  })
})

describe('pwa module without a DOM', () => {
  beforeEach(() => { vi.resetModules() })

  it('registerPwa is a no-op where service workers do not exist', async () => {
    const pwa = await import('./pwa.js')
    expect(() => pwa.registerPwa()).not.toThrow()
  })
})
