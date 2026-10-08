import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Step, Task } from '../types/task'

const mocks = vi.hoisted(() => ({ apiJSON: vi.fn(), account: 'alice' }))
vi.mock('./account', () => ({
  apiJSON: mocks.apiJSON,
  accountStorageKey: (key: string) => mocks.account + ':' + key
}))
import { TaskRequestManager } from './requestManager'

const step: Step = {
  id: 'step-1',
  taskId: 'task-1',
  type: 'skill',
  status: 'running',
  name: 'File analysis'
}
const task: Task = {
  id: 'task-1',
  type: 'file',
  status: 'completed',
  userMessage: 'question',
  steps: [{ ...step, status: 'completed' }],
  createdAt: 1,
  updatedAt: 2,
  result: 'answer'
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.account = 'alice'
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => {
  vi.useRealTimers()
})

describe('durable task event delivery', () => {
  it.each(['provider', 'estimated', 'unknown'])('replays persisted %s usage without interrupting the answer', async (tokenSource) => {
    const onContent = vi.fn()
    const onComplete = vi.fn()
    const onError = vi.fn()
    mocks.apiJSON.mockResolvedValueOnce({
      terminal: true, lastEventId: 3, events: [
        { id: 1, type: 'content', data: { content: 'answer' } },
        { id: 2, type: 'usage', data: { usage: {
          callId: 'call-1', model: 'test-model', tokenSource,
          outcome: tokenSource === 'unknown' ? 'unknown' : 'completed',
          ...(tokenSource === 'unknown' ? {} : { inputTokens: 100, outputTokens: 10 }),
        } } },
        { id: 3, type: 'complete', data: { task } },
      ],
    }).mockResolvedValueOnce({ task })
    await new TaskRequestManager({ onContent, onComplete, onError }).resume(task.id)
    expect(onContent).toHaveBeenCalledExactlyOnceWith('answer')
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(task)
    expect(onError).not.toHaveBeenCalled()
    expect(mocks.apiJSON.mock.calls[1]![0]).toBe('/tasks/task-1')
  })
  it('delivers progress separately from start and keeps the terminal task authoritative', async () => {
    const onStepStart = vi.fn()
    const onStepProgress = vi.fn()
    const onStepComplete = vi.fn()
    const onContent = vi.fn()
    const onComplete = vi.fn()
    const progress = { ...step, description: 'Retrieving original evidence' }
    mocks.apiJSON
      .mockResolvedValueOnce({
        terminal: true,
        lastEventId: 4,
        events: [
          { id: 1, type: 'step', data: { step, event: 'start' } },
          { id: 2, type: 'step', data: { step: progress, event: 'progress' } },
          { id: 3, type: 'content', data: { content: 'answer' } },
          { id: 4, type: 'step', data: { step: task.steps[0], event: 'complete' } }
        ]
      })
      .mockResolvedValueOnce({ task })
    await new TaskRequestManager({
      onStepStart,
      onStepProgress,
      onStepComplete,
      onContent,
      onComplete
    }).resume(task.id)
    expect(onStepStart).toHaveBeenCalledTimes(1)
    expect(onStepProgress).toHaveBeenCalledExactlyOnceWith(progress)
    expect(onStepComplete).toHaveBeenCalledExactlyOnceWith(task.steps[0])
    expect(onContent).toHaveBeenCalledExactlyOnceWith('answer')
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(task)
  })

  it('ignores a duplicate event and never reports a failed task as completed', async () => {
    const onStepProgress = vi.fn()
    const onComplete = vi.fn()
    const onError = vi.fn()
    mocks.apiJSON
      .mockResolvedValueOnce({
        terminal: true,
        lastEventId: 2,
        events: [
          { id: 1, type: 'step', data: { step, event: 'progress' } },
          { id: 1, type: 'step', data: { step, event: 'progress' } },
          { id: 2, type: 'error', data: { error: 'Provider interrupted' } }
        ]
      })
      .mockResolvedValueOnce({ task: { ...task, status: 'failed', error: 'Provider interrupted' } })
    await new TaskRequestManager({ onStepProgress, onComplete, onError }).resume(task.id)
    expect(onStepProgress).toHaveBeenCalledTimes(1)
    expect(onComplete).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledExactlyOnceWith('Provider interrupted')
  })
})

describe('safe task polling and protocol boundaries', () => {
  it.each([401, 403, 409])(
    'does not retry HTTP %s even when represented as a typed error',
    async (status) => {
      const onError = vi.fn()
      mocks.apiJSON.mockRejectedValue(Object.assign(new TypeError('request rejected'), { status }))
      await new TaskRequestManager({ onError }).resume(task.id)
      expect(mocks.apiJSON).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledExactlyOnceWith('request rejected')
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('does not retry plain apiJSON HTTP errors or create another task while restoring', async () => {
    mocks.apiJSON.mockRejectedValue(new Error('请求失败（403）'))
    await new TaskRequestManager({ onError: vi.fn() }).resume(task.id)
    expect(mocks.apiJSON).toHaveBeenCalledTimes(1)
    expect(mocks.apiJSON.mock.calls[0]![0]).toContain('/events?after=0')
  })

  it('retries a fetch network error and deduplicates overlapping pages without skipping cursor positions', async () => {
    const onContent = vi.fn()
    const onComplete = vi.fn()
    const onError = vi.fn()
    const firstEvent = { id: 1, type: 'content', data: { content: 'first' } }
    mocks.apiJSON
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ terminal: false, lastEventId: 1, events: [firstEvent] })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        terminal: true,
        lastEventId: 2,
        events: [firstEvent, { id: 2, type: 'content', data: { content: 'second' } }]
      })
      .mockResolvedValueOnce({ task })
    const viewing = new TaskRequestManager({ onContent, onComplete, onError }).resume(task.id)
    await vi.runAllTimersAsync()
    await viewing
    expect(onContent.mock.calls).toEqual([['first'], ['second']])
    expect(mocks.apiJSON.mock.calls.map(([path]) => path)).toEqual([
      '/tasks/task-1/events?after=0',
      '/tasks/task-1/events?after=0',
      '/tasks/task-1/events?after=1',
      '/tasks/task-1/events?after=1',
      '/tasks/task-1'
    ])
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(task)
    expect(onError).not.toHaveBeenCalled()
  })

  it('recovers a failed terminal snapshot read without replaying content', async () => {
    const onContent = vi.fn()
    const onComplete = vi.fn()
    mocks.apiJSON
      .mockResolvedValueOnce({
        terminal: true,
        lastEventId: 1,
        events: [{ id: 1, type: 'content', data: { content: 'answer' } }]
      })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ task })
    const viewing = new TaskRequestManager({ onContent, onComplete }).resume(task.id)
    await vi.runAllTimersAsync()
    await viewing
    expect(onContent).toHaveBeenCalledExactlyOnceWith('answer')
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(task)
    expect(mocks.apiJSON.mock.calls.map(([path]) => path)).toEqual([
      '/tasks/task-1/events?after=0',
      '/tasks/task-1',
      '/tasks/task-1'
    ])
  })

  it('retains the same idempotency key and request body for a network retry of creation', async () => {
    const onTaskStart = vi.fn()
    const onComplete = vi.fn()
    mocks.apiJSON
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ task: { ...task, status: 'pending' } })
      .mockResolvedValueOnce({ terminal: true, lastEventId: 0, events: [] })
      .mockResolvedValueOnce({ task })
    const request = {
      messages: [{ role: 'user' as const, content: 'question' }],
      requestKey: 'stable-request-key'
    }
    const sending = new TaskRequestManager({ onTaskStart, onComplete }).send(request)
    await vi.runAllTimersAsync()
    await sending
    const first = mocks.apiJSON.mock.calls[0]!
    const retry = mocks.apiJSON.mock.calls[1]!
    expect(first[0]).toBe('/tasks')
    expect(retry).toEqual(first)
    expect(first[1].headers).toEqual({ 'Idempotency-Key': 'stable-request-key' })
    expect(JSON.parse(first[1].body)).toEqual({ messages: request.messages })
    expect(onTaskStart).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(task)
  })

  it('bounds repeated network failures and reports exactly once', async () => {
    const onError = vi.fn()
    mocks.apiJSON.mockRejectedValue(new TypeError('Failed to fetch'))
    const viewing = new TaskRequestManager({ onError }).resume(task.id)
    await vi.runAllTimersAsync()
    await viewing
    expect(mocks.apiJSON).toHaveBeenCalledTimes(5)
    expect(onError).toHaveBeenCalledExactlyOnceWith('Failed to fetch')
  })

  it('aborts retry sleep without extra requests or an error callback', async () => {
    const controller = new AbortController()
    const onError = vi.fn()
    mocks.apiJSON.mockRejectedValue(new TypeError('Failed to fetch'))
    const viewing = new TaskRequestManager({ onError }, controller.signal).resume(task.id)
    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    await viewing
    expect(mocks.apiJSON).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a page resolving after abort even if fetch ignores the signal', async () => {
    const controller = new AbortController()
    let resolve!: (value: unknown) => void
    mocks.apiJSON.mockReturnValue(
      new Promise((finish) => {
        resolve = finish
      })
    )
    const onContent = vi.fn()
    const onError = vi.fn()
    const viewing = new TaskRequestManager({ onContent, onError }, controller.signal).resume(
      task.id
    )
    controller.abort()
    resolve({
      terminal: true,
      lastEventId: 1,
      events: [{ id: 1, type: 'content', data: { content: 'late' } }]
    })
    await viewing
    expect(onContent).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(mocks.apiJSON).toHaveBeenCalledTimes(1)
  })

  it('does not retry task creation under a new account', async () => {
    mocks.apiJSON.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const onError = vi.fn()
    const sending = new TaskRequestManager({ onError }).send({
      messages: [{ role: 'user', content: 'alice question' }]
    })
    await Promise.resolve()
    await Promise.resolve()
    mocks.account = 'bob'
    await vi.runAllTimersAsync()
    await sending
    expect(mocks.apiJSON).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('does not poll hidden tabs and resumes without resetting its cursor', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const controller = new AbortController()
    const onContent = vi.fn()
    const viewing = new TaskRequestManager({ onContent }, controller.signal).resume(task.id)
    await vi.advanceTimersByTimeAsync(1500)
    expect(mocks.apiJSON).not.toHaveBeenCalled()
    mocks.apiJSON
      .mockResolvedValueOnce({
        terminal: true,
        lastEventId: 1,
        events: [{ id: 1, type: 'content', data: { content: 'answer' } }]
      })
      .mockResolvedValueOnce({ task })
    visibility.mockReturnValue('visible')
    await vi.advanceTimersByTimeAsync(1500)
    await viewing
    expect(onContent).toHaveBeenCalledExactlyOnceWith('answer')
  })

  const content = { id: 1, type: 'content', data: { content: 'valid first' } }
  it.each([
    ['null page', null],
    ['missing events', { terminal: true, lastEventId: 0 }],
    ['invalid terminal flag', { terminal: 'true', lastEventId: 0, events: [] }],
    ['invalid cursor', { terminal: true, lastEventId: 1.5, events: [] }],
    ['cursor skips an event', { terminal: true, lastEventId: 2, events: [content] }],
    ['out of order', { terminal: true, lastEventId: 2, events: [{ ...content, id: 2 }, content] }],
    ['sequence gap', { terminal: true, lastEventId: 3, events: [content, { ...content, id: 3 }] }],
    [
      'conflicting duplicate',
      {
        terminal: true,
        lastEventId: 1,
        events: [content, { ...content, data: { content: 'different' } }]
      }
    ],
    [
      'late duplicate within page',
      { terminal: true, lastEventId: 2, events: [content, { ...content, id: 2 }, content] }
    ],
    [
      'malformed content',
      {
        terminal: true,
        lastEventId: 2,
        events: [content, { id: 2, type: 'content', data: { content: 42 } }]
      }
    ],
    [
      'malformed step',
      {
        terminal: true,
        lastEventId: 1,
        events: [
          {
            id: 1,
            type: 'step',
            data: { step: { ...step, taskId: 'wrong-task' }, event: 'progress' }
          }
        ]
      }
    ],
    [
      'unknown step event',
      {
        terminal: true,
        lastEventId: 1,
        events: [{ id: 1, type: 'step', data: { step, event: 'other' } }]
      }
    ],
    [
      'malformed sources',
      {
        terminal: true,
        lastEventId: 1,
        events: [{ id: 1, type: 'sources', data: { sources: [null] } }]
      }
    ],
    [
      'unexpected task',
      {
        terminal: true,
        lastEventId: 1,
        events: [{ id: 1, type: 'task', data: { task: { ...task, id: 'wrong-task' } } }]
      }
    ],
    [
      'malformed usage',
      {
        terminal: true, lastEventId: 1,
        events: [{ id: 1, type: 'usage', data: { usage: {
          callId: 'call', model: 'test-model', tokenSource: 'estimated',
          outcome: 'completed', inputTokens: -1,
        } } }],
      }
    ],
    [
      'unknown event',
      { terminal: true, lastEventId: 1, events: [{ id: 1, type: 'future-event', data: {} }] }
    ]
  ])('rejects %s before dispatching any part of the page', async (_name, page) => {
    const onContent = vi.fn()
    const onError = vi.fn()
    mocks.apiJSON.mockResolvedValue(page)
    await new TaskRequestManager({ onContent, onError }).resume(task.id)
    expect(onContent).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]![0]).toContain('格式或顺序异常')
    expect(mocks.apiJSON).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a nonterminal or malformed final snapshot instead of claiming completion', async () => {
    const onComplete = vi.fn()
    const onError = vi.fn()
    mocks.apiJSON
      .mockResolvedValueOnce({ terminal: true, lastEventId: 0, events: [] })
      .mockResolvedValueOnce({ task: { ...task, status: 'running' } })
    await new TaskRequestManager({ onComplete, onError }).resume(task.id)
    expect(onComplete).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('never starts polling for an invalid creation response', async () => {
    const onTaskStart = vi.fn()
    const onError = vi.fn()
    mocks.apiJSON.mockResolvedValueOnce({ task: { id: 'task-1' } })
    await new TaskRequestManager({ onTaskStart, onError }).send({
      messages: [{ role: 'user', content: 'question' }]
    })
    expect(onTaskStart).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(mocks.apiJSON).toHaveBeenCalledTimes(1)
  })

  it('uses the saved cancellation reason and never reports a cancelled task as completed', async () => {
    const onError = vi.fn()
    const onComplete = vi.fn()
    mocks.apiJSON
      .mockResolvedValueOnce({ terminal: true, lastEventId: 0, events: [] })
      .mockResolvedValueOnce({
        task: { ...task, status: 'cancelled', error: 'Saved cancellation reason' }
      })
    await new TaskRequestManager({ onError, onComplete }).resume(task.id)
    expect(onError).toHaveBeenCalledExactlyOnceWith('Saved cancellation reason')
    expect(onComplete).not.toHaveBeenCalled()
  })
})
