import { LoggerInstance } from './logger';
import { globalCache } from './OptimizedCacheManager';

/**
 * 数据处理结果
 */
interface ProcessingResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  processingTime: number;
}

/**
 * 批处理配置
 */
interface BatchConfig {
  batchSize: number;
  concurrency: number;
  retryAttempts: number;
  retryDelay: number;
}

/**
 * 优化的数据处理器
 * 提供高效的数据解析、转换和批处理功能
 */
export class OptimizedDataProcessor {
  private logger: LoggerInstance;
  private defaultBatchConfig: BatchConfig;

  constructor(logger: LoggerInstance) {
    this.logger = logger;
    this.defaultBatchConfig = {
      batchSize: 50,
      concurrency: 3,
      retryAttempts: 2,
      retryDelay: 1000
    };
  }

  /**
   * 安全的JSON解析
   */
  safeJsonParse<T>(jsonString: string, defaultValue: T): T {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      this.logger.debug('JSON解析失败:', error);
      return defaultValue;
    }
  }

  /**
   * 批量处理数据
   */
  async batchProcess<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    config?: Partial<BatchConfig>
  ): Promise<ProcessingResult<R>[]> {
    const startTime = Date.now();
    const finalConfig = { ...this.defaultBatchConfig, ...config };
    const results: ProcessingResult<R>[] = [];

    this.logger.debug(`开始批处理 ${items.length} 项数据，批大小: ${finalConfig.batchSize}`);

    // 分批处理
    for (let i = 0; i < items.length; i += finalConfig.batchSize) {
      const batch = items.slice(i, i + finalConfig.batchSize);
      const batchResults = await this.processBatch(batch, processor, finalConfig);
      results.push(...batchResults);
    }

    const totalTime = Date.now() - startTime;
    this.logger.debug(`批处理完成，总耗时: ${totalTime}ms`);

    return results;
  }

  /**
   * 处理单个批次
   */
  private async processBatch<T, R>(
    batch: T[],
    processor: (item: T) => Promise<R>,
    config: BatchConfig
  ): Promise<ProcessingResult<R>[]> {
    const semaphore = new Semaphore(config.concurrency);
    
    const promises = batch.map(async (item) => {
      await semaphore.acquire();
      
      try {
        return await this.processWithRetry(item, processor, config);
      } finally {
        semaphore.release();
      }
    });

    return Promise.all(promises);
  }

  /**
   * 带重试的处理
   */
  private async processWithRetry<T, R>(
    item: T,
    processor: (item: T) => Promise<R>,
    config: BatchConfig
  ): Promise<ProcessingResult<R>> {
    const startTime = Date.now();
    let lastError: any;

    for (let attempt = 0; attempt <= config.retryAttempts; attempt++) {
      try {
        const data = await processor(item);
        return {
          success: true,
          data,
          processingTime: Date.now() - startTime
        };
      } catch (error) {
        lastError = error;
        
        if (attempt < config.retryAttempts) {
          await this.sleep(config.retryDelay * Math.pow(2, attempt));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      processingTime: Date.now() - startTime
    };
  }

  /**
   * 数据去重
   */
  deduplicate<T>(items: T[], keyExtractor: (item: T) => string): T[] {
    const seen = new Set<string>();
    const result: T[] = [];

    for (const item of items) {
      const key = keyExtractor(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    this.logger.debug(`去重完成: ${items.length} -> ${result.length}`);
    return result;
  }

  /**
   * 数据分组
   */
  groupBy<T, K extends string | number>(
    items: T[],
    keyExtractor: (item: T) => K
  ): Map<K, T[]> {
    const groups = new Map<K, T[]>();

    for (const item of items) {
      const key = keyExtractor(item);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    }

    return groups;
  }

  /**
   * 数据过滤和转换
   */
  filterAndTransform<T, R>(
    items: T[],
    filter: (item: T) => boolean,
    transformer: (item: T) => R
  ): R[] {
    return items
      .filter(filter)
      .map(transformer);
  }

  /**
   * 分页处理
   */
  paginate<T>(items: T[], pageSize: number): T[][] {
    const pages: T[][] = [];
    for (let i = 0; i < items.length; i += pageSize) {
      pages.push(items.slice(i, i + pageSize));
    }
    return pages;
  }

  /**
   * 数据验证
   */
  validate<T>(
    items: T[],
    validator: (item: T) => boolean,
    errorMessage?: string
  ): { valid: T[]; invalid: T[] } {
    const valid: T[] = [];
    const invalid: T[] = [];

    for (const item of items) {
      if (validator(item)) {
        valid.push(item);
      } else {
        invalid.push(item);
        if (errorMessage) {
          this.logger.debug(`数据验证失败: ${errorMessage}`, item);
        }
      }
    }

    return { valid, invalid };
  }

  /**
   * 缓存装饰器
   */
  withCache<T extends any[], R>(
    fn: (...args: T) => Promise<R>,
    keyGenerator: (...args: T) => string,
    ttl?: number
  ): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
      const cacheKey = keyGenerator(...args);
      return globalCache.withCache(cacheKey, () => fn(...args), ttl);
    };
  }

  /**
   * 数据压缩（简单实现）
   */
  compress(data: any): string {
    try {
      const jsonString = JSON.stringify(data);
      // 简单的压缩：移除空格和换行
      return jsonString.replace(/\s+/g, '');
    } catch (error) {
      this.logger.warn('数据压缩失败:', error);
      return '';
    }
  }

  /**
   * 数据解压
   */
  decompress<T>(compressedData: string, defaultValue: T): T {
    try {
      return JSON.parse(compressedData);
    } catch (error) {
      this.logger.warn('数据解压失败:', error);
      return defaultValue;
    }
  }

  /**
   * 计算数据统计信息
   */
  calculateStats<T>(
    items: T[],
    valueExtractor: (item: T) => number
  ): {
    count: number;
    sum: number;
    average: number;
    min: number;
    max: number;
  } {
    if (items.length === 0) {
      return { count: 0, sum: 0, average: 0, min: 0, max: 0 };
    }

    const values = items.map(valueExtractor);
    const sum = values.reduce((a, b) => a + b, 0);
    const min = Math.min(...values);
    const max = Math.max(...values);

    return {
      count: items.length,
      sum,
      average: sum / items.length,
      min,
      max
    };
  }

  /**
   * 睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 信号量实现（用于控制并发）
 */
class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const resolve = this.waitQueue.shift()!;
      resolve();
    } else {
      this.permits++;
    }
  }
}

/**
 * 全局数据处理器实例
 */
let globalDataProcessor: OptimizedDataProcessor | null = null;

/**
 * 获取全局数据处理器
 */
export function getDataProcessor(logger: LoggerInstance): OptimizedDataProcessor {
  if (!globalDataProcessor) {
    globalDataProcessor = new OptimizedDataProcessor(logger);
  }
  return globalDataProcessor;
}
