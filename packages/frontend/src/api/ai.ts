/**
 * AI API 模块
 *
 * 负责与后端服务通信，处理流式响应
 *
 * 功能特性：
 * - 发送流式聊天请求
 * - 处理 SSE 流式响应
 * - 支持取消请求
 * - 支持多种 AI 模型格式
 *
 * @package frontend/src/api
 */

// ==================== 类型定义 ====================

/**
 * 聊天消息接口
 * 表示一条对话消息
 *
 * @property role - 消息角色（用户/AI/系统）
 * @property content - 消息内容
 */
export interface ChatMessage {
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string;
}

/**
 * 聊天选项接口
 * 配置聊天请求的参数
 *
 * @property model - 使用的 AI 模型
 * @property temperature - 温度参数（控制随机性）
 */
export interface ChatOptions {
  /** 使用的 AI 模型 */
  model?: string;
  /** 温度参数（控制输出的随机性，0-2，越低越确定） */
  temperature?: number;
}

/**
 * 流式响应块接口
 * OpenAI 格式的流式响应结构
 */
interface StreamChunk {
  /** 选择列表（通常只有一个） */
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
}

// ==================== 常量 ====================

/** API 基础 URL */
const API_URL = 'https://api.i-tool-chat.store';

/** SSE 结束标记 */
const SSE_DONE_MARKER = '[DONE]';

/** SSE 数据前缀 */
const SSE_DATA_PREFIX = 'data: ';

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
 * 支持后端 Task → Step → Skill 架构的事件格式
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
    const json = JSON.parse(data) as {
      type?: string
      data?: { content?: string }
      choices?: Array<{ delta?: { content?: string } }>
    }

    // 新的后端格式: { type: 'content', data: { content: '...' } }
    if (json.type === 'content' && json.data?.content) {
      onChunk(json.data.content)
      return
    }

    // 兼容旧的 OpenAI 格式: { choices: [{ delta: { content: '...' } }] }
    const legacyContent = json.choices?.[0]?.delta?.content
    if (legacyContent) {
      onChunk(legacyContent)
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
