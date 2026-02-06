/**
 * HTTP 中间件工具 - 优化版
 * 支持新的错误类型和更好的错误处理
 */

import type { Env, Handler, Middleware } from '../types';
import { WorkerError, ValidationError, AuthenticationError } from '../types';
import { logger } from './logger';

/**
 * CORS 中间件
 */
export function withCORS(handler: Handler): Handler {
  return async (request, env) => {
    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const response = await handler(request, env);

    // 添加 CORS 头
    response.headers.set('Access-Control-Allow-Origin', '*');

    return response;
  };
}

/**
 * 错误处理中间件
 */
export function withErrorHandler(handler: Handler): Handler {
  return async (request, env) => {
    try {
      return await handler(request, env);
    } catch (error) {
      // 记录错误
      if (error instanceof WorkerError) {
        logger.error(`WorkerError: ${error.code}`, error);
      } else {
        logger.error('Unhandled error:', error);
      }

      // 构建错误响应
      let message: string;
      let status: number;
      let code: string;
      let details: Record<string, unknown> | undefined;

      if (error instanceof WorkerError) {
        message = error.message;
        status = error.statusCode;
        code = error.code;
        details = error.details;
      } else {
        message = error instanceof Error ? error.message : 'Internal Server Error';
        status = 500;
        code = 'INTERNAL_ERROR';
      }

      return createJSONResponse(
        {
          error: {
            message,
            code,
            ...(details && { details }),
          },
        },
        status
      );
    }
  };
}

/**
 * 请求验证中间件
 */
export function withValidation(handler: Handler): Handler {
  return async (request, env) => {
    // 验证请求方法
    if (request.method !== 'POST' && request.method !== 'GET') {
      throw new ValidationError('Method Not Allowed', { method: request.method });
    }

    const url = new URL(request.url);
    const isUploadEndpoint = url.pathname.startsWith('/upload/');

    // GET 请求跳过 Content-Type 验证
    if (request.method === 'GET') {
      return handler(request, env);
    }

    // 验证 Content-Type
    const contentType = request.headers.get('content-type') || '';
    // 上传端点允许 multipart/form-data
    if (!isUploadEndpoint && !contentType.includes('application/json')) {
      throw new ValidationError('Content-Type must be application/json', {
        contentType,
      });
    }

    // 验证请求体大小 (限制 10MB)
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (contentLength > maxSize) {
      throw new ValidationError('Request body too large', {
        size: contentLength,
        maxSize,
      });
    }

    return handler(request, env);
  };
}

/**
 * 认证中间件
 */
export function withAuth(
  handler: Handler,
  getToken: (env: Env) => string | undefined
): Handler {
  return async (request, env) => {
    const authHeader = request.headers.get('authorization');
    const expectedToken = getToken(env);

    if (expectedToken) {
      const token = authHeader?.replace('Bearer ', '');
      if (token !== expectedToken) {
        throw new AuthenticationError('Invalid or missing token');
      }
    }

    return handler(request, env);
  };
}

/**
 * 日志中间件
 */
export function withLogging(handler: Handler): Handler {
  return async (request, env) => {
    const start = Date.now();
    const url = new URL(request.url);

    logger.info('Request started', {
      method: request.method,
      path: url.pathname,
      query: url.search,
    });

    try {
      const response = await handler(request, env);
      const duration = Date.now() - start;

      logger.info('Request completed', {
        method: request.method,
        path: url.pathname,
        status: response.status,
        duration,
      });

      return response;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Request failed', {
        method: request.method,
        path: url.pathname,
        duration,
        error,
      });
      throw error;
    }
  };
}

/**
 * 组合中间件
 */
export function compose(...middlewares: Middleware[]): Middleware {
  return (handler: Handler) => {
    return middlewares.reduceRight((acc, middleware) => middleware(acc), handler);
  };
}

/**
 * 创建 JSON 响应
 */
export function createJSONResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * 创建 SSE 响应
 */
export function createSSEResponse(
  generator: AsyncIterable<unknown>,
  onError?: (error: Error) => void
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of generator) {
          const data = `data: ${JSON.stringify(chunk)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        onError?.(err);

        const errorEvent = {
          type: 'error',
          data: { error: err.message },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * 自定义响应错误 (兼容旧代码)
 * @deprecated 使用 WorkerError 代替
 */
export class ResponseError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ResponseError';
  }
}

/**
 * 安全的 JSON 解析
 */
export async function safeJSONParse<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * 安全的 JSON 解析（带验证）
 */
export async function parseJSON<T>(
  request: Request,
  validator?: (data: unknown) => data is T
): Promise<T> {
  let data: unknown;

  try {
    data = await request.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  if (validator && !validator(data)) {
    throw new ValidationError('Invalid request body format');
  }

  return data as T;
}
