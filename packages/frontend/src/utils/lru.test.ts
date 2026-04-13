import { describe, expect, it } from 'vitest'
import { LRUCache } from './lru'

describe('LRUCache', () => {
  it('应该在命中后提升最近访问顺序', () => {
    const cache = new LRUCache<string, string>(2)
    cache.set('a', '1')
    cache.set('b', '2')

    expect(cache.get('a')).toBe('1')
    cache.set('c', '3')

    expect(cache.get('a')).toBe('1')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('3')
  })

  it('应该在更新已存在 key 时保留最新值', () => {
    const cache = new LRUCache<string, string>(2)
    cache.set('a', '1')
    cache.set('a', '2')

    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBe('2')
  })
})
