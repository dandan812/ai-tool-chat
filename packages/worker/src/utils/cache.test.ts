/**
 * Cache 模块单元测试
 */

import { Cache } from './cache';

// 简单的测试框架
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
    toBeUndefined() {
      if (actual !== undefined) {
        throw new Error(`Expected undefined but got ${actual}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error(`Expected defined but got undefined`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null but got ${actual}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
  };
}

// 测试套件
describe('Cache', () => {
  it('should set and get values', () => {
    const cache = new Cache();
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return undefined for non-existent keys', () => {
    const cache = new Cache();
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should expire values after TTL', async () => {
    const cache = new Cache({ defaultTTL: 50 }); // 50ms TTL
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');

    // 等待过期
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should check existence with has()', () => {
    const cache = new Cache();
    cache.set('key1', 'value1');
    expect(cache.has('key1')).toBe(true);
    expect(cache.has('nonexistent')).toBe(false);
  });

  it('should delete values', () => {
    const cache = new Cache();
    cache.set('key1', 'value1');
    expect(cache.delete('key1')).toBe(true);
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.delete('key1')).toBe(false);
  });

  it('should clear all values', () => {
    const cache = new Cache();
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.clear();
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBeUndefined();
  });

  it('should support getOrSet pattern', async () => {
    const cache = new Cache();
    let factoryCalls = 0;

    const factory = async () => {
      factoryCalls++;
      return 'computed';
    };

    const result1 = await cache.getOrSet('key1', factory);
    const result2 = await cache.getOrSet('key1', factory);

    expect(result1).toBe('computed');
    expect(result2).toBe('computed');
    expect(factoryCalls).toBe(1); // 工厂只应被调用一次
  });

  it('should provide stats', () => {
    const cache = new Cache();
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');

    const stats = cache.getStats();
    expect(stats.entries).toBe(2);
    expect(stats.size).toBeGreaterThan(0);
  });

  it('should handle object values', () => {
    const cache = new Cache();
    const obj = { name: 'test', nested: { value: 123 } };
    cache.set('obj', obj);
    expect(cache.get('obj')).toEqual(obj);
  });
});

// 运行测试
console.log('🧪 Running Cache Tests...');
