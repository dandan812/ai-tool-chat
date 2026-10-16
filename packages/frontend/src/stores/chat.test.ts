import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { TaskCallbacks, TaskRequest } from '../api/task'
import type { Task } from '../types/task'

const mocks = vi.hoisted(() => ({
  apiJSON: vi.fn(),
  sendTaskRequest: vi.fn(),
  resumeTaskRequest: vi.fn()
}))
vi.mock('../api/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/account')>()),
  apiJSON: mocks.apiJSON
}))
vi.mock('../api/task', () => ({
  sendTaskRequest: mocks.sendTaskRequest,
  resumeTaskRequest: mocks.resumeTaskRequest
}))
import { accountStorageKey, setStorageAccount } from '../api/account'
import { useChatStore } from './chat'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}
function task(id = 'task-1', status: Task['status'] = 'running'): Task {
  return {
    id,
    status,
    type: 'chat',
    userMessage: 'question',
    steps: [],
    createdAt: 1,
    updatedAt: 2
  }
}
interface Run {
  callbacks: TaskCallbacks
  signal: AbortSignal
  finish: () => void
  request?: TaskRequest
  taskId?: string
}

let store: ReturnType<typeof useChatStore>
let runs: Run[]
beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  localStorage.clear()
  setStorageAccount('alice')
  setActivePinia(createPinia())
  runs = []
  mocks.sendTaskRequest.mockImplementation(
    (request: TaskRequest, callbacks: TaskCallbacks, signal: AbortSignal) =>
      new Promise<void>((resolve) => runs.push({ request, callbacks, signal, finish: resolve }))
  )
  mocks.resumeTaskRequest.mockImplementation(
    (taskId: string, callbacks: TaskCallbacks, signal: AbortSignal) =>
      new Promise<void>((resolve) => runs.push({ taskId, callbacks, signal, finish: resolve }))
  )
  store = useChatStore()
})
afterEach(async () => {
  store.$dispose()
  for (const run of runs) run.finish()
  await Promise.resolve()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('per-session task observation', () => {
  it('forwards explicitly selected file research to task creation', async () => {
    const file = {
      fileId: 'file',
      fileHash: 'hash',
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      size: 10,
      source: 'uploaded' as const
    }
    const pending = store.sendTaskMessage('Compare the documents', [], [file], true)
    expect(runs[0]!.request).toMatchObject({ enableTools: true, files: [file] })
    runs[0]!.finish()
    await pending
  })
  it('flushes received SSE text before stopViewing invalidates the observation', async () => {
    const { TaskRequestManager } = await import('../api/requestManager')
    let producer!: ReadableStreamDefaultController<Uint8Array>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              producer = controller
            }
          }),
          { headers: { 'Content-Type': 'text/event-stream' } }
        )
      )
    )
    mocks.sendTaskRequest.mockImplementation(
      (_request: TaskRequest, callbacks: TaskCallbacks, signal: AbortSignal) =>
        new TaskRequestManager(callbacks, signal).resume('task-1')
    )
    const observation = store.sendTaskMessage('question')
    producer.enqueue(
      new TextEncoder().encode(
        'event: task-events\ndata: ' +
          JSON.stringify({
            events: [{ id: 1, type: 'content', data: { content: 'received before next frame' } }],
            lastEventId: 1,
            terminal: false
          }) +
          '\n\n'
      )
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(store.messages[1]!.content).toBe('')
    store.stopViewing()
    expect(store.messages[1]!.content).toBe('received before next frame')
    await observation
    await vi.advanceTimersByTimeAsync(20)
    expect(store.messages[1]!.content).toBe('received before next frame')
  })

  it('flushes buffered content before replacing it with a cancellation snapshot', async () => {
    const observation = store.sendTaskMessage('question')
    const run = runs[0]!
    run.callbacks.onTaskStart?.(task())
    let pending = 'tail'
    run.callbacks.onObservationReady?.(() => {
      if (pending) run.callbacks.onContent?.(pending)
      pending = ''
    })
    mocks.apiJSON.mockResolvedValue({
      task: { ...task('task-1', 'cancelled'), result: 'tail', error: 'cancelled' }
    })
    await store.stopGeneration()
    expect(store.messages[1]!.content).toBe('tail\n\ncancelled')
    run.finish()
    await observation
  })

  it('observes two sessions independently and finishes only its own session', async () => {
    const firstSession = store.currentSessionId
    const first = store.sendTaskMessage('first')
    const secondSession = store.createSession()
    const second = store.sendTaskMessage('second')
    expect(runs[0]!.signal.aborted).toBe(false)
    runs[0]!.callbacks.onContent?.('first answer')
    runs[1]!.callbacks.onContent?.('second answer')
    runs[0]!.finish()
    await first
    expect(store.isSessionLoading(firstSession)).toBe(false)
    expect(store.isSessionLoading(secondSession)).toBe(true)
    expect(store.isLoading).toBe(true)
    expect(store.messagesMap[firstSession]![1]!.content).toBe('first answer')
    expect(store.messages[1]!.content).toBe('second answer')
    runs[1]!.finish()
    await second
  })

  it('ignores old callbacks and old finally after stop and a new send', async () => {
    const sessionId = store.currentSessionId
    const old = store.sendTaskMessage('old')
    store.stopViewing()
    const current = store.sendTaskMessage('new')
    runs[0]!.callbacks.onContent?.('stale')
    runs[0]!.callbacks.onTaskStart?.(task('stale-task'))
    runs[0]!.callbacks.onComplete?.({ ...task('stale-task', 'completed'), result: 'stale answer' })
    runs[0]!.finish()
    await old
    expect(store.isSessionLoading(sessionId)).toBe(true)
    expect(runs[1]!.signal.aborted).toBe(false)
    expect(store.messages[1]!.content).toBe('')
    expect(store.getCurrentTask(sessionId)).toBeNull()
    runs[1]!.callbacks.onContent?.('new answer')
    runs[1]!.finish()
    await current
    expect(store.messages[3]!.content).toBe('new answer')
  })

  it('writes by message ID after deleting an earlier message, including before task creation returns', async () => {
    const request = store.sendTaskMessage('question')
    const assistantId = store.messages[1]!.id
    store.deleteMessage(0)
    expect(runs[0]!.signal.aborted).toBe(false)
    runs[0]!.callbacks.onTaskStart?.(task())
    runs[0]!.callbacks.onContent?.('answer')
    expect(store.messages[0]).toMatchObject({
      id: assistantId,
      role: 'assistant',
      content: 'answer',
      taskId: 'task-1'
    })
    expect(store.streamingContent).toMatchObject({ index: 0, content: 'answer' })
    runs[0]!.finish()
    await request
  })

  it('does not stop a new observer when deleting an old request message', async () => {
    const old = store.sendTaskMessage('old')
    runs[0]!.finish()
    await old
    const current = store.sendTaskMessage('new')
    store.deleteMessage(1)
    expect(runs[1]!.signal.aborted).toBe(false)
    runs[1]!.callbacks.onContent?.('new answer')
    expect(store.messages[2]!.content).toBe('new answer')
    runs[1]!.finish()
    await current
  })

  it('stops viewing a deleted target without writing into the next message or cancelling the backend', async () => {
    const request = store.sendTaskMessage('question')
    store.addMessage(store.currentSessionId, { role: 'assistant', content: 'next answer' })
    store.deleteMessage(1)
    runs[0]!.callbacks.onContent?.('stale')
    runs[0]!.callbacks.onTaskStart?.(task())
    expect(runs[0]!.signal.aborted).toBe(true)
    expect(store.messages[1]!.content).toBe('next answer')
    expect(mocks.apiJSON).not.toHaveBeenCalled()
    runs[0]!.finish()
    await request
  })

  it.each(['clear', 'delete'] as const)(
    '%s releases only local observation and ignores stale task updates',
    async (action) => {
      const sessionId = store.currentSessionId
      const old = store.sendTaskMessage('old')
      runs[0]!.callbacks.onTaskStart?.(task())
      if (action === 'clear') store.clearChat()
      else store.deleteSession(sessionId)
      const current = store.sendTaskMessage('new')
      runs[0]!.callbacks.onTaskUpdate?.(task('stale-task'))
      runs[0]!.callbacks.onContent?.('stale')
      runs[0]!.finish()
      await old
      expect(store.isLoading).toBe(true)
      expect(store.getCurrentTask(sessionId)).toBeNull()
      expect(store.messages.map((message) => message.content)).toEqual(['new', ''])
      expect(mocks.apiJSON).not.toHaveBeenCalled()
      runs[1]!.finish()
      await current
    }
  )

  it('switching and stopViewing do not stop a different session', async () => {
    const firstSession = store.currentSessionId
    const first = store.sendTaskMessage('first')
    const secondSession = store.createSession()
    const second = store.sendTaskMessage('second')
    store.switchSession(firstSession)
    store.stopViewing()
    expect(runs[0]!.signal.aborted).toBe(true)
    expect(runs[1]!.signal.aborted).toBe(false)
    expect(store.isSessionLoading(secondSession)).toBe(true)
    expect(store.isLoading).toBe(false)
    runs.forEach((run) => run.finish())
    await Promise.all([first, second])
  })

  it('blocks duplicate sends in one session and keeps IDs out of request history', async () => {
    const first = store.sendTaskMessage('first')
    await store.sendTaskMessage('duplicate')
    expect(runs).toHaveLength(1)
    runs[0]!.finish()
    await first
    const second = store.sendTaskMessage('second')
    expect(runs[1]!.request?.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' }
    ])
    expect(runs[1]!.request?.requestKey).not.toBe(runs[0]!.request?.requestKey)
    runs[1]!.finish()
    await second
  })

  it.each(['', '分析附件'])(
    'persists only bounded attachment metadata for %s while sending original images',
    async (content) => {
      const image = {
        id: 'image',
        base64: 'original-image-content',
        mimeType: 'image/png',
        description: 'figure.png',
        localAttachment: {
          kind: 'image' as const,
          name: 'figure.png',
          mimeType: 'image/png',
          size: 2048
        }
      }
      const file = {
        fileId: 'uploaded-file',
        fileName: 'report.docx',
        mimeType: 'application/msword',
        size: 5120,
        fileHash: 'hash',
        source: 'uploaded' as const
      }
      Object.assign(image, { previewUrl: 'blob:revoked' })
      const sending = store.sendTaskMessage(content, [image], [file])
      await store.sendTaskMessage('duplicate', [image], [file])
      expect(runs).toHaveLength(1)
      expect(store.messages[0]).toMatchObject({
        role: 'user',
        content: content || '[图片]',
        attachmentOnly: !content,
        attachments: [
          { kind: 'image', name: 'figure.png', mimeType: 'image/png', size: 2048 },
          { kind: 'file', name: 'report.docx', mimeType: 'application/msword', size: 5120 }
        ]
      })
      expect(runs[0]!.request?.messages).toEqual([{ role: 'user', content: content || '[图片]' }])
      expect(runs[0]!.request?.images).toEqual([
        {
          id: image.id,
          base64: image.base64,
          mimeType: image.mimeType,
          description: image.description
        }
      ])
      expect(runs[0]!.request?.files).toEqual([file])
      const stored = localStorage.getItem(accountStorageKey('chat_messages_map'))!
      expect(stored).toContain('figure.png')
      expect(stored).not.toContain(image.base64)
      expect(stored).not.toContain('blob:revoked')
      expect(stored).not.toContain('localAttachment')
      runs[0]!.finish()
      await sending
    }
  )

  it('keeps task steps and step presentation consistent through progress updates', async () => {
    const request = store.sendTaskMessage('question')
    const step = {
      id: 'step-1',
      taskId: 'task-1',
      name: 'Respond',
      type: 'skill' as const,
      status: 'running' as const
    }
    runs[0]!.callbacks.onTaskStart?.(task())
    runs[0]!.callbacks.onStepStart?.(step)
    runs[0]!.callbacks.onStepProgress?.({ ...step, description: 'In progress' })
    expect(store.getSteps(store.currentSessionId)).toEqual([
      { ...step, description: 'In progress' }
    ])
    expect(store.getCurrentTask(store.currentSessionId)?.steps).toEqual(
      store.getSteps(store.currentSessionId)
    )
    runs[0]!.finish()
    await request
  })

  it('releases every observer on reset and ignores all their old completions', async () => {
    const firstSession = store.currentSessionId
    const first = store.sendTaskMessage('first')
    const secondSession = store.createSession()
    const second = store.sendTaskMessage('second')
    runs[0]!.callbacks.onTaskStart?.(task('first-task'))
    store.resetTransientState()
    expect(runs.every((run) => run.signal.aborted)).toBe(true)
    expect(store.isSessionLoading(firstSession)).toBe(false)
    expect(store.isSessionLoading(secondSession)).toBe(false)
    const current = store.sendTaskMessage('current')
    runs[0]!.callbacks.onTaskUpdate?.(task('first-task', 'completed'))
    runs[1]!.callbacks.onContent?.('stale')
    runs[0]!.finish()
    runs[1]!.finish()
    await Promise.all([first, second])
    expect(store.isLoading).toBe(true)
    expect(store.getCurrentTask(firstSession)).toBeNull()
    expect(store.messages[1]!.content).toBe('')
    runs[2]!.finish()
    await current
  })
})

describe('restore without creating another execution', () => {
  it('does not replay an older task or recreate an unconfirmed latest request', async () => {
    store.addMessage(store.currentSessionId, {
      role: 'assistant',
      content: 'older result',
      taskId: 'older-task'
    })
    store.addMessage(store.currentSessionId, {
      role: 'assistant',
      content: '',
      requestKey: 'unconfirmed-request'
    })
    await store.restoreActiveTask()
    expect(mocks.apiJSON).not.toHaveBeenCalled()
    expect(mocks.sendTaskRequest).not.toHaveBeenCalled()
    expect(mocks.resumeTaskRequest).not.toHaveBeenCalled()
    expect(store.storageError).toContain('不会自动重新发送')
  })
  it('deduplicates concurrent and already-observed restores and replaces a partial replay', async () => {
    store.addMessage(store.currentSessionId, {
      role: 'assistant',
      content: 'old partial',
      taskId: 'task-1'
    })
    const metadata = deferred<{ task: Task }>()
    mocks.apiJSON.mockReturnValueOnce(metadata.promise)
    const first = store.restoreTask('task-1')
    const duplicate = store.restoreTask('task-1')
    expect(mocks.apiJSON).toHaveBeenCalledTimes(1)
    metadata.resolve({ task: task() })
    await Promise.resolve()
    expect(runs).toHaveLength(1)
    expect(store.messages[0]!.content).toBe('')
    runs[0]!.callbacks.onContent?.('replayed')
    await store.restoreTask('task-1')
    expect(runs).toHaveLength(1)
    expect(store.messages[0]!.content).toBe('replayed')
    expect(mocks.sendTaskRequest).not.toHaveBeenCalled()
    runs[0]!.finish()
    await Promise.all([first, duplicate])
  })

  it('restores finished and failed task snapshots without polling or losing partial results', async () => {
    mocks.apiJSON.mockResolvedValueOnce({
      task: { ...task('task-1', 'failed'), result: 'partial', error: 'interrupted' }
    })
    await store.restoreTask('task-1')
    expect(store.messages[1]!.content).toBe('partial\n\ninterrupted')
    expect(store.getCurrentTask(store.currentSessionId)?.status).toBe('failed')
    await store.restoreTask('task-1') // A missing/invalid response must not erase the saved answer.
    expect(store.messages[1]!.content).toBe('partial\n\ninterrupted')
    expect(mocks.resumeTaskRequest).not.toHaveBeenCalled()
    expect(mocks.sendTaskRequest).not.toHaveBeenCalled()
    expect(store.storageError).toContain('格式')
  })

  it('does not let a late metadata response take focus after switching sessions', async () => {
    const metadata = deferred<{ task: Task }>()
    mocks.apiJSON.mockReturnValueOnce(metadata.promise)
    const restoring = store.restoreTask('task-1')
    const current = store.createSession('new focus')
    metadata.resolve({ task: task() })
    await restoring
    expect(store.currentSessionId).toBe(current)
    expect(runs).toHaveLength(0)
    expect(store.sessions).toHaveLength(2)
  })

  it('last restore intent wins and stopViewing aborts pending metadata', async () => {
    const oldMetadata = deferred<{ task: Task }>()
    const currentMetadata = deferred<{ task: Task }>()
    mocks.apiJSON
      .mockReturnValueOnce(oldMetadata.promise)
      .mockReturnValueOnce(currentMetadata.promise)
    const old = store.restoreTask('old-task')
    const current = store.restoreTask('current-task')
    expect(mocks.apiJSON.mock.calls[0]![1].signal.aborted).toBe(true)
    store.stopViewing()
    oldMetadata.resolve({ task: task('old-task') })
    currentMetadata.resolve({ task: task('current-task') })
    await Promise.all([old, current])
    expect(runs).toHaveLength(0)
    expect(store.sessions).toHaveLength(1)
  })

  it('uses the same event callbacks for replay and final failed snapshots', async () => {
    mocks.apiJSON.mockResolvedValueOnce({ task: task() })
    const restoring = store.restoreTask('task-1')
    await Promise.resolve()
    const run = runs[0]!
    run.callbacks.onContent?.('streamed')
    run.callbacks.onError?.('interrupted')
    run.callbacks.onTaskUpdate?.({
      ...task('task-1', 'failed'),
      result: 'authoritative partial',
      error: 'interrupted'
    })
    expect(store.messages[1]!.content).toBe('authoritative partial\n\ninterrupted')
    run.finish()
    await restoring
  })
})

describe('explicit cancellation and account isolation', () => {
  it('a cancellation failure leaves observation active and the actual error visible after storage saves', async () => {
    const request = store.sendTaskMessage('question')
    runs[0]!.callbacks.onTaskStart?.(task())
    mocks.apiJSON.mockRejectedValueOnce(new Error('cancel forbidden'))
    await store.stopGeneration()
    runs[0]!.callbacks.onContent?.('still running')
    runs[0]!.callbacks.onTaskUpdate?.(task())
    await vi.advanceTimersByTimeAsync(300)
    expect(store.storageError).toBe('cancel forbidden')
    expect(store.isLoading).toBe(true)
    expect(runs[0]!.signal.aborted).toBe(false)
    expect(store.messages[1]!.content).toBe('still running')
    store.storageError = null
    expect(store.storageError).toBeNull()
    runs[0]!.finish()
    await request
  })

  it('deduplicates cancellation clicks and captures the original session across a focus switch', async () => {
    const sessionId = store.currentSessionId
    const request = store.sendTaskMessage('question')
    runs[0]!.callbacks.onTaskStart?.(task())
    const response = deferred<{ task: Task }>()
    mocks.apiJSON.mockReturnValueOnce(response.promise)
    const cancel = store.stopGeneration()
    const duplicate = store.stopGeneration()
    const other = store.createSession()
    response.resolve({ task: task('task-1', 'cancelled') })
    await Promise.all([cancel, duplicate])
    expect(mocks.apiJSON).toHaveBeenCalledTimes(1)
    expect(store.getCurrentTask(sessionId)?.status).toBe('cancelled')
    expect(store.getCurrentTask(other)).toBeNull()
    expect(runs[0]!.signal.aborted).toBe(true)
    runs[0]!.finish()
    await request
  })

  it('a late cancellation cannot stop a replacement observation', async () => {
    const old = store.sendTaskMessage('old')
    runs[0]!.callbacks.onTaskStart?.(task('old-task'))
    const response = deferred<{ task: Task }>()
    mocks.apiJSON.mockReturnValueOnce(response.promise)
    const cancel = store.stopGeneration()
    store.stopViewing()
    const current = store.sendTaskMessage('new')
    runs[1]!.callbacks.onTaskStart?.(task('new-task'))
    response.resolve({ task: task('old-task', 'cancelled') })
    await cancel
    expect(store.getCurrentTask(store.currentSessionId)?.id).toBe('new-task')
    expect(store.isLoading).toBe(true)
    expect(runs[1]!.signal.aborted).toBe(false)
    runs.forEach((run) => run.finish())
    await Promise.all([old, current])
  })

  it('can cancel a new task while an old task cancellation response is still pending', async () => {
    const old = store.sendTaskMessage('old')
    runs[0]!.callbacks.onTaskStart?.(task('old-task'))
    const oldResponse = deferred<{ task: Task }>()
    mocks.apiJSON.mockReturnValueOnce(oldResponse.promise)
    const oldCancel = store.stopGeneration()
    store.stopViewing()
    const current = store.sendTaskMessage('new')
    runs[1]!.callbacks.onTaskStart?.(task('new-task'))
    mocks.apiJSON.mockResolvedValueOnce({ task: task('new-task', 'cancelled') })
    await store.stopGeneration()
    expect(mocks.apiJSON.mock.calls.map(([path]) => path)).toEqual([
      '/tasks/old-task/cancel',
      '/tasks/new-task/cancel'
    ])
    expect(store.getCurrentTask(store.currentSessionId)?.status).toBe('cancelled')
    expect(runs[1]!.signal.aborted).toBe(true)
    oldResponse.resolve({ task: task('old-task', 'cancelled') })
    await oldCancel
    expect(store.getCurrentTask(store.currentSessionId)?.id).toBe('new-task')
    runs.forEach((run) => run.finish())
    await Promise.all([old, current])
  })

  it('does not claim an in-flight task creation was cancelled', async () => {
    const request = store.sendTaskMessage('question')
    await store.stopGeneration()
    expect(store.storageError).toContain('尚无法确认')
    expect(store.isLoading).toBe(true)
    expect(mocks.apiJSON).not.toHaveBeenCalled()
    runs[0]!.finish()
    await request
  })

  it('rejects an invalid cancellation snapshot without stopping observation', async () => {
    const request = store.sendTaskMessage('question')
    runs[0]!.callbacks.onTaskStart?.(task())
    mocks.apiJSON.mockResolvedValueOnce({ task: task('another-task', 'cancelled') })
    await store.stopGeneration()
    expect(store.isLoading).toBe(true)
    expect(store.storageError).toContain('格式')
    runs[0]!.finish()
    await request
  })

  it('account changes cannot receive old callbacks, delayed saves, or task restores', async () => {
    const request = store.sendTaskMessage('alice question')
    const previousContent = store.messages[1]!.content
    setStorageAccount('bob')
    runs[0]!.callbacks.onContent?.('alice result')
    await vi.advanceTimersByTimeAsync(300)
    expect(store.messages[1]!.content).toBe(previousContent)
    expect(localStorage.getItem(accountStorageKey('chat_messages_map'))).toBeNull()
    await store.restoreTask('alice-task')
    await store.sendTaskMessage('should not send')
    expect(mocks.apiJSON).not.toHaveBeenCalled()
    expect(runs).toHaveLength(1)
    runs[0]!.finish()
    await request
  })

  it('flushes recoverable identity on creation and restores the same empty message after a store restart', async () => {
    const sessionId = store.currentSessionId
    const request = store.sendTaskMessage('question')
    runs[0]!.callbacks.onTaskStart?.(task())
    const messageId = store.messages[1]!.id
    const stored = JSON.parse(localStorage.getItem(accountStorageKey('chat_messages_map'))!)
    expect(stored[sessionId][1]).toMatchObject({ id: messageId, taskId: 'task-1', content: '' })
    store.$dispose()
    // jsdom schedules storage events at zero delay, independently of our save debounce.
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    setActivePinia(createPinia())
    store = useChatStore()
    expect(store.messages[1]).toMatchObject({ id: messageId, taskId: 'task-1', content: '' })
    expect(store.isLoading).toBe(false)
    mocks.apiJSON.mockResolvedValueOnce({ task: task() })
    const restored = store.restoreActiveTask()
    await Promise.resolve()
    runs[1]!.callbacks.onContent?.('recovered answer')
    expect(store.messages[1]!.id).toBe(messageId)
    expect(store.messages[1]!.content).toBe('recovered answer')
    runs.forEach((run) => run.finish())
    await Promise.all([request, restored])
    expect(mocks.sendTaskRequest).toHaveBeenCalledTimes(1)
  })
})
