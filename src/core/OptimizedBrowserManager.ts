import puppeteer, { Browser, Page } from 'puppeteer';
import { LoggerInstance } from '../utils/logger';

/**
 * 浏览器实例池
 * 管理多个浏览器实例，支持复用和负载均衡
 */
class BrowserPool {
  private static instance: BrowserPool;
  private browsers: Map<string, {
    browser: Browser;
    page: Page;
    lastUsed: number;
    inUse: boolean;
    taskCount: number;
  }> = new Map();
  private maxPoolSize = 2; // 减少到2个实例以节省内存
  private maxTasksPerBrowser = 5; // 每个浏览器最多处理5个任务后重启
  private logger: LoggerInstance;

  private constructor(logger: LoggerInstance) {
    this.logger = logger;
    
    // 定期清理过期实例
    setInterval(() => {
      this.cleanup().catch(error => {
        this.logger.warn('定期清理浏览器实例失败:', error);
      });
    }, 5 * 60 * 1000); // 每5分钟清理一次
  }

  static getInstance(logger: LoggerInstance): BrowserPool {
    if (!BrowserPool.instance) {
      BrowserPool.instance = new BrowserPool(logger);
    }
    return BrowserPool.instance;
  }

  /**
   * 获取可用的浏览器实例
   */
  async getBrowser(): Promise<{ browser: Browser; page: Page; id: string }> {
    // 查找空闲且未过度使用的浏览器实例
    for (const [id, instance] of this.browsers) {
      if (!instance.inUse && instance.taskCount < this.maxTasksPerBrowser) {
        instance.inUse = true;
        instance.lastUsed = Date.now();
        instance.taskCount++;
        this.logger.debug(`复用浏览器实例: ${id} (任务数: ${instance.taskCount})`);
        return { ...instance, id };
      }
    }

    // 如果没有空闲实例且未达到最大数量，创建新实例
    if (this.browsers.size < this.maxPoolSize) {
      const id = `browser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const instance = await this.createBrowserInstance();
      this.browsers.set(id, { 
        ...instance, 
        lastUsed: Date.now(), 
        inUse: true,
        taskCount: 1
      });
      this.logger.debug(`创建新浏览器实例: ${id}`);
      return { ...instance, id };
    }

    // 等待空闲实例或重启过度使用的实例
    this.logger.debug('等待浏览器实例空闲或重启过度使用的实例...');
    return new Promise(async (resolve) => {
      const checkInterval = setInterval(async () => {
        // 检查空闲实例
        for (const [id, instance] of this.browsers) {
          if (!instance.inUse && instance.taskCount < this.maxTasksPerBrowser) {
            clearInterval(checkInterval);
            instance.inUse = true;
            instance.lastUsed = Date.now();
            instance.taskCount++;
            resolve({ ...instance, id });
            return;
          }
        }

        // 重启过度使用的实例
        for (const [id, instance] of this.browsers) {
          if (!instance.inUse && instance.taskCount >= this.maxTasksPerBrowser) {
            clearInterval(checkInterval);
            try {
              await instance.browser.close();
              this.browsers.delete(id);
              this.logger.debug(`重启过度使用的浏览器实例: ${id}`);
              
              const newInstance = await this.createBrowserInstance();
              this.browsers.set(id, { 
                ...newInstance, 
                lastUsed: Date.now(), 
                inUse: true,
                taskCount: 1
              });
              resolve({ ...newInstance, id });
            } catch (error) {
              this.logger.warn(`重启浏览器实例失败: ${id}`, error);
            }
            return;
          }
        }
      }, 100);

      // 10秒后超时，强制创建新实例
      setTimeout(async () => {
        clearInterval(checkInterval);
        try {
          const id = `browser_timeout_${Date.now()}`;
          const instance = await this.createBrowserInstance();
          this.browsers.set(id, { 
            ...instance, 
            lastUsed: Date.now(), 
            inUse: true,
            taskCount: 1
          });
          this.logger.warn(`超时创建新浏览器实例: ${id}`);
          resolve({ ...instance, id });
        } catch (error) {
          this.logger.error('超时创建浏览器实例失败:', error);
          throw error;
        }
      }, 10000);
    });
  }

  /**
   * 释放浏览器实例
   */
  releaseBrowser(id: string): void {
    const instance = this.browsers.get(id);
    if (instance) {
      instance.inUse = false;
      this.logger.debug(`释放浏览器实例: ${id} (任务数: ${instance.taskCount})`);
    }
  }

  /**
   * 创建优化的浏览器实例
   */
  private async createBrowserInstance(): Promise<{ browser: Browser; page: Page }> {
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

    // 直接连接，不使用代理
    const browser = await puppeteer.launch({
      headless: true,
      args: this.getOptimizedBrowserArgs(isGitHubActions),
      ignoreDefaultArgs: ['--enable-automation'],
      defaultViewport: null,
      timeout: isGitHubActions ? 60000 : 30000, // GitHub Actions 中使用更长的超时时间
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false
    });

    const page = await browser.newPage();

    // 设置页面超时
    page.setDefaultTimeout(isGitHubActions ? 30000 : 15000);
    page.setDefaultNavigationTimeout(isGitHubActions ? 30000 : 15000);

    await this.optimizePage(page, isGitHubActions);

    return { browser, page };
  }

  /**
   * 优化页面设置
   */
  private async optimizePage(page: Page, isGitHubActions: boolean): Promise<void> {
    // 设置超时时间
    const timeout = isGitHubActions ? 45000 : 60000;
    await page.setDefaultTimeout(timeout);
    await page.setDefaultNavigationTimeout(timeout);

    // 禁用不必要的资源加载以提升性能
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      
      // 阻止加载图片、字体、样式表等非必要资源
      if (['image', 'font', 'stylesheet', 'media'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // 设置用户代理
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // 设置视口
    await page.setViewport({ width: 1920, height: 1080 });
  }

  /**
   * 获取优化的浏览器启动参数
   */
  private getOptimizedBrowserArgs(isGitHubActions: boolean): string[] {
    const baseArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI,VizDisplayCompositor',
      '--disable-blink-features=AutomationControlled',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--disable-web-security',
      '--ignore-certificate-errors',
      '--window-size=1920,1080',
      '--memory-pressure-off', // 禁用内存压力检测
      '--max_old_space_size=1024', // 限制内存使用（减少到1GB）
    ];

    if (isGitHubActions) {
      baseArgs.push(
        '--disable-background-networking',
        '--disable-ipc-flooding-protection',
        '--single-process', // GitHub Actions中使用单进程模式
        '--disable-crash-reporter',
        '--disable-in-process-stack-traces',
        '--disable-logging',
        '--disable-dev-tools',
        '--disable-plugins',
        '--virtual-time-budget=10000', // 限制执行时间为10秒
        '--max_old_space_size=512' // GitHub Actions中进一步限制内存
      );
    }

    return baseArgs;
  }

  /**
   * 清理过期的浏览器实例
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    const maxIdleTime = 8 * 60 * 1000; // 8分钟空闲时间

    for (const [id, instance] of this.browsers) {
      if (!instance.inUse && (now - instance.lastUsed) > maxIdleTime) {
        try {
          await instance.browser.close();
          this.browsers.delete(id);
          this.logger.debug(`清理过期浏览器实例: ${id}`);
        } catch (error) {
          this.logger.warn(`清理浏览器实例失败: ${id}`, error);
        }
      }
    }
  }

  /**
   * 关闭所有浏览器实例
   */
  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.browsers.values()).map(async (instance) => {
      try {
        await instance.browser.close();
      } catch (error) {
        this.logger.warn('关闭浏览器实例失败:', error);
      }
    });

    await Promise.allSettled(closePromises);
    this.browsers.clear();
    this.logger.info('所有浏览器实例已关闭');
  }

  /**
   * 获取池状态信息
   */
  getPoolStatus(): { total: number; inUse: number; idle: number } {
    let inUse = 0;
    let idle = 0;
    
    for (const instance of this.browsers.values()) {
      if (instance.inUse) {
        inUse++;
      } else {
        idle++;
      }
    }

    return { total: this.browsers.size, inUse, idle };
  }
}

/**
 * 优化的浏览器管理器
 * 使用浏览器池进行实例管理
 */
export class OptimizedBrowserManager {
  private static pool: BrowserPool;
  private logger: LoggerInstance;
  private currentBrowserId: string | null = null;

  constructor(logger: LoggerInstance) {
    this.logger = logger;
    if (!OptimizedBrowserManager.pool) {
      OptimizedBrowserManager.pool = BrowserPool.getInstance(logger);
    }
  }

  /**
   * 获取浏览器实例
   */
  async getBrowser(): Promise<{ browser: Browser; page: Page }> {
    const result = await OptimizedBrowserManager.pool.getBrowser();
    this.currentBrowserId = result.id;
    return { browser: result.browser, page: result.page };
  }

  /**
   * 释放浏览器实例
   */
  releaseBrowser(): void {
    if (this.currentBrowserId) {
      OptimizedBrowserManager.pool.releaseBrowser(this.currentBrowserId);
      this.currentBrowserId = null;
    }
  }

  /**
   * 获取池状态
   */
  getPoolStatus(): { total: number; inUse: number; idle: number } {
    return OptimizedBrowserManager.pool.getPoolStatus();
  }

  /**
   * 关闭所有浏览器实例
   */
  static async closeAll(): Promise<void> {
    if (OptimizedBrowserManager.pool) {
      await OptimizedBrowserManager.pool.closeAll();
    }
  }
}
