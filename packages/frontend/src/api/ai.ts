/**
 * AI API 模块
 * 负责与后端服务通信，处理流式响应
 */

// ==================== 类型定义 ====================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatOptions {
  model?: string
  temperature?: number
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string
    }
  }>
}

// ==================== 常量 ====================

const API_URL = 'https://api.i-tool-chat.store'

const SSE_DONE_MARKER = '[DONE]'
const SSE_DATA_PREFIX = 'data: '

// ==================== 核心函数 ====================

/**
 * 发送流式聊天请求
 * @param messages - 消息历史
 * @param onChunk - 收到数据块时的回调
 * @param onError - 错误回调
 * @param onFinish - 完成回调
 * @param signal - 用于取消请求的 AbortSignal
 * @param options - 可选配置
 */
export async function sendChatRequest(
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  onError: (error: Error) => void,
  onFinish: () => void,
  signal?: AbortSignal,
  options: ChatOptions = {}
): Promise<void> {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...options }),
      signal
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    if (!response.body) {
      throw new Error('Response body is null')
    }

    await processStream(response.body, onChunk)
    onFinish()
  } catch (error) {
    handleError(error, onError)
  }
}

/**
 * 处理流式响应数据
 */
async function processStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: string) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      buffer += decoder.decode(value, { stream: true })
      buffer = processBuffer(buffer, onChunk)
    }

    // 处理剩余数据
    if (buffer.trim()) {
      processLine(buffer.trim(), onChunk)
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * 处理缓冲区数据
 * @returns 剩余未处理的缓冲区内容
 */
function processBuffer(buffer: string, onChunk: (chunk: string) => void): string {
  const lines = buffer.split('\n')
  // 保留最后一行（可能不完整）
  const remaining = lines.pop() ?? ''

  for (const line of lines) {
    processLine(line, onChunk)
  }

  return remaining
}

/**
 * 处理单行 SSE 数据
 */
function processLine(line: string, onChunk: (chunk: string) => void): void {
  const trimmed = line.trim()

  if (!trimmed || !trimmed.startsWith(SSE_DATA_PREFIX)) {
    return
  }

  const data = trimmed.slice(SSE_DATA_PREFIX.length)

  if (data === SSE_DONE_MARKER) {
    return
  }

  try {
    const json: StreamChunk = JSON.parse(data)
    const content = json.choices?.[0]?.delta?.content

    if (content) {
      onChunk(content)
    }
  } catch (e) {
    console.warn('Failed to parse SSE data:', e)
  }
}

/**
 * 统一错误处理
 */
function handleError(error: unknown, onError: (error: Error) => void): void {
  if (error instanceof DOMException && error.name === 'AbortError') {
    console.log('Request aborted by user')
    return
  }

  if (error instanceof Error) {
    onError(error)
  } else {
    onError(new Error(String(error)))
  }
}
