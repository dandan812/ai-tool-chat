/**
 * HTTP 中间件工具
 */

import type { Env, Handler, Middleware } from '../types';
import { WorkerError, ValidationError } from '../types';
import { logger } from './logger';
import { createErrorDetails, ERROR_CODES, getErrorCode, getRequestType } from './observability';

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
    const url = new URL(request.url);
    const route = url.pathname;
    const requestType = getRequestType(route);

    try {
      return await handler(request, env);
    } catch (error) {
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

      logger.error('Request error response', {
        route,
        requestType,
        method: request.method,
        status,
        errorCode: getErrorCode(error) || code,
        error,
      });

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
      throw new ValidationError('Method Not Allowed', createErrorDetails(
        ERROR_CODES.REQUEST_METHOD_NOT_ALLOWED,
        { method: request.method },
      ));
    }

    // GET 请求跳过 Content-Type 验证
    if (request.method === 'GET') {
      return handler(request, env);
    }

    // 验证 Content-Type
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
      throw new ValidationError(
        'Content-Type must be application/json or multipart/form-data',
        createErrorDetails(ERROR_CODES.REQUEST_UNSUPPORTED_CONTENT_TYPE, {
          contentType,
        }),
      );
    }

    // 验证请求体大小 (限制 10MB)
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (contentLength > maxSize) {
      throw new ValidationError(
        'Request body too large',
        createErrorDetails(ERROR_CODES.REQUEST_BODY_TOO_LARGE, {
          size: contentLength,
          maxSize,
        }),
      );
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
    const route = url.pathname;
    const requestType = getRequestType(route);

    logger.info('Request started', {
      route,
      requestType,
      method: request.method,
      path: route,
      query: url.search,
    });

    try {
      const response = await handler(request, env);
      const durationMs = Date.now() - start;

      logger.info('Request completed', {
        route,
        requestType,
        method: request.method,
        path: route,
        status: response.status,
        durationMs,
      });

      return response;
    } catch (error) {
      const durationMs = Date.now() - start;
      logger.error('Request failed', {
        route,
        requestType,
        method: request.method,
        path: route,
        durationMs,
        errorCode: getErrorCode(error),
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
 * 序列化 SSE 事件
 */
export function serializeSSEEvent(event: unknown): string {
  return JSON.stringify(event);
}
