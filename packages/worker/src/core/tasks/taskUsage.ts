import type { Env, ModelRuntimeControl, ModelUsage, TaskMetrics } from '../../types'
import { WorkerError } from '../../types'
import { beginModelCall, settleModelCall } from '../../platform/accounts'
import { estimateTaskCost, unknownTaskCost } from '../taskCost'
import { initialMetrics, TASK_BUDGET, type TaskRecord } from './taskRecord'

/** 执行期间的调用预算和用量；账户账本才是额度的持久化权威。 */
export class TaskUsageTracker {
  readonly metrics: TaskMetrics
  private readonly completedCalls = new Map<string, ModelUsage>()
  private readonly reservations = new Map<string, { tokens: number; settledTokens?: number }>()

  constructor(
    private readonly env: Env,
    private readonly record: TaskRecord,
    private readonly persist: (metrics: TaskMetrics) => Promise<void>
  ) {
    this.metrics = structuredClone(record.task.metadata?.metrics ?? initialMetrics())
  }

  control(signal: AbortSignal): ModelRuntimeControl {
    return {
      signal,
      beforeCall: (input) => this.beforeCall(input, signal),
      afterCall: (input) => this.afterCall(input)
    }
  }

  private async beforeCall(
    input: Parameters<ModelRuntimeControl['beforeCall']>[0],
    signal: AbortSignal
  ) {
    signal.throwIfAborted()
    const budget = this.record.budget ?? TASK_BUDGET
    const tokens = input.estimatedInputTokens + input.maxOutputTokens
    const committed = [...this.reservations.values()].reduce(
      (total, call) => total + (call.settledTokens ?? call.tokens),
      0
    )
    if (
      !Number.isSafeInteger(input.estimatedInputTokens) ||
      input.estimatedInputTokens < 0 ||
      !Number.isSafeInteger(input.maxOutputTokens) ||
      input.maxOutputTokens < 1 ||
      input.maxOutputTokens > 4096 ||
      this.reservations.size >= budget.maxCalls ||
      committed + tokens > budget.reservedTokens
    ) {
      throw new WorkerError('Model call budget exhausted', 'BUDGET_LIMIT', 429)
    }
    if (this.reservations.has(input.callId))
      throw new WorkerError('Call was already started', 'CALL_ALREADY_STARTED', 409)
    this.reservations.set(input.callId, { tokens })
    try {
      await beginModelCall(this.env, {
        userId: this.record.ownerId,
        taskId: this.record.task.id,
        ...input
      })
    } catch (error) {
      this.reservations.delete(input.callId)
      throw error
    }
    this.metrics.modelCalls++
    Object.assign(this.metrics, unknownTaskCost())
    await this.persist(this.metrics)
    signal.throwIfAborted()
  }

  private async afterCall(input: ModelUsage) {
    await settleModelCall(this.env, {
      userId: this.record.ownerId,
      taskId: this.record.task.id,
      ...input
    })
    if (this.completedCalls.has(input.callId)) return
    this.completedCalls.set(input.callId, structuredClone(input))
    const reserved = this.reservations.get(input.callId)
    if (
      reserved &&
      input.tokenSource === 'provider' &&
      Number.isSafeInteger(input.inputTokens) &&
      input.inputTokens! >= 0 &&
      Number.isSafeInteger(input.outputTokens) &&
      input.outputTokens! >= 0
    ) {
      reserved.settledTokens = input.inputTokens! + input.outputTokens!
    }
    const unknownEarlierCall = this.metrics.modelCalls > 1 && this.metrics.tokenSource === 'unknown'
    this.metrics.inputTokens = (this.metrics.inputTokens ?? 0) + (input.inputTokens ?? 0)
    this.metrics.outputTokens = (this.metrics.outputTokens ?? 0) + (input.outputTokens ?? 0)
    if (
      unknownEarlierCall ||
      input.tokenSource === 'unknown' ||
      input.inputTokens === undefined ||
      input.outputTokens === undefined
    ) {
      this.metrics.tokenSource = 'unknown'
      this.metrics.inputTokens = null
      this.metrics.outputTokens = null
    } else if (this.metrics.modelCalls === 1) this.metrics.tokenSource = input.tokenSource
    else if (this.metrics.tokenSource !== 'unknown' && input.tokenSource === 'estimated')
      this.metrics.tokenSource = 'estimated'
    Object.assign(
      this.metrics,
      this.completedCalls.size === this.metrics.modelCalls
        ? estimateTaskCost(this.env.MODEL_PRICES_JSON, [...this.completedCalls.values()])
        : unknownTaskCost()
    )
    await this.persist(this.metrics)
  }
}
