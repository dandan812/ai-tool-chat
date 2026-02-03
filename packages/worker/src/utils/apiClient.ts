/**
 * API 客户端基础类
 * 统一处理流式 API 调用和 SSE 解析
 */

import { withTimeout } from './retry';
import { logger } from './logger';

export interface APIClientConfig {
  baseURL: string;
  apiKey: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface StreamChunk {
  type: 'content' | 'error' | 'complete';
  content?: string;
  error?: string;
}

/**
 * 统一的 API 客户端
 */
export class APIClient {
  private config: Required<APIClientConfig>;

  constructor(config: APIClientConfig) {
    this.config = {
      timeout: 60000,
      headers: {},
      ...config,
    };
  }

  /**
   * 发送流式请求
   */
  async *streamRequest(
    endpoint: string,
    body: unknown,
    parser: (line: string) => StreamChunk | null
  ): AsyncIterable<StreamChunk> {
    const url = `${this.config.baseURL}${endpoint}`;
    
    try {
      const response = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
            ...this.config.headers,
          },
          body: JSON.stringify(body),
        }),
        this.config.timeout,
        `API request timeout after ${this.config.timeout}ms`
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('API request failed', { 
          status: response.status, 
          statusText: response.statusText,
          error: errorText 
        });
        yield { 
          type: 'error', 
          error: `API Error ${response.status}: ${errorText || response.statusText}` 
        };
        return;
      }

      if (!response.body) {
        yield { type: 'error', error: 'Response body is null' };
        return;
      }

      // 流式读取并解析
      yield* this.parseStream(response.body.getReader(), parser);
      yield { type: 'complete' };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('API request failed', error);
      yield { type: 'error', error: message };
    }
  }

  /**
   * 发送非流式请求
   */
  async request<T>(endpoint: string, body: unknown): Promise<T> {
    const url = `${this.config.baseURL}${endpoint}`;
    
    const response = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          ...this.config.headers,
        },
        body: JSON.stringify(body),
      }),
      this.config.timeout,
      `API request timeout after ${this.config.timeout}ms`
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText || response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * 解析流数据
   */
  private async *parseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    parser: (line: string) => StreamChunk | null
  ): AsyncIterable<StreamChunk> {
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const chunk = parser(line);
          if (chunk) {
            yield chunk;
          }
        }
      }

      // 处理剩余数据
      if (buffer.trim()) {
        const chunk = parser(buffer.trim());
        if (chunk) {
          yield chunk;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * 标准的 OpenAI 格式 SSE 解析器
 */
export function createOpenAIStreamParser(): (line: string) => StreamChunk | null {
  return (line: string): StreamChunk | null => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data: ')) {
      return null;
    }

    const data = trimmed.slice(6);
    if (data === '[DONE]') {
      return null;
    }

    try {
      const json = JSON.parse(data);
      const content = json.choices?.[0]?.delta?.content || 
                     json.choices?.[0]?.message?.content;
      
      if (content) {
        return { type: 'content', content };
      }
    } catch {
      // 忽略解析错误
    }

    return null;
  };
}

/**
 * 创建 SSE 解析器（带自定义内容提取器）
 */
export function createSSEParser(
  extractContent: (json: unknown) => string | undefined
): (line: string) => StreamChunk | null {
  return (line: string): StreamChunk | null => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data: ')) {
      return null;
    }

    const data = trimmed.slice(6);
    if (data === '[DONE]') {
      return null;
    }

    try {
      const json = JSON.parse(data);
      const content = extractContent(json);
      
      if (content) {
        return { type: 'content', content };
      }
    } catch {
      // 忽略解析错误
    }

    return null;
  };
}
