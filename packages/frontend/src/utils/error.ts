/**
 * 统一错误处理工具
 *
 * 将技术错误转换为用户友好的提示信息
 * 提供统一的错误分类和处理逻辑
 *
 * @package frontend/src/utils
 */

/**
 * 错误类型枚举
 */
export const ErrorType = {
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  STORAGE: 'storage',
  API: 'api',
  ABORT: 'abort',
  UNKNOWN: 'unknown'
} as const

export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType]

/**
 * 用户友好的错误消息映射
 */
const ERROR_MESSAGES: Record<string, string> = {
  // 网络错误
  'Failed to fetch': '网络连接失败，请检查网络设置',
  'NetworkError': '网络连接失败，请检查网络设置',
  'ERR_NETWORK': '网络连接失败，请检查网络设置',

  // 超时错误
  'TimeoutError': '请求超时，请稍后重试',
  'ERR_TIMEOUT': '请求超时，请稍后重试',

  // 存储错误
  'QuotaExceededError': '存储空间已满，已清理部分旧数据',
  'NS_ERROR_DOM_QUOTA_REACHED': '存储空间已满，已清理部分旧数据',

  // 中止错误
  'AbortError': '已停止生成',
  'ERR_CANCELED': '已停止生成',

  // API 错误
  'ECONNREFUSED': '服务器连接失败',
  'ECONNRESET': '连接已重置，请重试',
  'ENOTFOUND': '服务器地址无效',
  'ETIMEDOUT': '请求超时，请稍后重试',

  // HTTP 错误码
  'HTTP 400': '请求参数错误',
  'HTTP 401': '未授权，请检查配置',
  'HTTP 403': '无权访问',
  'HTTP 404': '资源不存在',
  'HTTP 429': '请求过于频繁，请稍后重试',
  'HTTP 500': '服务器错误，请稍后重试',
  'HTTP 502': '网关错误，请稍后重试',
  'HTTP 503': '服务暂时不可用',
}

/**
 * 获取用户友好的错误消息
 *
 * @param error - 错误对象
 * @param fallback - 默认错误消息
 * @returns 用户友好的错误消息
 */
export function getUserFriendlyError(error: Error | string, fallback: string = '出错了，请重试'): string {
  const errorMessage = typeof error === 'string' ? error : error.message

  // 直接匹配
  if (ERROR_MESSAGES[errorMessage]) {
    return ERROR_MESSAGES[errorMessage]
  }

  // 部分匹配
  for (const [key, value] of Object.entries(ERROR_MESSAGES)) {
    if (errorMessage.includes(key)) {
      return value
    }
  }

  // HTTP 状态码匹配
  const httpMatch = errorMessage.match(/HTTP (\d{3})/)
  if (httpMatch) {
    const statusCode = httpMatch[0]
    if (ERROR_MESSAGES[statusCode]) {
      return ERROR_MESSAGES[statusCode]
    }
  }

  return fallback
}

/**
 * 获取错误类型
 *
 * @param error - 错误对象
 * @returns 错误类型
 */
export function getErrorType(error: Error | string): ErrorType {
  const errorMessage = typeof error === 'string' ? error : error.message

  if (errorMessage.includes('fetch') ||
      errorMessage.includes('network') ||
      errorMessage.includes('ECONN') ||
      errorMessage.includes('ENOTFOUND')) {
    return ErrorType.NETWORK
  }

  if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
    return ErrorType.TIMEOUT
  }

  if (errorMessage.includes('Quota') || errorMessage.includes('quota')) {
    return ErrorType.STORAGE
  }

  if (errorMessage.includes('Abort') || errorMessage.includes('cancel')) {
    return ErrorType.ABORT
  }

  if (errorMessage.includes('HTTP') || errorMessage.includes('API')) {
    return ErrorType.API
  }

  return ErrorType.UNKNOWN
}

/**
 * 检查错误是否可重试
 *
 * @param error - 错误对象
 * @returns 是否可重试
 */
export function isRetryableError(error: Error | string): boolean {
  const errorType = getErrorType(error)
  return errorType === ErrorType.NETWORK ||
    errorType === ErrorType.TIMEOUT ||
    errorType === ErrorType.API
}

/**
 * 格式化完整错误信息（用于调试）
 *
 * @param error - 错误对象
 * @param context - 额外上下文信息
 * @returns 格式化的错误字符串
 */
export function formatError(error: Error | string, context?: Record<string, unknown>): string {
  const userMessage = getUserFriendlyError(error)
  const errorType = getErrorType(error)
  const errorMessage = typeof error === 'string' ? error : error.message

  return JSON.stringify({
    type: errorType,
    message: userMessage,
    original: errorMessage,
    context: context || {},
    timestamp: Date.now()
  })
}
