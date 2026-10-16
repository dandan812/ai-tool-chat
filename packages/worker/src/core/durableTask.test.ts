import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env, SkillContext, Task } from '../types'
import { createMockEnv } from '../test/mocks'

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  begin: vi.fn(),
  settleCall: vi.fn(),
  finish: vi.fn(),
  summary: vi.fn(),
  execute: vi.fn(),
  mode: 'normal',
  sources: [] as Array<Record<string, unknown>>
}))
vi.mock('../platform/accounts', () => ({
  reserveTask: mocks.reserve,
  beginModelCall: mocks.begin,
  settleModelCall: mocks.settleCall,
  finishTask: mocks.finish,
  updateTaskSummary: mocks.summary
}))
vi.mock('../skills', () => ({
  selectSkill: () => ({
    model: 'mock-model',
    label: 'Mock',
    description: 'test',
    toolingMode: 'disabled',
    skill: {
      name: 'mock',
      async *execute(_input: unknown, context: SkillContext) {
        mocks.execute()
        if (mocks.mode === 'progress') {
          yield {
            type: 'progress',
            progress: { message: 'Reading original documents', current: 0, total: 2 }
          }
          yield {
            type: 'progress',
            progress: { message: 'Generating from evidence', current: 1, total: 2 }
          }
        }
        const control = context.env.RUNTIME_CONTROL!
        await control.beforeCall({
          callId: 'call-1',
          model: 'mock-model',
          estimatedInputTokens: 10,
          maxOutputTokens: 100
        })
        yield { type: 'content', content: 'partial ' }
        if (mocks.mode === 'many-deltas') {
          for (let index = 0; index < 600; index++) yield { type: 'content', content: 'x' }
        }
        if (mocks.mode === 'wait') {
          await new Promise<void>((resolve) => {
            if (control.signal.aborted) resolve()
            else control.signal.addEventListener('abort', () => resolve(), { once: true })
          })
          await control.afterCall({
            callId: 'call-1',
            model: 'mock-model',
            tokenSource: 'unknown',
            outcome: 'cancelled'
          })
          control.signal.throwIfAborted()
        }
        if (mocks.mode === 'fail') throw new Error('upstream failure')
        if (mocks.mode === 'oversized') yield { type: 'content', content: 'x'.repeat(24001) }
        if (mocks.mode === 'escaped') yield { type: 'content', content: '\u0000'.repeat(23980) }
        if (mocks.mode === 'sources')
          yield {
            type: 'sources',
            sources: [
              {
                sourceId: 'S1',
                fileId: 'f1',
                fileName: 'notes.txt',
                fileHash: 'hash',
                excerpt: 'test source',
                startLine: 1,
                endLine: 1,
                startOffset: 0,
                endOffset: 11
              }
            ]
          }
        if (mocks.mode === 'large-sources') {
          yield { type: 'sources', sources: mocks.sources.slice(0, 12) }
          yield { type: 'sources', sources: mocks.sources.slice(8) }
          yield { type: 'content', content: '答'.repeat(23980) }
        }
        yield { type: 'content', content: 'answer' }
        await control.afterCall({
          callId: 'call-1',
          model: 'mock-model',
          inputTokens: 10,
          outputTokens: 2,
          tokenSource: 'provider',
          outcome: 'completed'
        })
        if (mocks.mode === 'priced-second-call') {
          await control.beforeCall({
            callId: 'call-2',
            model: 'second-model',
            estimatedInputTokens: 20,
            maxOutputTokens: 100
          })
          await control.afterCall({
            callId: 'call-2',
            model: 'second-model',
            inputTokens: 20,
            outputTokens: 3,
            tokenSource: 'estimated',
            outcome: 'completed'
          })
        }
        yield { type: 'complete' }
      }
    }
  })
}))
import { DurableTask, resolveTaskBudget, TASK_BUDGET } from './durableTask'

class MemoryStorage {
  values = new Map<string, unknown>()
  alarmAt: number | null = null
  private queue: Promise<unknown> = Promise.resolve()
  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.values.get(key)) as T | undefined
  }
  async put(key: string, value: unknown) {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 128 * 1024)
      throw new Error('DO value exceeds 128 KB')
    this.values.set(key, structuredClone(value))
  }
  async delete(key: string) {
    return this.values.delete(key)
  }
  async setAlarm(time: number) {
    this.alarmAt = time
  }
  async deleteAlarm() {
    this.alarmAt = null
  }
  async list<T>(options: { start: string; end: string; limit: number }): Promise<Map<string, T>> {
    return new Map(
      [...this.values.entries()]
        .filter(([key]) => key >= options.start && key < options.end)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, options.limit)
        .map(([key, value]) => [key, structuredClone(value) as T])
    )
  }
  async transaction<T>(callback: (storage: MemoryStorage) => Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      const previous = structuredClone(this.values)
      const previousAlarm = this.alarmAt
      try {
        return await callback(this)
      } catch (error) {
        this.values = previous
        this.alarmAt = previousAlarm
        throw error
      }
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }
}
function setup() {
  const storage = new MemoryStorage()
  const state = { storage } as unknown as DurableObjectState
  const env = createMockEnv() as Env
  const task = new DurableTask(state, env)
  return { storage, state, env, task }
}
function request(path = '/', owner = 'user-a', body?: unknown) {
  return new Request('https://task' + path, {
    method: body !== undefined || path === '/cancel' ? 'POST' : 'GET',
    headers: { 'X-Task-Owner': owner },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  })
}
const create = {
  ownerId: 'user-a',
  taskId: 'task-1',
  requestHash: 'hash-1',
  request: { messages: [{ role: 'user', content: 'hello' }] }
}
async function snapshot(task: DurableTask) {
  return (await (await task.fetch(request())).json()) as { task: Task; lastEventId: number }
}
async function events(task: DurableTask, after = 0) {
  return (await (await task.fetch(request(`/events?after=${after}`))).json()) as {
    events: Array<{ id: number; type: string; data: { task?: Task; content?: string } }>
    terminal: boolean
    lastEventId: number
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mode = 'normal'
  mocks.sources = []
  mocks.reserve.mockResolvedValue({ reservationId: 'task-1' })
  mocks.begin.mockResolvedValue(undefined)
  mocks.settleCall.mockResolvedValue(undefined)
  mocks.finish.mockResolvedValue(undefined)
  mocks.summary.mockResolvedValue(undefined)
})

describe('DurableTask lifecycle', () => {
  it('bounds observers at the shared task boundary and releases capacity after disconnect', async () => {
    const { task } = setup()
    await task.fetch(request('/create', 'user-a', create))
    const open = () =>
      task.fetch(
        new Request('https://task/events?after=0', {
          headers: { 'X-Task-Owner': 'user-a', Accept: 'text/event-stream' }
        })
      )
    const streams: Response[] = []
    try {
      for (let index = 0; index < 8; index++) {
        const response = await open()
        expect(response.status).toBe(200)
        streams.push(response)
      }
      expect((await open()).status).toBe(429)
      await streams.pop()!.body!.cancel()
      const replacement = await open()
      expect(replacement.status).toBe(200)
      streams.push(replacement)
    } finally {
      await Promise.all(streams.map((stream) => stream.body!.cancel()))
    }
    expect(task.hasActiveStreams).toBe(false)
  })

  it('pushes committed deltas while execution is pending, resumes by cursor, and closes on cancellation', async () => {
    mocks.mode = 'wait'
    const { task } = setup()
    await task.fetch(request('/create', 'user-a', create))
    const open = (after: number, signal?: AbortSignal, owner = 'user-a') =>
      task.fetch(
        new Request(`https://task/events?after=${after}`, {
          headers: { 'X-Task-Owner': owner, Accept: 'text/event-stream' },
          signal
        })
      )
    expect((await open(0, undefined, 'user-b')).status).toBe(404)
    expect((await open(1)).status).toBe(400)
    const abort = new AbortController()
    const response = await open(0, abort.signal)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    expect(task.hasActiveStreams).toBe(true)
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(': connected')
    const running = task.alarm()
    let cursor = 0
    let content = ''
    while (!content) {
      const frame = new TextDecoder().decode((await reader.read()).value)
      const page = JSON.parse(frame.split('data: ')[1])
      for (const event of page.events) {
        expect(event.id).toBe(++cursor)
        if (event.type === 'content') content += event.data.content
      }
      expect(page.terminal).toBe(false)
    }
    expect(content).toBe('partial ')
    abort.abort()
    await reader.cancel()
    expect(task.hasActiveStreams).toBe(false)
    const resumed = (await open(cursor)).body!.getReader()
    await resumed.read() // Initial comment.
    await task.fetch(request('/cancel'))
    let terminal = false
    while (true) {
      const next = await resumed.read()
      if (next.done) break
      const page = JSON.parse(new TextDecoder().decode(next.value).split('data: ')[1])
      for (const event of page.events) {
        expect(event.id).toBe(++cursor)
        expect(event.type).not.toBe('content')
      }
      terminal = page.terminal
    }
    await running
    expect(terminal).toBe(true)
    expect(task.hasActiveStreams).toBe(false)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('persists over 512 small deltas without the former batch-event limit and replays all pages', async () => {
    mocks.mode = 'many-deltas'
    const { task } = setup()
    await task.fetch(request('/create', 'user-a', create))
    await task.alarm()
    const response = await task.fetch(
      new Request('https://task/events?after=0', {
        headers: { 'X-Task-Owner': 'user-a', Accept: 'text/event-stream' }
      })
    )
    const frames = (await response.text())
      .split('\n\n')
      .filter((frame) => frame.startsWith('event:'))
    const pages = frames.map((frame) => JSON.parse(frame.split('data: ')[1]))
    const replay = pages.flatMap((page) => page.events)
    expect(pages.length).toBeGreaterThan(5)
    expect(pages.at(-1).terminal).toBe(true)
    expect(replay.map((event) => event.id)).toEqual(replay.map((_, index) => index + 1))
    expect(replay.filter((event) => event.type === 'content').length).toBe(602)
    expect(
      replay
        .filter((event) => event.type === 'content')
        .map((event) => event.data.content)
        .join('')
    ).toBe('partial ' + 'x'.repeat(600) + 'answer')
    expect((await snapshot(task)).task.status).toBe('completed')
  })

  it('persists ordered progress events and restores the latest step without rerunning the skill', async () => {
    mocks.mode = 'progress'
    const { task, state, env } = setup()
    await task.fetch(request('/create', 'user-a', create))
    await task.alarm()
    const recovered = new DurableTask(state, env)
    const replay = await events(recovered)
    const progress = replay.events.filter(
      (event) => event.type === 'step' && (event.data as { event?: string }).event === 'progress'
    )
    expect(
      progress.map((event) => (event.data as { step: { description: string } }).step.description)
    ).toEqual(['Reading original documents', 'Generating from evidence'])
    expect(progress[0].id).toBeLessThan(progress[1].id)
    const restored = await snapshot(recovered)
    expect(restored.task.steps.find((step) => step.type === 'skill')).toMatchObject({
      status: 'completed',
      progress: { message: 'Generating from evidence', current: 1, total: 2 }
    })
    expect((await events(recovered, replay.lastEventId)).events).toEqual([])
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
  it('concurrent idempotent creation reserves once, and changed payload conflicts', async () => {
    const { task } = setup()
    const responses = await Promise.all([
      task.fetch(request('/create', 'user-a', create)),
      task.fetch(request('/create', 'user-a', create))
    ])
    expect(responses.map((r) => r.status)).toEqual([202, 202])
    expect(mocks.reserve).toHaveBeenCalledTimes(1)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(
      (await task.fetch(request('/create', 'user-a', { ...create, requestHash: 'changed' }))).status
    ).toBe(409)
  })
  it('does not expose or cancel another user task', async () => {
    const { task } = setup()
    await task.fetch(request('/create', 'user-a', create))
    for (const path of ['/', '/events?after=0', '/cancel'])
      expect((await task.fetch(request(path, 'user-b'))).status).toBe(404)
    expect((await snapshot(task)).task.status).toBe('pending')
  })
  it('runs without a connected browser and replays the same completed task after object reconstruction', async () => {
    const { task, state, env, storage } = setup()
    await task.fetch(request('/create', 'user-a', create))
    await task.alarm()
    const recovered = new DurableTask(state, env)
    expect((await snapshot(recovered)).task).toMatchObject({
      id: 'task-1',
      status: 'completed',
      result: 'partial answer'
    })
    const replay = await events(recovered)
    expect(replay.terminal).toBe(true)
    expect(replay.events.map((e) => e.id)).toEqual(replay.events.map((_, index) => index + 1))
    expect(replay.events.find((e) => e.type === 'complete')?.data.task?.status).toBe('completed')
    expect(
      replay.events
        .filter((e) => e.type === 'content')
        .map((e) => e.data.content)
        .join('')
    ).toBe('partial answer')
    expect((await events(recovered, replay.lastEventId)).events).toEqual([])
    await recovered.alarm()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.finish).toHaveBeenCalledTimes(1)
    expect([...storage.values.keys()].some((key) => key.startsWith('request:'))).toBe(false)
  })
  it('a claimed task after interruption fails explicitly without reissuing the model call', async () => {
    const { task, storage, state, env } = setup()
    await task.fetch(request('/create', 'user-a', create))
    const record = await storage.get<Record<string, unknown>>('record')
    await storage.put('record', {
      ...record,
      phase: 'claimed',
      task: { ...(record!.task as Task), status: 'running', result: 'saved partial' }
    })
    const recovered = new DurableTask(state, env)
    await recovered.alarm()
    expect((await snapshot(recovered)).task).toMatchObject({
      status: 'failed',
      result: 'saved partial',
      metadata: { errorCode: 'TASK_INTERRUPTED' }
    })
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.finish).toHaveBeenCalledWith(env, expect.objectContaining({ usageUnknown: true }))
  })
  it('cancels queued work without calling a model or charging uncertain usage', async () => {
    const { task, env } = setup()
    await task.fetch(request('/create', 'user-a', create))
    await task.fetch(request('/cancel'))
    await task.alarm()
    expect((await snapshot(task)).task.status).toBe('cancelled')
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.finish).toHaveBeenCalledWith(env, expect.objectContaining({ usageUnknown: false }))
  })
  it('cancels the actual active runtime signal and retains committed partial output', async () => {
    mocks.mode = 'wait'
    const { task } = setup()
    await task.fetch(request('/create', 'user-a', create))
    const execution = task.alarm()
    await vi.waitFor(async () => expect((await snapshot(task)).task.result).toBe('partial '))
    await task.fetch(request('/cancel'))
    await execution
    expect((await snapshot(task)).task.status).toBe('cancelled')
    expect((await events(task)).events.some((e) => e.type === 'complete')).toBe(false)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
  it('keeps a failed provider result terminal rather than reporting completion', async () => {
    mocks.mode = 'fail'
    const { task } = setup()
    await task.fetch(request('/create', 'user-a', create))
    await task.alarm()
    expect((await snapshot(task)).task).toMatchObject({ status: 'failed', result: 'partial ' })
    expect((await events(task)).events.some((e) => e.type === 'complete')).toBe(false)
  })
  it('retries terminal accounting failure but never model execution', async () => {
    const { task } = setup()
    await task.fetch(request('/create', 'user-a', create))
    mocks.finish.mockImplementationOnce(async () => {
      expect((await snapshot(task)).task.status).toBe('completed')
      expect((await events(task)).events.some((event) => event.type === 'complete')).toBe(true)
      throw new Error('temporary ledger outage')
    })
    await expect(task.alarm()).rejects.toThrow('temporary ledger outage')
    expect((await snapshot(task)).task.status).toBe('completed')
    await task.alarm()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.finish).toHaveBeenCalledTimes(2)
  })
  it('does not trust event cursors or duplicate the terminal event on repeated cancel', async () => {
    const { task } = setup()
    await task.fetch(request('/create', 'user-a', create))
    expect((await task.fetch(request('/events?after=1'))).status).toBe(400)
    expect((await task.fetch(request('/events?after=-1'))).status).toBe(400)
    await task.fetch(request('/cancel'))
    const before = await events(task)
    await task.fetch(request('/cancel'))
    expect(await events(task)).toEqual(before)
  })
  it('times out an active provider and never emits a successful completion', async () => {
    mocks.mode = 'wait'
    const { task, storage } = setup()
    await task.fetch(request('/create', 'user-a', create))
    const record = await storage.get<Record<string, unknown>>('record')
    await storage.put('record', { ...record, deadline: Date.now() + 25 })
    await task.alarm()
    expect((await snapshot(task)).task).toMatchObject({
      status: 'failed',
      metadata: { errorCode: 'TASK_TIMEOUT' }
    })
    expect((await events(task)).events.some((e) => e.type === 'complete')).toBe(false)
  })
  it('does not run the provider twice when a second alarm arrives during execution', async () => {
    mocks.mode = 'wait'
    const { task } = setup()
    await task.fetch(request('/create', 'user-a', create))
    const running = task.alarm()
    await vi.waitFor(async () => expect((await snapshot(task)).task.result).toBe('partial '))
    await task.alarm()
    expect((await snapshot(task)).task.status).toBe('running')
    await task.fetch(request('/cancel'))
    await running
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
  it('keeps verified source records and metrics available after recovery', async () => {
    mocks.mode = 'sources'
    const { task, state, env } = setup()
    await task.fetch(request('/create', 'user-a', create))
    await task.alarm()
    const recovered = new DurableTask(state, env)
    expect((await snapshot(recovered)).task.metadata).toMatchObject({
      sources: [{ sourceId: 'S1', excerpt: 'test source' }],
      metrics: {
        modelCalls: 1,
        inputTokens: 10,
        outputTokens: 2,
        tokenSource: 'provider',
        estimatedCost: null,
        costSource: 'unknown'
      }
    })
    expect((await events(recovered)).events.some((e) => e.type === 'sources')).toBe(true)
  })
  it('stops oversized output instead of persisting an unbounded document or silent truncation', async () => {
    mocks.mode = 'oversized'
    const { task } = setup()
    await task.fetch(request('/create', 'user-a', create))
    await task.alarm()
    expect((await snapshot(task)).task).toMatchObject({
      status: 'failed',
      result: 'partial ',
      metadata: { errorCode: 'TASK_OUTPUT_LIMIT' }
    })
  })
  it('compensates a reservation when initial durable storage fails atomically', async () => {
    const { task, storage, env } = setup()
    vi.spyOn(storage, 'put').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(task.fetch(request('/create', 'user-a', create))).rejects.toThrow(
      'disk unavailable'
    )
    expect(storage.values.size).toBe(0)
    expect(storage.alarmAt).toBe(null)
    expect(mocks.finish).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ status: 'failed', usageUnknown: false })
    )
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('preserves all 48k Chinese evidence characters across paged storage, snapshots and replay', async () => {
    mocks.mode = 'large-sources'
    mocks.sources = Array.from({ length: 24 }, (_, index) => ({
      sourceId: `S${index}`,
      fileId: 'f1',
      fileName: '中文来源资料.txt',
      fileHash: 'hash',
      excerpt: '证'.repeat(2000),
      startLine: index + 1,
      endLine: index + 1,
      startOffset: index * 2000,
      endOffset: (index + 1) * 2000
    }))
    const { task, state, env, storage } = setup()
    const input = {
      ...create,
      request: { messages: [{ role: 'user', content: '问'.repeat(2000) }] }
    }
    await task.fetch(request('/create', 'user-a', input))
    await task.alarm()
    const recovered = new DurableTask(state, env)
    const restored = (await snapshot(recovered)).task
    expect(restored.status).toBe('completed')
    expect(restored.metadata?.sources).toEqual(mocks.sources)
    expect(restored.result).toBe('partial ' + '答'.repeat(23980) + 'answer')
    const replay = await events(recovered)
    const sourceEvents = replay.events.filter((event) => event.type === 'sources')
    expect(sourceEvents.length).toBeGreaterThan(1)
    expect(
      sourceEvents.flatMap((event) => (event.data as unknown as { sources: unknown[] }).sources)
    ).toEqual(mocks.sources)
    for (const event of sourceEvents)
      expect(new TextEncoder().encode(JSON.stringify(event)).byteLength).toBeLessThanOrEqual(
        60 * 1024
      )
    for (const value of storage.values.values())
      expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBeLessThan(128 * 1024)
    const stored = await storage.get<{ task: Task }>('record')
    expect(stored?.task.metadata?.sources).toBeUndefined()
    const replayedCreate = (await (
      await recovered.fetch(request('/create', 'user-a', input))
    ).json()) as { task: Task }
    expect(replayedCreate.task.metadata?.sources).toEqual(mocks.sources)
    await recovered.fetch(request('/cancel'))
    expect((await snapshot(recovered)).task).toEqual(restored)
    expect(mocks.finish).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
  it('enforces UTF-8 serialized size even for escape-heavy output within the character cap', async () => {
    mocks.mode = 'escaped'
    const { task, storage } = setup()
    await task.fetch(request('/create', 'user-a', create))
    await task.alarm()
    expect((await snapshot(task)).task).toMatchObject({
      status: 'failed',
      result: 'partial ',
      metadata: { errorCode: 'TASK_STORAGE_VALUE_LIMIT' }
    })
    for (const value of storage.values.values())
      expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBeLessThan(128 * 1024)
  })
  it('persists a configured multicall cost estimate without claiming it is a provider bill', async () => {
    mocks.mode = 'priced-second-call'
    const { task, env, state } = setup()
    env.MODEL_PRICES_JSON = JSON.stringify({
      'mock-model': { inputPerMillion: 1, outputPerMillion: 2, currency: 'CNY' },
      'second-model': { inputPerMillion: 3, outputPerMillion: 4, currency: 'CNY' }
    })
    await task.fetch(request('/create', 'user-a', create))
    await task.alarm()
    const metrics = (await snapshot(new DurableTask(state, env))).task.metadata?.metrics
    expect(metrics).toMatchObject({
      modelCalls: 2,
      inputTokens: 30,
      outputTokens: 5,
      tokenSource: 'estimated',
      currency: 'CNY',
      costSource: 'estimated'
    })
    expect(metrics?.estimatedCost).toBeCloseTo(0.000086, 10)
  })
  it('does not publish a partial cost when one of multiple model rates is unavailable', async () => {
    mocks.mode = 'priced-second-call'
    const { task, env } = setup()
    env.MODEL_PRICES_JSON = JSON.stringify({
      'mock-model': { inputPerMillion: 1, outputPerMillion: 2, currency: 'CNY' }
    })
    await task.fetch(request('/create', 'user-a', create))
    await task.alarm()
    expect((await snapshot(task)).task.metadata?.metrics).toMatchObject({
      estimatedCost: null,
      currency: null,
      costSource: 'unknown'
    })
  })
  it('normalizes low administrative budgets consistently for reservation and execution', async () => {
    mocks.mode = 'priced-second-call'
    const { task, env, storage } = setup()
    env.TASK_TOKEN_BUDGET = '8000'
    env.MAX_MODEL_CALLS = '2'
    expect((await task.fetch(request('/create', 'user-a', create))).status).toBe(202)
    expect(mocks.reserve).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ reservedTokens: 8000, maxCalls: 2 })
    )
    await task.alarm()
    expect((await snapshot(task)).task.status).toBe('completed')
    expect(mocks.begin).toHaveBeenCalledTimes(2)
    expect(await storage.get('record')).toMatchObject({
      budget: { reservedTokens: 8000, maxCalls: 2 }
    })
    expect(resolveTaskBudget({ TASK_TOKEN_BUDGET: '999999999', MAX_MODEL_CALLS: '999' })).toEqual(
      TASK_BUDGET
    )
    expect(resolveTaskBudget({ TASK_TOKEN_BUDGET: '-1', MAX_MODEL_CALLS: 'bad' })).toEqual(
      TASK_BUDGET
    )
  })
  it('stops a second call at the same low call budget used by reservation', async () => {
    mocks.mode = 'priced-second-call'
    const { task, env } = setup()
    env.TASK_TOKEN_BUDGET = '8000'
    env.MAX_MODEL_CALLS = '1'
    await task.fetch(request('/create', 'user-a', create))
    await task.alarm()
    expect(mocks.begin).toHaveBeenCalledTimes(1)
    expect((await snapshot(task)).task).toMatchObject({
      status: 'failed',
      metadata: { errorCode: 'BUDGET_EXCEEDED' }
    })
  })
  it('binds the first effective file version while same-client concurrent creation and replay stay idempotent', async () => {
    const { task, env, storage } = setup()
    const first = {
      ...create,
      requestHash: 'server-content-hash-v1',
      clientRequestHash: 'same-client-body'
    }
    const changedFile = { ...first, requestHash: 'server-content-hash-v2' }
    const results = await Promise.all([
      task.fetch(request('/create', 'user-a', first)),
      task.fetch(request('/create', 'user-a', changedFile))
    ])
    expect(results.map((response) => response.status)).toEqual([202, 202])
    expect(mocks.reserve).toHaveBeenCalledTimes(1)
    expect(mocks.reserve).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ requestHash: 'server-content-hash-v1' })
    )
    expect(await storage.get('record')).toMatchObject({
      requestHash: 'server-content-hash-v1',
      clientRequestHash: 'same-client-body'
    })
    await task.alarm()
    expect(
      (await task.fetch(request('/replay', 'user-a', { clientRequestHash: 'same-client-body' })))
        .status
    ).toBe(202)
    expect(
      (await task.fetch(request('/replay', 'user-a', { clientRequestHash: 'changed-client-body' })))
        .status
    ).toBe(409)
    expect(
      (await task.fetch(request('/replay', 'user-b', { clientRequestHash: 'same-client-body' })))
        .status
    ).toBe(404)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
})
