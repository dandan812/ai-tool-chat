import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { expect, it, vi } from 'vitest'
import type { Env, SkillStreamChunk } from '../types'
import { createMockEnv } from '../test/mocks'

vi.mock('../platform/accounts', () => ({
  reserveTask: async () => ({ reservationId: 'offline-task' }),
  beginModelCall: async () => undefined,
  settleModelCall: async () => undefined,
  finishTask: async () => undefined,
  updateTaskSummary: async () => undefined
}))
vi.mock('../infrastructure/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('../skills', () => ({
  selectSkill: () => ({
    model: 'offline',
    label: 'Offline',
    description: 'No network',
    toolingMode: 'disabled',
    skill: {
      name: 'offline',
      async *execute(): AsyncIterable<SkillStreamChunk> {
        for (let index = 0; index < 1024; index++) {
          yield { type: 'content', content: '0123456789abcdef' }
        }
        yield { type: 'complete' }
      }
    }
  })
}))
import { DurableTask } from './durableTask'

class MeasuredStorage {
  values = new Map<string, unknown>()
  reads = 0
  writes = 0
  writeBytes = 0
  async get<T>(key: string): Promise<T | undefined> {
    this.reads++
    return structuredClone(this.values.get(key)) as T | undefined
  }
  async put(key: string, value: unknown) {
    this.writes++
    this.writeBytes += Buffer.byteLength(JSON.stringify(value))
    this.values.set(key, structuredClone(value))
  }
  async delete(key: string) {
    return this.values.delete(key)
  }
  async setAlarm(_time: number) {}
  async deleteAlarm() {}
  async transaction<T>(work: (tx: MeasuredStorage) => Promise<T>): Promise<T> {
    return work(this)
  }
  async list<T>(options: { start: string; end: string; limit: number }) {
    return new Map(
      [...this.values.entries()]
        .filter(([key]) => key >= options.start && key < options.end)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, options.limit)
        .map(([key, value]) => [key, structuredClone(value) as T])
    )
  }
}

async function runFixture() {
  const storage = new MeasuredStorage()
  const task = new DurableTask({ storage } as unknown as DurableObjectState, createMockEnv() as Env)
  const request = (path: string, body?: unknown) =>
    new Request('https://task' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Task-Owner': 'offline-user' },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
  await task.fetch(
    request('/create', {
      ownerId: 'offline-user',
      taskId: 'offline-task',
      requestHash: 'fixed',
      request: { messages: [{ role: 'user', content: 'offline benchmark' }] }
    })
  )
  const started = performance.now()
  await task.alarm()
  const elapsedMs = performance.now() - started
  const response = await task.fetch(request('/events?after=0'))
  const replay = (await response.json()) as {
    events: Array<{ id: number; type: string; data: { content?: string } }>
    lastEventId: number
    terminal: boolean
  }
  expect(replay.terminal).toBe(true)
  expect(
    replay.events
      .filter((event) => event.type === 'content')
      .map((event) => event.data.content)
      .join('')
  ).toBe('0123456789abcdef'.repeat(1024))
  const snapshot = (await (await task.fetch(request('/'))).json()) as {
    task: { status: string; result: string }
  }
  expect(snapshot.task.status).toBe('completed')
  expect(snapshot.task.result.length).toBe(16384)
  return {
    elapsedMs,
    reads: storage.reads,
    writes: storage.writes,
    writeBytes: storage.writeBytes,
    eventCount: replay.events.length,
    replayBytes: Buffer.byteLength(JSON.stringify(replay))
  }
}

const benchmark = process.env.PLATFORM_BENCHMARK_REPORT ? it : it.skip
benchmark(
  'measures fixed durable execution and replay without network',
  async () => {
    for (let index = 0; index < 10; index++) await runFixture()
    const samples = []
    for (let index = 0; index < 50; index++) samples.push(await runFixture())
    const times = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b)
    const { elapsedMs: _elapsed, ...counts } = samples[0]
    const report = {
      measuredAt: new Date().toISOString(),
      runtime: process.version,
      realModelCalls: 0,
      scope:
        'DurableTask + synthetic Skill + in-memory storage + JSON replay; excludes Cloudflare/network/model latency',
      warmups: 10,
      samples: 50,
      medianMs: times[25],
      p95Ms: times[47],
      ...counts
    }
    writeFileSync(process.env.PLATFORM_BENCHMARK_REPORT!, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  },
  30000
)
