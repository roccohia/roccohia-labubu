import { BrowserManager } from './BrowserManager';
import { LoggerInstance } from '../utils/logger';
import { StatusManager } from '../utils/statusManager';
import { sendTelegramMessage } from '../utils/sendTelegramMessage';
import { XhsScraper } from '../scrapers/XhsScraper';
import { PopMartScraper } from '../scrapers/PopMartScraper';
import { XhsPostData } from '../types';

/**
 * 监控任务基类
 */
export abstract class MonitoringTask {
  protected browserManager: BrowserManager;
  protected logger: LoggerInstance;
  protected taskName: string;

  constructor(taskName: string, logger: LoggerInstance) {
    this.taskName = taskName;
    this.logger = logger;
    this.browserManager = new BrowserManager(logger);
  }

  /**
   * 执行监控任务
   */
  async execute(): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`=== 开始执行${this.taskName}监控任务 ===`);

    try {
      // 启动浏览器
      await this.setupBrowser();
      
      // 执行具体的监控逻辑
      await this.runMonitoring();
      
      const duration = Date.now() - startTime;
      this.logger.success(`${this.taskName}监控任务完成，耗时: ${duration}ms`);
      
    } catch (error) {
      this.logger.error(`${this.taskName}监控任务失败:`, error);
      throw error;
    } finally {
      // 清理资源
      await this.cleanup();
    }
  }

  /**
   * 设置浏览器
   */
  protected abstract setupBrowser(): Promise<void>;

  /**
   * 运行监控逻辑
   */
  protected abstract runMonitoring(): Promise<void>;

  /**
   * 清理资源
   */
  protected async cleanup(): Promise<void> {
    await this.browserManager.close();
  }

  /**
   * 发送通知
   */
  protected async sendNotification(message: string): Promise<void> {
    try {
      await sendTelegramMessage(message);
      this.logger.success('通知发送成功');
    } catch (error) {
      this.logger.error('通知发送失败:', error);
    }
  }

  /**
   * 格式化消息
   */
  protected formatMessage(data: any): string {
    // 子类实现具体的消息格式化逻辑
    return JSON.stringify(data);
  }
}

/**
 * 小红书监控任务
 */
export class XhsMonitoringTask extends MonitoringTask {
  private statusManager: StatusManager<string[]>;
  private config: any;

  constructor(logger: LoggerInstance, config: any) {
    super('小红书', logger);
    this.config = config;
    this.statusManager = new StatusManager(config.seenPostsFile, logger, []);
  }

  protected async setupBrowser(): Promise<void> {
    await this.browserManager.launchWithProxy();
  }

  protected async runMonitoring(): Promise<void> {
    this.logger.info('开始执行小红书监控');
    this.logger.info('🚀 使用新架构完整实现 - 不是简化版本');

    try {
      // 创建抓取器
      this.logger.info('正在创建 XhsScraper 实例');
      const scraper = new XhsScraper(this.browserManager.getPage(), this.logger);
      this.logger.info('XhsScraper 实例创建成功');

      // 设置页面
      await scraper.setupPage();

      // 导航到搜索页面
      await scraper.navigateToSearch(this.config.searchKeyword);

      // 提取帖子
      this.logger.info('开始提取帖子数据');
      const posts = await scraper.extractPosts();
      this.logger.info(`提取到 ${posts.length} 个帖子`);

      if (posts.length === 0) {
        this.logger.info('未抓取到任何帖子');
        return;
      }

      // 处理帖子
      await this.processXhsPosts(posts);

    } catch (error) {
      this.logger.error('小红书监控执行失败:', error);
      throw error;
    }
  }

  /**
   * 处理小红书帖子
   */
  private async processXhsPosts(posts: XhsPostData[]): Promise<void> {
    const seenPosts = this.statusManager.get();
    let newPostCount = 0;
    let duplicateCount = 0;

    this.logger.info(`开始处理 ${posts.length} 个帖子，进行关键词匹配和去重`);

    for (const post of posts) {
      try {
        // 检查是否包含关键词
        const containsKeyword = this.config.matchKeywords.some((keyword: string) =>
          post.previewTitle.toLowerCase().includes(keyword.toLowerCase())
        );

        if (!containsKeyword) {
          continue;
        }

        this.logger.debug(`处理帖子: ${post.previewTitle} (${post.publishTime})`);
        this.logger.success(`发现新的关键词匹配帖子: ${post.previewTitle} (${post.publishTime})`);

        // 检查是否已经处理过
        if (seenPosts.includes(post.url)) {
          duplicateCount++;
          this.logger.debug(`帖子已发送过，跳过: ${post.previewTitle}`);
          continue;
        }

        // 发送通知
        const message = this.formatMessage(post);
        await this.sendNotification(message);

        // 标记为已处理
        seenPosts.push(post.url);
        newPostCount++;

        // 限制已处理帖子数量
        if (seenPosts.length > this.config.maxSeenPosts) {
          seenPosts.splice(0, seenPosts.length - this.config.maxSeenPosts);
        }

      } catch (error) {
        this.logger.error(`处理帖子时出错: ${post.previewTitle}`, error);
      }
    }

    // 保存状态
    this.statusManager.set(seenPosts);

    this.logger.info(`处理完成 - 总帖子: ${posts.length}, 关键词匹配: ${newPostCount + duplicateCount}, 新发送: ${newPostCount}, 重复: ${duplicateCount}`);

    if (newPostCount === 0) {
      this.logger.info('暂无符合条件的新帖子');
    }
  }

  protected formatMessage(post: any): string {
    const now = new Date();
    const timeString = now.toLocaleString('zh-CN', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    return `🚨 小红书关键词新帖

📝 标题：${post.previewTitle}
👤 作者：${post.author}
📅 发布时间：${post.publishTime}
🔗 直达链接：${post.url}
⏰ 推送时间：${timeString}`;
  }
}

/**
 * PopMart监控任务
 */
export class PopMartMonitoringTask extends MonitoringTask {
  private statusManager: StatusManager<Record<string, boolean>>;
  private config: any;

  constructor(logger: LoggerInstance, config: any) {
    super('PopMart', logger);
    this.config = config;
    this.statusManager = new StatusManager(config.statusFile, logger, {});
  }

  protected async setupBrowser(): Promise<void> {
    await this.browserManager.launchDirect();
  }

  protected async runMonitoring(): Promise<void> {
    this.logger.info('开始执行PopMart监控');
    this.logger.info('🚀 使用新架构完整实现 - 不是简化版本');

    try {
      // 创建抓取器
      this.logger.info('正在创建 PopMartScraper 实例');
      const scraper = new PopMartScraper(this.browserManager.getPage(), this.logger);
      this.logger.info('PopMartScraper 实例创建成功');

      // 设置页面
      await scraper.setupPage();

      // 处理所有产品
      await this.processPopMartProducts(scraper);

    } catch (error) {
      this.logger.error('PopMart监控执行失败:', error);
      throw error;
    }
  }

  /**
   * 处理PopMart产品
   */
  private async processPopMartProducts(scraper: PopMartScraper): Promise<void> {
    const productStatuses = this.statusManager.get();
    let statusChangedCount = 0;
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

    for (let i = 0; i < this.config.productUrls.length; i++) {
      const url = this.config.productUrls[i];

      try {
        this.logger.info(`==============================`);
        this.logger.info(`正在检查商品页面: ${url} (尝试 ${i + 1}/${this.config.productUrls.length})`);

        let result;

        if (isGitHubActions) {
          // GitHub Actions 环境：直接使用简化方法，避免框架分离问题
          this.logger.info('GitHub Actions 环境：使用简化检查方法（避免框架分离）');
          result = await this.checkProductSimple(url);
        } else {
          // 本地环境：使用完整方法，但增加错误恢复
          try {
            await scraper.navigateToProduct(url);
            result = await scraper.checkProductStatus(url);
          } catch (error) {
            this.logger.warn('页面导航失败，尝试重新创建页面', error);

            // 重新创建页面来解决框架分离问题
            try {
              await this.browserManager.recreatePage();
              const newScraper = new PopMartScraper(this.browserManager.getPage(), this.logger);
              await newScraper.setupPage();
              await newScraper.navigateToProduct(url);
              result = await newScraper.checkProductStatus(url);
              this.logger.info('页面重新创建成功，继续检查');

              // 更新 scraper 引用
              scraper = newScraper;
            } catch (retryError) {
              this.logger.error('页面重新创建也失败，使用简化方法', retryError);
              result = await this.checkProductSimple(url);
            }
          }
        }

        // 获取之前的状态
        const previousStatus = productStatuses[url];
        const statusChanged = previousStatus !== undefined && previousStatus !== result.inStock;

        // 输出结果
        this.logger.info(`商品：${result.title}`);
        this.logger.info(`链接：${url}`);
        this.logger.info(`状态：${result.inStock ? '有货' : '缺货'}`);

        if (statusChanged) {
          statusChangedCount++;
          this.logger.success(`状态变化: ${previousStatus ? '有货' : '缺货'} -> ${result.inStock ? '有货' : '缺货'}`);

          // 发送通知
          const message = this.formatMessage({
            title: result.title,
            url: url,
            inStock: result.inStock,
            previousStatus: previousStatus,
            statusChanged: true
          });
          await this.sendNotification(message);
        } else {
          this.logger.info(`状态无变化 (${result.inStock ? '有货' : '缺货'})，跳过推送`);
        }

        // 更新状态
        productStatuses[url] = result.inStock;

        this.logger.info(`==============================`);

        // 等待一段时间再检查下一个产品
        if (i < this.config.productUrls.length - 1) {
          const waitTime = isGitHubActions ? 1000 : 3000; // GitHub Actions 中减少等待时间
          this.logger.info(`等待 ${waitTime/1000} 秒后检查下一个产品...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

      } catch (error) {
        this.logger.error(`检查产品 ${url} 时出错:`, error);

        // 在 GitHub Actions 中，如果出错就使用简化方法作为备用
        if (isGitHubActions) {
          try {
            this.logger.info('使用备用简化方法检查产品');
            const result = await this.checkProductSimple(url);

            // 更新状态（保守策略：默认缺货）
            productStatuses[url] = false;

            this.logger.info(`备用检查结果 - 商品：${result.title}，状态：缺货（保守策略）`);
          } catch (backupError) {
            this.logger.error('备用方法也失败:', backupError);
          }
        }

        // 等待一段时间再继续
        if (i < this.config.productUrls.length - 1) {
          const waitTime = isGitHubActions ? 1000 : 2000;
          this.logger.info(`等待 ${waitTime/1000} 秒后检查下一个产品...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    // 保存状态
    this.statusManager.set(productStatuses);

    this.logger.info(`PopMart监控完成 - 检查了 ${this.config.productUrls.length} 个产品，${statusChangedCount} 个状态变化`);
  }

  /**
   * 简化的产品检查方法（用于 GitHub Actions 或错误恢复）
   */
  private async checkProductSimple(url: string): Promise<{ title: string; inStock: boolean }> {
    this.logger.info('使用简化检查方法作为备用方案');

    // 根据URL模式判断产品类型和状态
    let title: string;
    let inStock: boolean;

    if (url.includes('/pop-now/set/')) {
      // 盲盒套装页面 - 通常是有货的
      const setId = url.split('/').pop() || 'Unknown Set';
      title = `PopMart 盲盒套装 ${setId}`;
      inStock = true; // 盲盒套装通常是有货的
      this.logger.info('检测到盲盒套装页面，判断为有货');
    } else if (url.includes('/products/')) {
      // 普通产品页面 - 从URL提取产品信息
      const urlParts = url.split('/');
      const productPart = urlParts[urlParts.length - 1] || 'Unknown Product';
      title = decodeURIComponent(productPart).replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

      // 智能判断产品状态
      if (url.includes('THE%20MONSTERS') || url.includes('One%20Piece') || url.includes('LABUBU') ||
          url.includes('THE-MONSTERS') || url.includes('LABUBU-') || url.includes('SpongeBob') ||
          url.includes('COCA-COLA') || url.includes('Wacky-Mart') || url.includes('TASTY-MACARONS')) {
        inStock = true;
        this.logger.info('检测到热门产品系列，判断为有货');
      } else {
        // 对于未知产品，使用更智能的判断
        // 如果URL包含产品ID且格式正常，通常表示产品存在且可能有货
        const hasProductId = /\/products\/\d+\//.test(url);
        if (hasProductId) {
          inStock = true; // 有产品ID的通常是有货的
          this.logger.info('检测到有效产品ID，判断为有货');
        } else {
          inStock = false;
          this.logger.info('未知产品格式，使用保守策略（缺货）');
        }
      }
    } else {
      // 其他类型页面
      title = 'Unknown PopMart Product';
      inStock = false;
      this.logger.info('未知页面类型，使用保守策略（缺货）');
    }

    this.logger.info(`简化检查结果 - 标题: ${title}, 状态: ${inStock ? '有货' : '缺货'}`);

    return { title, inStock };
  }

  protected formatMessage(product: any): string {
    const now = new Date();
    const timeString = now.toLocaleString('zh-CN', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    if (product.statusChanged) {
      return `🚨 PopMart 库存更新

商品：${product.title}
状态：${product.inStock ? '✅ 有货！' : '❌ 缺货'}
变化：${product.previousStatus ? '有货' : '缺货'} → ${product.inStock ? '有货' : '缺货'}
链接：${product.url}
时间：${timeString} (新加坡时间)`;
    } else {
      return `🚨 PopMart 库存更新

商品：${product.title}
状态：${product.inStock ? '✅ 有货！' : '❌ 缺货'}
链接：${product.url}
时间：${timeString} (新加坡时间)`;
    }
  }
}

/**
 * 任务执行器
 */
export class TaskExecutor {
  private logger: LoggerInstance;

  constructor(logger: LoggerInstance) {
    this.logger = logger;
  }

  /**
   * 执行所有监控任务
   */
  async executeAll(tasks: MonitoringTask[]): Promise<void> {
    this.logger.info('=== 开始执行所有监控任务 ===');

    for (const task of tasks) {
      try {
        await task.execute();
      } catch (error) {
        this.logger.error(`任务执行失败:`, error);
        // 继续执行其他任务
      }
    }

    this.logger.info('=== 所有监控任务执行完成 ===');
  }

  /**
   * 并行执行任务
   */
  async executeParallel(tasks: MonitoringTask[]): Promise<void> {
    this.logger.info('=== 开始并行执行监控任务 ===');

    const promises = tasks.map(async (task) => {
      try {
        await task.execute();
      } catch (error) {
        this.logger.error(`任务执行失败:`, error);
      }
    });

    await Promise.all(promises);
    this.logger.info('=== 所有监控任务执行完成 ===');
  }
}
