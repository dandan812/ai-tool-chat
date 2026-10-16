import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatRequest, SkillStreamChunk } from '../types'
import { WorkerError } from '../types'
import { createMockEnv } from '../test/mocks'

const mocks = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn() }))
vi.mock('../skills', () => ({ selectSkill: mocks.select }))
vi.mock('../infrastructure/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
import { TaskManager } from './taskManager'
import type { TaskStreamEvent } from './taskManagerTypes'
import { executeChatCompletionStream } from '../providers/chatCompletionStream'

const request: ChatRequest = { messages: [{ role: 'user', content: 'Explain the document' }] }
const source = {
  sourceId: 'source-1',
  fileId: 'file-1',
  fileHash: 'hash-1',
  fileName: 'notes.txt',
  excerpt: 'Original evidence',
  startLine: 1,
  endLine: 1,
  startOffset: 0,
  endOffset: 17
}

async function* stream(chunks: SkillStreamChunk[]) {
  for (const chunk of chunks) yield chunk
}

function setup(chunks: SkillStreamChunk[], env = createMockEnv()) {
  mocks.execute.mockImplementation(() => stream(chunks))
  const manager = new TaskManager(env)
  const task = manager.createTask(request)
  return { manager, task }
}

async function collect(manager: TaskManager, taskId: string) {
  const events: TaskStreamEvent[] = []
  for await (const event of manager.executeTask(taskId, request)) {
    // Stream consumers see the state at emission, not later mutations to the same Step.
    events.push(structuredClone(event))
  }
  return events
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.select.mockImplementation(() => ({
    skill: { name: 'test-skill', type: 'text', execute: mocks.execute },
    model: 'test-model',
    label: 'Answer question',
    description: 'Generating the answer',
    toolingMode: 'disabled'
  }))
})

describe('task execution contract', () => {
  it('records routing and execution without pretending to run a planner or a second generation', async () => {
    const { manager, task } = setup([{ type: 'content', content: 'answer' }, { type: 'complete' }])
    const events = await collect(manager, task.id)
    expect(task.steps.map((step) => step.type)).toEqual(['route', 'skill'])
    expect(task.steps.every((step) => step.status === 'completed')).toBe(true)
    expect(events.filter((event) => event.type === 'complete')).toHaveLength(1)
    expect(mocks.select).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('forwards progress on the same running step and preserves content order', async () => {
    const progress = [
      { message: 'Retrieving evidence', current: 0, total: 2 },
      { message: 'Generating an answer', current: 1, total: 2 }
    ]
    const { manager, task } = setup([
      { type: 'progress', progress: progress[0] },
      { type: 'content', content: 'first ' },
      { type: 'progress', progress: progress[1] },
      { type: 'content', content: 'second' },
      { type: 'complete' }
    ])
    const events = await collect(manager, task.id)
    const updates = events.filter(
      (event) => event.type === 'step' && (event.data as { event: string }).event === 'progress'
    )
    expect(
      updates.map((event) => (event.data as { step: { description: string } }).step.description)
    ).toEqual(progress.map((item) => item.message))
    expect(updates.map((event) => (event.data as { step: { id: string } }).step.id)).toEqual([
      task.steps[1].id,
      task.steps[1].id
    ])
    expect(task.result).toBe('first second')
  })

  it('stores answer content once rather than copying it into every step output', async () => {
    const { manager, task } = setup([
      { type: 'content', content: 'unique answer body' },
      { type: 'complete' }
    ])
    await collect(manager, task.id)
    expect(task.result).toBe('unique answer body')
    expect(JSON.stringify(task.steps)).not.toContain('unique answer body')
  })

  it('retains sources and consumes usage emitted after the skill completion marker', async () => {
    const usage = {
      callId: 'call-1',
      model: 'test-model',
      tokenSource: 'provider' as const,
      outcome: 'completed' as const,
      inputTokens: 10,
      outputTokens: 2
    }
    const { manager, task } = setup([
      { type: 'sources', sources: [source] },
      { type: 'content', content: 'answer' },
      { type: 'complete' },
      { type: 'usage', usage }
    ])
    const events = await collect(manager, task.id)
    expect(task.metadata?.sources).toEqual([source])
    expect(events.find((event) => event.type === 'usage')?.data).toEqual({ usage })
    expect(events.at(-1)?.type).toBe('complete')
  })

  it('preserves a budget error code and marks the running step as ended', async () => {
    const { manager, task } = setup([])
    mocks.execute.mockImplementation(async function* () {
      yield { type: 'content', content: 'partial' }
      throw new WorkerError('Budget exhausted', 'BUDGET_LIMIT', 429)
    })
    const events = await collect(manager, task.id)
    const failedStep = task.steps.find((step) => step.status === 'failed')
    expect(task.status).toBe('failed')
    expect(failedStep?.completedAt).toEqual(expect.any(Number))
    expect(events.at(-1)?.data).toMatchObject({ code: 'BUDGET_LIMIT' })
    expect(events.some((event) => event.type === 'complete')).toBe(false)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('records a failed routing step without starting a skill', async () => {
    const { manager, task } = setup([])
    mocks.select.mockImplementation(() => {
      throw new WorkerError('Unsupported request', 'INVALID_ROUTE')
    })
    const events = await collect(manager, task.id)
    expect(task.steps).toHaveLength(1)
    expect(task.steps[0]).toMatchObject({
      type: 'route',
      status: 'failed',
      completedAt: expect.any(Number)
    })
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(events.at(-1)?.data).toMatchObject({ code: 'INVALID_ROUTE' })
  })

  it('does not mistake an incomplete skill stream for a completed answer', async () => {
    const { manager, task } = setup([{ type: 'content', content: 'partial' }])
    const events = await collect(manager, task.id)
    expect(task.status).toBe('failed')
    expect(events.at(-1)?.data).toMatchObject({ code: 'SKILL_INCOMPLETE' })
    expect(events.some((event) => event.type === 'complete')).toBe(false)
  })

  it('does not append undefined when a content event is malformed', async () => {
    const { manager, task } = setup([{ type: 'content' }, { type: 'complete' }])
    const events = await collect(manager, task.id)
    expect(task.status).toBe('failed')
    expect(events.at(-1)?.data).toMatchObject({ code: 'SKILL_INVALID_CONTENT' })
    expect(events.some((event) => event.type === 'content')).toBe(false)
  })

  it('propagates an explicit skill error and does not execute it again', async () => {
    const { manager, task } = setup([{ type: 'error', error: 'Provider failed' }])
    const events = await collect(manager, task.id)
    expect(task.status).toBe('failed')
    expect(events.at(-1)?.data).toMatchObject({ error: expect.stringContaining('Provider failed') })
    await collect(manager, task.id)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('checks cancellation after the stream ends and leaves no running step', async () => {
    const controller = new AbortController()
    const env = createMockEnv({
      RUNTIME_CONTROL: { signal: controller.signal, beforeCall: vi.fn(), afterCall: vi.fn() }
    })
    const { manager, task } = setup([], env)
    mocks.execute.mockImplementation(async function* () {
      yield { type: 'complete' }
      controller.abort(new Error('TASK_CANCELLED'))
    })
    const events = await collect(manager, task.id)
    expect(task.status).toBe('failed')
    expect(task.steps.some((step) => step.status === 'running')).toBe(false)
    expect(events.some((event) => event.type === 'complete')).toBe(false)
  })

  it('does not call a skill if cancellation occurs after routing', async () => {
    const controller = new AbortController()
    const { manager, task } = setup(
      [],
      createMockEnv({
        RUNTIME_CONTROL: { signal: controller.signal, beforeCall: vi.fn(), afterCall: vi.fn() }
      })
    )
    const events: TaskStreamEvent[] = []
    for await (const event of manager.executeTask(task.id, request)) {
      events.push(structuredClone(event))
      if (event.type === 'step' && (event.data as { event: string }).event === 'complete') {
        controller.abort(new Error('TASK_CANCELLED'))
      }
    }
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(events.some((event) => event.type === 'complete')).toBe(false)
    const failed = task.steps.find((step) => step.status === 'failed')!
    expect(Number.isFinite(failed.completedAt)).toBe(true)
    expect(failed.completedAt!).toBeGreaterThanOrEqual(failed.startedAt!)
  })

  it.each(['success', 'settlement-failure', 'cancel-during-settlement'] as const)(
    'consumes the real offline provider tail before reporting task success: %s',
    async (outcome) => {
      const order: string[] = []
      const controller = new AbortController()
      const afterCall = vi.fn(async () => {
        order.push('settlement')
        if (outcome === 'settlement-failure')
          throw new WorkerError('Settlement unavailable', 'SETTLEMENT_FAILED')
        if (outcome === 'cancel-during-settlement') controller.abort(new Error('TASK_CANCELLED'))
      })
      const runtime = { signal: controller.signal, beforeCall: vi.fn(), afterCall }
      const { manager, task } = setup([], createMockEnv({ RUNTIME_CONTROL: runtime }))
      mocks.execute.mockImplementation(async function* () {
        const providerStream = executeChatCompletionStream({
          provider: 'bailian',
          model: 'offline-model',
          url: 'https://mock.invalid',
          apiKey: 'local-test-only',
          body: { messages: request.messages },
          mock: true,
          runtime
        })
        for await (const chunk of providerStream) {
          if (chunk.type === 'complete') order.push('provider-complete')
          if (chunk.type === 'usage') order.push('usage')
          yield chunk
        }
      })
      const events = await collect(manager, task.id)
      expect(afterCall).toHaveBeenCalledTimes(1)
      expect(order.slice(0, 2)).toEqual(['provider-complete', 'settlement'])
      if (outcome === 'success') {
        expect(order).toEqual(['provider-complete', 'settlement', 'usage'])
        expect(events.at(-1)?.type).toBe('complete')
        expect(task.status).toBe('completed')
      } else {
        expect(events.some((event) => event.type === 'complete')).toBe(false)
        expect(task.status).toBe('failed')
        expect(task.steps.some((step) => step.status === 'running')).toBe(false)
      }
    }
  )
})
