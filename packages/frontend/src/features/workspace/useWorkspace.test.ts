import { createApp, h, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ apiJSON: vi.fn() }))
vi.mock('../../api/account', () => ({ apiJSON: mocks.apiJSON, notifyAccountChanged: vi.fn() }))
import { useWorkspace } from './useWorkspace'

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
  vi.resetAllMocks()
})

describe('workspace refresh ordering', () => {
  it.each(['cancel', 'removeFile'] as const)(
    'queues a fresh snapshot after %s during an older refresh',
    async (operation) => {
      let releaseOld!: (value: unknown) => void
      let taskReads = 0
      mocks.apiJSON.mockImplementation((path: string) => {
        if (path === '/tasks') {
          taskReads++
          if (taskReads === 1)
            return new Promise((resolve) => {
              releaseOld = resolve
            })
          return Promise.resolve({ tasks: [{ id: 't1', status: 'cancelled' }] })
        }
        if (path === '/auth/files')
          return Promise.resolve({ files: taskReads === 1 ? [{ fileId: 'f1' }] : [] })
        if (path === '/auth/usage') return Promise.resolve({ chargedTokens: 0 })
        if (path === '/auth/me') return Promise.resolve({ user: { username: 'Alice' } })
        return Promise.resolve({})
      })
      let workspace!: ReturnType<typeof useWorkspace>
      const root = document.createElement('div')
      document.body.append(root)
      app = createApp({
        setup() {
          workspace = useWorkspace()
          return () => h('div')
        }
      })
      app.mount(root)
      if (operation === 'removeFile') await workspace.removeFile('f1')
      const mutation = operation === 'cancel' ? workspace.cancel('t1') : workspace.removeFile('f1')
      await Promise.resolve()
      await Promise.resolve()
      releaseOld({ tasks: [{ id: 't1', status: 'running' }] })
      await mutation
      expect(taskReads).toBe(2)
      expect(workspace.tasks.value[0]?.status).toBe('cancelled')
      expect(workspace.files.value).toEqual([])
      expect(workspace.pending.value).toBe(false)
      expect(workspace.error.value).toBe('')
    }
  )
})
