/**
 * MCP (Model Context Protocol) Client - 优化版
 * 管理 Tools 和 Resources，支持工具调用
 * 添加超时控制、安全沙箱、错误处理、工具链
 */
import type {
  MCPClient,
  MCPTool,
  MCPResource,
  ToolResult,
  ToolCall,
} from '../types';
import { logger } from '../utils/logger';
import { withTimeout, withRetry, isRetryableError } from '../utils/retry';
import { Cache } from '../utils/cache';

// 工具执行超时
const TOOL_TIMEOUT_MS = 30000;
const TOOL_RETRY_OPTIONS = {
  maxAttempts: 2,
  retryableError: isRetryableError,
};

// 工具定义
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string> | string;
  cacheable?: boolean; // 是否可缓存结果
}

// 工具执行上下文
interface ToolContext {
  callId: string;
  startTime: number;
}

export class MCPClientImpl implements MCPClient {
  private toolDefinitions = new Map<string, ToolDefinition>();
  private toolCache = new Cache({ defaultTTL: 5 * 60 * 1000 }); // 5分钟缓存
  resources: Map<string, MCPResource> = new Map();
  private executionStats = new Map<string, { calls: number; errors: number; totalTime: number }>();

  constructor() {
    this.registerBuiltinTools();
  }

  get tools(): Map<string, MCPTool> {
    const map = new Map<string, MCPTool>();
    for (const [name, def] of this.toolDefinitions) {
      map.set(name, {
        name: def.name,
        description: def.description,
        parameters: def.parameters,
      });
    }
    return map;
  }

  private registerBuiltinTools(): void {
    // 代码执行工具
    this.registerTool({
      name: 'execute_code',
      description: '执行 JavaScript/TypeScript 代码并返回结果',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '要执行的代码' },
          language: {
            type: 'string',
            enum: ['javascript', 'typescript'],
            description: '代码语言',
          },
        },
        required: ['code'],
      },
      cacheable: true,
      handler: async (args) => {
        const code = String(args.code || '');
        return this.safeExecuteCode(code);
      },
    });

    // 网页搜索工具
    this.registerTool({
      name: 'web_search',
      description: '搜索网页获取信息',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          num_results: {
            type: 'number',
            description: '返回结果数量',
            default: 5,
          },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const query = String(args.query || '');
        const numResults = Number(args.num_results) || 5;
        logger.info('Web search requested', { query, numResults });
        return `[Web search] Query: "${query}"\nNote: Web search integration not configured. Add a search API like SerpAPI or Bing Search.`;
      },
    });

    // 文件操作工具
    this.registerTool({
      name: 'file_operations',
      description: '读取或写入文件内容',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['read', 'write'],
            description: '操作类型',
          },
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '写入内容' },
        },
        required: ['operation', 'path'],
      },
      handler: async (args) => {
        const operation = String(args.operation);
        const path = String(args.path || '');

        if (this.isSensitivePath(path)) {
          throw new Error('Access to sensitive paths is not allowed');
        }

        if (operation === 'read') {
          return `[File read] Path: ${path}\nNote: File system access not available in Worker environment`;
        } else {
          const content = String(args.content || '');
          return `[File write] Path: ${path}, Content length: ${content.length}\nNote: File system access not available in Worker environment`;
        }
      },
    });

    // 数学计算工具
    this.registerTool({
      name: 'calculate',
      description: '执行数学计算',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '数学表达式' },
        },
        required: ['expression'],
      },
      cacheable: true,
      handler: async (args) => {
        const expression = String(args.expression || '');
        return this.safeCalculate(expression);
      },
    });

    // 时间日期工具
    this.registerTool({
      name: 'datetime',
      description: '获取当前日期和时间信息',
      parameters: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['iso', 'locale', 'timestamp'],
            description: '输出格式',
            default: 'locale',
          },
          timezone: {
            type: 'string',
            description: '时区',
            default: 'local',
          },
        },
      },
      handler: async (args) => {
        const format = String(args.format || 'locale');
        const date = new Date();

        switch (format) {
          case 'iso':
            return date.toISOString();
          case 'timestamp':
            return String(date.getTime());
          case 'locale':
          default:
            return date.toLocaleString();
        }
      },
    });

    // JSON 处理工具
    this.registerTool({
      name: 'json_parser',
      description: '解析和格式化 JSON 数据',
      parameters: {
        type: 'object',
        properties: {
          json: { type: 'string', description: 'JSON 字符串' },
          action: {
            type: 'string',
            enum: ['parse', 'format', 'validate'],
            description: '操作类型',
            default: 'parse',
          },
        },
        required: ['json'],
      },
      cacheable: true,
      handler: async (args) => {
        const jsonStr = String(args.json || '');
        const action = String(args.action || 'parse');

        try {
          const parsed = JSON.parse(jsonStr);

          switch (action) {
            case 'format':
              return JSON.stringify(parsed, null, 2);
            case 'validate':
              return 'Valid JSON';
            case 'parse':
            default:
              return JSON.stringify(parsed);
          }
        } catch (error) {
          return `Error: Invalid JSON - ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    });
  }

  private safeExecuteCode(code: string): string {
    const dangerousPatterns = [
      /eval\s*\(/i,
      /Function\s*\(/i,
      /import\s*\(/i,
      /fetch\s*\(/i,
      /XMLHttpRequest/i,
      /WebSocket/i,
      /localStorage/i,
      /sessionStorage/i,
      /document\./i,
      /window\./i,
      /globalThis\./i,
      /process\./i,
      /require\s*\(/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return 'Error: Potentially dangerous code detected';
      }
    }

    if (code.length > 10000) {
      return 'Error: Code too long (max 10000 characters)';
    }

    try {
      const sandbox = {
        Math,
        JSON,
        Date,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Error,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURI,
        decodeURI,
        encodeURIComponent,
        decodeURIComponent,
        console: { log: (...args: unknown[]) => args.join(' ') },
      };

      const sandboxKeys = Object.keys(sandbox);
      const sandboxValues = Object.values(sandbox);

      const fn = new Function(
        ...sandboxKeys,
        `"use strict"; try { return (${code}); } catch (e) { return "Error: " + e.message; }`
      );
      const result = fn(...sandboxValues);
      return `Result: ${result}`;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private safeCalculate(expression: string): string {
    const allowedPattern = /^[\d\s+\-*/().,^%MathPIsincoantlgehrqutomxyzaZE_]+$/i;

    if (!allowedPattern.test(expression)) {
      return 'Error: Invalid characters in expression';
    }

    if (expression.length > 500) {
      return 'Error: Expression too long';
    }

    try {
      const safeExpr = expression.replace(/\^/g, '**');
      const result = Function('"use strict"; return (' + safeExpr + ')')();
      return `Result: ${result}`;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private isSensitivePath(path: string): boolean {
    const sensitivePatterns = [
      /\.\.\//,
      /^\//,
      /\\/,
      /etc\/passwd/i,
      /\.env/i,
      /\.git/i,
      /\.ssh/i,
      /\/etc\//,
      /\/root\//,
      /C:\\/,
    ];
    return sensitivePatterns.some((pattern) => pattern.test(path));
  }

  registerTool(tool: ToolDefinition): void {
    this.toolDefinitions.set(tool.name, tool);
    logger.info(`Tool registered: ${tool.name}`);
  }

  registerResource(resource: MCPResource): void {
    this.resources.set(resource.uri, resource);
    logger.info(`Resource registered: ${resource.uri}`);
  }

  listTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.toolDefinitions.get(name);
    if (!tool) {
      return { toolCallId: name, content: `Tool "${name}" not found`, isError: true };
    }

    // 生成缓存键
    const cacheKey = tool.cacheable ? this.generateCacheKey(name, args) : null;

    // 检查缓存
    if (cacheKey) {
      const cached = this.toolCache.get<string>(cacheKey);
      if (cached !== undefined) {
        logger.debug(`Tool cache hit: ${name}`);
        return { toolCallId: name, content: cached, isError: false };
      }
    }

    const context: ToolContext = {
      callId: `${name}-${Date.now()}`,
      startTime: Date.now(),
    };

    logger.info(`Calling tool: ${name}`, { args });

    try {
      // 使用重试机制执行工具
      const result = await withRetry(
        () =>
          withTimeout(
            Promise.resolve(tool.handler(args)),
            TOOL_TIMEOUT_MS,
            `Tool "${name}" execution timeout`
          ),
        TOOL_RETRY_OPTIONS
      );

      // 更新统计
      this.updateStats(name, true, Date.now() - context.startTime);

      // 缓存结果
      if (cacheKey) {
        this.toolCache.set(cacheKey, result);
      }

      return { toolCallId: name, content: result, isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Tool execution failed: ${name}`, error);

      // 更新统计
      this.updateStats(name, false, Date.now() - context.startTime);

      return { toolCallId: name, content: message, isError: true };
    }
  }

  async callTools(calls: ToolCall[]): Promise<ToolResult[]> {
    // 并行执行多个工具调用
    return Promise.all(calls.map((call) => this.callTool(call.name, call.arguments)));
  }

  getToolsDescription(): string {
    const tools = this.listTools();
    if (tools.length === 0) return '';

    return `\n\nYou have access to the following tools:\n${tools
      .map(
        (t) =>
          `- ${t.name}: ${t.description}\n  Parameters: ${JSON.stringify(t.parameters)}`
      )
      .join('\n')}\n\nTo use a tool, respond with: {"tool": "tool_name", "arguments": {}}`;
  }

  /**
   * 获取工具执行统计
   */
  getStats(): Record<string, { calls: number; errors: number; avgTime: number }> {
    const stats: Record<string, { calls: number; errors: number; avgTime: number }> = {};
    for (const [name, data] of this.executionStats) {
      stats[name] = {
        calls: data.calls,
        errors: data.errors,
        avgTime: data.calls > 0 ? Math.round(data.totalTime / data.calls) : 0,
      };
    }
    return stats;
  }

  private updateStats(name: string, success: boolean, duration: number): void {
    const existing = this.executionStats.get(name);
    if (existing) {
      existing.calls++;
      existing.totalTime += duration;
      if (!success) existing.errors++;
    } else {
      this.executionStats.set(name, {
        calls: 1,
        errors: success ? 0 : 1,
        totalTime: duration,
      });
    }
  }

  private generateCacheKey(name: string, args: Record<string, unknown>): string {
    return `tool:${name}:${JSON.stringify(args)}`;
  }
}

export function createMCPClient(): MCPClient {
  return new MCPClientImpl();
}
