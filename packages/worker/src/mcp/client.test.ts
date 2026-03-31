import { describe, expect, it } from 'vitest';
import { createMCPClient, MCPClientImpl } from './client';
import type { ToolCall } from '../types';

describe('MCPClient', () => {
  it('应该创建客户端实例并暴露内置工具', () => {
    const client = createMCPClient();
    const toolNames = client.listTools().map((tool) => tool.name);

    expect(client.tools).toBeDefined();
    expect(client.resources).toBeDefined();
    expect(toolNames).toEqual(
      expect.arrayContaining(['execute_code', 'calculate', 'web_search', 'datetime', 'json_parser']),
    );
  });

  it('应该执行 calculate 工具', async () => {
    const client = createMCPClient();
    const result = await client.callTool('calculate', { expression: '1 + 2' });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('3');
  });

  it('应该在工具不存在时返回错误结果', async () => {
    const client = createMCPClient();
    const result = await client.callTool('missing', {});

    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
  });

  it('应该阻止危险代码执行', async () => {
    const client = createMCPClient();
    const result = await client.callTool('execute_code', { code: 'eval(\"alert(1)\")' });

    expect(result.content).toContain('dangerous');
  });

  it('应该支持并行调用多个工具', async () => {
    const client = createMCPClient() as MCPClientImpl;
    const calls: ToolCall[] = [
      { id: '1', name: 'calculate', arguments: { expression: '1 + 1' } },
      { id: '2', name: 'calculate', arguments: { expression: '2 + 2' } },
    ];

    const results = await client.callTools(calls);

    expect(results).toHaveLength(2);
    expect(results[0]?.content).toContain('2');
    expect(results[1]?.content).toContain('4');
  });

  it('应该记录工具统计并命中缓存', async () => {
    const client = createMCPClient() as MCPClientImpl;

    const result1 = await client.callTool('calculate', { expression: '123456789' });
    const result2 = await client.callTool('calculate', { expression: '123456789' });
    const stats = client.getStats();

    expect(result1.content).toBe(result2.content);
    expect(stats.calculate.calls).toBe(1);
  });
});
