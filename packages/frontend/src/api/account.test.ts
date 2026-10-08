// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APIError, apiJSON, setStorageAccount } from './account'

afterEach(() => { vi.unstubAllGlobals(); setStorageAccount(null) })

describe('account HTTP client', () => {
  it('preserves Headers input and binds the server call to the active account', async () => {
    setStorageAccount('alice')
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers)
      expect(headers.get('Idempotency-Key')).toBe('fixed-key')
      expect(headers.get('X-Account-ID')).toBe('alice')
      expect(init.credentials).toBe('include')
      return Response.json({ ok: true })
    })
    vi.stubGlobal('fetch', fetch)
    await expect(apiJSON('/tasks', { headers: new Headers({ 'Idempotency-Key': 'fixed-key' }) })).resolves.toEqual({ ok: true })
  })
  it('exposes HTTP status and error code without treating forbidden access as a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: { code: 'ORIGIN_FORBIDDEN', message: 'Forbidden' },
    }, { status: 403 })))
    await expect(apiJSON('/tasks')).rejects.toMatchObject({
      name: 'APIError', status: 403, code: 'ORIGIN_FORBIDDEN',
    })
  })
  it('rejects a late response from a previous account', async () => {
    setStorageAccount('alice')
    vi.stubGlobal('fetch', vi.fn(async () => {
      setStorageAccount('bob')
      return Response.json({ privateData: 'alice only' })
    }))
    await expect(apiJSON('/tasks')).rejects.toBeInstanceOf(APIError)
  })
  it('rejects an invalidated startup response even when the account remains null', async () => {
    setStorageAccount(null)
    vi.stubGlobal('fetch', vi.fn(async () => {
      setStorageAccount(null)
      return Response.json({ user: { id: 'alice', username: 'Alice' } })
    }))
    await expect(apiJSON('/auth/me')).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
  })
  it('checks the account again after reading a delayed response body', async () => {
    setStorageAccount('alice')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => {
        setStorageAccount('bob')
        return { privateData: 'alice only' }
      },
    })))
    await expect(apiJSON('/tasks')).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
  })
})
