#!/usr/bin/env node

/**
 * Labubu 监控系统 - 优化版主入口
 * 
 * 优化特性：
 * - 浏览器实例池管理
 * - 智能缓存机制
 * - 资源自动清理
 * - 内存压力监控
 * - 批量数据处理
 * - 网络请求优化
 */

import { logger } from './utils/logger';
import { validateConfig, xhsConfig, sgpmConfig } from './config';
import { validateEnvironmentVariables } from './utils/helpers';
import { getResourceManager } from './utils/ResourceManager';
import { OptimizedBrowserManager } from './core/OptimizedBrowserManager';
import { getHttpClient, TelegramHttpClient } from './utils/OptimizedHttpClient';
import { getDataProcessor } from './utils/OptimizedDataProcessor';
import { globalCache, httpCache, productCache } from './utils/OptimizedCacheManager';

/**
 * 优化的监控任务基类
 */
abstract class OptimizedMonitoringTask {
  protected logger = logger;
  protected resourceManager = getResourceManager(logger);
  protected httpClient = getHttpClient(logger);
  protected dataProcessor = getDataProcessor(logger);
  protected browserManager: OptimizedBrowserManager;
  protected taskName: string;

  constructor(taskName: string) {
    this.taskName = taskName;
    this.browserManager = new OptimizedBrowserManager(logger);
  }

  /**
   * 执行任务
   */
  async execute(): Promise<void> {
    const startTime = Date.now();
    const taskId = `${this.taskName}_${Date.now()}`;
    
    this.logger.info(`=== 开始执行${this.taskName}监控任务 ===`);

    try {
      // 注册任务资源
      this.resourceManager.register(taskId, 'memory', async () => {
        this.browserManager.releaseBrowser();
      });

      // 执行具体监控逻辑
      await this.runMonitoring();

      const duration = Date.now() - startTime;
      this.logger.success(`${this.taskName}监控任务完成，耗时: ${duration}ms`);

    } catch (error) {
      this.logger.error(`${this.taskName}监控任务失败:`, error);
      throw error;
    } finally {
      // 清理任务资源
      await this.resourceManager.release(taskId);
    }
  }

  /**
   * 抽象方法：运行监控逻辑
   */
  protected abstract runMonitoring(): Promise<void>;

  /**
   * 发送Telegram通知
   */
  protected async sendTelegramNotification(message: string): Promise<boolean> {
    try {
      const botToken = process.env.BOT_TOKEN;
      const chatId = process.env.CHAT_ID;

      if (!botToken || !chatId) {
        this.logger.warn('Telegram配置缺失，跳过通知发送');
        return false;
      }

      const telegramClient = new TelegramHttpClient(this.logger, botToken);
      const response = await telegramClient.sendMessage(chatId, message);
      
      this.logger.info('Telegram通知发送成功');
      return true;
    } catch (error) {
      this.logger.error('Telegram通知发送失败:', error);
      return false;
    }
  }
}

/**
 * 优化的小红书监控任务
 */
class OptimizedXhsTask extends OptimizedMonitoringTask {
  constructor() {
    super('小红书');
  }

  protected async runMonitoring(): Promise<void> {
    // 获取浏览器实例
    const { browser, page } = await this.browserManager.getBrowser();
    
    // 使用缓存检查是否需要重新抓取
    const cacheKey = `xhs_posts_${xhsConfig.searchKeyword}`;
    const cachedPosts = globalCache.get(cacheKey);
    
    if (cachedPosts) {
      this.logger.info('使用缓存的小红书数据');
      await this.processCachedPosts(cachedPosts);
      return;
    }

    // 导航到小红书搜索页面
    const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(xhsConfig.searchKeyword)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // 等待页面加载
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 检查安全验证
    const pageTitle = await page.title();
    if (this.isSecurityVerificationPage(pageTitle)) {
      this.logger.warn('检测到安全验证页面');
      return;
    }

    // 提取帖子数据
    const posts = await this.extractPosts(page);
    
    // 缓存结果
    globalCache.set(cacheKey, posts, 2 * 60 * 1000); // 2分钟缓存
    
    // 处理帖子
    await this.processPosts(posts);
  }

  private isSecurityVerificationPage(title: string): boolean {
    const securityKeywords = ['Security Verification', '安全验证', '扫码验证'];
    return securityKeywords.some(keyword => title.includes(keyword));
  }

  private async extractPosts(page: any): Promise<any[]> {
    // 简化的帖子提取逻辑
    return await page.evaluate(() => {
      const posts: any[] = [];
      const postElements = document.querySelectorAll('.note-item, .note-card');
      
      postElements.forEach((element, index) => {
        if (index < 20) { // 限制提取数量
          const titleElement = element.querySelector('.title, .note-title');
          const authorElement = element.querySelector('.author, .user-name');
          const timeElement = element.querySelector('.time, .publish-time');
          
          posts.push({
            title: titleElement?.textContent?.trim() || '',
            author: authorElement?.textContent?.trim() || '',
            time: timeElement?.textContent?.trim() || '',
            url: element.querySelector('a')?.href || ''
          });
        }
      });
      
      return posts;
    });
  }

  private async processCachedPosts(posts: any[]): Promise<void> {
    this.logger.info(`处理缓存的 ${posts.length} 个帖子`);
    // 处理逻辑...
  }

  private async processPosts(posts: any[]): Promise<void> {
    this.logger.info(`提取到 ${posts.length} 个帖子`);
    
    // 使用批处理优化
    const results = await this.dataProcessor.batchProcess(
      posts,
      async (post) => this.processPost(post),
      { batchSize: 10, concurrency: 2 }
    );

    const successCount = results.filter(r => r.success).length;
    this.logger.info(`成功处理 ${successCount}/${posts.length} 个帖子`);
  }

  private async processPost(post: any): Promise<any> {
    // 帖子处理逻辑
    return post;
  }
}

/**
 * 优化的PopMart监控任务
 */
class OptimizedPopMartTask extends OptimizedMonitoringTask {
  constructor() {
    super('PopMart');
  }

  protected async runMonitoring(): Promise<void> {
    const products = sgpmConfig.productUrls;
    
    // 批量检查产品状态
    const results = await this.dataProcessor.batchProcess(
      products,
      async (url) => this.checkProduct(url),
      { batchSize: 5, concurrency: 2 }
    );

    // 处理结果
    const inStockProducts = results
      .filter(r => r.success && r.data?.inStock)
      .map(r => r.data);

    if (inStockProducts.length > 0) {
      await this.notifyInStockProducts(inStockProducts);
    }
  }

  private async checkProduct(url: string): Promise<{ title: string; inStock: boolean }> {
    // 检查缓存
    const cacheKey = `product_${url}`;
    const cached = productCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 获取浏览器实例
    const { page } = await this.browserManager.getBrowser();
    
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      const result = await page.evaluate(() => {
        const titleElement = document.querySelector('h1, .product-title, .title');
        const stockButton = document.querySelector('.add-to-cart, .buy-now, .in-stock');
        
        return {
          title: titleElement?.textContent?.trim() || 'Unknown Product',
          inStock: !!stockButton && !stockButton.textContent?.includes('Out of Stock')
        };
      });

      // 缓存结果
      productCache.set(cacheKey, result, 1 * 60 * 1000); // 1分钟缓存
      
      return result;
    } catch (error) {
      this.logger.warn(`检查产品失败: ${url}`, error);
      return { title: 'Error', inStock: false };
    }
  }

  private async notifyInStockProducts(products: any[]): Promise<void> {
    const message = `🛒 PopMart 库存提醒\n\n${products.map(p => `✅ ${p.title}`).join('\n')}`;
    await this.sendTelegramNotification(message);
  }
}

/**
 * 优化的任务执行器
 */
class OptimizedTaskExecutor {
  private logger = logger;
  private resourceManager = getResourceManager(logger);

  async executeAll(tasks: OptimizedMonitoringTask[]): Promise<void> {
    this.logger.info(`开始执行 ${tasks.length} 个监控任务`);
    
    // 并发执行任务
    const results = await Promise.allSettled(
      tasks.map(task => task.execute())
    );

    // 统计结果
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    this.logger.info(`任务执行完成: 成功 ${successful}, 失败 ${failed}`);

    // 输出失败详情
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(`任务 ${index + 1} 失败:`, result.reason);
      }
    });
  }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  const startTime = Date.now();
  logger.info('=== Labubu 监控系统启动（优化版）===');

  const resourceManager = getResourceManager(logger);

  try {
    // 1. 环境检查
    await performEnvironmentChecks();

    // 2. 预热缓存
    await warmupCaches();

    // 3. 创建监控任务
    const tasks = createOptimizedTasks();

    // 4. 执行监控任务
    const executor = new OptimizedTaskExecutor();
    await executor.executeAll(tasks);

    // 5. 输出性能统计
    await outputPerformanceStats();

    const duration = Date.now() - startTime;
    logger.success(`=== 监控系统执行完成，总耗时: ${duration}ms ===`);

  } catch (error) {
    logger.error('监控系统执行失败', error);
    process.exit(1);
  } finally {
    // 清理资源
    await resourceManager.releaseAll();
    
    // GitHub Actions环境立即退出
    if (process.env.GITHUB_ACTIONS === 'true') {
      process.exit(0);
    }
  }
}

/**
 * 环境检查
 */
async function performEnvironmentChecks(): Promise<void> {
  logger.info('执行环境检查...');
  
  // 验证环境变量
  validateEnvironmentVariables();
  
  // 验证配置
  validateConfig();
  
  logger.info('环境检查完成');
}

/**
 * 预热缓存
 */
async function warmupCaches(): Promise<void> {
  logger.info('预热缓存...');
  
  // 可以在这里预加载一些常用数据
  
  logger.info('缓存预热完成');
}

/**
 * 创建优化的任务
 */
function createOptimizedTasks(): OptimizedMonitoringTask[] {
  const tasks: OptimizedMonitoringTask[] = [];
  
  // 根据命令行参数决定运行哪些任务
  const args = process.argv.slice(2);
  
  if (args.includes('--xhs-only')) {
    tasks.push(new OptimizedXhsTask());
  } else if (args.includes('--popmart-only')) {
    tasks.push(new OptimizedPopMartTask());
  } else {
    // 默认运行所有任务
    tasks.push(new OptimizedXhsTask());
    tasks.push(new OptimizedPopMartTask());
  }
  
  return tasks;
}

/**
 * 输出性能统计
 */
async function outputPerformanceStats(): Promise<void> {
  const resourceManager = getResourceManager(logger);
  const memoryInfo = resourceManager.getMemoryInfo();
  const resourceStats = resourceManager.getResourceStats();
  const cacheStats = {
    global: globalCache.getStats(),
    http: httpCache.getStats(),
    product: productCache.getStats()
  };

  logger.info('=== 性能统计 ===');
  logger.info(`内存使用: ${(memoryInfo.heapUsed / 1024 / 1024).toFixed(2)}MB`);
  logger.info(`活跃资源: ${resourceStats.total} 个`);
  logger.info(`缓存命中率: 全局 ${(cacheStats.global.hitRate * 100).toFixed(1)}%, HTTP ${(cacheStats.http.hitRate * 100).toFixed(1)}%`);
}

// 启动应用
if (require.main === module) {
  main().catch(error => {
    logger.error('应用启动失败:', error);
    process.exit(1);
  });
}
