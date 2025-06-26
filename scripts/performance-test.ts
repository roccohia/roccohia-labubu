#!/usr/bin/env node

/**
 * 性能测试脚本
 * 用于测试和比较不同优化版本的性能
 */

import { logger } from '../src/utils/logger';
import { getPerformanceMonitor } from '../src/utils/PerformanceMonitor';
import { getNetworkOptimizer } from '../src/utils/NetworkOptimizer';
import { getConcurrencyController, TaskPriority } from '../src/utils/ConcurrencyController';
import { getEnhancedResourceManager } from '../src/utils/EnhancedResourceManager';
import { CacheManagerFactory } from '../src/utils/OptimizedCacheManager';

/**
 * 性能测试套件
 */
class PerformanceTestSuite {
  private performanceMonitor = getPerformanceMonitor(logger);
  private networkOptimizer = getNetworkOptimizer(logger);
  private concurrencyController = getConcurrencyController(logger);
  private resourceManager = getEnhancedResourceManager(logger);

  /**
   * 运行所有性能测试
   */
  async runAllTests(): Promise<void> {
    logger.info('🚀 开始性能测试套件');
    
    // 启动性能监控
    this.performanceMonitor.startMonitoring(5000); // 每5秒收集一次指标

    try {
      // 1. 网络性能测试
      await this.testNetworkPerformance();
      
      // 2. 缓存性能测试
      await this.testCachePerformance();
      
      // 3. 并发性能测试
      await this.testConcurrencyPerformance();
      
      // 4. 内存管理测试
      await this.testMemoryManagement();
      
      // 5. 综合性能测试
      await this.testIntegratedPerformance();
      
      // 生成性能报告
      this.generateFinalReport();
      
    } catch (error) {
      logger.error('❌ 性能测试失败:', error);
    } finally {
      this.performanceMonitor.stopMonitoring();
    }
  }

  /**
   * 网络性能测试
   */
  private async testNetworkPerformance(): Promise<void> {
    logger.info('🌐 开始网络性能测试');
    this.performanceMonitor.startBenchmark('network_performance');

    const testUrls = [
      'https://httpbin.org/delay/1',
      'https://httpbin.org/json',
      'https://httpbin.org/headers',
      'https://httpbin.org/user-agent',
      'https://httpbin.org/ip'
    ];

    // 测试单个请求性能
    logger.info('📊 测试单个请求性能');
    for (const url of testUrls) {
      const startTime = Date.now();
      try {
        await this.networkOptimizer.get(url, { cache: true, timeout: 10000 });
        const duration = Date.now() - startTime;
        logger.info(`✅ ${url}: ${duration}ms`);
      } catch (error) {
        logger.error(`❌ ${url}: 失败`);
      }
    }

    // 测试批量请求性能
    logger.info('📦 测试批量请求性能');
    const batchStartTime = Date.now();
    try {
      await this.networkOptimizer.batchGet(testUrls, { timeout: 10000 });
      const batchDuration = Date.now() - batchStartTime;
      logger.info(`✅ 批量请求完成: ${batchDuration}ms`);
    } catch (error) {
      logger.error('❌ 批量请求失败:', error);
    }

    // 测试缓存效果
    logger.info('📋 测试缓存效果');
    const cacheTestUrl = testUrls[0];
    
    // 第一次请求（无缓存）
    const firstRequestTime = Date.now();
    await this.networkOptimizer.get(cacheTestUrl, { cache: true });
    const firstDuration = Date.now() - firstRequestTime;
    
    // 第二次请求（有缓存）
    const secondRequestTime = Date.now();
    await this.networkOptimizer.get(cacheTestUrl, { cache: true });
    const secondDuration = Date.now() - secondRequestTime;
    
    const cacheSpeedup = firstDuration / secondDuration;
    logger.info(`📋 缓存加速比: ${cacheSpeedup.toFixed(2)}x (${firstDuration}ms → ${secondDuration}ms)`);

    this.performanceMonitor.endBenchmark('network_performance');
  }

  /**
   * 缓存性能测试
   */
  private async testCachePerformance(): Promise<void> {
    logger.info('📋 开始缓存性能测试');
    this.performanceMonitor.startBenchmark('cache_performance');

    const testCache = CacheManagerFactory.createCache('test_cache', 5 * 60 * 1000, 1000);

    // 测试写入性能
    logger.info('📝 测试缓存写入性能');
    const writeStartTime = Date.now();
    for (let i = 0; i < 1000; i++) {
      testCache.set(`key_${i}`, { data: `value_${i}`, timestamp: Date.now() });
    }
    const writeDuration = Date.now() - writeStartTime;
    logger.info(`✅ 写入1000项: ${writeDuration}ms (${(1000 / writeDuration * 1000).toFixed(0)} ops/sec)`);

    // 测试读取性能
    logger.info('📖 测试缓存读取性能');
    const readStartTime = Date.now();
    let hits = 0;
    for (let i = 0; i < 1000; i++) {
      if (testCache.get(`key_${i}`)) {
        hits++;
      }
    }
    const readDuration = Date.now() - readStartTime;
    logger.info(`✅ 读取1000项: ${readDuration}ms (${(1000 / readDuration * 1000).toFixed(0)} ops/sec, 命中率: ${hits/10}%)`);

    // 测试缓存统计
    const stats = testCache.getStats();
    logger.info(`📊 缓存统计: 大小=${stats.size}, 命中率=${(stats.hitRate * 100).toFixed(1)}%`);

    this.performanceMonitor.endBenchmark('cache_performance');
  }

  /**
   * 并发性能测试
   */
  private async testConcurrencyPerformance(): Promise<void> {
    logger.info('⚡ 开始并发性能测试');
    this.performanceMonitor.startBenchmark('concurrency_performance');

    // 创建测试任务
    const createTestTask = (id: number, duration: number) => ({
      id: `task_${id}`,
      priority: TaskPriority.NORMAL,
      fn: async () => {
        await new Promise(resolve => setTimeout(resolve, duration));
        return `Task ${id} completed`;
      },
      timeout: 5000
    });

    // 测试低并发
    logger.info('🔄 测试低并发 (5个任务)');
    const lowConcurrencyTasks = Array.from({ length: 5 }, (_, i) => createTestTask(i, 100));
    const lowConcurrencyStart = Date.now();
    await this.concurrencyController.addTasks(lowConcurrencyTasks);
    await this.concurrencyController.waitForCompletion();
    const lowConcurrencyDuration = Date.now() - lowConcurrencyStart;
    logger.info(`✅ 低并发完成: ${lowConcurrencyDuration}ms`);

    // 测试高并发
    logger.info('🚀 测试高并发 (50个任务)');
    const highConcurrencyTasks = Array.from({ length: 50 }, (_, i) => createTestTask(i + 100, 50));
    const highConcurrencyStart = Date.now();
    await this.concurrencyController.addTasks(highConcurrencyTasks);
    await this.concurrencyController.waitForCompletion();
    const highConcurrencyDuration = Date.now() - highConcurrencyStart;
    logger.info(`✅ 高并发完成: ${highConcurrencyDuration}ms`);

    // 输出并发统计
    const concurrencyStats = this.concurrencyController.getStats();
    logger.info(`📊 并发统计: 成功率=${concurrencyStats.successRate.toFixed(1)}%, 平均耗时=${concurrencyStats.avgDuration}ms`);

    this.performanceMonitor.endBenchmark('concurrency_performance');
  }

  /**
   * 内存管理测试
   */
  private async testMemoryManagement(): Promise<void> {
    logger.info('💾 开始内存管理测试');
    this.performanceMonitor.startBenchmark('memory_management');

    const initialMemory = process.memoryUsage();
    logger.info(`📊 初始内存: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);

    // 创建大量资源
    logger.info('📝 创建大量资源');
    const resourceIds: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = this.resourceManager.register({
        type: 'OTHER' as any,
        metadata: { testData: new Array(1000).fill(`data_${i}`) },
        cleanup: async () => {
          // 模拟清理操作
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      });
      resourceIds.push(id);
    }

    const afterCreationMemory = process.memoryUsage();
    logger.info(`📊 创建资源后内存: ${(afterCreationMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);

    // 触发自动清理
    logger.info('🧹 触发自动清理');
    await this.resourceManager.autoCleanup();

    const afterCleanupMemory = process.memoryUsage();
    logger.info(`📊 清理后内存: ${(afterCleanupMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);

    // 手动清理剩余资源
    logger.info('🗑️ 手动清理剩余资源');
    await this.resourceManager.cleanupBatch(resourceIds);

    const finalMemory = process.memoryUsage();
    logger.info(`📊 最终内存: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);

    const memoryRecovered = afterCreationMemory.heapUsed - finalMemory.heapUsed;
    logger.info(`♻️ 内存回收: ${(memoryRecovered / 1024 / 1024).toFixed(2)}MB`);

    this.performanceMonitor.endBenchmark('memory_management');
  }

  /**
   * 综合性能测试
   */
  private async testIntegratedPerformance(): Promise<void> {
    logger.info('🎯 开始综合性能测试');
    this.performanceMonitor.startBenchmark('integrated_performance');

    // 模拟真实工作负载
    const tasks = [];
    
    // 添加网络任务
    for (let i = 0; i < 10; i++) {
      tasks.push({
        id: `network_task_${i}`,
        priority: TaskPriority.NORMAL,
        fn: async () => {
          return await this.networkOptimizer.get('https://httpbin.org/json', { cache: true });
        }
      });
    }

    // 添加计算任务
    for (let i = 0; i < 20; i++) {
      tasks.push({
        id: `compute_task_${i}`,
        priority: TaskPriority.HIGH,
        fn: async () => {
          // 模拟CPU密集型任务
          let result = 0;
          for (let j = 0; j < 100000; j++) {
            result += Math.sqrt(j);
          }
          return result;
        }
      });
    }

    // 执行综合任务
    const integratedStart = Date.now();
    await this.concurrencyController.addTasks(tasks);
    await this.concurrencyController.waitForCompletion();
    const integratedDuration = Date.now() - integratedStart;

    logger.info(`✅ 综合测试完成: ${integratedDuration}ms`);
    logger.info(`📊 任务吞吐量: ${(tasks.length / integratedDuration * 1000).toFixed(2)} tasks/sec`);

    this.performanceMonitor.endBenchmark('integrated_performance');
  }

  /**
   * 生成最终报告
   */
  private generateFinalReport(): void {
    logger.info('📋 生成性能测试报告');
    
    const report = this.performanceMonitor.generatePerformanceReport();
    const networkStats = this.networkOptimizer.getStats();
    const cacheStats = CacheManagerFactory.getAllCacheStats();
    const resourceStats = this.resourceManager.getStats();
    const concurrencyStats = this.concurrencyController.getStats();

    logger.info('');
    logger.info('📊 ===== 性能测试报告 =====');
    logger.info('');
    
    // 基准测试结果
    logger.info('⏱️ 基准测试结果:');
    report.benchmarks.forEach(benchmark => {
      logger.info(`  - ${benchmark.name}: ${benchmark.duration}ms`);
    });
    logger.info('');

    // 网络性能
    logger.info('🌐 网络性能:');
    logger.info(`  - 总请求数: ${networkStats.totalRequests}`);
    logger.info(`  - 缓存命中率: ${networkStats.cacheHitRate.toFixed(1)}%`);
    logger.info(`  - 平均响应时间: ${networkStats.avgResponseTime}ms`);
    logger.info(`  - 错误率: ${networkStats.errorRate.toFixed(1)}%`);
    logger.info('');

    // 缓存性能
    logger.info('📋 缓存性能:');
    Object.entries(cacheStats).forEach(([name, stats]) => {
      logger.info(`  - ${name}: ${stats.size} 项, 命中率 ${(stats.hitRate * 100).toFixed(1)}%`);
    });
    logger.info('');

    // 资源管理
    logger.info('💾 资源管理:');
    logger.info(`  - 当前资源数: ${resourceStats.currentResources}`);
    logger.info(`  - 已清理资源: ${resourceStats.totalResourcesCleaned}`);
    logger.info(`  - 内存压力: ${resourceStats.memoryPressure}`);
    logger.info('');

    // 并发性能
    logger.info('⚡ 并发性能:');
    logger.info(`  - 总任务数: ${concurrencyStats.totalTasks}`);
    logger.info(`  - 成功率: ${concurrencyStats.successRate.toFixed(1)}%`);
    logger.info(`  - 平均耗时: ${concurrencyStats.avgDuration}ms`);
    logger.info('');

    // 优化建议
    logger.info('💡 优化建议:');
    report.recommendations.forEach(rec => {
      logger.info(`  - [${rec.priority.toUpperCase()}] ${rec.title}: ${rec.action}`);
    });
    logger.info('');

    logger.info('✅ 性能测试完成！');
  }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  try {
    const testSuite = new PerformanceTestSuite();
    await testSuite.runAllTests();
  } catch (error) {
    logger.error('❌ 性能测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
if (require.main === module) {
  main();
}
