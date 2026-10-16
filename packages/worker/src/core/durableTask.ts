import type { Env } from '../types'
import { WorkerError } from '../types'
import { finishTask, reserveTask, updateTaskSummary } from '../platform/accounts'
import { TaskManager } from './taskManager'
import { TaskRepository } from './tasks/taskRepository'
import { taskEventStream } from './tasks/taskEventStream'
import { TaskUsageTracker } from './tasks/taskUsage'
import { executeAndPersistTask } from './tasks/taskExecution'
import {
  compactTask,
  initialMetrics,
  resolveTaskBudget,
  taskJSON as json,
  taskSummary,
  type CreateDurableTask,
  type TaskRecord
} from './tasks/taskRecord'

export { resolveTaskBudget, TASK_BUDGET } from './tasks/taskRecord'
export type { CreateDurableTask, DurableTaskEvent, TaskBudget } from './tasks/taskRecord'

/** 每个任务一个 DO；浏览器只观察，创建、alarm 执行和取消各有明确入口。 */
export class DurableTask implements DurableObject {
  private activeRun = false
  private controller?: AbortController
  private createQueue: Promise<unknown> = Promise.resolve()
  private readonly repository: TaskRepository

  constructor(
    state: DurableObjectState,
    private readonly env: Env
  ) {
    this.repository = new TaskRepository(state.storage)
  }

  get hasActiveStreams(): boolean {
    return this.repository.hasSubscribers
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return await this.handleFetch(request)
    } catch (error) {
      if (error instanceof WorkerError)
        return json({ error: error.message, code: error.code }, error.statusCode)
      throw error
    }
  }

  private async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const ownerId = request.headers.get('X-Task-Owner')
    if (!ownerId) return json({ error: 'Not found' }, 404)
    if (url.pathname === '/replay' && request.method === 'POST') {
      const input = await request.json<{ clientRequestHash?: string }>()
      if (typeof input.clientRequestHash !== 'string' || !input.clientRequestHash)
        return json({ error: 'Invalid replay hash' }, 400)
      return this.createQueue.then(async () => {
        const record = await this.repository.read()
        if (!record || record.ownerId !== ownerId) return json({ error: 'Not found' }, 404)
        if (!this.matchesRequest(record, input.clientRequestHash!))
          return json({ error: 'Idempotency key already used for another request' }, 409)
        return this.snapshot(202, true)
      })
    }
    if (url.pathname === '/create' && request.method === 'POST') {
      const input = await request.json<CreateDurableTask>()
      if (input.ownerId !== ownerId) return json({ error: 'Not found' }, 404)
      const operation = this.createQueue.then(() => this.create(input))
      this.createQueue = operation.catch(() => undefined)
      return operation
    }
    const record = await this.repository.read()
    if (!record || record.ownerId !== ownerId) return json({ error: 'Not found' }, 404)
    if (url.pathname === '/cancel' && request.method === 'POST') {
      this.controller?.abort(new Error('TASK_CANCELLED'))
      await this.repository.terminate(
        'cancelled',
        'TASK_CANCELLED',
        '任务已取消；已发生的模型消耗可能仍计费。'
      )
      await this.settle()
      return this.snapshot()
    }
    if (url.pathname === '/events' && request.method === 'GET') {
      const after = Number(url.searchParams.get('after') || 0)
      if (!Number.isSafeInteger(after) || after < 0 || after > record.lastEventId)
        return json({ error: 'Invalid event cursor' }, 400)
      if (request.headers.get('Accept')?.includes('text/event-stream')) {
        return taskEventStream(this.repository, after, request.signal)
      }
      return json(await this.repository.events(record, after))
    }
    if (url.pathname === '/' && request.method === 'GET') return this.snapshot()
    return json({ error: 'Not found' }, 404)
  }

  private matchesRequest(record: TaskRecord, clientHash: string): boolean {
    return (record.clientRequestHash ?? record.requestHash) === clientHash
  }

  private async snapshot(status = 200, replayed?: boolean): Promise<Response> {
    const snapshot = await this.repository.snapshot()
    return snapshot
      ? json({ ...snapshot, ...(replayed !== undefined ? { replayed } : {}) }, status)
      : json({ error: 'Not found' }, 404)
  }

  private async create(input: CreateDurableTask): Promise<Response> {
    const previous = await this.repository.read()
    if (previous) {
      if (previous.ownerId !== input.ownerId) return json({ error: 'Not found' }, 404)
      if (!this.matchesRequest(previous, input.clientRequestHash ?? input.requestHash)) {
        return json({ error: 'Idempotency key already used for another request' }, 409)
      }
      return this.snapshot(202, true)
    }
    const budget = resolveTaskBudget(this.env)
    const reservation = await reserveTask(this.env, {
      userId: input.ownerId,
      taskId: input.taskId,
      requestHash: input.requestHash,
      ...budget
    })
    const task = compactTask(new TaskManager(this.env).createTask(input.request, input.taskId))
    task.metadata = { ...task.metadata, metrics: initialMetrics() }
    const record: TaskRecord = {
      ownerId: input.ownerId,
      requestHash: input.requestHash,
      clientRequestHash: input.clientRequestHash ?? input.requestHash,
      budget,
      task,
      phase: 'queued',
      lastEventId: 0,
      requestChunks: 0,
      sourcePages: 0,
      reservationId: reservation.reservationId,
      deadline: Date.now() + budget.maxDurationMs,
      settled: false,
      usageUnknown: false
    }
    try {
      await this.repository.create(record, input.request)
    } catch (error) {
      await finishTask(this.env, {
        userId: input.ownerId,
        taskId: task.id,
        status: 'failed',
        usageUnknown: false
      })
      throw error
    }
    // 调度成功后的索引失败不能撤销或重新执行一个可能付费的任务。
    await updateTaskSummary(this.env, input.ownerId, taskSummary(task))
    return json({ task, lastEventId: 0, replayed: false }, 202)
  }

  async alarm(): Promise<void> {
    if (this.activeRun) return
    this.activeRun = true
    try {
      const record = await this.repository.read()
      if (!record) return
      if (record.phase === 'terminal') {
        await this.settle()
        return
      }
      if (record.phase === 'claimed') {
        await this.repository.terminate(
          'failed',
          'TASK_INTERRUPTED',
          '后台执行中断，已保留收到的内容。为避免重复计费，未自动重新调用模型。',
          true
        )
        await this.settle()
        return
      }
      if (record.deadline <= Date.now()) {
        await this.repository.terminate(
          'failed',
          'TASK_TIMEOUT',
          '任务等待超时，请手动发起新任务。'
        )
        await this.settle()
        return
      }
      const claimed = await this.repository.claim()
      if (!claimed) {
        await this.settle()
        return
      }
      await this.execute(claimed)
      await this.settle()
    } finally {
      this.activeRun = false
    }
  }

  private async execute(record: TaskRecord): Promise<void> {
    const controller = new AbortController()
    this.controller = controller
    const shutdown = this.env.RUNTIME_SHUTDOWN_SIGNAL
    const interrupted = () => controller.abort(new Error('TASK_INTERRUPTED'))
    shutdown?.addEventListener('abort', interrupted, { once: true })
    if (shutdown?.aborted) interrupted()
    const usage = new TaskUsageTracker(this.env, record, (metrics) =>
      this.repository.saveMetrics(metrics)
    )
    const timeout = setTimeout(
      () => controller.abort(new Error('TASK_TIMEOUT')),
      Math.max(1, record.deadline - Date.now())
    )
    try {
      const body = await this.repository.readRequest(record)
      await executeAndPersistTask(this.env, record, body, this.repository, usage, controller.signal)
    } catch (error) {
      const limits = [
        'TASK_OUTPUT_LIMIT',
        'TASK_SOURCE_LIMIT',
        'TASK_EVENT_LIMIT',
        'TASK_STORAGE_VALUE_LIMIT',
        'TASK_SOURCE_VALUE_LIMIT'
      ]
      const failureCode =
        error instanceof Error && limits.includes(error.message)
          ? error.message
          : 'TASK_EXECUTION_FAILED'
      const code = controller.signal.aborted
        ? String(controller.signal.reason).replace(/^Error: /, '')
        : failureCode
      await this.repository.terminate(
        code === 'TASK_CANCELLED' ? 'cancelled' : 'failed',
        code,
        code === 'TASK_TIMEOUT'
          ? '任务超时，已停止本地请求；已发生的上游费用不会自动退回。'
          : code === 'TASK_INTERRUPTED'
            ? '服务正在重启，已保留收到的内容。为避免重复计费，未自动重新调用模型。'
            : '任务执行失败，已保存收到的内容，可确认后发起新任务。',
        usage.metrics.modelCalls > 0
      )
    } finally {
      clearTimeout(timeout)
      shutdown?.removeEventListener('abort', interrupted)
      this.controller = undefined
    }
  }

  private async settle(): Promise<void> {
    const record = await this.repository.read()
    if (!record || record.phase !== 'terminal' || record.settled) return
    await finishTask(this.env, {
      userId: record.ownerId,
      taskId: record.task.id,
      status: record.task.status,
      usageUnknown: record.usageUnknown
    })
    await updateTaskSummary(this.env, record.ownerId, taskSummary(record.task))
    await this.repository.markSettled()
  }
}
