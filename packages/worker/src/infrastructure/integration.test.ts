import { describe, expect, it, vi } from 'vitest';
import { Cache } from '../utils/cache';
import { TaskManager } from '../core/taskManager';
import { createMCPClient } from '../mcp/client';
import { createMockEnv } from '../test/mocks';
import type { ChatRequest } from '../types';

vi.mock('../skills', () => ({
  selectSkill: () => ({
    skill: {
      name: 'mock-text',
      type: 'text',
      description: 'mock skill',
      async *execute() {
        yield { type: 'content', content: 'mock answer' };
        yield { type: 'complete' };
      },
    },
    model: 'mock-model',
    label: '调用 Mock 模型',
    description: '模拟技能执行',
    toolingMode: 'disabled',
  }),
}));

describe('集成测试', () => {
  it('应该创建完整工作流所需的核心对象', () => {
    const cache = new Cache();
    const taskManager = new TaskManager(createMockEnv());
    const mcpClient = createMCPClient();

    expect(cache).toBeDefined();
    expect(taskManager).toBeDefined();
    expect(mcpClient).toBeDefined();
  });

  it('应该能创建并执行一条聊天任务', async () => {
    const env = createMockEnv();
    const taskManager = new TaskManager(env);
    const request: ChatRequest = {
      messages: [{ role: 'user', content: 'Hello AI' }],
    };

    const task = taskManager.createTask(request);
    const chunks: string[] = [];

    for await (const event of taskManager.executeTask(task.id, request)) {
      if (event.type === 'content') {
        chunks.push((event.data as { content: string }).content);
      }
    }

    expect(chunks.join('')).toContain('mock answer');
    expect(taskManager.getTask(task.id)?.status).toBe('completed');
  });

  it('应该保留工具缓存行为', async () => {
    const client = createMCPClient();

    const first = await client.callTool('calculate', { expression: '2+2' });
    const second = await client.callTool('calculate', { expression: '2+2' });

    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(first.content).toBe(second.content);
  });
});
