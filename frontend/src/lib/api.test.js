import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: '', credentials: {} },
  })
  globalThis.window = {}
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete globalThis.navigator
  delete globalThis.window
})

describe('API error diagnostics', () => {
  it('retains HTTP status details for callers and console diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    }))
    const { api } = await import('./api.js')

    await expect(api('/api/login/options')).rejects.toMatchObject({
      message: 'HTTP 502',
      status: 502,
    })
  })
})
