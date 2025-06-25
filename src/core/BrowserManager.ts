import puppeteer, { Browser, Page } from 'puppeteer';
import { launchWithRandomProxy } from '../utils/proxyLauncher';
import { LoggerInstance } from '../utils/logger';
import { ProxyConfig } from '../types';

/**
 * 通用浏览器管理器
 * 统一管理浏览器的创建、配置和销毁
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private proxy: ProxyConfig | null = null;
  private logger: LoggerInstance;

  constructor(logger: LoggerInstance) {
    this.logger = logger;
  }

  /**
   * 获取浏览器启动参数
   */
  private getBrowserArgs(isGitHubActions: boolean): string[] {
    const baseArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
      '--disable-infobars',
      '--disable-web-security',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
      '--window-size=1920,1080'
    ];

    if (isGitHubActions) {
      baseArgs.push(
        '--disable-features=site-per-process',
        '--single-process',
        '--no-zygote',
        '--memory-pressure-off',
        '--max_old_space_size=4096'
      );
      this.logger.info('GitHub Actions 环境：使用增强稳定性配置');
    }

    return baseArgs;
  }

  /**
   * 启动浏览器（带代理）
   */
  async launchWithProxy(): Promise<{ browser: Browser; page: Page; proxy: ProxyConfig | null }> {
    try {
      this.logger.info('启动浏览器和代理');
      
      try {
        const result = await launchWithRandomProxy();
        this.browser = result.browser;
        this.page = result.page;
        this.proxy = result.proxy;
        
        if (this.proxy) {
          this.logger.info(`使用代理: ${this.proxy.ip}:${this.proxy.port}`);
        }
      } catch (proxyError) {
        this.logger.warn('代理启动失败，尝试直接连接:', proxyError);
        const result = await this.launchDirect();
        this.browser = result.browser;
        this.page = result.page;
        this.proxy = null;
      }

      return { browser: this.browser, page: this.page, proxy: this.proxy };
    } catch (error) {
      this.logger.error('浏览器启动失败:', error);
      throw error;
    }
  }

  /**
   * 启动浏览器（直接连接）
   */
  async launchDirect(): Promise<{ browser: Browser; page: Page }> {
    this.logger.info('使用直接连接模式（无代理）');

    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

    const args = this.getBrowserArgs(isGitHubActions);

    this.browser = await puppeteer.launch({
      headless: true,
      args,
      ignoreDefaultArgs: ['--enable-automation'],
      defaultViewport: null,
      timeout: 30000
    });

    this.page = await this.browser.newPage();

    // 在 GitHub Actions 中设置更宽松的页面配置
    if (isGitHubActions) {
      await this.page.setDefaultTimeout(60000);
      await this.page.setDefaultNavigationTimeout(90000);
    }

    return { browser: this.browser, page: this.page };
  }

  /**
   * 设置页面反检测
   */
  async setupAntiDetection(page: Page): Promise<void> {
    // 设置用户代理
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // 设置视口
    await page.setViewport({ width: 1920, height: 1080 });
    
    // 移除 webdriver 标识
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });
  }

  /**
   * 安全导航到页面
   */
  async navigateToPage(url: string, options?: { waitUntil?: 'networkidle2' | 'domcontentloaded'; timeout?: number }): Promise<void> {
    if (!this.page) {
      throw new Error('页面未初始化');
    }

    const { waitUntil = 'networkidle2', timeout = 60000 } = options || {};
    
    try {
      await this.page.goto(url, { waitUntil, timeout });
      this.logger.info('页面导航成功');
    } catch (navError) {
      this.logger.error('页面导航失败:', navError);
      throw navError;
    }
  }

  /**
   * 获取当前页面
   */
  getPage(): Page {
    if (!this.page) {
      throw new Error('页面未初始化');
    }
    return this.page;
  }

  /**
   * 获取当前浏览器
   */
  getBrowser(): Browser {
    if (!this.browser) {
      throw new Error('浏览器未初始化');
    }
    return this.browser;
  }

  /**
   * 重新创建页面（解决框架分离问题）
   */
  async recreatePage(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }

      if (this.browser) {
        this.page = await this.browser.newPage();

        // 重新设置页面配置
        const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
        if (isGitHubActions) {
          await this.page.setDefaultTimeout(10000);
          await this.page.setDefaultNavigationTimeout(15000);
        }

        this.logger.info('页面重新创建成功');
      } else {
        throw new Error('浏览器实例不存在');
      }
    } catch (error) {
      this.logger.error('重新创建页面失败:', error);
      throw error;
    }
  }

  /**
   * 关闭浏览器（带超时保护）
   */
  async close(): Promise<void> {
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    const timeout = isGitHubActions ? 10000 : 30000; // GitHub Actions: 10秒，本地: 30秒

    try {
      await Promise.race([
        this.closeInternal(),
        new Promise<void>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`浏览器关闭超时（${timeout/1000}秒）`));
          }, timeout);
        })
      ]);
    } catch (error) {
      this.logger.warn('关闭浏览器时出错:', error);

      // 强制清理
      try {
        if (this.browser) {
          this.browser.process()?.kill('SIGKILL');
        }
      } catch (killError) {
        this.logger.debug('强制终止浏览器进程失败:', killError);
      }

      this.page = null;
      this.browser = null;
    }
  }

  /**
   * 内部关闭逻辑
   */
  private async closeInternal(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.logger.info('浏览器已关闭');
  }
}
