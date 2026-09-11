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

  it('uses the server error message when a failed response contains JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'forbidden by policy' }),
    }))
    const { api } = await import('./api.js')

    await expect(api('/api/admin/users')).rejects.toMatchObject({
      message: 'forbidden by policy',
      status: 403,
    })
  })
})

describe('API response handling', () => {
  it('returns successful JSON and supplies the default content type', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetch)
    const { api } = await import('./api.js')

    await expect(api('/api/health')).resolves.toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith('/api/health', {
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it.each([
    ['an empty response', new SyntaxError('Unexpected end of JSON input')],
    ['a non-JSON response', new SyntaxError('Unexpected token')],
  ])('normalizes %s to an empty object', async (_label, error) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: vi.fn().mockRejectedValue(error),
    }))
    const { api } = await import('./api.js')

    await expect(api('/api/logout', { method: 'POST' })).resolves.toEqual({})
  })
})

describe('WebAuthn wire encoding', () => {
  const bytes = (...values) => new Uint8Array(values).buffer

  it('decodes registration options and base64url-encodes an attestation credential', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'credential-id', rawId: bytes(251, 255), type: 'public-key', authenticatorAttachment: 'platform',
      getClientExtensionResults: () => ({ credProps: { rk: true } }),
      response: {
        clientDataJSON: bytes(1, 2, 3), attestationObject: bytes(4, 5, 6),
        getTransports: () => ['internal', 'hybrid'],
      },
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: '', credentials: { create } },
    })
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        cid: 'registration-challenge',
        options: {
          challenge: 'AQID', user: { id: 'BAUG', name: 'User' },
          excludeCredentials: [{ id: '-_8', type: 'public-key' }],
        },
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: 'u1', name: 'User' } }) })
    vi.stubGlobal('fetch', fetch)
    const { passkeyRegister } = await import('./api.js')

    await expect(passkeyRegister('User', 'invite')).resolves.toEqual({ id: 'u1', name: 'User' })
    const publicKey = create.mock.calls[0][0].publicKey
    expect([...new Uint8Array(publicKey.challenge)]).toEqual([1, 2, 3])
    expect([...new Uint8Array(publicKey.user.id)]).toEqual([4, 5, 6])
    expect([...new Uint8Array(publicKey.excludeCredentials[0].id)]).toEqual([251, 255])
    const verification = JSON.parse(fetch.mock.calls[1][1].body)
    expect(verification).toEqual({
      cid: 'registration-challenge',
      credential: {
        id: 'credential-id', rawId: '-_8', type: 'public-key',
        clientExtensionResults: { credProps: { rk: true } },
        authenticatorAttachment: 'platform',
        response: { clientDataJSON: 'AQID', attestationObject: 'BAUG', transports: ['internal', 'hybrid'] },
      },
    })
  })

  it('decodes login options and base64url-encodes an assertion credential', async () => {
    const get = vi.fn().mockResolvedValue({
      id: 'credential-id', rawId: bytes(1), type: 'public-key',
      response: {
        clientDataJSON: bytes(2), authenticatorData: bytes(3), signature: bytes(251, 255), userHandle: bytes(4),
      },
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: '', credentials: { get } },
    })
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        cid: 'login-challenge', options: { challenge: 'AQ', allowCredentials: [{ id: 'Ag', type: 'public-key' }] },
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: 'u1' } }) })
    vi.stubGlobal('fetch', fetch)
    const { passkeyLogin } = await import('./api.js')

    await expect(passkeyLogin()).resolves.toEqual({ id: 'u1' })
    const publicKey = get.mock.calls[0][0].publicKey
    expect([...new Uint8Array(publicKey.challenge)]).toEqual([1])
    expect([...new Uint8Array(publicKey.allowCredentials[0].id)]).toEqual([2])
    const verification = JSON.parse(fetch.mock.calls[1][1].body)
    expect(verification.credential.response).toEqual({
      clientDataJSON: 'Ag', authenticatorData: 'Aw', signature: '-_8', userHandle: 'BA',
    })
    expect(verification.credential.authenticatorAttachment).toBeNull()
    expect(verification.credential.clientExtensionResults).toEqual({})
  })
})
