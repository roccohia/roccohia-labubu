import { LoggerInstance } from './logger';
import { OptimizedBrowserManager } from '../core/OptimizedBrowserManager';

/**
 * 资源类型
 */
type ResourceType = 'browser' | 'file' | 'network' | 'timer' | 'memory';

/**
 * 资源信息
 */
interface ResourceInfo {
  id: string;
  type: ResourceType;
  createdAt: number;
  lastUsed: number;
  cleanup: () => Promise<void> | void;
  metadata?: any;
}

/**
 * 内存监控信息
 */
interface MemoryInfo {
  used: number;
  total: number;
  percentage: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

/**
 * 资源管理器
 * 统一管理应用程序的各种资源，确保正确清理
 */
export class ResourceManager {
  private static instance: ResourceManager;
  private resources = new Map<string, ResourceInfo>();
  private logger: LoggerInstance;
  private memoryThreshold = 0.8; // 80%内存使用率阈值
  private cleanupInterval: NodeJS.Timeout | null = null;
  private memoryMonitorInterval: NodeJS.Timeout | null = null;

  private constructor(logger: LoggerInstance) {
    this.logger = logger;
    this.startCleanupScheduler();
    this.startMemoryMonitor();
    this.setupProcessHandlers();
  }

  static getInstance(logger: LoggerInstance): ResourceManager {
    if (!ResourceManager.instance) {
      ResourceManager.instance = new ResourceManager(logger);
    }
    return ResourceManager.instance;
  }

  /**
   * 注册资源
   */
  register(
    id: string,
    type: ResourceType,
    cleanup: () => Promise<void> | void,
    metadata?: any
  ): void {
    const resource: ResourceInfo = {
      id,
      type,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      cleanup,
      metadata
    };

    this.resources.set(id, resource);
    this.logger.debug(`注册资源: ${type}:${id}`);
  }

  /**
   * 更新资源使用时间
   */
  touch(id: string): void {
    const resource = this.resources.get(id);
    if (resource) {
      resource.lastUsed = Date.now();
    }
  }

  /**
   * 释放特定资源
   */
  async release(id: string): Promise<boolean> {
    const resource = this.resources.get(id);
    if (!resource) {
      return false;
    }

    try {
      await resource.cleanup();
      this.resources.delete(id);
      this.logger.debug(`释放资源: ${resource.type}:${id}`);
      return true;
    } catch (error) {
      this.logger.warn(`释放资源失败: ${resource.type}:${id}`, error);
      return false;
    }
  }

  /**
   * 释放特定类型的所有资源
   */
  async releaseByType(type: ResourceType): Promise<number> {
    const resources = Array.from(this.resources.values()).filter(r => r.type === type);
    let released = 0;

    for (const resource of resources) {
      if (await this.release(resource.id)) {
        released++;
      }
    }

    this.logger.debug(`释放 ${type} 类型资源: ${released}/${resources.length}`);
    return released;
  }

  /**
   * 释放过期资源
   */
  async releaseExpired(maxAge: number = 10 * 60 * 1000): Promise<number> {
    const now = Date.now();
    const expiredResources = Array.from(this.resources.values())
      .filter(r => (now - r.lastUsed) > maxAge);

    let released = 0;
    for (const resource of expiredResources) {
      if (await this.release(resource.id)) {
        released++;
      }
    }

    if (released > 0) {
      this.logger.debug(`释放过期资源: ${released} 个`);
    }

    return released;
  }

  /**
   * 释放所有资源
   */
  async releaseAll(): Promise<void> {
    this.logger.info('开始释放所有资源...');
    
    const releasePromises = Array.from(this.resources.values()).map(async (resource) => {
      try {
        await resource.cleanup();
        this.logger.debug(`释放资源: ${resource.type}:${resource.id}`);
      } catch (error) {
        this.logger.warn(`释放资源失败: ${resource.type}:${resource.id}`, error);
      }
    });

    await Promise.allSettled(releasePromises);
    this.resources.clear();
    
    // 关闭浏览器池
    await OptimizedBrowserManager.closeAll();
    
    this.logger.info('所有资源已释放');
  }

  /**
   * 获取内存使用信息
   */
  getMemoryInfo(): MemoryInfo {
    const memUsage = process.memoryUsage();
    const totalMemory = require('os').totalmem();
    const freeMemory = require('os').freemem();
    const usedMemory = totalMemory - freeMemory;

    return {
      used: usedMemory,
      total: totalMemory,
      percentage: (usedMemory / totalMemory) * 100,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external
    };
  }

  /**
   * 强制垃圾回收
   */
  forceGC(): void {
    if (global.gc) {
      global.gc();
      this.logger.debug('强制垃圾回收完成');
    } else {
      this.logger.debug('垃圾回收不可用（需要 --expose-gc 参数）');
    }
  }

  /**
   * 检查内存压力
   */
  checkMemoryPressure(): boolean {
    const memInfo = this.getMemoryInfo();
    return memInfo.percentage > this.memoryThreshold * 100;
  }

  /**
   * 内存压力处理
   */
  async handleMemoryPressure(): Promise<void> {
    this.logger.warn('检测到内存压力，开始清理资源...');
    
    // 1. 释放过期资源
    await this.releaseExpired(5 * 60 * 1000); // 5分钟
    
    // 2. 强制垃圾回收
    this.forceGC();
    
    // 3. 清理缓存
    const { globalCache, httpCache, productCache } = await import('./OptimizedCacheManager');
    globalCache.clear();
    httpCache.clear();
    productCache.clear();
    
    // 4. 再次检查内存
    const memInfo = this.getMemoryInfo();
    this.logger.info(`内存清理完成，当前使用率: ${memInfo.percentage.toFixed(2)}%`);
  }

  /**
   * 获取资源统计信息
   */
  getResourceStats(): {
    total: number;
    byType: Record<ResourceType, number>;
    oldestResource: { type: ResourceType; age: number } | null;
  } {
    const byType: Record<ResourceType, number> = {
      browser: 0,
      file: 0,
      network: 0,
      timer: 0,
      memory: 0
    };

    let oldestResource: { type: ResourceType; age: number } | null = null;
    const now = Date.now();

    for (const resource of this.resources.values()) {
      byType[resource.type]++;
      
      const age = now - resource.createdAt;
      if (!oldestResource || age > oldestResource.age) {
        oldestResource = { type: resource.type, age };
      }
    }

    return {
      total: this.resources.size,
      byType,
      oldestResource
    };
  }

  /**
   * 启动清理调度器
   */
  private startCleanupScheduler(): void {
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.releaseExpired();
        
        // 检查内存压力
        if (this.checkMemoryPressure()) {
          await this.handleMemoryPressure();
        }
      } catch (error) {
        this.logger.warn('定期清理失败:', error);
      }
    }, 2 * 60 * 1000); // 每2分钟清理一次
  }

  /**
   * 启动内存监控
   */
  private startMemoryMonitor(): void {
    this.memoryMonitorInterval = setInterval(() => {
      const memInfo = this.getMemoryInfo();
      
      if (memInfo.percentage > 90) {
        this.logger.warn(`内存使用率过高: ${memInfo.percentage.toFixed(2)}%`);
      }
      
      // 记录详细内存信息（调试模式）
      if (process.env.DEBUG_MODE === 'true') {
        this.logger.debug('内存使用情况:', {
          percentage: `${memInfo.percentage.toFixed(2)}%`,
          heap: `${(memInfo.heapUsed / 1024 / 1024).toFixed(2)}MB / ${(memInfo.heapTotal / 1024 / 1024).toFixed(2)}MB`,
          external: `${(memInfo.external / 1024 / 1024).toFixed(2)}MB`
        });
      }
    }, 30 * 1000); // 每30秒监控一次
  }

  /**
   * 设置进程处理器
   */
  private setupProcessHandlers(): void {
    // 优雅退出处理
    const gracefulShutdown = async (signal: string) => {
      this.logger.info(`收到 ${signal} 信号，开始优雅退出...`);
      
      try {
        // 停止定时器
        if (this.cleanupInterval) {
          clearInterval(this.cleanupInterval);
        }
        if (this.memoryMonitorInterval) {
          clearInterval(this.memoryMonitorInterval);
        }
        
        // 释放所有资源
        await this.releaseAll();
        
        this.logger.info('优雅退出完成');
        process.exit(0);
      } catch (error) {
        this.logger.error('优雅退出失败:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // 未捕获异常处理
    process.on('uncaughtException', async (error) => {
      this.logger.error('未捕获异常:', error);
      await this.releaseAll();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      this.logger.error('未处理的Promise拒绝:', reason);
      await this.releaseAll();
      process.exit(1);
    });
  }

  /**
   * 设置内存阈值
   */
  setMemoryThreshold(threshold: number): void {
    this.memoryThreshold = Math.max(0.1, Math.min(0.95, threshold));
    this.logger.debug(`内存阈值设置为: ${(this.memoryThreshold * 100).toFixed(1)}%`);
  }

  /**
   * 销毁资源管理器
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.memoryMonitorInterval) {
      clearInterval(this.memoryMonitorInterval);
    }
  }
}

/**
 * 获取全局资源管理器
 */
export function getResourceManager(logger: LoggerInstance): ResourceManager {
  return ResourceManager.getInstance(logger);
}
