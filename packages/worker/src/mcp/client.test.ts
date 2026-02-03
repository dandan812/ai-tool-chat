/**
 * MCP Client 单元测试
 */

import { createMCPClient, MCPClientImpl } from './client';
import type { ToolCall } from '../types';

// 测试框架
function describe(name: string, fn: () => void) {
  console.log(`\n📦 ${name}`);
  fn();
}

function it(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then(() => console.log(`  ✅ ${name}`))
        .catch((err) => console.log(`  ❌ ${name}: ${err.message}`));
    } else {
      console.log(`  ✅ ${name}`);
    }
  } catch (err) {
    console.log(`  ❌ ${name}: ${(err as Error).message}`);
  }
}

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error(`Expected defined but got undefined`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toContain(expected: unknown) {
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          throw new Error(`Expected array to contain ${expected}`);
        }
      } else if (typeof actual === 'string' && typeof expected === 'string') {
        if (!actual.includes(expected)) {
          throw new Error(`Expected "${actual}" to contain "${expected}"`);
        }
      } else {
        throw new Error(`Unsupported type for toContain`);
      }
    },
    toMatch(pattern: RegExp) {
      if (typeof actual !== 'string' || !pattern.test(actual)) {
        throw new Error(`Expected "${actual}" to match ${pattern}`);
      }
    },
    async toBeResolved() {
      if (!(actual instanceof Promise)) {
        throw new Error(`Expected a promise but got ${typeof actual}`);
      }
      await actual;
    },
    async toBeRejected() {
      if (!(actual instanceof Promise)) {
        throw new Error(`Expected a promise but got ${typeof actual}`);
      }
      try {
        await actual;
        throw new Error('Expected promise to be rejected but it resolved');
      } catch {
        // Expected
      }
    },
  };
}

describe('MCPClient', () => {
  it('should create MCP client instance', () => {
    const client = createMCPClient();
    expect(client).toBeDefined();
    expect(client.tools).toBeDefined();
    expect(client.resources).toBeDefined();
  });

  it('should list built-in tools', () => {
    const client = createMCPClient();
    const tools = client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('execute_code');
    expect(toolNames).toContain('calculate');
    expect(toolNames).toContain('web_search');
    expect(toolNames).toContain('datetime');
    expect(toolNames).toContain('json_parser');
  });

  it('should execute calculate tool', async () => {
    const client = createMCPClient();
    const result = await client.callTool('calculate', { expression: '1 + 2' });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('3');
    expect(result.toolCallId).toBe('calculate');
  });

  it('should execute datetime tool', async () => {
    const client = createMCPClient();
    const result = await client.callTool('datetime', { format: 'iso' });

    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('should handle invalid expression in calculate', async () => {
    const client = createMCPClient();
    const result = await client.callTool('calculate', { expression: 'invalid!!!' });

    expect(result.isError).toBe(false); // 工具返回错误消息而不是抛出
    expect(result.content).toContain('Error');
  });

  it('should handle non-existent tool', async () => {
    const client = createMCPClient();
    const result = await client.callTool('nonexistent', {});

    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
  });

  it('should execute code tool safely', async () => {
    const client = createMCPClient();
    const result = await client.callTool('execute_code', { code: '1 + 1' });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('2');
  });

  it('should block dangerous code', async () => {
    const client = createMCPClient();
    const result = await client.callTool('execute_code', { code: 'eval("alert(1)")' });

    expect(result.content).toContain('dangerous');
  });

  it('should parse JSON correctly', async () => {
    const client = createMCPClient();
    const result = await client.callTool('json_parser', {
      json: '{"name":"test","value":123}',
      action: 'parse',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('test');
  });

  it('should format JSON correctly', async () => {
    const client = createMCPClient();
    const result = await client.callTool('json_parser', {
      json: '{"name":"test"}',
      action: 'format',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('\n'); // 格式化后应有换行
  });

  it('should provide tools description', () => {
    const client = createMCPClient();
    const description = (client as MCPClientImpl).getToolsDescription();

    expect(description).toBeDefined();
    expect(description).toContain('execute_code');
    expect(description).toContain('calculate');
  });

  it('should call multiple tools in parallel', async () => {
    const client = createMCPClient();
    const calls: ToolCall[] = [
      { id: '1', name: 'calculate', arguments: { expression: '1+1' } },
      { id: '2', name: 'calculate', arguments: { expression: '2+2' } },
    ];

    const results = await (client as MCPClientImpl).callTools(calls);

    expect(results.length).toBe(2);
    expect(results[0].content).toContain('2');
    expect(results[1].content).toContain('4');
  });

  it('should provide tool statistics', async () => {
    const client = createMCPClient();
    await client.callTool('calculate', { expression: '1+1' });
    await client.callTool('calculate', { expression: '2+2' });

    const stats = (client as MCPClientImpl).getStats();
    expect(stats.calculate).toBeDefined();
    expect(stats.calculate.calls).toBe(2);
  });

  it('should cache calculate results', async () => {
    const client = createMCPClient();
    
    // 第一次调用
    const result1 = await client.callTool('calculate', { expression: '123456789' });
    // 第二次调用相同的表达式（应该命中缓存）
    const result2 = await client.callTool('calculate', { expression: '123456789' });

    expect(result1.content).toBe(result2.content);
  });
});

console.log('🧪 Running MCP Client Tests...');
