/**
 * 优化的缓存管理器
 * 支持LRU淘汰、统计信息、批量操作等高级功能
 */
export class OptimizedCacheManager<T> {
  private cache = new Map<string, { 
    value: T; 
    expiry: number; 
    accessCount: number; 
    lastAccess: number;
    size: number; // 估算的内存大小
  }>();
  private defaultTTL: number;
  private maxSize: number;
  private maxMemory: number; // 最大内存使用量（字节）
  private currentMemory: number = 0;
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
    memoryUsage: 0
  };

  constructor(
    defaultTTL: number = 5 * 60 * 1000, 
    maxSize: number = 1000,
    maxMemory: number = 50 * 1024 * 1024 // 50MB
  ) {
    this.defaultTTL = defaultTTL;
    this.maxSize = maxSize;
    this.maxMemory = maxMemory;
    
    // 定期清理过期项和统计信息
    setInterval(() => {
      this.cleanup();
      this.updateMemoryStats();
    }, Math.min(defaultTTL / 4, 30000)); // 最多每30秒清理一次
  }

  /**
   * 设置缓存项
   */
  set(key: string, value: T, ttl?: number): void {
    const now = Date.now();
    const expiry = now + (ttl || this.defaultTTL);
    const size = this.estimateSize(value);

    // 检查是否需要淘汰
    this.ensureCapacity(size);

    // 如果key已存在，先删除旧值
    if (this.cache.has(key)) {
      const oldItem = this.cache.get(key)!;
      this.currentMemory -= oldItem.size;
    }

    this.cache.set(key, {
      value,
      expiry,
      accessCount: 0,
      lastAccess: now,
      size
    });

    this.currentMemory += size;
    this.stats.sets++;
  }

  /**
   * 获取缓存项
   */
  get(key: string): T | null {
    const item = this.cache.get(key);
    
    if (!item) {
      this.stats.misses++;
      return null;
    }

    const now = Date.now();
    
    // 检查是否过期
    if (now > item.expiry) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }

    // 更新访问信息
    item.accessCount++;
    item.lastAccess = now;
    this.stats.hits++;

    return item.value;
  }

  /**
   * 删除缓存项
   */
  delete(key: string): boolean {
    const item = this.cache.get(key);
    if (item) {
      this.currentMemory -= item.size;
      this.cache.delete(key);
      this.stats.deletes++;
      return true;
    }
    return false;
  }

  /**
   * 检查缓存项是否存在且未过期
   */
  has(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;
    
    if (Date.now() > item.expiry) {
      this.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * 批量设置
   */
  setMany(items: Array<{ key: string; value: T; ttl?: number }>): void {
    for (const item of items) {
      this.set(item.key, item.value, item.ttl);
    }
  }

  /**
   * 批量获取
   */
  getMany(keys: string[]): Map<string, T> {
    const result = new Map<string, T>();
    for (const key of keys) {
      const value = this.get(key);
      if (value !== null) {
        result.set(key, value);
      }
    }
    return result;
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

  /**
   * 确保缓存容量
   */
  private ensureCapacity(newItemSize: number): void {
    // 检查数量限制
    while (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    // 检查内存限制
    while (this.currentMemory + newItemSize > this.maxMemory && this.cache.size > 0) {
      this.evictLRU();
    }
  }

  /**
   * LRU淘汰策略
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, item] of this.cache) {
      if (item.lastAccess < oldestTime) {
        oldestTime = item.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * 清理过期项
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, item] of this.cache) {
      if (now > item.expiry) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.delete(key);
    }
  }

  /**
   * 估算对象大小（简单实现）
   */
  private estimateSize(value: T): number {
    try {
      const str = JSON.stringify(value);
      return str.length * 2; // 假设每个字符占2字节
    } catch {
      return 1024; // 默认1KB
    }
  }

  /**
   * 更新内存统计
   */
  private updateMemoryStats(): void {
    this.stats.memoryUsage = this.currentMemory;
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    size: number;
    hitRate: number;
    memoryUsage: number;
    maxMemory: number;
    hits: number;
    misses: number;
    sets: number;
    deletes: number;
    evictions: number;
  } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;

    // 更新内存使用统计
    this.stats.memoryUsage = this.currentMemory;

    return {
      size: this.cache.size,
      hitRate,
      maxMemory: this.maxMemory,
      ...this.stats
    };
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.currentMemory = 0;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      memoryUsage: 0
    };
  }

  /**
   * 获取所有键
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 获取内存使用情况
   */
  getMemoryUsage(): { current: number; max: number; percentage: number } {
    return {
      current: this.currentMemory,
      max: this.maxMemory,
      percentage: (this.currentMemory / this.maxMemory) * 100
    };
  }

  /**
   * 设置最大内存限制
   */
  setMaxMemory(maxMemory: number): void {
    this.maxMemory = maxMemory;
    this.ensureCapacity(0); // 触发清理
  }

  /**
   * 预热缓存
   */
  async warmup(items: Array<{ key: string; fn: () => Promise<T>; ttl?: number }>): Promise<void> {
    const promises = items.map(async (item) => {
      try {
        const value = await item.fn();
        this.set(item.key, value, item.ttl);
      } catch (error) {
        console.warn(`缓存预热失败: ${item.key}`, error);
      }
    });

    await Promise.allSettled(promises);
  }
}

/**
 * 全局缓存实例
 */
export const globalCache = new OptimizedCacheManager<any>(10 * 60 * 1000, 1000, 50 * 1024 * 1024); // 10分钟TTL, 1000项, 50MB

/**
 * HTTP请求缓存
 */
export const httpCache = new OptimizedCacheManager<string>(5 * 60 * 1000, 500, 20 * 1024 * 1024); // 5分钟TTL, 500项, 20MB

/**
 * 产品状态缓存
 */
export const productCache = new OptimizedCacheManager<{ title: string; inStock: boolean }>(2 * 60 * 1000, 200, 5 * 1024 * 1024);

/**
 * XHS帖子缓存
 */
export const xhsPostCache = new OptimizedCacheManager<any>(10 * 60 * 1000, 1000, 20 * 1024 * 1024); // 10分钟TTL, 1000项, 20MB

/**
 * 时间过滤缓存
 */
export const timeFilterCache = new OptimizedCacheManager<boolean>(30 * 60 * 1000, 500, 2 * 1024 * 1024); // 30分钟TTL, 500项, 2MB

/**
 * 关键词匹配缓存
 */
export const keywordMatchCache = new OptimizedCacheManager<boolean>(60 * 60 * 1000, 1000, 5 * 1024 * 1024); // 1小时TTL, 1000项, 5MB

/**
 * 缓存管理器工厂
 */
export class CacheManagerFactory {
  /**
   * 创建专用缓存管理器
   */
  static createCache<T>(
    name: string,
    ttl: number = 5 * 60 * 1000,
    maxSize: number = 1000,
    maxMemory: number = 10 * 1024 * 1024
  ): OptimizedCacheManager<T> {
    const cache = new OptimizedCacheManager<T>(ttl, maxSize, maxMemory);
    console.log(`✅ 创建缓存管理器: ${name} (TTL: ${ttl}ms, 最大项数: ${maxSize}, 最大内存: ${(maxMemory / 1024 / 1024).toFixed(1)}MB)`);
    return cache;
  }

  /**
   * 获取所有缓存统计
   */
  static getAllCacheStats() {
    return {
      global: globalCache.getStats(),
      http: httpCache.getStats(),
      product: productCache.getStats(),
      xhsPost: xhsPostCache.getStats(),
      timeFilter: timeFilterCache.getStats(),
      keywordMatch: keywordMatchCache.getStats()
    };
  }

  /**
   * 清理所有缓存
   */
  static clearAllCaches(): void {
    globalCache.clear();
    httpCache.clear();
    productCache.clear();
    xhsPostCache.clear();
    timeFilterCache.clear();
    keywordMatchCache.clear();
    console.log('🗑️ 所有缓存已清理');
  }

  /**
   * 获取总内存使用情况
   */
  static getTotalMemoryUsage(): { current: number; max: number; percentage: number } {
    const caches = [globalCache, httpCache, productCache, xhsPostCache, timeFilterCache, keywordMatchCache];

    let totalCurrent = 0;
    let totalMax = 0;

    caches.forEach(cache => {
      const usage = cache.getMemoryUsage();
      totalCurrent += usage.current;
      totalMax += usage.max;
    });

    return {
      current: totalCurrent,
      max: totalMax,
      percentage: totalMax > 0 ? (totalCurrent / totalMax) * 100 : 0
    };
  }
} // 2分钟TTL, 200项, 5MB

/**
 * 页面内容缓存
 */
export const pageCache = new OptimizedCacheManager<string>(1 * 60 * 1000, 100, 10 * 1024 * 1024); // 1分钟TTL, 100项, 10MB
