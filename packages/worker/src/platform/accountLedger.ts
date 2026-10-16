import type {
  AccountSettings,
  AccountUsage,
  BeginModelCallInput,
  FinishTaskInput,
  ReserveTaskInput,
  SettleModelCallInput
} from './accountTypes'
import { accountError as fail, positive } from './accountSupport'

interface Call {
  model: string
  reserved: number
  used?: number
  source?: string
  outcome?: string
}

interface Reservation {
  taskId: string
  requestHash: string
  reserved: number
  used: number
  day: string
  expiresAt: number
  maxCalls: number
  finished: boolean
  calls: Record<string, Call>
}

interface Ledger {
  days: Record<string, number>
  active: Record<string, number>
}

/** Token admission accounting, not a provider invoice. All writes run under the directory gate. */
export class TaskBudgetLedger {
  private readonly ledgerKey: string
  private readonly day: string

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: AccountSettings,
    private readonly userId: string,
    private readonly now: number
  ) {
    this.ledgerKey = 'ledger:' + userId
    this.day = new Date(now).toISOString().slice(0, 10)
  }

  async usage(): Promise<AccountUsage> {
    const ledger = await this.readLedger()
    return {
      day: this.day,
      chargedTokens: ledger.days[this.day] || 0,
      dailyTokenBudget: positive(this.env.DAILY_TOKEN_BUDGET, 100000),
      activeTasks: Object.keys(ledger.active).length
    }
  }

  async reserve(input: ReserveTaskInput): Promise<{ reservationId: string }> {
    const previous = await this.storage.get<Reservation>(this.taskKey(input.taskId))
    if (previous) {
      if (previous.requestHash !== input.requestHash)
        fail('Task ID conflict', 'IDEMPOTENCY_CONFLICT', 409)
      return { reservationId: input.taskId }
    }
    if (
      !input.reservedTokens ||
      input.reservedTokens > positive(this.env.TASK_TOKEN_BUDGET, 16000) ||
      input.maxCalls < 1 ||
      input.maxCalls > positive(this.env.MAX_MODEL_CALLS, 4) ||
      input.maxDurationMs < 1 ||
      input.maxDurationMs > 30 * 60 * 1000
    ) {
      fail('Task exceeds configured limits', 'BUDGET_LIMIT', 429)
    }
    const ledger = await this.readLedger()
    const charged = (ledger.days[this.day] || 0) + input.reservedTokens
    if (
      Object.keys(ledger.active).length >= positive(this.env.MAX_CONCURRENT_TASKS, 2) ||
      charged > positive(this.env.DAILY_TOKEN_BUDGET, 100000)
    ) {
      fail('Daily or concurrent task budget exhausted', 'BUDGET_LIMIT', 429)
    }
    ledger.days[this.day] = charged
    ledger.active[input.taskId] = this.now + input.maxDurationMs
    const task: Reservation = {
      taskId: input.taskId,
      requestHash: input.requestHash,
      reserved: input.reservedTokens,
      used: 0,
      day: this.day,
      expiresAt: this.now + input.maxDurationMs,
      maxCalls: input.maxCalls,
      finished: false,
      calls: {}
    }
    await this.save(ledger, task)
    return { reservationId: input.taskId }
  }

  async beginCall(input: BeginModelCallInput): Promise<object> {
    const task = await this.readTask(input.taskId)
    if (task.finished || task.expiresAt <= this.now)
      fail('Task is no longer running', 'TASK_STOPPED', 409)
    if (Object.hasOwn(task.calls, input.callId))
      fail('Call was already started', 'CALL_ALREADY_STARTED', 409)
    const reserved = input.estimatedInputTokens + input.maxOutputTokens
    const committed = Object.values(task.calls).reduce(
      (total, call) => total + (call.used ?? call.reserved),
      0
    )
    if (Object.keys(task.calls).length >= task.maxCalls || committed + reserved > task.reserved) {
      fail('Model call budget exhausted', 'BUDGET_LIMIT', 429)
    }
    task.calls[input.callId] = { model: input.model, reserved }
    await this.save(await this.readLedger(), task)
    return {}
  }

  async settleCall(input: SettleModelCallInput): Promise<object> {
    const task = await this.readTask(input.taskId)
    const call = Object.hasOwn(task.calls, input.callId) ? task.calls[input.callId] : undefined
    if (!call) fail('Call was not reserved')
    if (call.outcome !== undefined) return {}
    const used =
      input.tokenSource === 'provider' &&
      input.inputTokens !== undefined &&
      input.outputTokens !== undefined
        ? input.inputTokens + input.outputTokens
        : call.reserved
    if (!Number.isSafeInteger(used) || !Number.isSafeInteger(task.used + used))
      fail('Invalid token budget')
    call.source = input.tokenSource
    call.outcome = input.outcome
    call.used = used
    task.used += used
    // Late settlement is recorded, but cannot reopen a finished task or refund its conservative charge.
    await this.save(await this.readLedger(), task)
    return {}
  }

  async finish(input: FinishTaskInput): Promise<object> {
    const task = await this.readTask(input.taskId)
    if (task.finished) return {}
    const ledger = await this.readLedger()
    task.finished = true
    delete ledger.active[task.taskId]
    const known =
      !input.usageUnknown &&
      Object.values(task.calls).every(
        (call) => call.source === 'provider' && call.used !== undefined
      )
    if (known) {
      ledger.days[task.day] = Math.max(0, (ledger.days[task.day] || 0) - task.reserved + task.used)
    }
    await this.save(ledger, task)
    return {}
  }

  private async readLedger(): Promise<Ledger> {
    const ledger = (await this.storage.get<Ledger>(this.ledgerKey)) || { days: {}, active: {} }
    // Expiry frees concurrency only. Reservation records and their pre-charge remain intact.
    ledger.active = Object.fromEntries(
      Object.entries(ledger.active).filter(([, expiry]) => expiry > this.now)
    )
    ledger.days = Object.fromEntries(
      Object.entries(ledger.days).filter(([day]) => Date.parse(day) > this.now - 35 * 86400000)
    )
    return ledger
  }

  private taskKey(taskId: string): string {
    return 'reservation:' + this.userId + ':' + taskId
  }

  private async readTask(taskId: string): Promise<Reservation> {
    const task = await this.storage.get<Reservation>(this.taskKey(taskId))
    if (!task) fail('Reservation not found', 'NOT_FOUND', 404)
    return task
  }

  private async save(ledger: Ledger, task: Reservation): Promise<void> {
    await this.storage.transaction(async (transaction) => {
      await transaction.put(this.ledgerKey, ledger)
      await transaction.put(this.taskKey(task.taskId), task)
    })
  }
}
