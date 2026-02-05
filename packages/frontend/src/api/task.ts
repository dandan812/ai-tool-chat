/**
 * Task API 模块
 *
 * 负责与 Worker 后端通信，使用 SSE（Server-Sent Events）实现流式响应
 * 支持新的 Task/Step/Content 架构
 *
 * 功能特性：
 * - 发送 Task 请求
 * - 处理 SSE 流式响应
 * - 支持多模态（图片、文件）
 * - 支持取消请求
 *
 * @package frontend/src/api
 */

import type { ChatMessage } from './ai';
import type { Task, Step, SSEEvent, ImageData, FileData } from '../types/task';
import { API_BASE_URL } from '../config';
import { getUserFriendlyError } from '../utils/error';

export interface TaskRequest {
  /** 消息列表 */
  messages: ChatMessage[];
  /** 图片数据（多模态） */
  images?: ImageData[];
  /** 文件数据 */
  files?: FileData[];
  /** 温度参数 */
  temperature?: number;
  /** 是否启用工具调用 */
  enableTools?: boolean;
}

export interface TaskCallbacks {
  onTaskStart?: (task: Task) => void;
  onTaskUpdate?: (task: Task) => void;
  onStepStart?: (step: Step) => void;
  onStepComplete?: (step: Step) => void;
  onContent?: (content: string) => void;
  onError?: (error: string) => void;
  onComplete?: (task: Task) => void;
}

/**
 * 发送 Task 请求，支持 SSE 流式响应
 */
export async function sendTaskRequest(
  request: TaskRequest,
  callbacks: TaskCallbacks,
  signal?: AbortSignal
): Promise<void> {
  try {
    console.log('[TaskAPI] Sending request to:', API_BASE_URL);
    // 调试：打印文件信息
    if (request.files && request.files.length > 0) {
      console.log('[TaskAPI] Sending files:', request.files.map(f => ({
        name: f.name,
        contentLength: f.content?.length || 0,
        contentPreview: f.content?.substring(0, 100) || '(empty)',
        mimeType: f.mimeType,
        size: f.size
      })));
    }
    const requestBody = {
      ...request,
      stream: true,
    };
    // 调试：检查序列化后的数据
    const serialized = JSON.stringify(requestBody);
    console.log('[TaskAPI] Request body size:', serialized.length);
    const response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal,
    });
    console.log('[TaskAPI] Response received:', response.status, response.ok);

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`HTTP ${response.status}`);
      const userError = getUserFriendlyError(error, `服务器错误 (${response.status})`);
      throw new Error(userError);
    }

    if (!response.body) {
      throw new Error(getUserFriendlyError(new Error('No response body'), '服务器响应异常'));
    }

    console.log('[TaskAPI] Starting stream processing');
    await processTaskStream(response.body, callbacks);
    console.log('[TaskAPI] Stream processing completed');

  } catch (error) {
    console.error('[TaskAPI] Error caught:', error);
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log('Request aborted by user');
      // 用户主动取消，不触发错误回调
      return;
    }
    const userError = getUserFriendlyError(error as Error, '请求失败');
    callbacks.onError?.(userError);
  }
}

/**
 * 处理 Task 流式响应
 */
async function processTaskStream(
  body: ReadableStream<Uint8Array>,
  callbacks: TaskCallbacks
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = processSSEBuffer(buffer, callbacks);
    }

    // 处理剩余数据
    if (buffer.trim()) {
      processSSELine(buffer.trim(), callbacks);
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 处理 SSE 缓冲区
 */
function processSSEBuffer(buffer: string, callbacks: TaskCallbacks): string {
  const lines = buffer.split('\n');
  const remaining = lines.pop() ?? '';

  for (const line of lines) {
    processSSELine(line, callbacks);
  }

  return remaining;
}

/**
 * 处理单行 SSE 数据
 */
function processSSELine(line: string, callbacks: TaskCallbacks): void {
  const trimmed = line.trim();

  if (!trimmed || !trimmed.startsWith('data: ')) {
    return;
  }

  const data = trimmed.slice(6);

  if (data === '[DONE]') {
    return;
  }

  try {
    const event: SSEEvent = JSON.parse(data);
    handleSSEEvent(event, callbacks);
  } catch (e) {
    console.warn('Failed to parse SSE data:', e);
  }
}

/**
 * 处理 SSE 事件
 */
function handleSSEEvent(event: SSEEvent, callbacks: TaskCallbacks): void {
  switch (event.type) {
    case 'task': {
      const { task, event: taskEvent } = event.data as { task: Task; event: string };
      if (taskEvent === 'started') {
        callbacks.onTaskStart?.(task);
      } else {
        callbacks.onTaskUpdate?.(task);
      }
      break;
    }

    case 'step': {
      const { step, event: stepEvent } = event.data as { step: Step; event: string };
      if (stepEvent === 'start') {
        callbacks.onStepStart?.(step);
      } else if (stepEvent === 'complete') {
        callbacks.onStepComplete?.(step);
      }
      break;
    }

    case 'content': {
      const { content } = event.data as { content: string };
      console.log('[TaskAPI] Received content:', JSON.stringify(content));
      callbacks.onContent?.(content);
      break;
    }

    case 'error': {
      const { error } = event.data as { error: string };
      callbacks.onError?.(error);
      break;
    }

    case 'complete': {
      const { task } = event.data as { task: Task };
      callbacks.onComplete?.(task);
      break;
    }
  }
}
