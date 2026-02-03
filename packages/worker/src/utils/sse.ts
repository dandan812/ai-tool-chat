/**
 * SSE (Server-Sent Events) 工具函数
 * 统一的流式数据处理
 */

/**
 * SSE 解析器 - 异步生成器
 */
export async function* parseSSEStream<T>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  parser: (line: string) => T | null
): AsyncIterable<T> {
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
        const parsed = parser(line);
        if (parsed !== null) {
          yield parsed;
        }
      }
    }

    // 处理剩余数据
    if (buffer.trim()) {
      const parsed = parser(buffer.trim());
      if (parsed !== null) {
        yield parsed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 标准 SSE 行解析器
 * 解析 data: {...} 格式
 */
export function parseSSELine<T>(line: string, transformer: (data: unknown) => T | null): T | null {
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
    return transformer(json);
  } catch {
    return null;
  }
}

/**
 * 创建 SSE 响应
 */
export function createSSEResponse(generator: AsyncIterable<string>): Response {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of generator) {
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        const errorEvent = JSON.stringify({
          type: 'error',
          data: { error: String(error) }
        });
        controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * 安全的 SSE 数据序列化
 * 防止注入攻击
 */
export function serializeSSEEvent(event: unknown): string {
  return JSON.stringify(event)
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}
