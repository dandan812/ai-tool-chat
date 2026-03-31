/**
 * 日志工具 - 结构化日志
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]),
    );
  }

  return value;
}

class Logger {
  private level: LogLevel = 'info';
  private prefix = '[Worker]';

  constructor(prefix?: string) {
    if (prefix) {
      this.prefix = prefix;
    }
  }

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * 格式化日志
   */
  private format(level: LogLevel, message: string, data?: unknown): LogEntry {
    const baseEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: `${this.prefix} ${message}`,
    };

    if (data === undefined) {
      return baseEntry;
    }

    if (isRecord(data)) {
      return {
        ...baseEntry,
        ...normalizeValue(data) as Record<string, unknown>,
      };
    }

    return {
      ...baseEntry,
      data: normalizeValue(data),
    };
  }

  /**
   * 检查日志级别
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) {
      console.log(JSON.stringify(this.format('debug', message, data)));
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      console.log(JSON.stringify(this.format('info', message, data)));
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(JSON.stringify(this.format('warn', message, data)));
    }
  }

  error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      const errorData = normalizeValue(error);
      console.error(JSON.stringify(this.format('error', message, errorData)));
    }
  }

  /**
   * 创建带上下文的子 Logger
   */
  child(prefix: string): Logger {
    return new Logger(`${this.prefix} ${prefix}`);
  }
}

// 全局 Logger 实例
export const logger = new Logger();

// 默认导出
export default Logger;
