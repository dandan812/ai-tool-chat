import { createApp, h, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setStorageAccount } from '../../api/account'
import { useAccountSession } from './useAccountSession'

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  setStorageAccount(null)
})

describe('account startup lifecycle', () => {
  function mountSession() {
    let session!: ReturnType<typeof useAccountSession>
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp({
      setup() {
        session = useAccountSession()
        return () => h('div', session.user.value?.username ?? 'signed out')
      }
    })
    app.mount(root)
    return { session, root }
  }
  it('automatically opens an independent guest session without credentials', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ user: null, guestEnabled: true, registrationEnabled: false })
      )
      .mockResolvedValueOnce(
        Response.json({ user: { id: 'guest-a', username: 'guest', guest: true } })
      )
    vi.stubGlobal('fetch', fetcher)
    const { session } = mountSession()
    await vi.waitFor(() => expect(session.ready.value).toBe(true))
    expect(session.user.value?.id).toBe('guest-a')
    expect(fetcher.mock.calls[1]?.[0]).toMatch(/\/auth\/guest$/)
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: '{}',
      credentials: 'include'
    })
  })
  it('recovers from unavailable account discovery through retry', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(Response.json({ user: null, guestEnabled: true }))
      .mockResolvedValueOnce(
        Response.json({ user: { id: 'guest-retry', username: 'guest', guest: true } })
      )
    vi.stubGlobal('fetch', fetcher)
    const { session } = mountSession()
    await vi.waitFor(() => expect(session.ready.value).toBe(true))
    expect(session.loadFailed.value).toBe(true)
    expect(session.error.value).toContain('无法连接账户服务')
    await session.retry()
    expect(session.loadFailed.value).toBe(false)
    expect(session.error.value).toBe('')
    expect(session.user.value?.id).toBe('guest-retry')
  })
  it('shows a guest bootstrap failure instead of asking for credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ user: null, guestEnabled: true }))
        .mockResolvedValueOnce(
          Response.json(
            { error: 'Guest capacity reached', code: 'GUEST_CAPACITY' },
            { status: 429 }
          )
        )
    )
    const { session } = mountSession()
    await vi.waitFor(() => expect(session.ready.value).toBe(true))
    expect(session.user.value).toBeNull()
    expect(session.guestEnabled.value).toBe(true)
    expect(session.error.value).toBe('Guest capacity reached')
  })
  it('does not replace an existing owner with a guest', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        user: { id: 'owner-id', username: 'owner' },
        guestEnabled: true
      })
    )
    vi.stubGlobal('fetch', fetcher)
    const { session } = mountSession()
    await vi.waitFor(() => expect(session.ready.value).toBe(true))
    expect(session.user.value?.id).toBe('owner-id')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('reloads expired guests to discard account-owned Pinia state', async () => {
    const reload = vi.fn()
    const target = new EventTarget()
    Object.assign(target, { location: { reload } })
    vi.stubGlobal('window', target)
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ user: { id: 'guest-a', username: 'guest' }, guestEnabled: true })
      )
      .mockResolvedValueOnce(Response.json({ user: null, guestEnabled: true }))
      .mockResolvedValueOnce(
        Response.json({ user: { id: 'guest-b', username: 'guest', guest: true } })
      )
    vi.stubGlobal('fetch', fetcher)
    const { session } = mountSession()
    await vi.waitFor(() => expect(session.ready.value).toBe(true))
    window.dispatchEvent(new Event('account-expired'))
    expect(reload).toHaveBeenCalledOnce()
    expect(session.user.value).toBeNull()
    expect(session.ready.value).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['account-expired', 'storage'])(
    'does not reopen an account after %s invalidates startup',
    async (eventType) => {
      setStorageAccount(null)
      let resolve!: (response: Response) => void
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise<Response>((finish) => {
              resolve = finish
            })
        )
      )
      let session!: ReturnType<typeof useAccountSession>
      const root = document.createElement('div')
      document.body.append(root)
      app = createApp({
        setup() {
          session = useAccountSession()
          return () => h('div', session.user.value?.username ?? 'signed out')
        }
      })
      app.mount(root)
      window.dispatchEvent(
        eventType === 'storage'
          ? new StorageEvent('storage', { key: 'ait_account_changed', newValue: 'logout' })
          : new Event('account-expired')
      )
      resolve(Response.json({ user: { id: 'alice', username: 'Alice' } }))
      await vi.waitFor(() => expect(session.ready.value).toBe(true))
      await nextTick()
      expect(session.user.value).toBeNull()
      expect(root.textContent).toBe('signed out')
    }
  )
})
