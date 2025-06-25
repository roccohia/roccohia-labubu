import { BrowserManager } from './BrowserManager';
import { LoggerInstance } from '../utils/logger';
import { StatusManager } from '../utils/statusManager';
import { sendTelegramMessage } from '../utils/sendTelegramMessage';

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
    // 实现小红书监控逻辑
    // 这里会使用 XhsScraper
    this.logger.info('小红书监控逻辑待实现');
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
    // 实现PopMart监控逻辑
    // 这里会使用 PopMartScraper
    this.logger.info('PopMart监控逻辑待实现');
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

    return `🚨 PopMart 库存更新

商品：${product.title}
状态：${product.inStock ? '有货！' : '缺货'}
链接：${product.url}
时间：${timeString} (新加坡时间)`;
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
