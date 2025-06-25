/**
 * 缓存管理器
 * 用于缓存网络请求结果，减少重复请求
 */
export class CacheManager<T> {
  private cache = new Map<string, { data: T; timestamp: number; ttl: number }>();
  private defaultTTL: number;

  constructor(defaultTTL: number = 5 * 60 * 1000) { // 默认5分钟
    this.defaultTTL = defaultTTL;
  }

  /**
   * 设置缓存
   */
  set(key: string, data: T, ttl?: number): void {
    const timestamp = Date.now();
    const cacheTTL = ttl || this.defaultTTL;
    
    this.cache.set(key, {
      data,
      timestamp,
      ttl: cacheTTL
    });
  }

  /**
   * 获取缓存
   */
  get(key: string): T | null {
    const cached = this.cache.get(key);
    
    if (!cached) {
      return null;
    }

    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      // 缓存过期，删除并返回null
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * 检查是否有有效缓存
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 清理过期缓存
   */
  cleanup(): void {
    const now = Date.now();
    
    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > cached.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * 带缓存的异步函数包装器
   */
  async withCache<R>(
    key: string,
    fn: () => Promise<R>,
    ttl?: number
  ): Promise<R> {
    // 先检查缓存
    const cached = this.get(key) as R;
    if (cached !== null) {
      return cached;
    }

    // 执行函数并缓存结果
    const result = await fn();
    this.set(key, result as T, ttl);
    return result;
  }
}

/**
 * 全局缓存实例
 */
export const globalCache = new CacheManager<any>(10 * 60 * 1000); // 10分钟TTL

/**
 * HTTP请求缓存
 */
export const httpCache = new CacheManager<string>(5 * 60 * 1000); // 5分钟TTL

/**
 * 产品状态缓存
 */
export const productCache = new CacheManager<{ title: string; inStock: boolean }>(2 * 60 * 1000); // 2分钟TTL
