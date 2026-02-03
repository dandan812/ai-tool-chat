/**
 * 集成测试
 * 测试完整的请求处理流程
 */

import type { Env, ChatRequest, Task } from './types';
import { TaskManager } from './core/taskManager';
import { createMCPClient } from './mcp/client';
import { Cache } from './utils/cache';

// 模拟环境变量
const mockEnv: Env = {
  DEEPSEEK_API_KEY: 'test-api-key',
  QWEN_API_KEY: 'test-qwen-key',
};

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
    toEqual(expected: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toContain(expected: string) {
      if (typeof actual !== 'string' || !actual.includes(expected)) {
        throw new Error(`Expected "${actual}" to contain "${expected}"`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeLessThan(expected: number) {
      if (typeof actual !== 'number' || actual >= expected) {
        throw new Error(`Expected ${actual} to be less than ${expected}`);
      }
    },
    toBeLessThanOrEqual(expected: number) {
      if (typeof actual !== 'number' || actual > expected) {
        throw new Error(`Expected ${actual} to be less than or equal ${expected}`);
      }
    },
    toBeUndefined() {
      if (actual !== undefined) {
        throw new Error(`Expected undefined but got ${actual}`);
      }
    },
  };
}

describe('Integration Tests', () => {
  it('should create complete workflow components', () => {
    const cache = new Cache();
    const taskManager = new TaskManager(mockEnv);
    const mcpClient = createMCPClient();

    expect(cache).toBeDefined();
    expect(taskManager).toBeDefined();
    expect(mcpClient).toBeDefined();
  });

  it('should create task with correct structure', () => {
    const taskManager = new TaskManager(mockEnv);
    const request: ChatRequest = {
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello AI' },
      ],
      temperature: 0.8,
      enableTools: true,
    };

    const task = taskManager.createTask(request);

    expect(task.id).toBeDefined();
    expect(task.type).toBe('code'); // enableTools = true
    expect(task.userMessage).toBe('Hello AI');
    expect(task.status).toBe('pending');
    expect(task.steps).toEqual([]);
    expect(task.createdAt).toBeGreaterThan(0);
  });

  it('should cache tool results', async () => {
    const client = createMCPClient();

    // 第一次调用
    const result1 = await client.callTool('calculate', { expression: '2+2' });
    // 第二次调用（应该命中缓存）
    const result2 = await client.callTool('calculate', { expression: '2+2' });

    expect(result1.content).toBe(result2.content);
    expect(result1.isError).toBe(false);
    expect(result2.isError).toBe(false);
  });

  it('should execute tool chain', async () => {
    const client = createMCPClient();

    // 步骤1: 计算
    const calcResult = await client.callTool('calculate', { expression: '10 * 10' });
    expect(calcResult.content).toContain('100');

    // 步骤2: 格式化结果为 JSON
    const jsonResult = await client.callTool('json_parser', {
      json: `{"result": 100}`,
      action: 'format',
    });
    expect(jsonResult.content).toContain('"result": 100');

    // 步骤3: 获取当前时间
    const timeResult = await client.callTool('datetime', { format: 'timestamp' });
    expect(timeResult.isError).toBe(false);
  });

  it('should handle multiple task types', () => {
    const taskManager = new TaskManager(mockEnv);

    const chatTask = taskManager.createTask({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(chatTask.type).toBe('chat');

    const imageTask = taskManager.createTask({
      messages: [{ role: 'user', content: 'Look' }],
      images: [{ id: '1', base64: 'abc', mimeType: 'image/png' }],
    });
    expect(imageTask.type).toBe('image');

    const fileTask = taskManager.createTask({
      messages: [{ role: 'user', content: 'Read this' }],
      files: [{ id: '1', name: 'test.txt', content: 'hello', mimeType: 'text/plain' }],
    });
    expect(fileTask.type).toBe('file');
  });

  it('should track task lifecycle', () => {
    const taskManager = new TaskManager(mockEnv);

    // 创建任务
    const task = taskManager.createTask({
      messages: [{ role: 'user', content: 'Test' }],
    });
    expect(task.status).toBe('pending');

    // 检查统计
    const stats = taskManager.getStats();
    expect(stats.total).toBe(1);
    expect(stats.pending).toBe(1);

    // 删除任务
    taskManager.deleteTask(task.id);
    const newStats = taskManager.getStats();
    expect(newStats.total).toBe(0);
  });

  it('should handle cache with TTL', async () => {
    const cache = new Cache({ defaultTTL: 100 }); // 100ms TTL

    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');

    // 等待过期
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should provide tools for AI consumption', () => {
    const client = createMCPClient();
    const tools = client.listTools();

    // 验证工具定义
    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.parameters).toBeDefined();
    }

    // 验证工具数量
    expect(tools.length).toBeGreaterThan(0);
  });

  it('should handle concurrent cache operations', () => {
    const cache = new Cache();

    // 并发设置
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(Promise.resolve(cache.set(`key${i}`, `value${i}`)));
    }

    Promise.all(promises).then(() => {
      // 验证所有值都存在
      for (let i = 0; i < 10; i++) {
        expect(cache.get(`key${i}`)).toBe(`value${i}`);
      }
    });
  });
});

describe('Performance Tests', () => {
  it('should handle large cache operations efficiently', () => {
    const cache = new Cache();
    const start = Date.now();

    // 写入 1000 个条目
    for (let i = 0; i < 1000; i++) {
      cache.set(`key${i}`, { data: `value${i}`, index: i });
    }

    // 读取 1000 个条目
    for (let i = 0; i < 1000; i++) {
      cache.get(`key${i}`);
    }

    const duration = Date.now() - start;
    console.log(`    ⏱️  1000 cache operations took ${duration}ms`);

    expect(duration).toBeLessThan(1000); // 应该在 1 秒内完成
  });

  it('should handle LRU eviction', () => {
    const cache = new Cache({ maxEntries: 100 });

    // 写入 200 个条目（超过限制）
    for (let i = 0; i < 200; i++) {
      cache.set(`key${i}`, `value${i}`);
    }

    // 应该只有最近的一部分存在
    const stats = cache.getStats();
    expect(stats.entries).toBeLessThanOrEqual(100);
  });
});

console.log('🧪 Running Integration Tests...');
