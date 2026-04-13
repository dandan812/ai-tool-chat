import { API_BASE_URL } from '../config'
import { getUserFriendlyError } from '../utils/error'
import type { ChatMessage, ImageData, Step, SSEEvent, Task, UploadedFileRef } from '../types/task'

export interface TaskRequest {
  messages: ChatMessage[]
  images?: ImageData[]
  files?: UploadedFileRef[]
  temperature?: number
  enableTools?: boolean
}

export interface TaskCallbacks {
  onTaskStart?: (task: Task) => void
  onTaskUpdate?: (task: Task) => void
  onStepStart?: (step: Step) => void
  onStepComplete?: (step: Step) => void
  onStepError?: (step: Step) => void
  onContent?: (content: string) => void
  onError?: (error: string) => void
  onComplete?: (task: Task) => void
}

/**
 * 请求管理器负责统一处理：
 * - 请求体构造
 * - fetch 发送
 * - SSE 流式解析
 * - 错误归一化
 */
export class TaskRequestManager {
  private readonly callbacks: TaskCallbacks
  private readonly signal?: AbortSignal

  constructor(
    callbacks: TaskCallbacks,
    signal?: AbortSignal,
  ) {
    this.callbacks = callbacks
    this.signal = signal
  }

  async send(request: TaskRequest): Promise<void> {
    try {
      const response = await fetch(API_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...request,
          stream: true,
        }),
        signal: this.signal,
      })

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`)
        throw new Error(getUserFriendlyError(error, `服务器错误 (${response.status})`))
      }

      if (!response.body) {
        throw new Error(getUserFriendlyError(new Error('No response body'), '服务器响应异常'))
      }

      await this.processStream(response.body)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      this.callbacks.onError?.(getUserFriendlyError(error as Error, '请求失败'))
    }
  }

  private async processStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        buffer = this.processBuffer(buffer)
      }

      if (buffer.trim()) {
        this.processLine(buffer.trim())
      }
    } finally {
      reader.releaseLock()
    }
  }

  private processBuffer(buffer: string): string {
    const lines = buffer.split('\n')
    const remaining = lines.pop() ?? ''

    for (const line of lines) {
      this.processLine(line)
    }

    return remaining
  }

  private processLine(line: string): void {
    const trimmed = line.trim()

    if (!trimmed || !trimmed.startsWith('data: ')) {
      return
    }

    const data = trimmed.slice(6)
    if (data === '[DONE]') {
      return
    }

    try {
      const event: SSEEvent = JSON.parse(data)
      this.handleEvent(event)
    } catch (error) {
      console.warn('Failed to parse SSE data:', error)
    }
  }

  private handleEvent(event: SSEEvent): void {
    switch (event.type) {
      case 'task': {
        const { task, event: taskEvent } = event.data as { task: Task; event: string }
        if (taskEvent === 'started') {
          this.callbacks.onTaskStart?.(task)
        } else {
          this.callbacks.onTaskUpdate?.(task)
        }
        break
      }

      case 'step': {
        const { step, event: stepEvent } = event.data as { step: Step; event: string }
        if (stepEvent === 'start') {
          this.callbacks.onStepStart?.(step)
        } else if (stepEvent === 'complete') {
          this.callbacks.onStepComplete?.(step)
        } else if (stepEvent === 'error') {
          this.callbacks.onStepError?.(step)
        }
        break
      }

      case 'content': {
        const { content } = event.data as { content: string }
        this.callbacks.onContent?.(content)
        break
      }

      case 'error': {
        const { error } = event.data as { error: string }
        this.callbacks.onError?.(error)
        break
      }

      case 'complete': {
        const { task } = event.data as { task: Task }
        this.callbacks.onComplete?.(task)
        break
      }
    }
  }
}
