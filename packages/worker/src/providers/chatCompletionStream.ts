import type { SkillStreamChunk } from '../types';
import { logger } from '../utils/logger';
import { parseChatCompletionSSELine } from '../utils/sse';

export interface ChatCompletionStreamRequest {
  provider: string;
  model: string;
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * 统一执行兼容 OpenAI Chat Completions 协议的流式请求。
 *
 * 这里不负责“选哪个模型/供应商”，只负责把已经确定好的请求发出去并流式读回。
 * 当前主用场景是阿里云百炼兼容接口，因此这里更像一个通用的“兼容协议执行器”。
 */
export async function* executeChatCompletionStream(
  request: ChatCompletionStreamRequest,
): AsyncIterable<SkillStreamChunk> {
  const rawMessages = Array.isArray(request.body.messages)
    ? request.body.messages
    : [];
  const messagePreview = rawMessages.map((message, index) => {
    if (!message || typeof message !== 'object') {
      return {
        index,
        role: 'unknown',
        preview: '[invalid message]',
      };
    }

    const candidate = message as Record<string, unknown>;
    const content = candidate.content;
    const preview = typeof content === 'string'
      ? content.slice(0, 300)
      : JSON.stringify(content).slice(0, 300);

    return {
      index,
      role: typeof candidate.role === 'string' ? candidate.role : 'unknown',
      preview,
    };
  });

  logger.info('Calling chat completion provider', {
    provider: request.provider,
    model: request.model,
    messageCount: rawMessages.length,
    messagePreview,
  });

  const controller = new AbortController();
  const timeoutId = request.timeoutMs
    ? setTimeout(() => controller.abort(), request.timeoutMs)
    : null;

  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Chat completion provider error', {
        provider: request.provider,
        model: request.model,
        status: response.status,
        error,
      });
      yield {
        type: 'error',
        error: `${request.provider.toUpperCase()} API Error (Status ${response.status}): ${error}`,
      };
      return;
    }

    if (!response.body) {
      yield { type: 'error', error: 'Response body is null' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const chunk = parseChatCompletionSSELine(line);
          if (!chunk) {
            continue;
          }

          if (chunk.type === 'content') {
            chunkCount++;
          }

          yield chunk;
        }
      }

      if (buffer.trim()) {
        const chunk = parseChatCompletionSSELine(buffer.trim());
        if (chunk) {
          if (chunk.type === 'content') {
            chunkCount++;
          }
          yield chunk;
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'complete' };
    logger.info('Chat completion provider streaming completed', {
      provider: request.provider,
      model: request.model,
      totalChunks: chunkCount,
    });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
