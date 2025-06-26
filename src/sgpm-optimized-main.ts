#!/usr/bin/env node

/**
 * SGPM (Singapore PopMart) 高性能监控系统 - 优化版入口
 * 
 * 优化特性：
 * - 并发产品检查
 * - 智能缓存机制
 * - HTTP连接池复用
 * - 批量处理优化
 * - 性能监控和指标
 * - 资源管理和清理
 */

import { logger } from './utils/logger';
import { sgpmConfig, validateSgpmConfig, validateSgpmEnvironment, getSgpmEnvConfig } from './config-sgpm';
import { OptimizedSgpmService } from './services/OptimizedSgpmService';
import { getEnhancedResourceManager } from './utils/EnhancedResourceManager';
import { globalCache, httpCache, productCache } from './utils/OptimizedCacheManager';

/**
 * 性能监控器
 */
class PerformanceMonitor {
  private startTime: number = 0;
  private memoryStart: NodeJS.MemoryUsage;
  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
    this.memoryStart = process.memoryUsage();
  }

  start(): void {
    this.startTime = Date.now();
    this.memoryStart = process.memoryUsage();
    this.logger.info('🚀 性能监控开始');
  }

  end(): void {
    const duration = Date.now() - this.startTime;
    const memoryEnd = process.memoryUsage();
    const memoryDiff = {
      rss: memoryEnd.rss - this.memoryStart.rss,
      heapUsed: memoryEnd.heapUsed - this.memoryStart.heapUsed,
      heapTotal: memoryEnd.heapTotal - this.memoryStart.heapTotal
    };

    this.logger.info('📊 性能监控结果:');
    this.logger.info(`   ⏱️  总执行时间: ${duration}ms`);
    this.logger.info(`   💾 内存使用变化:`);
    this.logger.info(`      - RSS: ${(memoryDiff.rss / 1024 / 1024).toFixed(2)}MB`);
    this.logger.info(`      - Heap Used: ${(memoryDiff.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    this.logger.info(`      - Heap Total: ${(memoryDiff.heapTotal / 1024 / 1024).toFixed(2)}MB`);
    
    // 输出缓存统计
    const cacheStats = {
      global: globalCache.getStats(),
      http: httpCache.getStats(),
      product: productCache.getStats()
    };
    
    this.logger.info(`   📋 缓存统计:`);
    this.logger.info(`      - 全局缓存: ${cacheStats.global.size} 项, 命中率 ${(cacheStats.global.hitRate * 100).toFixed(1)}%`);
    this.logger.info(`      - HTTP缓存: ${cacheStats.http.size} 项, 命中率 ${(cacheStats.http.hitRate * 100).toFixed(1)}%`);
    this.logger.info(`      - 产品缓存: ${cacheStats.product.size} 项, 命中率 ${(cacheStats.product.hitRate * 100).toFixed(1)}%`);
  }
}

/**
 * 环境优化器
 */
class EnvironmentOptimizer {
  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * 优化Node.js环境
   */
  optimizeEnvironment(): void {
    // 设置最大监听器数量
    process.setMaxListeners(20);

    // 优化垃圾回收
    if (global.gc) {
      global.gc();
    }

    // 设置进程标题
    process.title = 'sgpm-optimized-monitor';
  }

  /**
   * 设置性能监控
   */
  setupPerformanceMonitoring(): void {
    // 监控未处理的Promise拒绝
    process.on('unhandledRejection', (reason) => {
      this.logger.error('❌ 未处理的Promise拒绝:', reason);
    });

    // 监控未捕获的异常
    process.on('uncaughtException', (error) => {
      this.logger.error('❌ 未捕获的异常:', error);
      process.exit(1);
    });
  }
}

/**
 * SGPM优化监控主函数
 */
async function main(): Promise<void> {
  const performanceMonitor = new PerformanceMonitor(logger);
  const environmentOptimizer = new EnvironmentOptimizer(logger);
  const resourceManager = getEnhancedResourceManager(logger);

  performanceMonitor.start();
  logger.info('=== SGPM高性能监控系统启动 ===');

  try {
    // 1. 环境优化
    environmentOptimizer.optimizeEnvironment();
    environmentOptimizer.setupPerformanceMonitoring();

    // 2. 验证配置
    const configValidation = validateSgpmConfig();
    if (!configValidation.valid) {
      throw new Error(`SGPM配置验证失败: ${configValidation.errors.join(', ')}`);
    }

    // 3. 验证环境变量
    const envValidation = validateSgpmEnvironment();
    const envConfig = getSgpmEnvConfig();

    if (!envValidation.valid) {
      logger.warn(`⚠️ Telegram未配置，将跳过通知: ${envValidation.missing.join(', ')}`);
    }

    logger.info(`📊 监控: ${sgpmConfig.productUrls.length}个产品 | Bot:${envConfig.botToken ? '✅' : '❌'} | Chat:${envConfig.chatId ? '✅' : '❌'}`);

    // 4. 预热系统缓存
    await globalCache.warmup([
      {
        key: 'sgpm_config',
        fn: async () => sgpmConfig,
        ttl: 30 * 60 * 1000
      }
    ]);

    // 5. 创建并配置SGPM服务
    const sgpmService = new OptimizedSgpmService(sgpmConfig, logger);

    const isGitHubActions = envConfig.isGitHubActions;
    if (isGitHubActions) {
      sgpmService.setBatchConfig({
        batchSize: 2,
        concurrency: 1,
        delayBetweenBatches: 2000,
        retryFailedItems: false
      });
    } else {
      sgpmService.setBatchConfig({
        batchSize: 4,
        concurrency: 3,
        delayBetweenBatches: 500,
        retryFailedItems: true
      });
    }

    // 6. 执行监控
    logger.info('🚀 开始SGPM高性能监控...');
    await sgpmService.checkProducts();

    // 7. 性能统计和清理
    const serviceStats = sgpmService.getPerformanceStats();
    const duration = serviceStats.endTime - serviceStats.startTime;
    const efficiency = serviceStats.totalChecks > 0 ? (serviceStats.totalChecks / (duration / 1000)).toFixed(1) : 0;
    const cacheRate = serviceStats.totalChecks > 0 ? ((serviceStats.cacheHits / serviceStats.totalChecks) * 100).toFixed(1) : 0;

    logger.info(`✅ 完成: ${efficiency}检查/秒 | 缓存${cacheRate}% | 网络${serviceStats.networkRequests}次 | 耗时${duration}ms`);

    // 8. 清理资源
    await resourceManager.cleanupAll();
    if (isGitHubActions) {
      httpCache.clear();
    }

  } catch (error) {
    logger.error('❌ SGPM高性能监控系统执行失败:', error);
    process.exit(1);
  } finally {
    performanceMonitor.end();
    
    // GitHub Actions环境立即退出
    if (process.env.GITHUB_ACTIONS === 'true') {
      logger.info('🔄 GitHub Actions环境，立即退出');
      process.exit(0);
    }
  }
}

/**
 * 优雅关闭处理
 */
function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    logger.info(`📡 接收到 ${signal} 信号，开始优雅关闭...`);
    
    try {
      // 清理资源
      const resourceManager = getEnhancedResourceManager(logger);
      await resourceManager.cleanupAll();
      
      // 清理缓存
      globalCache.clear();
      httpCache.clear();
      productCache.clear();
      
      logger.info('✅ 优雅关闭完成');
      process.exit(0);
    } catch (error) {
      logger.error('❌ 优雅关闭失败:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// 设置优雅关闭
setupGracefulShutdown();

// 启动应用
if (require.main === module) {
  main().catch(error => {
    logger.error('❌ SGPM高性能应用启动失败:', error);
    process.exit(1);
  });
}

export { main as sgpmOptimizedMain };
