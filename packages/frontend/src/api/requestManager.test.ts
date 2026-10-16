import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Step, Task } from '../types/task'

const mocks = vi.hoisted(() => ({
  apiJSON: vi.fn(),
  account: 'alice',
  revision: 0,
  fetch: vi.fn()
}))
vi.mock('./account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./account')>()),
  apiJSON: mocks.apiJSON,
  getAccountRevision: () => mocks.revision,
  accountHeaders: () => ({ 'X-Account-ID': mocks.account }),
  accountStorageKey: (key: string) => mocks.account + ':' + key
}))
import { TaskRequestManager } from './requestManager'
import { API_BASE_URL } from '../config'

const encoder = new TextEncoder()
function frame(page: unknown) {
  return 'event: task-events\ndata: ' + JSON.stringify(page) + '\n\n'
}
function streamResponse(text: string) {
  return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })
}
function page(content: string, id = 1, terminal = false) {
  return { terminal, lastEventId: id, events: [{ id, type: 'content', data: { content } }] }
}

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
  mocks.revision = 0
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  // Keep the legacy protocol fixtures, but deliver their event pages through real SSE bodies.
  mocks.fetch.mockImplementation(async (url: string, init: RequestInit) =>
    streamResponse(frame(await mocks.apiJSON(url.slice(API_BASE_URL.length), init)))
  )
  vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('durable task event delivery', () => {
  it.each(['provider', 'estimated', 'unknown'])(
    'replays persisted %s usage without interrupting the answer',
    async (tokenSource) => {
      const onContent = vi.fn()
      const onComplete = vi.fn()
      const onError = vi.fn()
      mocks.apiJSON
        .mockResolvedValueOnce({
          terminal: true,
          lastEventId: 3,
          events: [
            { id: 1, type: 'content', data: { content: 'answer' } },
            {
              id: 2,
              type: 'usage',
              data: {
                usage: {
                  callId: 'call-1',
                  model: 'test-model',
                  tokenSource,
                  outcome: tokenSource === 'unknown' ? 'unknown' : 'completed',
                  ...(tokenSource === 'unknown' ? {} : { inputTokens: 100, outputTokens: 10 })
                }
              }
            },
            { id: 3, type: 'complete', data: { task } }
          ]
        })
        .mockResolvedValueOnce({ task })
      await new TaskRequestManager({ onContent, onComplete, onError }).resume(task.id)
      expect(onContent).toHaveBeenCalledExactlyOnceWith('answer')
      expect(onComplete).toHaveBeenCalledExactlyOnceWith(task)
      expect(onError).not.toHaveBeenCalled()
      expect(mocks.apiJSON.mock.calls[1]![0]).toBe('/tasks/task-1')
    }
  )
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

describe('safe task observation and protocol boundaries', () => {
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

  it('receives a terminal SSE frame even in a hidden tab', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const onContent = vi.fn()
    mocks.apiJSON
      .mockResolvedValueOnce({
        terminal: true,
        lastEventId: 1,
        events: [{ id: 1, type: 'content', data: { content: 'answer' } }]
      })
      .mockResolvedValueOnce({ task })
    await new TaskRequestManager({ onContent }).resume(task.id)
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
        terminal: true,
        lastEventId: 1,
        events: [
          {
            id: 1,
            type: 'usage',
            data: {
              usage: {
                callId: 'call',
                model: 'test-model',
                tokenSource: 'estimated',
                outcome: 'completed',
                inputTokens: -1
              }
            }
          }
        ]
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

function openStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
    cancel
  })
  const response = new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
  return {
    response,
    body,
    cancel,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    fail: () => controller.error(new TypeError('socket lost'))
  }
}

async function settleUntil(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await Promise.resolve()
  expect(check()).toBe(true)
}

describe('SSE transport and animation-frame batching', () => {
  it('keeps a healthy SSE connection open without polling or creating tasks', async () => {
    const stream = openStream()
    const controller = new AbortController()
    const onContent = vi.fn()
    mocks.fetch.mockResolvedValue(stream.response)
    const viewing = new TaskRequestManager({ onContent }, controller.signal).resume(task.id)
    stream.push(frame(page('answer')) + ': heartbeat\n\n')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onContent).toHaveBeenCalledExactlyOnceWith('answer')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.apiJSON).not.toHaveBeenCalled()
    controller.abort()
    await viewing
    expect(stream.cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops ordered callbacks when flushing buffered content triggers an abort', async () => {
    const stream = openStream()
    const controller = new AbortController()
    const onTaskUpdate = vi.fn()
    const onComplete = vi.fn()
    const onError = vi.fn()
    const onContent = vi.fn(() => controller.abort())
    mocks.fetch.mockResolvedValue(stream.response)
    stream.push(
      frame({
        terminal: true,
        lastEventId: 2,
        events: [...page('answer').events, { id: 2, type: 'task', data: { task } }]
      })
    )
    await new TaskRequestManager(
      { onContent, onTaskUpdate, onComplete, onError },
      controller.signal
    ).resume(task.id)
    expect(onContent).toHaveBeenCalledExactlyOnceWith('answer')
    expect(onTaskUpdate).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(mocks.apiJSON).not.toHaveBeenCalled()
    expect(stream.cancel).toHaveBeenCalledTimes(1)
    expect(stream.body.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('decodes fragmented UTF-8, CRLF, multiline data and heartbeat comments', async () => {
    const content = '\u4f60\u597d \ud83d\ude80'
    const text =
      ': heartbeat\r\n\r\nevent: ignored\r\ndata: invalid\r\n\r\n' +
      'event: task-events\r\ndata: ' +
      JSON.stringify(page(content, 1, true)).replace(',"events"', ',\r\ndata: "events"') +
      '\r\n\r\n'
    const bytes = encoder.encode(text)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
        controller.close()
      }
    })
    mocks.fetch.mockResolvedValue(
      new Response(body, {
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' }
      })
    )
    mocks.apiJSON.mockResolvedValue({ task })
    const onContent = vi.fn()
    const onComplete = vi.fn()
    await new TaskRequestManager({ onContent, onComplete }).resume(task.id)
    expect(onContent).toHaveBeenCalledExactlyOnceWith(content)
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(task)
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(
      API_BASE_URL + '/tasks/task-1/events?after=0',
      expect.objectContaining({
        credentials: 'include',
        headers: { Accept: 'text/event-stream', 'X-Account-ID': 'alice' }
      })
    )
    expect(body.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['close', 'fail'] as const)(
    'reconnects after %s from the delivered cursor and never repeats creation or content',
    async (end) => {
      const first = openStream()
      const onContent = vi.fn()
      const onComplete = vi.fn()
      const onError = vi.fn()
      mocks.apiJSON
        .mockResolvedValueOnce({ task: { ...task, status: 'pending' } })
        .mockResolvedValueOnce({ task })
      mocks.fetch.mockResolvedValueOnce(first.response).mockResolvedValueOnce(
        streamResponse(
          frame({
            terminal: true,
            lastEventId: 2,
            events: [...page('first').events, ...page('second', 2).events]
          })
        )
      )
      const sending = new TaskRequestManager({ onContent, onComplete, onError }).send({
        messages: [{ role: 'user', content: 'question' }],
        requestKey: 'only-once'
      })
      first.push(frame(page('first')))
      await vi.advanceTimersByTimeAsync(20)
      expect(onContent).toHaveBeenCalledExactlyOnceWith('first')
      // A torn frame must not advance the durable cursor.
      first.push(frame(page('second', 2)).slice(0, -1))
      first[end]()
      await vi.runAllTimersAsync()
      await sending
      expect(onContent.mock.calls).toEqual([['first'], ['second']])
      expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
        API_BASE_URL + '/tasks/task-1/events?after=0',
        API_BASE_URL + '/tasks/task-1/events?after=1'
      ])
      expect(mocks.apiJSON.mock.calls.map(([path]) => path)).toEqual(['/tasks', '/tasks/task-1'])
      expect(onComplete).toHaveBeenCalledExactlyOnceWith(task)
      expect(onError).not.toHaveBeenCalled()
      expect(first.body.locked).toBe(false)
    }
  )

  it('flushes content after a complete event before the authoritative terminal snapshot', async () => {
    const order: string[] = []
    const stream = openStream()
    mocks.fetch.mockResolvedValue(stream.response)
    mocks.apiJSON.mockResolvedValue({ task: { ...task, result: 'saved answer' } })
    stream.push(
      frame(page('head')) +
        frame({
          terminal: true,
          lastEventId: 3,
          events: [
            { id: 2, type: 'complete', data: { task: { ...task, result: 'stale' } } },
            ...page('tail', 3).events
          ]
        })
    )
    await new TaskRequestManager({
      onContent: (content) => order.push(content),
      onTaskUpdate: (task) => order.push('task:' + task.result),
      onComplete: (task) => order.push('complete:' + task.result)
    }).resume(task.id)
    expect(order).toEqual(['head', 'tail', 'task:saved answer', 'complete:saved answer'])
    expect(stream.cancel).toHaveBeenCalledTimes(1)
    expect(stream.body.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('coalesces many event pages into one animation frame and flushes pending content on abort', async () => {
    const stream = openStream()
    const controller = new AbortController()
    const onContent = vi.fn()
    const onError = vi.fn()
    const onComplete = vi.fn()
    mocks.fetch.mockResolvedValue(stream.response)
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const viewing = new TaskRequestManager(
      { onContent, onError, onComplete },
      controller.signal
    ).resume(task.id)
    stream.push(frame(page('one')) + frame(page('two', 2)) + frame(page('three', 3)))
    await settleUntil(() => raf.mock.calls.length === 1)
    await vi.advanceTimersByTimeAsync(20)
    expect(onContent).toHaveBeenCalledExactlyOnceWith('onetwothree')
    stream.push(frame(page('four', 4)) + frame(page('five', 5)))
    await settleUntil(() => raf.mock.calls.length === 2)
    // Allow both frames to be consumed without advancing the animation clock.
    for (let i = 0; i < 20; i++) await Promise.resolve()
    controller.abort()
    await viewing
    expect(onContent.mock.calls).toEqual([['onetwothree'], ['fourfive']])
    expect(onError).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()
    expect(stream.cancel).toHaveBeenCalledTimes(1)
    expect(stream.body.locked).toBe(false)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    await vi.runAllTimersAsync()
    expect(onContent).toHaveBeenCalledTimes(2)
  })

  it('preserves callback order across content, task, step, sources and error barriers', async () => {
    const order: string[] = []
    const failed = { ...task, status: 'failed', error: 'failed' }
    mocks.fetch.mockResolvedValue(
      streamResponse(
        frame({
          terminal: true,
          lastEventId: 8,
          events: [
            ...page('a').events,
            { id: 2, type: 'task', data: { task: { ...task, status: 'running' } } },
            ...page('b', 3).events,
            { id: 4, type: 'step', data: { step, event: 'progress' } },
            ...page('c', 5).events,
            { id: 6, type: 'sources', data: { sources: [] } },
            ...page('d', 7).events,
            { id: 8, type: 'error', data: { error: 'failed', task: failed } }
          ]
        })
      )
    )
    mocks.apiJSON.mockResolvedValue({ task: failed })
    await new TaskRequestManager({
      onContent: (value) => order.push(value),
      onTaskUpdate: (value) => order.push(value.status),
      onStepProgress: () => order.push('step'),
      onSources: () => order.push('sources'),
      onError: () => order.push('error'),
      onComplete: () => order.push('complete')
    }).resume(task.id)
    expect(order).toEqual([
      'a',
      'running',
      'b',
      'step',
      'c',
      'sources',
      'd',
      'failed',
      'error',
      'failed'
    ])
  })

  it('discards queued content on an account revision change even if the account ID is unchanged', async () => {
    const stream = openStream()
    const onContent = vi.fn()
    const onError = vi.fn()
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    mocks.fetch.mockResolvedValue(stream.response)
    const viewing = new TaskRequestManager({ onContent, onError }).resume(task.id)
    stream.push(frame(page('old account')))
    await settleUntil(() => raf.mock.calls.length === 1)
    mocks.revision++
    stream.push(': heartbeat\n\n')
    await viewing
    await vi.runAllTimersAsync()
    expect(onContent).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(stream.cancel).toHaveBeenCalledTimes(1)
    expect(stream.body.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans up a response arriving after abort without starting its reader', async () => {
    const stream = openStream()
    const controller = new AbortController()
    let resolve!: (response: Response) => void
    mocks.fetch.mockReturnValue(
      new Promise<Response>((finish) => {
        resolve = finish
      })
    )
    const onContent = vi.fn()
    const viewing = new TaskRequestManager({ onContent }, controller.signal).resume(task.id)
    controller.abort()
    resolve(stream.response)
    await viewing
    expect(stream.cancel).toHaveBeenCalledTimes(1)
    expect(stream.body.locked).toBe(false)
    expect(onContent).not.toHaveBeenCalled()
  })

  it('bounds clean EOF reconnects, including heartbeat-only connections', async () => {
    mocks.fetch.mockImplementation(() => Promise.resolve(streamResponse(': heartbeat\n\n')))
    const onError = vi.fn()
    const viewing = new TaskRequestManager({ onError }).resume(task.id)
    await vi.runAllTimersAsync()
    await viewing
    expect(mocks.fetch).toHaveBeenCalledTimes(5)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(mocks.apiJSON).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([401, 403, 409])('does not reconnect an actual HTTP %s response', async (status) => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'denied' }), { status }))
    const expired = vi.fn()
    window.addEventListener('account-expired', expired)
    try {
      const onError = vi.fn()
      await new TaskRequestManager({ onError }).resume(task.id)
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledExactlyOnceWith('denied')
      expect(expired).toHaveBeenCalledTimes(status === 401 ? 1 : 0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      window.removeEventListener('account-expired', expired)
    }
  })

  it.each([429, 503])('reconnects an HTTP %s response', async (status) => {
    mocks.fetch
      .mockResolvedValueOnce(new Response('', { status }))
      .mockResolvedValueOnce(streamResponse(frame(page('answer', 1, true))))
    mocks.apiJSON.mockResolvedValue({ task })
    const onComplete = vi.fn()
    const viewing = new TaskRequestManager({ onComplete }).resume(task.id)
    await vi.runAllTimersAsync()
    await viewing
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(task)
  })

  it('supports explicit JSON compatibility responses without changing the SSE Accept header', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page('first')), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page('second', 2, true)), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    mocks.apiJSON.mockResolvedValue({ task })
    const onContent = vi.fn()
    const viewing = new TaskRequestManager({ onContent }).resume(task.id)
    await vi.runAllTimersAsync()
    await viewing
    expect(onContent.mock.calls).toEqual([['first'], ['second']])
    expect(mocks.fetch.mock.calls[1]![0]).toBe(API_BASE_URL + '/tasks/task-1/events?after=1')
    expect(
      mocks.fetch.mock.calls.every(([, init]) => init.headers.Accept === 'text/event-stream')
    ).toBe(true)
  })

  it.each([
    ['text/html', '<html>wrong server</html>'],
    ['text/event-stream', 'event: task-events\ndata: not-json\n\n']
  ])('rejects malformed %s responses without reconnecting', async (contentType, body) => {
    mocks.fetch.mockResolvedValue(new Response(body, { headers: { 'Content-Type': contentType } }))
    const onError = vi.fn()
    await new TaskRequestManager({ onError }).resume(task.id)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
