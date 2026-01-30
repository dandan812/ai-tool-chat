/**
 * MCP (Model Context Protocol) Client
 * 管理 Tools 和 Resources，支持工具调用
 */
import type { MCPClient, MCPTool, MCPResource, ToolResult, ToolCall } from '../types';

export class MCPClientImpl implements MCPClient {
  tools: Map<string, MCPTool> = new Map();
  resources: Map<string, MCPResource> = new Map();

  constructor() {
    // 注册内置工具
    this.registerBuiltinTools();
  }

  /**
   * 注册内置工具
   */
  private registerBuiltinTools(): void {
    // 代码执行工具
    this.registerTool({
      name: 'execute_code',
      description: '执行 JavaScript/TypeScript 代码并返回结果',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '要执行的代码',
          },
          language: {
            type: 'string',
            enum: ['javascript', 'typescript'],
            description: '代码语言',
          },
        },
        required: ['code'],
      },
    });

    // 网页搜索工具
    this.registerTool({
      name: 'web_search',
      description: '搜索网页获取信息',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词',
          },
          num_results: {
            type: 'number',
            description: '返回结果数量',
            default: 5,
          },
        },
        required: ['query'],
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
          path: {
            type: 'string',
            description: '文件路径',
          },
          content: {
            type: 'string',
            description: '写入内容（仅 write 操作需要）',
          },
        },
        required: ['operation', 'path'],
      },
    });

    // 数学计算工具
    this.registerTool({
      name: 'calculate',
      description: '执行数学计算',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '数学表达式，如 "2 + 2" 或 "Math.sin(30)"',
          },
        },
        required: ['expression'],
      },
    });
  }

  /**
   * 注册工具
   */
  registerTool(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
    console.log(`[MCP] Tool registered: ${tool.name}`);
  }

  /**
   * 注册资源
   */
  registerResource(resource: MCPResource): void {
    this.resources.set(resource.uri, resource);
    console.log(`[MCP] Resource registered: ${resource.uri}`);
  }

  /**
   * 列出所有工具
   */
  listTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        toolCallId: name,
        content: `Tool "${name}" not found`,
        isError: true,
      };
    }

    try {
      const result = await this.executeTool(name, args);
      return {
        toolCallId: name,
        content: result,
        isError: false,
      };
    } catch (error) {
      return {
        toolCallId: name,
        content: String(error),
        isError: true,
      };
    }
  }

  /**
   * 执行具体工具逻辑
   */
  private async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'execute_code': {
        const code = args.code as string;
        // 注意：实际环境中需要沙箱执行
        return `[Code execution simulated]\nCode: ${code.slice(0, 100)}...`;
      }

      case 'web_search': {
        const query = args.query as string;
        const numResults = (args.num_results as number) || 5;
        // 模拟搜索结果
        return `[Web search simulated]\nQuery: "${query}"\nFound ${numResults} results`;
      }

      case 'file_operations': {
        const operation = args.operation as string;
        const path = args.path as string;
        if (operation === 'read') {
          return `[File read simulated]\nPath: ${path}`;
        } else {
          const content = args.content as string;
          return `[File write simulated]\nPath: ${path}\nContent: ${content?.slice(0, 50)}...`;
        }
      }

      case 'calculate': {
        const expression = args.expression as string;
        try {
          // 简单的安全计算（实际应使用更安全的计算库）
          const result = Function('"use strict"; return (' + expression + ')')();
          return `Result: ${result}`;
        } catch {
          return `Error: Invalid expression "${expression}"`;
        }
      }

      default:
        return `Tool "${name}" execution not implemented`;
    }
  }

  /**
   * 获取工具描述（用于 Prompt）
   */
  getToolsDescription(): string {
    const tools = this.listTools();
    if (tools.length === 0) return '';

    return `\n\nYou have access to the following tools:\n${tools
      .map(
        (tool) =>
          `- ${tool.name}: ${tool.description}\n  Parameters: ${JSON.stringify(
            tool.parameters
          )}`
      )
      .join('\n')}\n\nTo use a tool, respond with: <tool>${JSON.stringify({
        tool: 'tool_name',
        arguments: {},
      })}</tool>`;
  }
}

/**
 * 创建 MCP Client 实例
 */
export function createMCPClient(): MCPClient {
  return new MCPClientImpl();
}
