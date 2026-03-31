import { describe, expect, it } from 'vitest';
import { Cache } from './cache';

describe('Cache', () => {
  it('应该正常设置和读取缓存值', () => {
    const cache = new Cache();
    cache.set('key1', 'value1');

    expect(cache.get('key1')).toBe('value1');
  });

  it('不存在的键应该返回 undefined', () => {
    const cache = new Cache();
    expect(cache.get('missing')).toBeUndefined();
  });

  it('TTL 到期后应该返回 undefined', async () => {
    const cache = new Cache({ defaultTTL: 50 });
    cache.set('key1', 'value1');

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(cache.get('key1')).toBeUndefined();
  });

  it('getOrSet 应该只调用一次工厂函数', async () => {
    const cache = new Cache();
    let calls = 0;

    const factory = async () => {
      calls += 1;
      return 'computed';
    };

    await expect(cache.getOrSet('key1', factory)).resolves.toBe('computed');
    await expect(cache.getOrSet('key1', factory)).resolves.toBe('computed');
    expect(calls).toBe(1);
  });

  it('统计信息应该反映当前缓存情况', () => {
    const cache = new Cache();
    cache.set('key1', 'value1');
    cache.set('key2', { name: 'value2' });

    const stats = cache.getStats();

    expect(stats.entries).toBe(2);
    expect(stats.size).toBeGreaterThan(0);
  });
});
