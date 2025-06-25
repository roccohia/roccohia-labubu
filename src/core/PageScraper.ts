import { Page } from 'puppeteer';
import { LoggerInstance } from '../utils/logger';

/**
 * 通用页面抓取器
 * 提供常用的页面操作和数据提取方法
 */
export class PageScraper {
  private page: Page;
  private logger: LoggerInstance;

  constructor(page: Page, logger: LoggerInstance) {
    this.page = page;
    this.logger = logger;
  }

  /**
   * 等待页面稳定
   */
  async waitForStable(timeout: number = 5000): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, timeout));
  }

  /**
   * 安全导航到页面
   */
  async navigateToPage(url: string, options?: { waitUntil?: 'networkidle2' | 'domcontentloaded'; timeout?: number }): Promise<void> {
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
   * 安全地获取页面内容
   */
  async getPageContent(): Promise<string> {
    try {
      return await this.page.content();
    } catch (error) {
      this.logger.warn('获取页面内容失败:', error);
      return '';
    }
  }

  /**
   * 安全地获取页面标题
   */
  async getPageTitle(): Promise<string> {
    try {
      return await this.page.title();
    } catch (error) {
      this.logger.warn('获取页面标题失败:', error);
      return '';
    }
  }

  /**
   * 安全地获取页面URL
   */
  async getPageUrl(): Promise<string> {
    try {
      return await this.page.url();
    } catch (error) {
      this.logger.warn('获取页面URL失败:', error);
      return '';
    }
  }

  /**
   * 检查元素是否存在
   */
  async elementExists(selector: string): Promise<boolean> {
    try {
      const element = await this.page.$(selector);
      return element !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * 安全地点击元素
   */
  async safeClick(selector: string): Promise<boolean> {
    try {
      await this.page.click(selector);
      return true;
    } catch (error) {
      this.logger.debug(`点击元素失败 ${selector}:`, error);
      return false;
    }
  }

  /**
   * 获取元素文本
   */
  async getElementText(selector: string): Promise<string> {
    try {
      const element = await this.page.$(selector);
      if (element) {
        return await this.page.evaluate(el => el.textContent?.trim() || '', element);
      }
      return '';
    } catch (error) {
      return '';
    }
  }

  /**
   * 获取多个元素的文本
   */
  async getElementsText(selector: string): Promise<string[]> {
    try {
      return await this.page.evaluate((sel) => {
        const elements = document.querySelectorAll(sel);
        return Array.from(elements).map(el => el.textContent?.trim() || '');
      }, selector);
    } catch (error) {
      return [];
    }
  }

  /**
   * 处理Cookie弹窗
   */
  async handleCookiePopup(): Promise<void> {
    this.logger.info('检查 Cookie 弹窗...');
    
    const cookieSelectors = [
      'button[id*="accept"]',
      'button[class*="accept"]',
      'button[class*="cookie"]',
      '.cookie-accept',
      '#cookie-accept',
      '[data-testid="accept-cookies"]'
    ];

    for (const selector of cookieSelectors) {
      if (await this.elementExists(selector)) {
        await this.safeClick(selector);
        await this.waitForStable(1000);
        break;
      }
    }
    
    this.logger.info('Cookie 弹窗处理完成');
  }

  /**
   * 滚动页面到底部
   */
  async scrollToBottom(): Promise<void> {
    try {
      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await this.waitForStable(2000);
    } catch (error) {
      this.logger.debug('滚动页面失败:', error);
    }
  }

  /**
   * 检测框架分离
   */
  async isFrameDetached(): Promise<boolean> {
    try {
      await this.page.url();
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return errorMessage.includes('detached Frame');
    }
  }

  /**
   * GitHub Actions 环境检测
   */
  isGitHubActions(): boolean {
    return process.env.GITHUB_ACTIONS === 'true';
  }

  /**
   * 安全地执行页面脚本
   */
  async safeEvaluate<T>(pageFunction: () => T): Promise<T | null> {
    try {
      return await this.page.evaluate(pageFunction);
    } catch (error) {
      this.logger.debug('页面脚本执行失败:', error);
      return null;
    }
  }

  /**
   * 等待选择器出现
   */
  async waitForSelector(selector: string, timeout: number = 10000): Promise<boolean> {
    try {
      await this.page.waitForSelector(selector, { timeout });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 批量测试选择器
   */
  async testSelectors(selectors: string[]): Promise<{ selector: string; count: number }[]> {
    const results: { selector: string; count: number }[] = [];
    
    for (const selector of selectors) {
      try {
        const count = await this.page.evaluate((sel) => {
          return document.querySelectorAll(sel).length;
        }, selector);
        results.push({ selector, count });
      } catch (error) {
        results.push({ selector, count: 0 });
      }
    }
    
    return results;
  }
}
