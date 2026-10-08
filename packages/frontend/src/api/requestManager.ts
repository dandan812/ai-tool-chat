import { accountStorageKey, apiJSON } from './account'
import type {
  ChatMessage,
  EvidenceSource,
  ImageData,
  Step,
  Task,
  UploadedFileRef
} from '../types/task'
import {
  readEventPage,
  readTaskSnapshot,
  TaskProtocolError,
  type TaskEvent
} from '../features/tasks/taskProtocol'

export interface TaskRequest {
  messages: ChatMessage[]
  images?: ImageData[]
  files?: UploadedFileRef[]
  temperature?: number
  enableTools?: boolean
  requestKey?: string
}
export interface TaskCallbacks {
  onTaskStart?: (task: Task) => void
  onTaskUpdate?: (task: Task) => void
  onStepStart?: (step: Step) => void
  onStepProgress?: (step: Step) => void
  onStepComplete?: (step: Step) => void
  onStepError?: (step: Step) => void
  onContent?: (content: string) => void
  onSources?: (sources: EvidenceSource[]) => void
  onError?: (error: string) => void
  onComplete?: (task: Task) => void
}
export interface DurableEvent {
  id: number
  type: string
  data: unknown
}

function canRetry(error: unknown) {
  if (!(error instanceof Error) || error instanceof TaskProtocolError) return false
  const status =
    (error as Error & { status?: number; statusCode?: number }).status ??
    (error as Error & { statusCode?: number }).statusCode
  if (status !== undefined) return status === 429 || status >= 500
  // apiJSON currently exposes HTTP failures as plain Error, fetch failures as TypeError.
  return error instanceof TypeError
}

async function delay(milliseconds: number, signal?: AbortSignal) {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(new DOMException('Stopped viewing', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export class TaskRequestManager {
  private accountScope = accountStorageKey('task-observation')
  private callbacks: TaskCallbacks
  private signal?: AbortSignal
  constructor(callbacks: TaskCallbacks, signal?: AbortSignal) {
    this.callbacks = callbacks
    this.signal = signal
  }

  private ensureActive() {
    this.signal?.throwIfAborted()
    if (accountStorageKey('task-observation') !== this.accountScope) {
      throw new DOMException('Account changed', 'AbortError')
    }
  }

  private async read(path: string, init: RequestInit = {}): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      this.ensureActive()
      try {
        const response = await apiJSON<unknown>(path, { ...init, signal: this.signal })
        this.ensureActive()
        return response
      } catch (error) {
        if (this.signal?.aborted || !canRetry(error) || attempt >= 4) throw error
        await delay(Math.min(8000, (attempt + 1) * 1500), this.signal)
      }
    }
  }

  async send(request: TaskRequest): Promise<void> {
    const { requestKey = crypto.randomUUID(), ...body } = request
    try {
      // Network retries retain the same key and body; they cannot create another execution.
      const task = readTaskSnapshot(
        await this.read('/tasks', {
          method: 'POST',
          headers: { 'Idempotency-Key': requestKey },
          body: JSON.stringify(body)
        })
      )
      this.callbacks.onTaskStart?.(task)
      await this.resume(task.id)
    } catch (error) {
      this.report(error)
    }
  }

  async resume(taskId: string): Promise<void> {
    let cursor = 0
    let reportedError = false
    try {
      while (!this.signal?.aborted) {
        this.ensureActive()
        if (document.visibilityState === 'hidden') {
          await delay(1500, this.signal)
          continue
        }
        const page = readEventPage(
          await this.read('/tasks/' + encodeURIComponent(taskId) + '/events?after=' + cursor),
          taskId,
          cursor
        )
        for (const event of page.events) {
          this.ensureActive()
          this.dispatch(event)
          if (event.type === 'error') reportedError = true
          cursor = event.id
        }
        if (page.terminal) {
          // Retry this read without replaying already delivered content.
          const task = readTaskSnapshot(
            await this.read('/tasks/' + encodeURIComponent(taskId)),
            taskId
          )
          if (task.status === 'pending' || task.status === 'running') throw new TaskProtocolError()
          this.callbacks.onTaskUpdate?.(task)
          this.ensureActive()
          if (task.status === 'completed') this.callbacks.onComplete?.(task)
          else if (!reportedError)
            this.callbacks.onError?.(
              task.error ??
                (task.status === 'cancelled'
                  ? '后台任务已取消。'
                  : '任务中断，可在任务中心查看已保存的结果。')
            )
          return
        }
        await delay(1000, this.signal)
      }
    } catch (error) {
      this.report(error)
    }
  }

  private dispatch(event: TaskEvent) {
    switch (event.type) {
      case 'usage':
        // 用量由后端结算，最终快照提供汇总；仍消费事件以保持游标连续。
        break
      case 'content':
        this.callbacks.onContent?.(event.data.content)
        break
      case 'sources':
        this.callbacks.onSources?.(event.data.sources)
        break
      case 'task':
        this.callbacks.onTaskUpdate?.(event.data.task)
        break
      case 'complete':
        break // The terminal snapshot is authoritative.
      case 'error':
        if (event.data.task) this.callbacks.onTaskUpdate?.(event.data.task)
        this.ensureActive()
        this.callbacks.onError?.(event.data.error)
        break
      case 'step': {
        const callbacks = {
          start: this.callbacks.onStepStart,
          progress: this.callbacks.onStepProgress,
          complete: this.callbacks.onStepComplete,
          error: this.callbacks.onStepError
        }
        callbacks[event.data.event]?.(event.data.step)
        break
      }
    }
  }

  private report(error: unknown) {
    if (
      this.signal?.aborted ||
      accountStorageKey('task-observation') !== this.accountScope ||
      (error instanceof Error && error.name === 'AbortError')
    )
      return
    this.callbacks.onError?.(
      error instanceof Error ? error.message : '连接中断。任务记录保留，可从任务中心重新打开。'
    )
  }
}
