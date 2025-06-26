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
    this.logger.info('🔧 优化运行环境...');

    // 设置最大监听器数量
    process.setMaxListeners(20);

    // 优化垃圾回收
    if (global.gc) {
      this.logger.debug('🗑️ 手动触发垃圾回收');
      global.gc();
    }

    // 设置进程标题
    process.title = 'sgpm-optimized-monitor';

    // 优化事件循环
    process.nextTick(() => {
      this.logger.debug('⚡ 事件循环优化完成');
    });

    this.logger.info('✅ 环境优化完成');
  }

  /**
   * 设置性能监控
   */
  setupPerformanceMonitoring(): void {
    // 监控未处理的Promise拒绝
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('❌ 未处理的Promise拒绝:', reason);
    });

    // 监控未捕获的异常
    process.on('uncaughtException', (error) => {
      this.logger.error('❌ 未捕获的异常:', error);
      process.exit(1);
    });

    // 监控内存使用
    const memoryMonitor = setInterval(() => {
      const usage = process.memoryUsage();
      const heapUsedMB = (usage.heapUsed / 1024 / 1024).toFixed(2);
      
      if (usage.heapUsed > 200 * 1024 * 1024) { // 200MB警告
        this.logger.warn(`⚠️ 内存使用较高: ${heapUsedMB}MB`);
      }
    }, 30000); // 每30秒检查一次

    // 清理定时器
    setTimeout(() => {
      clearInterval(memoryMonitor);
    }, 10 * 60 * 1000); // 10分钟后停止监控
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
    logger.info('🔍 验证SGPM配置...');
    const configValidation = validateSgpmConfig();
    if (!configValidation.valid) {
      throw new Error(`SGPM配置验证失败: ${configValidation.errors.join(', ')}`);
    }
    logger.info('✅ SGPM配置验证通过');

    // 3. 验证环境变量
    logger.info('🔍 验证SGPM环境变量...');
    const envValidation = validateSgpmEnvironment();
    if (!envValidation.valid) {
      logger.warn(`⚠️ SGPM环境变量验证失败，缺少: ${envValidation.missing.join(', ')}`);
      logger.info('📝 将跳过Telegram通知，但继续执行产品检查');
    } else {
      logger.info('✅ SGPM环境变量验证通过');
    }

    // 4. 获取环境配置
    const envConfig = getSgpmEnvConfig();
    logger.info(`📊 监控配置:`);
    logger.info(`   📦 产品数量: ${sgpmConfig.productUrls.length}`);
    logger.info(`   🤖 Telegram Bot: ${envConfig.botToken ? '已配置' : '未配置'}`);
    logger.info(`   💬 Chat ID: ${envConfig.chatId ? '已配置' : '未配置'}`);
    logger.info(`   🌐 使用代理: ${envConfig.useProxy ? '是' : '否'}`);
    logger.info(`   🔧 调试模式: ${envConfig.debugMode ? '是' : '否'}`);

    // 5. 预热系统缓存
    logger.info('🔥 预热系统缓存...');
    await globalCache.warmup([
      {
        key: 'sgpm_config',
        fn: async () => sgpmConfig,
        ttl: 30 * 60 * 1000 // 30分钟
      },
      {
        key: 'sgpm_env',
        fn: async () => envConfig,
        ttl: 30 * 60 * 1000 // 30分钟
      }
    ]);
    logger.info('✅ 系统缓存预热完成');

    // 6. 创建高性能SGPM服务
    logger.info('🚀 初始化高性能SGPM监控服务...');
    const sgpmService = new OptimizedSgpmService(sgpmConfig, logger);

    // 7. 配置批量处理参数
    const isGitHubActions = envConfig.isGitHubActions;
    if (isGitHubActions) {
      // GitHub Actions环境：更保守的配置
      sgpmService.setBatchConfig({
        batchSize: 2,
        concurrency: 1,
        delayBetweenBatches: 2000,
        retryFailedItems: false
      });
      logger.info('🔧 GitHub Actions环境：使用保守的批量处理配置');
    } else {
      // 本地环境：更激进的配置
      sgpmService.setBatchConfig({
        batchSize: 4,
        concurrency: 3,
        delayBetweenBatches: 500,
        retryFailedItems: true
      });
      logger.info('🔧 本地环境：使用高性能批量处理配置');
    }

    // 8. 执行高性能监控
    logger.info('🎯 开始执行SGPM高性能产品库存监控...');
    await sgpmService.checkProducts();

    // 9. 获取服务性能统计
    const serviceStats = sgpmService.getPerformanceStats();
    logger.info('📈 服务性能统计:');
    logger.info(`   🔍 检查效率: ${serviceStats.totalChecks > 0 ? (serviceStats.totalChecks / ((serviceStats.endTime - serviceStats.startTime) / 1000)).toFixed(2) : 0} 检查/秒`);
    logger.info(`   📋 缓存效率: ${serviceStats.totalChecks > 0 ? ((serviceStats.cacheHits / serviceStats.totalChecks) * 100).toFixed(1) : 0}% 命中率`);
    logger.info(`   🌐 网络效率: ${serviceStats.networkRequests} 请求 (节省 ${serviceStats.cacheHits} 次)`);

    // 10. 资源清理
    logger.info('🧹 清理系统资源...');
    await resourceManager.cleanupAll();
    
    // 清理缓存（可选）
    if (isGitHubActions) {
      // GitHub Actions环境清理缓存以节省内存
      httpCache.clear();
      logger.info('🗑️ GitHub Actions环境：已清理HTTP缓存');
    }

    // 11. 完成
    logger.success('=== SGPM高性能监控完成 ===');

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
