import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'
import type { ChatRequest, SkillStreamChunk } from '../types'
import { createMockEnv } from '../test/mocks'

const fixture = vi.hoisted(() => ({ chunks: 64, progress: false, nextId: 0 }))
vi.mock('../utils/id', () => ({
  now: () => 1000,
  generateId: () => `id-${String(++fixture.nextId).padStart(8, '0')}`
}))
vi.mock('../infrastructure/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('../skills', () => ({
  selectSkill: () => ({
    model: 'offline-model',
    label: 'Offline execution',
    description: 'Deterministic fixture; no network',
    toolingMode: 'disabled',
    skill: {
      name: 'offline-skill',
      async *execute(): AsyncIterable<SkillStreamChunk> {
        if (fixture.progress) {
          yield {
            type: 'progress',
            progress: { message: 'Retrieving evidence', current: 0, total: 2 }
          }
          yield {
            type: 'progress',
            progress: { message: 'Generating answer', current: 1, total: 2 }
          }
        }
        for (let index = 0; index < fixture.chunks; index++) {
          yield { type: 'content', content: '0123456789abcdef' }
        }
        yield { type: 'complete' }
      }
    }
  })
}))

import { TaskManager } from './taskManager'

const cases = [
  { name: 'short-chat', chunks: 64, progress: false },
  { name: 'long-chat', chunks: 1024, progress: false },
  { name: 'file-progress', chunks: 256, progress: true }
]

async function execute() {
  fixture.nextId = 0
  const manager = new TaskManager(createMockEnv())
  const request: ChatRequest = { messages: [{ role: 'user', content: 'offline benchmark' }] }
  const task = manager.createTask(request)
  let events = 0
  let progressEvents = 0
  let eventBytes = 0
  let content = ''
  const startedAt = performance.now()
  for await (const event of manager.executeTask(task.id, request)) {
    events++
    // Measure raw runner events, not the compacted DurableTask HTTP payload.
    eventBytes += Buffer.byteLength(JSON.stringify(event))
    if (event.type === 'content') content += (event.data as { content: string }).content
    if (event.type === 'step' && (event.data as { event: string }).event === 'progress')
      progressEvents++
  }
  const elapsedMs = performance.now() - startedAt
  expect(content).toBe('0123456789abcdef'.repeat(fixture.chunks))
  expect(task.result).toBe(content)
  expect(task.status).toBe('completed')
  return { elapsedMs, events, progressEvents, eventBytes, steps: task.steps.length }
}

describe('offline task execution benchmark', () => {
  const benchmark = process.env.TASK_BENCHMARK_REPORT ? it : it.skip

  benchmark(
    'records repeatable workloads without asserting noisy timing thresholds',
    async () => {
      const results = []
      for (const workload of cases) {
        Object.assign(fixture, workload)
        for (let warmup = 0; warmup < 20; warmup++) await execute()
        const samples = []
        for (let sample = 0; sample < 100; sample++) samples.push(await execute())
        const timings = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b)
        const { elapsedMs: _elapsedMs, ...counts } = samples[0]
        results.push({
          ...workload,
          samples: samples.length,
          warmups: 20,
          medianMs: timings[50],
          p95Ms: timings[94],
          ...counts
        })
      }
      const report = {
        measuredAt: new Date().toISOString(),
        runtime: process.version,
        realModelCalls: 0,
        scope:
          'TaskManager + synthetic Skill + raw event serialization; excludes DO, HTTP and model latency',
        results
      }
      writeFileSync(process.env.TASK_BENCHMARK_REPORT!, JSON.stringify(report, null, 2))
      console.log(JSON.stringify(report))
    },
    30000
  )
})
