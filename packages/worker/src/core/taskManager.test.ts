import { describe, expect, it, vi } from 'vitest';
import type { ChatRequest } from '../types';
import { createMockEnv } from '../test/mocks';

vi.mock('../skills', () => ({
  selectSkill: () => ({
    skill: {
      name: 'mock-text',
      type: 'text',
      description: 'mock skill',
      async *execute() {
        yield { type: 'content', content: 'mock reply' };
        yield { type: 'complete' };
      },
    },
    model: 'mock-model',
    label: '调用 Mock 模型',
    description: '模拟技能执行',
    toolingMode: 'disabled',
  }),
}));

vi.mock('../mcp/client', () => ({
  createMCPClient: () => ({
    tools: new Map(),
    resources: new Map(),
    callTool: vi.fn(),
    listTools: () => [],
  }),
}));

import { TaskManager } from './taskManager';

describe('TaskManager', () => {
  it('应该创建待执行任务', () => {
    const manager = new TaskManager(createMockEnv());
    const request: ChatRequest = {
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const task = manager.createTask(request);

    expect(task.status).toBe('pending');
    expect(task.type).toBe('chat');
    expect(task.userMessage).toBe('Hello');
    expect(task.steps).toEqual([]);
  });

  it('应该根据请求内容推断任务类型', () => {
    const manager = new TaskManager(createMockEnv());

    expect(
      manager.createTask({ messages: [{ role: 'user', content: 'hi' }] }).type,
    ).toBe('chat');

    expect(
      manager.createTask({
        messages: [{ role: 'user', content: 'look' }],
        images: [{ id: '1', base64: 'a', mimeType: 'image/png' }],
      }).type,
    ).toBe('image');

    expect(
      manager.createTask({
        messages: [{ role: 'user', content: 'file' }],
        files: [{
          fileId: 'f1',
          fileName: 'demo.txt',
          mimeType: 'text/plain',
          size: 1,
          fileHash: 'hash',
          source: 'uploaded',
        }],
      }).type,
    ).toBe('file');
  });

  it('应该输出完整的任务步骤流并更新状态', async () => {
    const manager = new TaskManager(createMockEnv());
    const request: ChatRequest = {
      messages: [{ role: 'user', content: '请回答' }],
    };

    const task = manager.createTask(request);
    const events: Array<{ type: string; data: unknown }> = [];

    for await (const event of manager.executeTask(task.id, request)) {
      events.push(event);
    }

    const completedTask = manager.getTask(task.id);
    const eventTypes = events.map((event) => event.type);

    expect(eventTypes).toContain('task');
    expect(eventTypes).toContain('step');
    expect(eventTypes).toContain('content');
    expect(eventTypes).toContain('complete');
    expect(completedTask?.status).toBe('completed');
    expect(completedTask?.result).toBe('mock reply');
    expect(completedTask?.metadata?.model).toBe('mock-model');
  });

  it('应该提供任务统计', () => {
    const manager = new TaskManager(createMockEnv());
    manager.createTask({ messages: [{ role: 'user', content: 'a' }] });
    manager.createTask({ messages: [{ role: 'user', content: 'b' }] });

    expect(manager.getStats()).toEqual({
      total: 2,
      pending: 2,
      running: 0,
      completed: 0,
      failed: 0,
    });
  });
});
