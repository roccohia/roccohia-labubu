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
   * 创建优化的浏览器实例（增强错误处理）
   */
  private async createBrowserInstance(): Promise<{ browser: Browser; page: Page }> {
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
      // 直接连接，不使用代理
      const launchOptions: any = {
        headless: true,
        args: this.getOptimizedBrowserArgs(isGitHubActions),
        timeout: isGitHubActions ? 90000 : 30000, // GitHub Actions 中使用更长的超时时间
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false
      };

      // GitHub Actions 中完全禁用默认视口和自动化检测
      if (isGitHubActions) {
        launchOptions.defaultViewport = null;
        launchOptions.ignoreDefaultArgs = [
          '--enable-automation',
          '--enable-blink-features=IdleDetection'
        ];
        console.log('GitHub Actions环境：禁用默认视口和自动化特性以避免触摸模拟');
      } else {
        launchOptions.defaultViewport = { width: 1920, height: 1080 };
        launchOptions.ignoreDefaultArgs = ['--enable-automation'];
      }

      browser = await puppeteer.launch(launchOptions);

      // 验证浏览器是否成功启动
      if (!browser || !browser.isConnected()) {
        throw new Error('Browser failed to start or connect');
      }

      page = await browser.newPage();

      // 验证页面是否成功创建
      if (!page || page.isClosed()) {
        throw new Error('Page failed to create or was closed');
      }

      // 设置页面超时
      page.setDefaultTimeout(isGitHubActions ? 45000 : 15000);
      page.setDefaultNavigationTimeout(isGitHubActions ? 45000 : 15000);

      // GitHub Actions 中完全跳过页面优化以避免任何模拟调用
      if (isGitHubActions) {
        console.log('GitHub Actions环境：跳过页面优化以避免模拟错误');
        // 只设置最基本的用户代理，不做任何其他设置
        try {
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        } catch (uaError) {
          console.warn('设置用户代理失败，继续使用默认值:', uaError);
        }
      } else {
        await this.optimizePage(page, isGitHubActions);
      }

      return { browser, page };

    } catch (error) {
      // 清理资源
      if (page && !page.isClosed()) {
        try {
          await page.close();
        } catch (closeError) {
          console.warn('Failed to close page during cleanup:', closeError);
        }
      }

      if (browser && browser.isConnected()) {
        try {
          await browser.close();
        } catch (closeError) {
          console.warn('Failed to close browser during cleanup:', closeError);
        }
      }

      throw error;
    }
  }

  /**
   * 优化页面设置（GitHub Actions 安全版）
   */
  private async optimizePage(page: Page, isGitHubActions: boolean): Promise<void> {
    try {
      // 设置超时时间
      const timeout = isGitHubActions ? 45000 : 60000;
      await page.setDefaultTimeout(timeout);
      await page.setDefaultNavigationTimeout(timeout);

      // GitHub Actions 中简化资源处理
      if (isGitHubActions) {
        // 只设置用户代理，避免其他可能触发模拟的操作
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        console.log('GitHub Actions环境：使用简化的页面设置');
      } else {
        // 本地环境使用完整的资源拦截
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
      }

      // 安全设置视口，完全避免触摸模拟问题
      if (isGitHubActions) {
        // GitHub Actions 中跳过视口设置，使用默认值
        console.log('GitHub Actions环境：跳过视口设置以避免触摸模拟错误');
      } else {
        // 本地环境使用简化设置
        await page.setViewport({
          width: 1920,
          height: 1080
        });
      }

    } catch (error) {
      console.warn('页面优化设置失败，使用默认设置:', error);
      // 如果设置失败，至少确保基本功能可用
      try {
        const timeout = isGitHubActions ? 45000 : 60000;
        await page.setDefaultTimeout(timeout);
        await page.setDefaultNavigationTimeout(timeout);
      } catch (timeoutError) {
        console.warn('设置超时失败:', timeoutError);
      }
    }
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
        '--virtual-time-budget=15000', // 增加执行时间限制
        '--max_old_space_size=512', // GitHub Actions中进一步限制内存
        // 额外的稳定性参数
        '--disable-extensions-http-throttling',
        '--disable-component-extensions-with-background-pages',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-client-side-phishing-detection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-hang-monitor',
        '--disable-domain-reliability',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        // 完全禁用触摸和模拟相关功能
        '--disable-touch-events',
        '--disable-touch-adjustment',
        '--disable-gesture-typing',
        '--disable-touch-drag-drop',
        '--disable-pinch',
        '--disable-device-emulation',
        '--disable-mobile-emulation',
        // 额外的模拟禁用参数
        '--disable-features=TouchEventFeatureDetection',
        '--disable-features=VizDisplayCompositor',
        '--disable-blink-features=TouchEventFeatureDetection',
        '--disable-blink-features=MobileLayoutTheme',
        '--disable-blink-features=PointerEvent',
        '--disable-accelerated-2d-canvas',
        '--disable-accelerated-video-decode',
        '--disable-gpu-sandbox',
        '--disable-software-rasterizer',
        // 激进的模拟禁用参数
        '--disable-features=UserAgentClientHint',
        '--disable-features=WebXR',
        '--disable-features=VirtualKeyboard',
        '--disable-blink-features=UserAgentClientHint',
        '--disable-blink-features=WebXR',
        '--disable-blink-features=VirtualKeyboard',
        '--disable-blink-features=DeviceMemoryAPI',
        '--disable-blink-features=NavigatorDeviceMemory',
        '--disable-device-discovery-notifications',
        '--disable-device-orientation',
        '--disable-sensors',
        '--disable-generic-sensor',
        '--disable-generic-sensor-extra-classes',
        // 最激进的解决方案：禁用整个模拟系统
        '--disable-features=DeviceEmulation',
        '--disable-features=TouchEmulation',
        '--disable-features=ViewportEmulation',
        '--disable-features=ScreenOrientationAPI',
        '--disable-blink-features=DeviceEmulation',
        '--disable-blink-features=TouchEmulation',
        '--disable-blink-features=ViewportEmulation',
        '--disable-blink-features=ScreenOrientationAPI',
        '--force-device-scale-factor=1',
        '--disable-lcd-text'
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
