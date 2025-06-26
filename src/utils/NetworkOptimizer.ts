import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { LoggerInstance } from './logger';
import { httpCache } from './OptimizedCacheManager';

/**
 * 请求去重管理器
 */
class RequestDeduplicator {
  private pendingRequests = new Map<string, Promise<AxiosResponse>>();
  private logger: LoggerInstance;

  constructor(logger: LoggerInstance) {
    this.logger = logger;
  }

  /**
   * 生成请求键
   */
  private generateKey(method: string, url: string, config?: AxiosRequestConfig): string {
    const configStr = config ? JSON.stringify({
      params: config.params,
      data: config.data,
      headers: config.headers
    }) : '';
    return `${method.toUpperCase()}:${url}:${Buffer.from(configStr).toString('base64')}`;
  }

  /**
   * 去重请求
   */
  async deduplicateRequest<T = any>(
    method: string,
    url: string,
    requestFn: () => Promise<AxiosResponse<T>>,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    const key = this.generateKey(method, url, config);

    // 如果已有相同请求在进行中，返回该请求的Promise
    if (this.pendingRequests.has(key)) {
      this.logger.debug(`🔄 请求去重命中: ${method} ${url}`);
      return this.pendingRequests.get(key) as Promise<AxiosResponse<T>>;
    }

    // 创建新请求
    const requestPromise = requestFn().finally(() => {
      // 请求完成后清理
      this.pendingRequests.delete(key);
    });

    this.pendingRequests.set(key, requestPromise);
    return requestPromise;
  }

  /**
   * 清理所有待处理请求
   */
  clear(): void {
    this.pendingRequests.clear();
    this.logger.debug('🗑️ 请求去重器已清理');
  }

  /**
   * 获取统计信息
   */
  getStats(): { pendingRequests: number } {
    return {
      pendingRequests: this.pendingRequests.size
    };
  }
}

/**
 * 批量请求管理器
 */
class BatchRequestManager {
  private logger: LoggerInstance;
  private batchQueue: Array<{
    url: string;
    config?: AxiosRequestConfig;
    resolve: (value: AxiosResponse) => void;
    reject: (reason: any) => void;
  }> = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private batchSize: number = 10;
  private batchDelay: number = 100; // 100ms

  constructor(logger: LoggerInstance, batchSize: number = 10, batchDelay: number = 100) {
    this.logger = logger;
    this.batchSize = batchSize;
    this.batchDelay = batchDelay;
  }

  /**
   * 添加请求到批次队列
   */
  addToBatch(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return new Promise((resolve, reject) => {
      this.batchQueue.push({ url, config, resolve, reject });

      // 如果达到批次大小，立即处理
      if (this.batchQueue.length >= this.batchSize) {
        this.processBatch();
      } else {
        // 否则设置定时器
        this.scheduleBatchProcessing();
      }
    });
  }

  /**
   * 调度批次处理
   */
  private scheduleBatchProcessing(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.processBatch();
    }, this.batchDelay);
  }

  /**
   * 处理批次
   */
  private async processBatch(): Promise<void> {
    if (this.batchQueue.length === 0) return;

    const batch = this.batchQueue.splice(0, this.batchSize);
    this.logger.debug(`📦 处理批次请求: ${batch.length} 个`);

    // 并发执行批次中的所有请求
    const promises = batch.map(async (item) => {
      try {
        const response = await axios.get(item.url, item.config);
        item.resolve(response);
      } catch (error) {
        item.reject(error);
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * 清理批次队列
   */
  clear(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    // 拒绝所有待处理的请求
    this.batchQueue.forEach(item => {
      item.reject(new Error('批次队列已清理'));
    });
    
    this.batchQueue = [];
    this.logger.debug('🗑️ 批次请求队列已清理');
  }
}

/**
 * 连接池管理器
 */
class ConnectionPoolManager {
  private pools = new Map<string, AxiosInstance>();
  private logger: LoggerInstance;
  private defaultConfig: AxiosRequestConfig;

  constructor(logger: LoggerInstance) {
    this.logger = logger;
    this.defaultConfig = {
      timeout: 30000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
      }
    };
  }

  /**
   * 获取或创建连接池
   */
  getPool(hostname: string, config?: AxiosRequestConfig): AxiosInstance {
    if (!this.pools.has(hostname)) {
      const poolConfig = {
        ...this.defaultConfig,
        ...config,
        baseURL: `https://${hostname}`,
        // 启用HTTP/2和连接复用
        httpAgent: new (require('http').Agent)({
          keepAlive: true,
          maxSockets: 10,
          maxFreeSockets: 5,
          timeout: 60000,
          freeSocketTimeout: 30000
        }),
        httpsAgent: new (require('https').Agent)({
          keepAlive: true,
          maxSockets: 10,
          maxFreeSockets: 5,
          timeout: 60000,
          freeSocketTimeout: 30000
        })
      };

      const pool = axios.create(poolConfig);
      
      // 添加请求拦截器
      pool.interceptors.request.use(
        (config) => {
          this.logger.debug(`🌐 连接池请求: ${config.method?.toUpperCase()} ${config.url}`);
          return config;
        },
        (error) => {
          this.logger.error('❌ 连接池请求错误:', error);
          return Promise.reject(error);
        }
      );

      // 添加响应拦截器
      pool.interceptors.response.use(
        (response) => {
          this.logger.debug(`✅ 连接池响应: ${response.status} ${response.config.url}`);
          return response;
        },
        (error) => {
          this.logger.error(`❌ 连接池响应错误: ${error.config?.url}`, error.message);
          return Promise.reject(error);
        }
      );

      this.pools.set(hostname, pool);
      this.logger.info(`🔗 创建连接池: ${hostname}`);
    }

    return this.pools.get(hostname)!;
  }

  /**
   * 清理连接池
   */
  clear(): void {
    this.pools.clear();
    this.logger.info('🗑️ 连接池已清理');
  }

  /**
   * 获取连接池统计
   */
  getStats(): { poolCount: number; pools: string[] } {
    return {
      poolCount: this.pools.size,
      pools: Array.from(this.pools.keys())
    };
  }
}

/**
 * 网络性能优化器
 * 
 * 功能：
 * - HTTP连接池管理
 * - 请求去重
 * - 批量请求处理
 * - 智能缓存
 * - 性能监控
 */
export class NetworkOptimizer {
  private logger: LoggerInstance;
  private deduplicator: RequestDeduplicator;
  private batchManager: BatchRequestManager;
  private connectionPool: ConnectionPoolManager;
  
  // 性能统计
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    deduplicatedRequests: 0,
    batchedRequests: 0,
    errors: 0,
    totalResponseTime: 0
  };

  constructor(logger: LoggerInstance, batchSize: number = 10, batchDelay: number = 100) {
    this.logger = logger;
    this.deduplicator = new RequestDeduplicator(logger);
    this.batchManager = new BatchRequestManager(logger, batchSize, batchDelay);
    this.connectionPool = new ConnectionPoolManager(logger);
  }

  /**
   * 优化的GET请求
   */
  async get(url: string, config?: AxiosRequestConfig & { 
    cache?: boolean; 
    cacheTTL?: number; 
    deduplicate?: boolean;
    batch?: boolean;
  }): Promise<AxiosResponse> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    const {
      cache = true,
      cacheTTL = 5 * 60 * 1000,
      deduplicate = true,
      batch = false,
      ...axiosConfig
    } = config || {};

    try {
      // 1. 检查缓存
      if (cache) {
        const cacheKey = this.generateCacheKey('GET', url, axiosConfig);
        const cached = httpCache.get(cacheKey);
        if (cached) {
          this.stats.cacheHits++;
          this.logger.debug(`📋 缓存命中: GET ${url}`);
          return JSON.parse(cached);
        }
      }

      // 2. 获取主机名用于连接池
      const hostname = new URL(url).hostname;
      const pool = this.connectionPool.getPool(hostname);

      // 3. 创建请求函数
      const requestFn = async () => {
        if (batch) {
          this.stats.batchedRequests++;
          return this.batchManager.addToBatch(url, axiosConfig);
        } else {
          return pool.get(url, axiosConfig);
        }
      };

      // 4. 执行请求（可能去重）
      let response: AxiosResponse;
      if (deduplicate) {
        response = await this.deduplicator.deduplicateRequest('GET', url, requestFn, axiosConfig);
        if (this.deduplicator.getStats().pendingRequests > 1) {
          this.stats.deduplicatedRequests++;
        }
      } else {
        response = await requestFn();
      }

      // 5. 缓存响应
      if (cache && response.status === 200) {
        const cacheKey = this.generateCacheKey('GET', url, axiosConfig);
        httpCache.set(cacheKey, JSON.stringify(response), cacheTTL);
      }

      // 6. 更新统计
      this.stats.totalResponseTime += Date.now() - startTime;
      
      return response;

    } catch (error) {
      this.stats.errors++;
      this.logger.error(`❌ 网络请求失败: GET ${url}`, error);
      throw error;
    }
  }

  /**
   * 优化的POST请求
   */
  async post(url: string, data?: any, config?: AxiosRequestConfig & {
    cache?: boolean;
    cacheTTL?: number;
    deduplicate?: boolean;
  }): Promise<AxiosResponse> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    const {
      cache = false, // POST请求默认不缓存
      cacheTTL = 5 * 60 * 1000,
      deduplicate = false, // POST请求默认不去重
      ...axiosConfig
    } = config || {};

    try {
      // 获取主机名用于连接池
      const hostname = new URL(url).hostname;
      const pool = this.connectionPool.getPool(hostname);

      // 创建请求函数
      const requestFn = async () => pool.post(url, data, axiosConfig);

      // 执行请求
      let response: AxiosResponse;
      if (deduplicate) {
        response = await this.deduplicator.deduplicateRequest('POST', url, requestFn, { ...axiosConfig, data });
      } else {
        response = await requestFn();
      }

      // 缓存响应（如果启用）
      if (cache && response.status === 200) {
        const cacheKey = this.generateCacheKey('POST', url, { ...axiosConfig, data });
        httpCache.set(cacheKey, JSON.stringify(response), cacheTTL);
      }

      // 更新统计
      this.stats.totalResponseTime += Date.now() - startTime;
      
      return response;

    } catch (error) {
      this.stats.errors++;
      this.logger.error(`❌ 网络请求失败: POST ${url}`, error);
      throw error;
    }
  }

  /**
   * 批量GET请求
   */
  async batchGet(urls: string[], config?: AxiosRequestConfig): Promise<AxiosResponse[]> {
    this.logger.info(`📦 批量GET请求: ${urls.length} 个URL`);
    
    const promises = urls.map(url => this.get(url, { ...config, batch: true }));
    const results = await Promise.allSettled(promises);
    
    const responses: AxiosResponse[] = [];
    const errors: any[] = [];
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        responses.push(result.value);
      } else {
        errors.push({ url: urls[index], error: result.reason });
        this.logger.error(`❌ 批量请求失败: ${urls[index]}`, result.reason);
      }
    });
    
    this.logger.info(`✅ 批量请求完成: 成功 ${responses.length}, 失败 ${errors.length}`);
    return responses;
  }

  /**
   * 健康检查
   */
  async healthCheck(urls: string[], timeout: number = 5000): Promise<{ [url: string]: boolean }> {
    this.logger.info(`🏥 健康检查: ${urls.length} 个URL`);
    
    const results: { [url: string]: boolean } = {};
    
    const promises = urls.map(async (url) => {
      try {
        await this.get(url, { 
          timeout, 
          cache: false, 
          deduplicate: false,
          validateStatus: (status) => status < 500 
        });
        results[url] = true;
      } catch (error) {
        results[url] = false;
        this.logger.debug(`❌ 健康检查失败: ${url}`);
      }
    });
    
    await Promise.allSettled(promises);
    
    const healthyCount = Object.values(results).filter(Boolean).length;
    this.logger.info(`✅ 健康检查完成: ${healthyCount}/${urls.length} 个URL健康`);
    
    return results;
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(method: string, url: string, config?: AxiosRequestConfig): string {
    const configStr = config ? JSON.stringify({
      params: config.params,
      data: config.data,
      headers: config.headers
    }) : '';
    return `${method}:${url}:${Buffer.from(configStr).toString('base64')}`;
  }

  /**
   * 获取性能统计
   */
  getStats() {
    const avgResponseTime = this.stats.totalRequests > 0 ? 
      this.stats.totalResponseTime / this.stats.totalRequests : 0;
    
    return {
      ...this.stats,
      avgResponseTime: Math.round(avgResponseTime),
      cacheHitRate: this.stats.totalRequests > 0 ? 
        (this.stats.cacheHits / this.stats.totalRequests) * 100 : 0,
      errorRate: this.stats.totalRequests > 0 ? 
        (this.stats.errors / this.stats.totalRequests) * 100 : 0,
      deduplicator: this.deduplicator.getStats(),
      connectionPool: this.connectionPool.getStats()
    };
  }

  /**
   * 清理所有资源
   */
  cleanup(): void {
    this.deduplicator.clear();
    this.batchManager.clear();
    this.connectionPool.clear();
    httpCache.clear();
    this.logger.info('🗑️ 网络优化器已清理');
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      deduplicatedRequests: 0,
      batchedRequests: 0,
      errors: 0,
      totalResponseTime: 0
    };
    this.logger.debug('📊 网络统计已重置');
  }
}

/**
 * 全局网络优化器实例
 */
let globalNetworkOptimizer: NetworkOptimizer | null = null;

/**
 * 获取全局网络优化器
 */
export function getNetworkOptimizer(logger: LoggerInstance): NetworkOptimizer {
  if (!globalNetworkOptimizer) {
    globalNetworkOptimizer = new NetworkOptimizer(logger);
  }
  return globalNetworkOptimizer;
}
