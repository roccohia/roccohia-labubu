import { LoggerInstance } from './logger';
import { CacheManagerFactory } from './OptimizedCacheManager';

/**
 * 资源类型枚举
 */
export enum ResourceType {
  BROWSER = 'browser',
  PAGE = 'page',
  HTTP_CLIENT = 'http_client',
  CACHE = 'cache',
  FILE_HANDLE = 'file_handle',
  TIMER = 'timer',
  PROCESS = 'process',
  OTHER = 'other'
}

/**
 * 资源接口
 */
export interface Resource {
  id: string;
  type: ResourceType;
  createdAt: number;
  lastUsed: number;
  metadata?: any;
  cleanup?: () => Promise<void> | void;
  priority?: number; // 清理优先级，数字越大越重要
}

/**
 * 内存压力级别
 */
export enum MemoryPressureLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * 资源清理策略
 */
export interface CleanupStrategy {
  maxAge: number; // 最大存活时间（毫秒）
  maxIdle: number; // 最大空闲时间（毫秒）
  maxMemoryUsage: number; // 最大内存使用（字节）
  maxResourceCount: number; // 最大资源数量
  enableAutoCleanup: boolean; // 启用自动清理
  cleanupInterval: number; // 清理间隔（毫秒）
  memoryPressureThresholds: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
}

/**
 * 内存监控器
 */
class MemoryMonitor {
  private logger: LoggerInstance;
  private strategy: CleanupStrategy;

  constructor(logger: LoggerInstance, strategy: CleanupStrategy) {
    this.logger = logger;
    this.strategy = strategy;
  }

  /**
   * 获取当前内存使用情况
   */
  getCurrentMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      rss: usage.rss,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers,
      percentage: (usage.heapUsed / usage.heapTotal) * 100
    };
  }

  /**
   * 评估内存压力级别
   */
  assessMemoryPressure(): MemoryPressureLevel {
    const usage = this.getCurrentMemoryUsage();
    const heapUsed = usage.heapUsed;
    const thresholds = this.strategy.memoryPressureThresholds;

    if (heapUsed >= thresholds.critical) {
      return MemoryPressureLevel.CRITICAL;
    } else if (heapUsed >= thresholds.high) {
      return MemoryPressureLevel.HIGH;
    } else if (heapUsed >= thresholds.medium) {
      return MemoryPressureLevel.MEDIUM;
    } else {
      return MemoryPressureLevel.LOW;
    }
  }

  /**
   * 触发垃圾回收
   */
  forceGarbageCollection(): boolean {
    if (global.gc) {
      this.logger.debug('🗑️ 强制触发垃圾回收');
      const beforeGC = this.getCurrentMemoryUsage();
      global.gc();
      const afterGC = this.getCurrentMemoryUsage();
      
      const freed = beforeGC.heapUsed - afterGC.heapUsed;
      this.logger.info(`🗑️ 垃圾回收完成，释放内存: ${(freed / 1024 / 1024).toFixed(2)}MB`);
      return true;
    } else {
      this.logger.warn('⚠️ 垃圾回收不可用（需要 --expose-gc 参数）');
      return false;
    }
  }
}

/**
 * 增强版资源管理器
 * 
 * 功能：
 * - 智能资源生命周期管理
 * - 内存压力监控和自动清理
 * - 资源优先级管理
 * - 性能监控和统计
 * - 自动垃圾回收
 */
export class EnhancedResourceManager {
  private static instance: EnhancedResourceManager;
  private resources = new Map<string, Resource>();
  private logger: LoggerInstance;
  private memoryMonitor: MemoryMonitor;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private memoryMonitorTimer: NodeJS.Timeout | null = null;
  
  // 默认清理策略
  private strategy: CleanupStrategy = {
    maxAge: 30 * 60 * 1000, // 30分钟
    maxIdle: 10 * 60 * 1000, // 10分钟
    maxMemoryUsage: 500 * 1024 * 1024, // 500MB
    maxResourceCount: 1000,
    enableAutoCleanup: true,
    cleanupInterval: 5 * 60 * 1000, // 5分钟
    memoryPressureThresholds: {
      low: 100 * 1024 * 1024,    // 100MB
      medium: 200 * 1024 * 1024, // 200MB
      high: 400 * 1024 * 1024,   // 400MB
      critical: 600 * 1024 * 1024 // 600MB
    }
  };

  // 性能统计
  private stats = {
    totalResourcesCreated: 0,
    totalResourcesCleaned: 0,
    autoCleanupRuns: 0,
    manualCleanupRuns: 0,
    memoryPressureEvents: 0,
    garbageCollectionRuns: 0
  };

  private constructor(logger: LoggerInstance) {
    this.logger = logger;
    this.memoryMonitor = new MemoryMonitor(logger, this.strategy);
    this.startAutoCleanup();
    this.startMemoryMonitoring();
    this.setupProcessHandlers();
  }

  /**
   * 获取单例实例
   */
  static getInstance(logger: LoggerInstance): EnhancedResourceManager {
    if (!EnhancedResourceManager.instance) {
      EnhancedResourceManager.instance = new EnhancedResourceManager(logger);
    }
    return EnhancedResourceManager.instance;
  }

  /**
   * 注册资源
   */
  register(resource: Omit<Resource, 'createdAt' | 'lastUsed'> & { id?: string }): string {
    const id = resource.id || `resource_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const fullResource: Resource = {
      ...resource,
      id,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      priority: resource.priority || 1
    };

    this.resources.set(id, fullResource);
    this.stats.totalResourcesCreated++;
    
    this.logger.debug(`📝 资源已注册: ${id} (类型: ${resource.type}, 总数: ${this.resources.size})`);
    
    // 检查是否需要清理
    this.checkResourceLimits();
    
    return id;
  }

  /**
   * 更新资源最后使用时间
   */
  touch(id: string): boolean {
    const resource = this.resources.get(id);
    if (resource) {
      resource.lastUsed = Date.now();
      this.logger.debug(`👆 资源已更新: ${id}`);
      return true;
    }
    return false;
  }

  /**
   * 手动清理特定资源
   */
  async cleanup(id: string): Promise<boolean> {
    const resource = this.resources.get(id);
    if (!resource) {
      return false;
    }

    try {
      if (resource.cleanup) {
        await resource.cleanup();
      }
      
      this.resources.delete(id);
      this.stats.totalResourcesCleaned++;
      
      this.logger.debug(`🗑️ 资源已清理: ${id}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ 清理资源失败: ${id}`, error);
      return false;
    }
  }

  /**
   * 批量清理资源
   */
  async cleanupBatch(ids: string[]): Promise<{ success: string[]; failed: string[] }> {
    const results = { success: [] as string[], failed: [] as string[] };
    
    const promises = ids.map(async (id) => {
      const success = await this.cleanup(id);
      if (success) {
        results.success.push(id);
      } else {
        results.failed.push(id);
      }
    });

    await Promise.allSettled(promises);
    
    this.logger.info(`📦 批量清理完成: 成功 ${results.success.length}, 失败 ${results.failed.length}`);
    return results;
  }

  /**
   * 自动清理过期资源
   */
  async autoCleanup(): Promise<void> {
    this.stats.autoCleanupRuns++;
    const now = Date.now();
    const toCleanup: string[] = [];

    // 找出需要清理的资源
    for (const [id, resource] of this.resources) {
      const age = now - resource.createdAt;
      const idle = now - resource.lastUsed;
      
      // 检查是否过期
      if (age > this.strategy.maxAge || idle > this.strategy.maxIdle) {
        toCleanup.push(id);
      }
    }

    // 按优先级排序（优先级低的先清理）
    toCleanup.sort((a, b) => {
      const resourceA = this.resources.get(a)!;
      const resourceB = this.resources.get(b)!;
      return (resourceA.priority || 1) - (resourceB.priority || 1);
    });

    if (toCleanup.length > 0) {
      this.logger.info(`🧹 自动清理开始: ${toCleanup.length} 个过期资源`);
      await this.cleanupBatch(toCleanup);
    }
  }

  /**
   * 内存压力清理
   */
  async memoryPressureCleanup(): Promise<void> {
    const pressure = this.memoryMonitor.assessMemoryPressure();
    
    if (pressure === MemoryPressureLevel.LOW) {
      return;
    }

    this.stats.memoryPressureEvents++;
    this.logger.warn(`⚠️ 内存压力检测: ${pressure}`);

    // 根据压力级别决定清理策略
    let cleanupRatio = 0;
    switch (pressure) {
      case MemoryPressureLevel.MEDIUM:
        cleanupRatio = 0.2; // 清理20%
        break;
      case MemoryPressureLevel.HIGH:
        cleanupRatio = 0.5; // 清理50%
        break;
      case MemoryPressureLevel.CRITICAL:
        cleanupRatio = 0.8; // 清理80%
        break;
    }

    // 获取所有资源，按优先级和最后使用时间排序
    const allResources = Array.from(this.resources.entries());
    allResources.sort(([, a], [, b]) => {
      // 优先级低的先清理
      const priorityDiff = (a.priority || 1) - (b.priority || 1);
      if (priorityDiff !== 0) return priorityDiff;
      
      // 最久未使用的先清理
      return a.lastUsed - b.lastUsed;
    });

    const cleanupCount = Math.floor(allResources.length * cleanupRatio);
    const toCleanup = allResources.slice(0, cleanupCount).map(([id]) => id);

    if (toCleanup.length > 0) {
      this.logger.warn(`🚨 内存压力清理: ${toCleanup.length} 个资源`);
      await this.cleanupBatch(toCleanup);
    }

    // 强制垃圾回收
    if (pressure >= MemoryPressureLevel.HIGH) {
      this.memoryMonitor.forceGarbageCollection();
      this.stats.garbageCollectionRuns++;
    }

    // 清理缓存
    if (pressure >= MemoryPressureLevel.HIGH) {
      CacheManagerFactory.clearAllCaches();
      this.logger.warn('🗑️ 内存压力清理：已清理所有缓存');
    }
  }

  /**
   * 检查资源限制
   */
  private checkResourceLimits(): void {
    // 检查资源数量限制
    if (this.resources.size > this.strategy.maxResourceCount) {
      this.logger.warn(`⚠️ 资源数量超限: ${this.resources.size}/${this.strategy.maxResourceCount}`);
      // 触发清理最旧的资源
      const oldestResources = Array.from(this.resources.entries())
        .sort(([, a], [, b]) => a.lastUsed - b.lastUsed)
        .slice(0, Math.floor(this.resources.size * 0.1)) // 清理10%最旧的
        .map(([id]) => id);
      
      this.cleanupBatch(oldestResources);
    }
  }

  /**
   * 启动自动清理
   */
  private startAutoCleanup(): void {
    if (!this.strategy.enableAutoCleanup) return;

    this.cleanupTimer = setInterval(() => {
      this.autoCleanup().catch(error => {
        this.logger.error('❌ 自动清理失败:', error);
      });
    }, this.strategy.cleanupInterval);

    this.logger.info(`🔄 自动清理已启动，间隔: ${this.strategy.cleanupInterval}ms`);
  }

  /**
   * 启动内存监控
   */
  private startMemoryMonitoring(): void {
    this.memoryMonitorTimer = setInterval(() => {
      this.memoryPressureCleanup().catch(error => {
        this.logger.error('❌ 内存压力清理失败:', error);
      });
    }, 30000); // 每30秒检查一次

    this.logger.info('📊 内存监控已启动');
  }

  /**
   * 设置进程处理器
   */
  private setupProcessHandlers(): void {
    const cleanup = async () => {
      this.logger.info('🔄 进程退出，清理所有资源...');
      await this.cleanupAll();
    };

    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('beforeExit', cleanup);
  }

  /**
   * 清理所有资源
   */
  async cleanupAll(): Promise<void> {
    this.logger.info(`🧹 开始清理所有资源: ${this.resources.size} 个`);
    
    const allIds = Array.from(this.resources.keys());
    await this.cleanupBatch(allIds);
    
    // 停止定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    if (this.memoryMonitorTimer) {
      clearInterval(this.memoryMonitorTimer);
      this.memoryMonitorTimer = null;
    }
    
    this.logger.info('✅ 所有资源已清理');
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const memoryUsage = this.memoryMonitor.getCurrentMemoryUsage();
    const pressure = this.memoryMonitor.assessMemoryPressure();
    
    const resourcesByType: Record<string, number> = {};
    for (const resource of this.resources.values()) {
      resourcesByType[resource.type] = (resourcesByType[resource.type] || 0) + 1;
    }

    return {
      ...this.stats,
      currentResources: this.resources.size,
      resourcesByType,
      memoryUsage: {
        heapUsed: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2) + 'MB',
        heapTotal: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2) + 'MB',
        rss: (memoryUsage.rss / 1024 / 1024).toFixed(2) + 'MB',
        percentage: memoryUsage.percentage.toFixed(1) + '%'
      },
      memoryPressure: pressure,
      strategy: this.strategy
    };
  }

  /**
   * 更新清理策略
   */
  updateStrategy(newStrategy: Partial<CleanupStrategy>): void {
    this.strategy = { ...this.strategy, ...newStrategy };
    this.memoryMonitor = new MemoryMonitor(this.logger, this.strategy);
    this.logger.info('🔧 清理策略已更新:', this.strategy);
  }
}

/**
 * 获取全局增强资源管理器
 */
export function getEnhancedResourceManager(logger: LoggerInstance): EnhancedResourceManager {
  return EnhancedResourceManager.getInstance(logger);
}
