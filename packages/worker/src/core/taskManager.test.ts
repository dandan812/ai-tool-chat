/**
 * TaskManager 单元测试
 */

import { TaskManager } from './taskManager';
import type { Env, ChatRequest } from '../types';

// 模拟环境变量
const mockEnv: Env = {
  DEEPSEEK_API_KEY: 'test-api-key',
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
    toEqual(expected: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error(`Expected defined but got undefined`);
      }
    },
    toBeUndefined() {
      if (actual !== undefined) {
        throw new Error(`Expected undefined but got ${actual}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toContain(expected: string) {
      if (typeof actual !== 'string' || !actual.includes(expected)) {
        throw new Error(`Expected "${actual}" to contain "${expected}"`);
      }
    },
    toBeOneOf(expected: unknown[]) {
      if (!expected.includes(actual)) {
        throw new Error(`Expected ${actual} to be one of ${JSON.stringify(expected)}`);
      }
    },
  };
}

describe('TaskManager', () => {
  it('should create a task manager instance', () => {
    const manager = new TaskManager(mockEnv);
    expect(manager).toBeDefined();
  });

  it('should create a new task', () => {
    const manager = new TaskManager(mockEnv);
    const request: ChatRequest = {
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const task = manager.createTask(request);

    expect(task.id).toBeDefined();
    expect(task.status).toBe('pending');
    expect(task.type).toBe('chat');
    expect(task.userMessage).toBe('Hello');
    expect(task.steps).toEqual([]);
    expect(task.createdAt).toBeGreaterThan(0);
    expect(task.updatedAt).toBeGreaterThan(0);
  });

  it('should determine task type correctly', () => {
    const manager = new TaskManager(mockEnv);

    const chatTask = manager.createTask({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(chatTask.type).toBe('chat');

    const imageTask = manager.createTask({
      messages: [{ role: 'user', content: 'Look at this' }],
      images: [{ id: '1', base64: 'abc', mimeType: 'image/png' }],
    });
    expect(imageTask.type).toBe('image');

    const codeTask = manager.createTask({
      messages: [{ role: 'user', content: 'Write code' }],
      enableTools: true,
    });
    expect(codeTask.type).toBe('code');
  });

  it('should get a task by id', () => {
    const manager = new TaskManager(mockEnv);
    const request: ChatRequest = {
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const task = manager.createTask(request);
    const retrieved = manager.getTask(task.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(task.id);
  });

  it('should return undefined for non-existent task', () => {
    const manager = new TaskManager(mockEnv);
    const retrieved = manager.getTask('non-existent-id');
    expect(retrieved).toBeUndefined();
  });

  it('should list all tasks', () => {
    const manager = new TaskManager(mockEnv);

    manager.createTask({ messages: [{ role: 'user', content: 'Hello 1' }] });
    manager.createTask({ messages: [{ role: 'user', content: 'Hello 2' }] });

    const tasks = manager.listTasks();
    expect(tasks.length).toBe(2);
  });

  it('should delete a task', () => {
    const manager = new TaskManager(mockEnv);
    const task = manager.createTask({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    const deleted = manager.deleteTask(task.id);
    expect(deleted).toBe(true);

    const retrieved = manager.getTask(task.id);
    expect(retrieved).toBeUndefined();
  });

  it('should return false when deleting non-existent task', () => {
    const manager = new TaskManager(mockEnv);
    const deleted = manager.deleteTask('non-existent');
    expect(deleted).toBe(false);
  });

  it('should provide stats', () => {
    const manager = new TaskManager(mockEnv);

    manager.createTask({ messages: [{ role: 'user', content: 'Hello 1' }] });
    manager.createTask({ messages: [{ role: 'user', content: 'Hello 2' }] });

    const stats = manager.getStats();
    expect(stats.total).toBe(2);
    expect(stats.pending).toBe(2);
    expect(stats.running).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
  });
});

console.log('🧪 Running TaskManager Tests...');
