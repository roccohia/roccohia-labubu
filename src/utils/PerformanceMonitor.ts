import { LoggerInstance } from './logger';
import { CacheManagerFactory } from './OptimizedCacheManager';
import { getNetworkOptimizer } from './NetworkOptimizer';
import { getConcurrencyController } from './ConcurrencyController';
import { getEnhancedResourceManager } from './EnhancedResourceManager';

/**
 * 性能指标接口
 */
export interface PerformanceMetrics {
  timestamp: number;
  duration: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  };
  cpuUsage: {
    user: number;
    system: number;
  };
  networkStats: {
    totalRequests: number;
    cacheHitRate: number;
    avgResponseTime: number;
    errorRate: number;
  };
  cacheStats: {
    totalSize: number;
    hitRate: number;
    memoryUsage: number;
  };
  resourceStats: {
    totalResources: number;
    cleanupEvents: number;
    memoryPressure: string;
  };
  concurrencyStats: {
    activeTasks: number;
    queueSize: number;
    successRate: number;
  };
}

/**
 * 性能基准
 */
export interface PerformanceBenchmark {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: any;
}

/**
 * 优化建议
 */
export interface OptimizationRecommendation {
  category: 'memory' | 'network' | 'cache' | 'concurrency' | 'resource';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  action: string;
  impact: string;
}

/**
 * 性能监控器
 * 
 * 功能：
 * - 实时性能指标收集
 * - 性能基准测试
 * - 自动优化建议
 * - 性能报告生成
 * - 异常检测和告警
 */
export class PerformanceMonitor {
  private logger: LoggerInstance;
  private metrics: PerformanceMetrics[] = [];
  private benchmarks = new Map<string, PerformanceBenchmark>();
  private isMonitoring = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private maxMetricsHistory = 100; // 保留最近100个指标

  // 性能阈值
  private thresholds = {
    memory: {
      heapUsage: 0.8, // 80%
      rss: 500 * 1024 * 1024, // 500MB
    },
    network: {
      errorRate: 0.05, // 5%
      avgResponseTime: 5000, // 5秒
    },
    cache: {
      hitRate: 0.7, // 70%
      memoryUsage: 100 * 1024 * 1024, // 100MB
    },
    concurrency: {
      successRate: 0.95, // 95%
      queueSize: 50,
    }
  };

  constructor(logger: LoggerInstance) {
    this.logger = logger;
  }

  /**
   * 开始性能监控
   */
  startMonitoring(interval: number = 30000): void {
    if (this.isMonitoring) {
      this.logger.warn('⚠️ 性能监控已在运行');
      return;
    }

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, interval);

    this.logger.info(`📊 性能监控已启动，间隔: ${interval}ms`);
  }

  /**
   * 停止性能监控
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.logger.info('📊 性能监控已停止');
  }

  /**
   * 收集性能指标
   */
  private async collectMetrics(): Promise<void> {
    try {
      const timestamp = Date.now();
      const startTime = process.hrtime.bigint();

      // 收集内存使用情况
      const memoryUsage = process.memoryUsage();

      // 收集CPU使用情况
      const cpuUsage = process.cpuUsage();

      // 收集网络统计
      const networkOptimizer = getNetworkOptimizer(this.logger);
      const networkStats = networkOptimizer.getStats();

      // 收集缓存统计
      const cacheStats = CacheManagerFactory.getAllCacheStats();
      const totalCacheSize = Object.values(cacheStats).reduce((sum, stat) => sum + stat.size, 0);
      const avgHitRate = Object.values(cacheStats).reduce((sum, stat) => sum + stat.hitRate, 0) / Object.keys(cacheStats).length;
      const totalCacheMemory = CacheManagerFactory.getTotalMemoryUsage();

      // 收集资源统计
      const resourceManager = getEnhancedResourceManager(this.logger);
      const resourceStats = resourceManager.getStats();

      // 收集并发统计
      const concurrencyController = getConcurrencyController(this.logger);
      const concurrencyStats = concurrencyController.getStats();

      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000; // 转换为毫秒

      const metrics: PerformanceMetrics = {
        timestamp,
        duration,
        memoryUsage: {
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
          rss: memoryUsage.rss,
          external: memoryUsage.external
        },
        cpuUsage: {
          user: cpuUsage.user,
          system: cpuUsage.system
        },
        networkStats: {
          totalRequests: networkStats.totalRequests,
          cacheHitRate: networkStats.cacheHitRate,
          avgResponseTime: networkStats.avgResponseTime,
          errorRate: networkStats.errorRate
        },
        cacheStats: {
          totalSize: totalCacheSize,
          hitRate: avgHitRate,
          memoryUsage: totalCacheMemory.current
        },
        resourceStats: {
          totalResources: resourceStats.currentResources,
          cleanupEvents: resourceStats.totalResourcesCleaned,
          memoryPressure: resourceStats.memoryPressure
        },
        concurrencyStats: {
          activeTasks: concurrencyStats.activeTasks,
          queueSize: concurrencyStats.currentQueueSize,
          successRate: concurrencyStats.successRate
        }
      };

      this.addMetrics(metrics);
      this.checkThresholds(metrics);

    } catch (error) {
      this.logger.error('❌ 收集性能指标失败:', error);
    }
  }

  /**
   * 添加指标到历史记录
   */
  private addMetrics(metrics: PerformanceMetrics): void {
    this.metrics.push(metrics);
    
    // 保持历史记录在限制范围内
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics.shift();
    }
  }

  /**
   * 检查性能阈值
   */
  private checkThresholds(metrics: PerformanceMetrics): void {
    const warnings: string[] = [];

    // 检查内存使用
    const heapUsageRatio = metrics.memoryUsage.heapUsed / metrics.memoryUsage.heapTotal;
    if (heapUsageRatio > this.thresholds.memory.heapUsage) {
      warnings.push(`内存使用率过高: ${(heapUsageRatio * 100).toFixed(1)}%`);
    }

    if (metrics.memoryUsage.rss > this.thresholds.memory.rss) {
      warnings.push(`RSS内存过高: ${(metrics.memoryUsage.rss / 1024 / 1024).toFixed(1)}MB`);
    }

    // 检查网络性能
    if (metrics.networkStats.errorRate > this.thresholds.network.errorRate) {
      warnings.push(`网络错误率过高: ${(metrics.networkStats.errorRate * 100).toFixed(1)}%`);
    }

    if (metrics.networkStats.avgResponseTime > this.thresholds.network.avgResponseTime) {
      warnings.push(`网络响应时间过长: ${metrics.networkStats.avgResponseTime}ms`);
    }

    // 检查缓存性能
    if (metrics.cacheStats.hitRate < this.thresholds.cache.hitRate) {
      warnings.push(`缓存命中率过低: ${(metrics.cacheStats.hitRate * 100).toFixed(1)}%`);
    }

    // 检查并发性能
    if (metrics.concurrencyStats.successRate < this.thresholds.concurrency.successRate) {
      warnings.push(`任务成功率过低: ${(metrics.concurrencyStats.successRate * 100).toFixed(1)}%`);
    }

    if (metrics.concurrencyStats.queueSize > this.thresholds.concurrency.queueSize) {
      warnings.push(`任务队列过长: ${metrics.concurrencyStats.queueSize}`);
    }

    // 输出警告
    if (warnings.length > 0) {
      this.logger.warn('⚠️ 性能警告:');
      warnings.forEach(warning => this.logger.warn(`  - ${warning}`));
    }
  }

  /**
   * 开始性能基准测试
   */
  startBenchmark(name: string, metadata?: any): void {
    const benchmark: PerformanceBenchmark = {
      name,
      startTime: Date.now(),
      metadata
    };

    this.benchmarks.set(name, benchmark);
    this.logger.debug(`⏱️ 基准测试开始: ${name}`);
  }

  /**
   * 结束性能基准测试
   */
  endBenchmark(name: string): PerformanceBenchmark | null {
    const benchmark = this.benchmarks.get(name);
    if (!benchmark) {
      this.logger.warn(`⚠️ 基准测试不存在: ${name}`);
      return null;
    }

    benchmark.endTime = Date.now();
    benchmark.duration = benchmark.endTime - benchmark.startTime;

    this.logger.info(`⏱️ 基准测试完成: ${name} - ${benchmark.duration}ms`);
    return benchmark;
  }

  /**
   * 生成优化建议
   */
  generateOptimizationRecommendations(): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    
    if (this.metrics.length === 0) {
      return recommendations;
    }

    const latestMetrics = this.metrics[this.metrics.length - 1];

    // 内存优化建议
    const heapUsageRatio = latestMetrics.memoryUsage.heapUsed / latestMetrics.memoryUsage.heapTotal;
    if (heapUsageRatio > 0.8) {
      recommendations.push({
        category: 'memory',
        priority: 'high',
        title: '内存使用率过高',
        description: `当前内存使用率为 ${(heapUsageRatio * 100).toFixed(1)}%，接近限制`,
        action: '清理缓存、减少资源使用、触发垃圾回收',
        impact: '降低内存压力，提高系统稳定性'
      });
    }

    // 缓存优化建议
    if (latestMetrics.cacheStats.hitRate < 0.7) {
      recommendations.push({
        category: 'cache',
        priority: 'medium',
        title: '缓存命中率偏低',
        description: `当前缓存命中率为 ${(latestMetrics.cacheStats.hitRate * 100).toFixed(1)}%`,
        action: '调整缓存策略、增加缓存时间、优化缓存键设计',
        impact: '减少重复计算和网络请求，提高响应速度'
      });
    }

    // 网络优化建议
    if (latestMetrics.networkStats.errorRate > 0.05) {
      recommendations.push({
        category: 'network',
        priority: 'high',
        title: '网络错误率过高',
        description: `当前网络错误率为 ${(latestMetrics.networkStats.errorRate * 100).toFixed(1)}%`,
        action: '检查网络连接、增加重试机制、优化超时设置',
        impact: '提高请求成功率，减少失败重试'
      });
    }

    // 并发优化建议
    if (latestMetrics.concurrencyStats.queueSize > 50) {
      recommendations.push({
        category: 'concurrency',
        priority: 'medium',
        title: '任务队列积压',
        description: `当前队列中有 ${latestMetrics.concurrencyStats.queueSize} 个待处理任务`,
        action: '增加并发数、优化任务处理速度、分批处理',
        impact: '减少任务等待时间，提高处理效率'
      });
    }

    return recommendations;
  }

  /**
   * 生成性能报告
   */
  generatePerformanceReport(): {
    summary: any;
    trends: any;
    recommendations: OptimizationRecommendation[];
    benchmarks: PerformanceBenchmark[];
  } {
    if (this.metrics.length === 0) {
      return {
        summary: {},
        trends: {},
        recommendations: [],
        benchmarks: []
      };
    }

    const latestMetrics = this.metrics[this.metrics.length - 1];
    const firstMetrics = this.metrics[0];

    // 计算趋势
    const memoryTrend = this.metrics.length > 1 ? 
      latestMetrics.memoryUsage.heapUsed - firstMetrics.memoryUsage.heapUsed : 0;
    
    const networkTrend = this.metrics.length > 1 ?
      latestMetrics.networkStats.avgResponseTime - firstMetrics.networkStats.avgResponseTime : 0;

    const summary = {
      monitoringDuration: latestMetrics.timestamp - firstMetrics.timestamp,
      totalMetrics: this.metrics.length,
      currentMemoryUsage: {
        heapUsed: (latestMetrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2) + 'MB',
        heapTotal: (latestMetrics.memoryUsage.heapTotal / 1024 / 1024).toFixed(2) + 'MB',
        rss: (latestMetrics.memoryUsage.rss / 1024 / 1024).toFixed(2) + 'MB'
      },
      networkPerformance: {
        totalRequests: latestMetrics.networkStats.totalRequests,
        cacheHitRate: (latestMetrics.networkStats.cacheHitRate * 100).toFixed(1) + '%',
        avgResponseTime: latestMetrics.networkStats.avgResponseTime + 'ms',
        errorRate: (latestMetrics.networkStats.errorRate * 100).toFixed(1) + '%'
      },
      resourceManagement: {
        totalResources: latestMetrics.resourceStats.totalResources,
        memoryPressure: latestMetrics.resourceStats.memoryPressure
      }
    };

    const trends = {
      memoryUsage: memoryTrend > 0 ? 'increasing' : memoryTrend < 0 ? 'decreasing' : 'stable',
      networkPerformance: networkTrend > 0 ? 'degrading' : networkTrend < 0 ? 'improving' : 'stable'
    };

    const recommendations = this.generateOptimizationRecommendations();
    const benchmarks = Array.from(this.benchmarks.values()).filter(b => b.endTime);

    return {
      summary,
      trends,
      recommendations,
      benchmarks
    };
  }

  /**
   * 获取最新指标
   */
  getLatestMetrics(): PerformanceMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }

  /**
   * 获取指标历史
   */
  getMetricsHistory(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  /**
   * 清理历史数据
   */
  clearHistory(): void {
    this.metrics = [];
    this.benchmarks.clear();
    this.logger.info('🗑️ 性能监控历史数据已清理');
  }

  /**
   * 设置性能阈值
   */
  setThresholds(newThresholds: Partial<typeof this.thresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    this.logger.info('🎛️ 性能阈值已更新:', this.thresholds);
  }
}

/**
 * 全局性能监控器实例
 */
let globalPerformanceMonitor: PerformanceMonitor | null = null;

/**
 * 获取全局性能监控器
 */
export function getPerformanceMonitor(logger: LoggerInstance): PerformanceMonitor {
  if (!globalPerformanceMonitor) {
    globalPerformanceMonitor = new PerformanceMonitor(logger);
  }
  return globalPerformanceMonitor;
}
