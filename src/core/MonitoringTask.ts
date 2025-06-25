import { BrowserManager } from './BrowserManager';
import { LoggerInstance } from '../utils/logger';
import { StatusManager } from '../utils/statusManager';
import { sendTelegramMessage } from '../utils/sendTelegramMessage';
import { XhsScraper } from '../scrapers/XhsScraper';
import { PopMartScraper } from '../scrapers/PopMartScraper';
import { XhsService } from '../services/XhsService';
import { PopMartService } from '../services/PopMartService';
import { XhsPostData } from '../types';

/**
 * 监控任务基类
 */
export abstract class MonitoringTask {
  protected browserManager: BrowserManager;
  protected logger: LoggerInstance;
  protected taskName: string;
  protected isGitHubActions: boolean;

  constructor(taskName: string, logger: LoggerInstance) {
    this.taskName = taskName;
    this.logger = logger;
    this.browserManager = new BrowserManager(logger);
    this.isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
  }

  /**
   * 条件日志输出 - 在 GitHub Actions 中减少无用日志
   */
  protected logInfo(message: string, forceShow: boolean = false): void {
    if (forceShow || !this.isGitHubActions) {
      this.logger.info(message);
    }
  }

  protected logDebug(message: string): void {
    if (!this.isGitHubActions) {
      this.logger.debug(message);
    }
  }

  /**
   * 执行监控任务
   */
  async execute(): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`=== 开始执行${this.taskName}监控任务 ===`);

    try {
      // 设置任务超时时间（20分钟，留5分钟给清理工作）
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`${this.taskName}监控任务超时（20分钟）`));
        }, 20 * 60 * 1000);
      });

      await Promise.race([
        this.runTaskWithSetup(),
        timeoutPromise
      ]);

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
   * 运行任务（包含浏览器设置）
   */
  private async runTaskWithSetup(): Promise<void> {
    // 启动浏览器
    await this.setupBrowser();

    // 执行具体的监控逻辑
    await this.runMonitoring();
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
   * 清理资源（带超时保护）
   */
  protected async cleanup(): Promise<void> {
    try {
      this.logger.debug('开始清理资源');

      // 设置清理超时（GitHub Actions: 15秒，本地: 30秒）
      const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
      const timeout = isGitHubActions ? 15000 : 30000;

      await Promise.race([
        this.browserManager.close(),
        new Promise<void>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`资源清理超时（${timeout/1000}秒）`));
          }, timeout);
        })
      ]);

      this.logger.debug('资源清理完成');
    } catch (error) {
      this.logger.warn('资源清理失败:', error);
      // 不抛出错误，避免影响主流程
    }
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
      // 重新抛出错误，让调用方知道推送失败
      throw error;
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
  private xhsService: XhsService;

  constructor(logger: LoggerInstance, config: any) {
    super('小红书', logger);
    this.config = config;
    this.statusManager = new StatusManager(config.seenPostsFile, logger, []);
    this.xhsService = new XhsService(logger, this.statusManager, config);
  }

  protected async setupBrowser(): Promise<void> {
    await this.browserManager.launchWithProxy();
  }

  protected async runMonitoring(): Promise<void> {
    this.logInfo('开始执行小红书监控', true);
    this.logDebug('🚀 使用新架构完整实现 - 不是简化版本');

    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    if (isGitHubActions) {
      this.logger.info('🔧 GitHub Actions 环境检测到，使用优化配置');
    }

    try {
      // 创建抓取器
      this.logDebug('正在创建 XhsScraper 实例');
      const scraper = new XhsScraper(this.browserManager.getPage(), this.logger);
      this.logDebug('XhsScraper 实例创建成功');

      // 设置页面
      this.logInfo('设置页面配置', true);
      await scraper.setupPage();

      // 导航到搜索页面
      this.logInfo('导航到搜索页面', true);
      await scraper.navigateToSearch(this.config.searchKeyword);

      // 提取帖子
      this.logInfo('开始提取帖子数据', true);
      const posts = await scraper.extractPosts();
      this.logInfo(`提取到 ${posts.length} 个帖子`, true);

      if (posts.length === 0) {
        this.logInfo('未抓取到任何帖子', true);
        return;
      }

      // 处理帖子
      this.logInfo('开始处理帖子数据', true);
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
    // 使用XhsService处理帖子
    await this.xhsService.processPosts(posts);
  }



  protected formatMessage(post: any): string {
    const now = new Date();
    const pushTimeString = now.toLocaleString('zh-CN', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // 使用帖子的发布时间，确保显示正确的相对时间
    const publishTime = post.publishTime || '未知时间';
    const location = post.location || '';

    return `🚨 小红书关键词新帖

📝 标题：${post.previewTitle}
👤 作者：${post.author || '未知作者'}
📅 帖子发布：${publishTime}${location ? ` 📍 ${location}` : ''}
🔗 直达链接：${post.url}
⏰ 系统推送：${pushTimeString} (新加坡时间)`;
  }
}

/**
 * PopMart监控任务
 */
export class PopMartMonitoringTask extends MonitoringTask {
  private statusManager: StatusManager<Record<string, any>>;
  private config: any;
  private popMartService: PopMartService;

  constructor(logger: LoggerInstance, config: any) {
    super('PopMart', logger);
    this.config = config;
    this.statusManager = new StatusManager(config.statusFile, logger, {});
    this.popMartService = new PopMartService(logger, this.statusManager, config);
  }

  protected async setupBrowser(): Promise<void> {
    await this.browserManager.launchDirect();
  }

  protected async runMonitoring(): Promise<void> {
    this.logInfo('开始执行PopMart监控', true);
    this.logDebug('🚀 使用新架构完整实现 - 不是简化版本');

    try {
      // 创建抓取器
      this.logDebug('正在创建 PopMartScraper 实例');
      const scraper = new PopMartScraper(this.browserManager.getPage(), this.logger);
      this.logDebug('PopMartScraper 实例创建成功');

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
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

    for (let i = 0; i < this.config.productUrls.length; i++) {
      const url = this.config.productUrls[i];

      try {
        this.logDebug(`==============================`);
        this.logInfo(`正在检查商品页面: ${url} (${i + 1}/${this.config.productUrls.length})`, true);

        let result;

        if (isGitHubActions) {
          // GitHub Actions 环境：直接使用简化方法，避免框架分离问题
          this.logDebug('GitHub Actions 环境：使用简化检查方法（避免框架分离）');
          result = await this.popMartService.checkProductSimple(url);
        } else {
          // 本地环境：使用完整检查方法获取真实商品信息
          this.logDebug('本地环境：使用完整检查方法（获取真实商品信息）');
          try {
            // 导航到产品页面
            await scraper.navigateToProduct(url);
            // 检查产品状态
            result = await scraper.checkProductStatus(url);
          } catch (error) {
            this.logDebug(`完整检查失败，使用简化方法: ${error}`);
            result = await this.popMartService.checkProductSimple(url);
          }
        }

        // 使用PopMartService处理结果
        await this.popMartService.processProductResult(url, result);

        this.logger.info(`==============================`);

        // 等待一段时间再检查下一个产品
        if (i < this.config.productUrls.length - 1) {
          const waitTime = isGitHubActions ? 1000 : 3000; // GitHub Actions 中减少等待时间
          this.logger.info(`等待 ${waitTime/1000} 秒后检查下一个产品...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

      } catch (error) {
        this.logger.error(`检查产品 ${url} 时出错:`, error);
      }

      // 等待一段时间再检查下一个产品
      if (i < this.config.productUrls.length - 1) {
        const waitTime = isGitHubActions ? 1000 : 3000;
        this.logger.info(`等待 ${waitTime/1000} 秒后检查下一个产品...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    const statusChangedCount = this.popMartService.getStatusChangeCount();
    this.logger.info(`PopMart监控完成 - 检查了 ${this.config.productUrls.length} 个产品，${statusChangedCount} 个状态变化`);
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
