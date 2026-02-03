/**
 * 简单的内存缓存实现
 * 支持 TTL 和 LRU 淘汰策略
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  size: number;
}

export interface CacheOptions {
  /** 默认 TTL（毫秒） */
  defaultTTL?: number;
  /** 最大缓存条目数 */
  maxEntries?: number;
  /** 最大缓存大小（字节） */
  maxSize?: number;
}

export class Cache {
  private store = new Map<string, CacheEntry<unknown>>();
  private accessOrder: string[] = [];
  private currentSize = 0;
  private readonly defaultTTL: number;
  private readonly maxEntries: number;
  private readonly maxSize: number;

  constructor(options: CacheOptions = {}) {
    this.defaultTTL = options.defaultTTL ?? 5 * 60 * 1000; // 默认 5 分钟
    this.maxEntries = options.maxEntries ?? 1000;
    this.maxSize = options.maxSize ?? 10 * 1024 * 1024; // 默认 10MB
  }

  /**
   * 获取缓存值
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    
    if (!entry) {
      return undefined;
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return undefined;
    }

    // 更新访问顺序
    this.touch(key);
    return entry.value as T;
  }

  /**
   * 设置缓存值
   */
  set<T>(key: string, value: T, ttl?: number): void {
    const size = this.estimateSize(value);
    
    // 如果单个条目超过最大大小，不缓存
    if (size > this.maxSize * 0.1) {
      return;
    }

    // 清理过期条目
    this.cleanupExpired();

    // 确保有足够空间
    while (this.currentSize + size > this.maxSize && this.accessOrder.length > 0) {
      this.evictLRU();
    }

    // 如果已存在，先删除旧值
    if (this.store.has(key)) {
      this.delete(key);
    }

    // 如果超过最大条目数，淘汰最旧的
    if (this.store.size >= this.maxEntries) {
      this.evictLRU();
    }

    const expiresAt = Date.now() + (ttl ?? this.defaultTTL);
    this.store.set(key, { value, expiresAt, size });
    this.accessOrder.push(key);
    this.currentSize += size;
  }

  /**
   * 删除缓存条目
   */
  delete(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }

    this.store.delete(key);
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.currentSize -= entry.size;
    return true;
  }

  /**
   * 检查是否存在
   */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }

    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 获取或设置（缓存未命中时执行工厂函数）
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.store.clear();
    this.accessOrder = [];
    this.currentSize = 0;
  }

  /**
   * 获取缓存统计
   */
  getStats(): { entries: number; size: number; maxSize: number } {
    return {
      entries: this.store.size,
      size: this.currentSize,
      maxSize: this.maxSize,
    };
  }

  /**
   * 更新访问顺序
   */
  private touch(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
      this.accessOrder.push(key);
    }
  }

  /**
   * 淘汰最久未使用的条目
   */
  private evictLRU(): void {
    const key = this.accessOrder.shift();
    if (key) {
      this.delete(key);
    }
  }

  /**
   * 清理过期条目
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        expired.push(key);
      }
    }

    for (const key of expired) {
      this.delete(key);
    }
  }

  /**
   * 估算值的大小（字节）
   */
  private estimateSize(value: unknown): number {
    try {
      return new Blob([JSON.stringify(value)]).size;
    } catch {
      return 1024; // 默认 1KB
    }
  }
}

// 全局缓存实例
export const globalCache = new Cache();
