/**
 * 重试机制工具
 */

export interface RetryOptions {
  /** 最大重试次数 */
  maxAttempts?: number;
  /** 初始延迟（毫秒） */
  initialDelay?: number;
  /** 最大延迟（毫秒） */
  maxDelay?: number;
  /** 退避乘数 */
  backoffMultiplier?: number;
  /** 可重试的错误判断 */
  retryableError?: (error: Error) => boolean;
  /** 每次重试前的回调 */
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryableError: () => true,
  onRetry: () => {},
};

/**
 * 带重试的异步函数执行
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;
  let delay = opts.initialDelay;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 最后一次尝试，直接抛出
      if (attempt === opts.maxAttempts) {
        throw lastError;
      }

      // 检查是否可重试
      if (!opts.retryableError(lastError)) {
        throw lastError;
      }

      // 等待重试
      opts.onRetry(attempt, lastError, delay);
      await sleep(delay);

      // 指数退避
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelay);
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * 睡眠函数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带超时的 Promise
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timeout'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    }),
  ]);
}

/**
 * 网络请求错误判断
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  
  // 网络错误
  if (message.includes('fetch') || 
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('abort')) {
    return true;
  }
  
  // HTTP 状态码判断
  const statusMatch = message.match(/status:\s*(\d+)/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);
    // 5xx 错误或 429 (限流) 可重试
    return status >= 500 || status === 429;
  }
  
  return false;
}
