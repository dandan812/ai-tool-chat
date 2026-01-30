/**
 * Task API 模块
 * 支持新的 SSE 事件格式（Task/Step/Content）
 */
import type { ChatMessage } from './ai';
import type { Task, Step, SSEEvent, ImageData } from '../types/task';

const API_URL = 'https://api.i-tool-chat.store';

export interface TaskRequest {
  messages: ChatMessage[];
  images?: ImageData[];
  temperature?: number;
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
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...request,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    await processTaskStream(response.body, callbacks);

  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log('Request aborted by user');
      return;
    }
    callbacks.onError?.(String(error));
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
