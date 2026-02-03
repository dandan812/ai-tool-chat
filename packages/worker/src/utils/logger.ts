/**
 * 日志工具 - 结构化日志
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
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
    return {
      timestamp: new Date().toISOString(),
      level,
      message: `${this.prefix} ${message}`,
      data,
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
      const errorData = error instanceof Error 
        ? { message: error.message, stack: error.stack }
        : error;
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
