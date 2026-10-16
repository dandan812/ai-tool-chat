/**
 * HTTP 中间件工具
 */

import type { Handler, Middleware } from '../types'
import { WorkerError, ValidationError } from '../types'
import { logger } from './logger'
import { createErrorDetails, ERROR_CODES, getErrorCode, getRequestType } from './observability'

/**
 * CORS 中间件
 */
export function withCORS(handler: Handler): Handler {
  return async (request, env) => {
    const origin = request.headers.get('Origin')
    const allowed = (env.ALLOWED_ORIGINS || 'https://i-tool-chat.store')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    if (
      (origin && !allowed.includes(origin)) ||
      (request.method !== 'GET' && request.method !== 'OPTIONS' && !origin)
    ) {
      return createJSONResponse(
        { error: { message: 'Request origin is not allowed', code: 'ORIGIN_REJECTED' } },
        403
      )
    }
    const response =
      request.method === 'OPTIONS'
        ? new Response(null, { status: 204 })
        : await handler(request, env)
    const headers = new Headers(response.headers)
    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin)
      headers.set('Access-Control-Allow-Credentials', 'true')
    }
    headers.set('Vary', 'Origin')
    headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, X-Account-ID')
    headers.set('Access-Control-Max-Age', '600')
    headers.set(
      'Cache-Control',
      response.headers.get('Content-Type')?.startsWith('text/event-stream')
        ? 'no-store, no-transform'
        : 'no-store'
    )
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(response.body, { status: response.status, headers })
  }
}

/**
 * 错误处理中间件
 */
export function withErrorHandler(handler: Handler): Handler {
  return async (request, env) => {
    const url = new URL(request.url)
    const route = url.pathname
    const requestType = getRequestType(route)

    try {
      return await handler(request, env)
    } catch (error) {
      let message: string
      let status: number
      let code: string
      let details: Record<string, unknown> | undefined

      if (error instanceof WorkerError) {
        message = error.message
        status = error.statusCode
        code = error.code
        details = error.details
      } else {
        message = error instanceof Error ? error.message : 'Internal Server Error'
        status = 500
        code = 'INTERNAL_ERROR'
      }

      logger.error('Request error response', {
        requestId: request.headers.get('X-Request-ID'),
        route,
        requestType,
        method: request.method,
        status,
        errorCode: getErrorCode(error) || code,
        errorType: error instanceof Error ? error.name : 'UnknownError'
      })

      return createJSONResponse(
        {
          error: {
            message,
            code,
            ...(details && { details })
          }
        },
        status
      )
    }
  }
}

/**
 * 请求验证中间件
 */
export function withValidation(handler: Handler): Handler {
  return async (request, env) => {
    // 验证请求方法
    if (request.method !== 'POST' && request.method !== 'GET') {
      throw new ValidationError(
        'Method Not Allowed',
        createErrorDetails(ERROR_CODES.REQUEST_METHOD_NOT_ALLOWED, { method: request.method })
      )
    }

    // GET 请求跳过 Content-Type 验证
    if (request.method === 'GET') {
      return handler(request, env)
    }

    // 验证 Content-Type
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
      throw new ValidationError(
        'Content-Type must be application/json or multipart/form-data',
        createErrorDetails(ERROR_CODES.REQUEST_UNSUPPORTED_CONTENT_TYPE, {
          contentType
        })
      )
    }

    // 验证请求体大小 (限制 10MB)
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10)
    const maxSize = 10 * 1024 * 1024 // 10MB
    if (contentLength > maxSize) {
      throw new ValidationError(
        'Request body too large',
        createErrorDetails(ERROR_CODES.REQUEST_BODY_TOO_LARGE, {
          size: contentLength,
          maxSize
        })
      )
    }

    // Bound the actual stream as well as Content-Length before parsers allocate it.
    if (request.body) {
      const limit = contentType.includes('multipart/form-data') ? 6 * 1024 * 1024 : 2 * 1024 * 1024
      const reader = request.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > limit) {
            await reader.cancel()
            throw new WorkerError('Request body too large', 'BODY_TOO_LARGE', 413)
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      return handler(new Request(request, { body: bytes }), env)
    }
    return handler(request, env)
  }
}

/**
 * 日志中间件
 */
export function withLogging(handler: Handler): Handler {
  return async (request, env) => {
    const start = Date.now()
    const url = new URL(request.url)
    const route = url.pathname
    const requestType = getRequestType(route)

    logger.info('Request started', {
      requestId: request.headers.get('X-Request-ID'),
      route,
      requestType,
      method: request.method,
      path: route
    })

    try {
      const response = await handler(request, env)
      const durationMs = Date.now() - start

      logger.info('Request completed', {
        requestId: request.headers.get('X-Request-ID'),
        route,
        requestType,
        method: request.method,
        path: route,
        status: response.status,
        durationMs
      })

      return response
    } catch (error) {
      const durationMs = Date.now() - start
      logger.error('Request failed', {
        requestId: request.headers.get('X-Request-ID'),
        route,
        requestType,
        method: request.method,
        path: route,
        durationMs,
        errorCode: getErrorCode(error),
        errorType: error instanceof Error ? error.name : 'UnknownError'
      })
      throw error
    }
  }
}

/**
 * 组合中间件
 */
export function compose(...middlewares: Middleware[]): Middleware {
  return (handler: Handler) => {
    return middlewares.reduceRight((acc, middleware) => middleware(acc), handler)
  }
}

/**
 * 创建 JSON 响应
 */
export function createJSONResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  })
}
