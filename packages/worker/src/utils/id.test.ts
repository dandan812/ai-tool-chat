/**
 * ID 生成工具单元测试
 */

import { generateId, generateULID, generateShortId, generateTaskId, generateStepId, now } from './id';

// 测试框架
function describe(name: string, fn: () => void) {
  console.log(`\n📦 ${name}`);
  fn();
}

function it(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
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
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toMatch(pattern: RegExp) {
      if (typeof actual !== 'string' || !pattern.test(actual)) {
        throw new Error(`Expected "${actual}" to match ${pattern}`);
      }
    },
    toHaveLength(expected: number) {
      const length = (actual as string).length;
      if (length !== expected) {
        throw new Error(`Expected length ${expected} but got ${length}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error(`Expected defined but got undefined`);
      }
    },
    toBeType(type: string) {
      if (typeof actual !== type) {
        throw new Error(`Expected type ${type} but got ${typeof actual}`);
      }
    },
  };
}

describe('ID Generation', () => {
  it('should generate unique IDs', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    if (id1 === id2) {
      throw new Error('IDs should be unique');
    }
  });

  it('should generate ULID format', () => {
    const ulid = generateULID();
    expect(ulid).toHaveLength(26); // ULID 是 26 个字符
    expect(ulid).toMatch(/^[0-9A-Z]{26}$/i);
  });

  it('should generate short ID (8 chars)', () => {
    const shortId = generateShortId();
    expect(shortId).toHaveLength(8);
  });

  it('should generate task ID with prefix', () => {
    const taskId = generateTaskId();
    expect(taskId).toMatch(/^task-/);
    expect(taskId.length).toBeGreaterThan(10);
  });

  it('should generate step ID with prefix', () => {
    const stepId = generateStepId();
    expect(stepId).toMatch(/^step-/);
    expect(stepId.length).toBeGreaterThan(10);
  });

  it('should return current timestamp', () => {
    const before = Date.now();
    const n = now();
    const after = Date.now();
    expect(n).toBeGreaterThan(before - 1);
    expect(n).toBeType('number');
  });

  it('should generate unique ULIDs', () => {
    const ulids = new Set();
    for (let i = 0; i < 100; i++) {
      ulids.add(generateULID());
    }
    expect(ulids.size).toBe(100); // 所有 ULID 应该是唯一的
  });
});

console.log('🧪 Running ID Tests...');
