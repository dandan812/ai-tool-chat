import { accountStorageKey, accountHeaders, getAccountRevision, APIError, apiJSON } from './account'
import { API_BASE_URL } from '../config'
import { readTaskEventStream } from './taskEventStream'
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
  onObservationReady?: (flushContent: () => void) => void
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
  // Fetch network failures have no HTTP status.
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
  private accountRevision = getAccountRevision()
  private callbacks: TaskCallbacks
  private signal?: AbortSignal
  private content: string[] = []
  private frame?: number
  constructor(callbacks: TaskCallbacks, signal?: AbortSignal) {
    this.callbacks = callbacks
    this.signal = signal
    this.callbacks.onObservationReady?.(() => this.flushContent())
  }

  private ensureActive() {
    this.signal?.throwIfAborted()
    if (!this.isCurrentAccount()) {
      throw new DOMException('Account changed', 'AbortError')
    }
  }

  private isCurrentAccount() {
    return (
      getAccountRevision() === this.accountRevision &&
      accountStorageKey('task-observation') === this.accountScope
    )
  }

  private flushContent() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.frame = undefined
    const content = this.content.join('')
    this.content = []
    // An explicit stop preserves received text; an account switch must never leak it.
    if (content && this.isCurrentAccount()) this.callbacks.onContent?.(content)
  }

  private async observe(path: string, receive: (page: unknown) => boolean): Promise<boolean> {
    this.ensureActive()
    const response = await fetch(API_BASE_URL + path, {
      credentials: 'include',
      headers: { ...accountHeaders(), Accept: 'text/event-stream' },
      signal: this.signal
    })
    try {
      this.ensureActive()
      if (!response.ok) {
        const result = await response.json().catch(() => null)
        this.ensureActive()
        const code = result?.code ?? result?.error?.code
        if (response.status === 401 || code === 'ACCOUNT_CHANGED')
          window.dispatchEvent(new Event('account-expired'))
        const message = typeof result?.error === 'string' ? result.error : result?.error?.message
        throw new APIError(
          message || '请求失败（' + response.status + '）',
          response.status,
          code,
          response.headers?.get('X-Request-ID')
        )
      }
      const contentType = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()
      if (contentType === 'application/json') {
        const page: unknown = await response.json()
        this.ensureActive()
        return receive(page)
      }
      if (contentType !== 'text/event-stream' || !response.body) throw new TaskProtocolError()
      for await (const page of readTaskEventStream(
        response.body,
        () => this.ensureActive(),
        this.signal
      )) {
        if (receive(page)) return true
      }
      throw new TypeError('任务事件连接中断。任务记录保留，可从任务中心重新打开。')
    } finally {
      await response.body?.cancel().catch(() => {})
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
    let retries = 0
    try {
      while (true) {
        this.ensureActive()
        let terminal: boolean
        try {
          terminal = await this.observe(
            '/tasks/' + encodeURIComponent(taskId) + '/events?after=' + cursor,
            (input) => {
              const page = readEventPage(input, taskId, cursor)
              for (const event of page.events) {
                this.ensureActive()
                this.dispatch(event)
                if (event.type === 'error') reportedError = true
                cursor = event.id
              }
              return page.terminal
            }
          )
        } catch (error) {
          this.ensureActive()
          if (!canRetry(error) || retries >= 4) throw error
          this.flushContent()
          await delay(Math.min(8000, ++retries * 1500), this.signal)
          continue
        }
        if (terminal) {
          this.flushContent()
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
        // Only an explicitly negotiated JSON response reaches this compatibility path.
        await delay(500, this.signal)
      }
    } catch (error) {
      this.flushContent()
      this.report(error)
    } finally {
      this.flushContent()
    }
  }

  private dispatch(event: TaskEvent) {
    if (event.type !== 'content' && event.type !== 'usage') {
      this.flushContent()
      this.ensureActive()
    }
    switch (event.type) {
      case 'usage':
        // 用量由后端结算，最终快照提供汇总；仍消费事件以保持游标连续。
        break
      case 'content':
        this.content.push(event.data.content)
        if (this.frame === undefined) this.frame = requestAnimationFrame(() => this.flushContent())
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
      !this.isCurrentAccount() ||
      (error instanceof Error && error.name === 'AbortError')
    )
      return
    this.callbacks.onError?.(
      error instanceof Error ? error.message : '连接中断。任务记录保留，可从任务中心重新打开。'
    )
  }
}
