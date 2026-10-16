import type { ChatRequest, Env, Task, TaskMetrics } from '../../types'
import type { TaskStreamEvent } from '../taskManagerTypes'
import { TASK_TIMEOUT_MS } from '../taskTimeout'

export const RECORD_KEY = 'record'
export const MAX_OUTPUT_CHARS = 24000
// Each nonempty content delta consumes at least one of the bounded output characters.
export const MAX_EVENTS = MAX_OUTPUT_CHARS + 512
export const REQUEST_CHUNK_CHARS = 12000
export const MAX_STORAGE_VALUE_BYTES = 120 * 1024
export const MAX_SOURCE_EVENT_BYTES = 60 * 1024
export const TASK_BUDGET = { maxCalls: 3, reservedTokens: 16000, maxDurationMs: TASK_TIMEOUT_MS }
export type TaskBudget = typeof TASK_BUDGET

export interface DurableTaskEvent extends TaskStreamEvent {
  id: number
}
export interface TaskRecord {
  ownerId: string
  requestHash: string
  clientRequestHash?: string
  budget?: TaskBudget
  task: Task
  phase: 'queued' | 'claimed' | 'terminal'
  lastEventId: number
  requestChunks: number
  sourcePages: number
  reservationId: string
  deadline: number
  settled: boolean
  usageUnknown: boolean
}
export interface CreateDurableTask {
  ownerId: string
  taskId: string
  requestHash: string
  clientRequestHash?: string
  request: ChatRequest
}

/** 管理员可以降低单任务预算，不能超过平台上限。 */
export function resolveTaskBudget(
  env: Pick<Env, 'TASK_TOKEN_BUDGET' | 'MAX_MODEL_CALLS'>
): TaskBudget {
  const limit = (value: string | undefined, ceiling: number) => {
    const number = Number(value)
    return Number.isSafeInteger(number) && number > 0 ? Math.min(number, ceiling) : ceiling
  }
  return {
    reservedTokens: limit(env.TASK_TOKEN_BUDGET, TASK_BUDGET.reservedTokens),
    maxCalls: limit(env.MAX_MODEL_CALLS, TASK_BUDGET.maxCalls),
    maxDurationMs: TASK_BUDGET.maxDurationMs
  }
}

export function initialMetrics(): TaskMetrics {
  return {
    elapsedMs: 0,
    firstContentMs: null,
    modelCalls: 0,
    inputTokens: null,
    outputTokens: null,
    tokenSource: 'unknown',
    estimatedCost: null,
    currency: null,
    costSource: 'unknown'
  }
}

/** 记录只保存一份答案，引用单独分页存储；兼容已有记录格式。 */
export function compactTask(task: Task): Task {
  const result = structuredClone(task)
  if (result.metadata) delete result.metadata.sources
  result.userMessage = result.userMessage.slice(0, 2000)
  result.steps = result.steps.map((step) => {
    const copy = { ...step }
    if (copy.error) copy.error = copy.error.slice(0, 2000)
    delete copy.input
    if (copy.output && typeof copy.output === 'object') {
      const output = { ...(copy.output as Record<string, unknown>) }
      delete output.content
      delete output.result
      copy.output = output
    }
    return copy
  })
  return result
}

export function taskSummary(task: Task): Task {
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    userMessage: task.userMessage.slice(0, 240),
    steps: [],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.error ? { error: task.error.slice(0, 240) } : {}),
    metadata: {
      model: task.metadata?.model,
      metrics: task.metadata?.metrics,
      errorCode: task.metadata?.errorCode
    }
  }
}

export function taskJSON(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}
