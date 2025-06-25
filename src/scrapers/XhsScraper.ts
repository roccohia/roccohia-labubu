import { Page } from 'puppeteer';
import { PageScraper } from '../core/PageScraper';
import { LoggerInstance } from '../utils/logger';
import { PostData } from '../types';

/**
 * 小红书专用抓取器
 */
export class XhsScraper extends PageScraper {
  private readonly POST_SELECTORS = [
    'section.note-item',
    '.note-item',
    '.note-card',
    '[data-testid="note-item"]',
    '.feeds-page .note-item',
    '.search-item',
    '.note-list .item'
  ];

  constructor(page: Page, logger: LoggerInstance) {
    super(page, logger);
  }

  /**
   * 导航到搜索页面
   */
  async navigateToSearch(keyword: string): Promise<void> {
    const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&type=51`;
    this.logger.info(`导航到搜索页: ${keyword}`);
    
    await this.navigateToPage(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await this.waitForStable(8000);
    
    // 检查页面状态
    const currentUrl = await this.getPageUrl();
    const pageTitle = await this.getPageTitle();
    this.logger.info(`当前页面URL: ${currentUrl}`);
    this.logger.info(`页面标题: ${pageTitle}`);
  }

  /**
   * 提取帖子数据
   */
  async extractPosts(): Promise<PostData[]> {
    this.logger.info('开始提取帖子数据');

    // 先获取页面调试信息
    const debugInfo = await this.getDebugInfo();
    this.logDebugInfo(debugInfo);

    if (debugInfo.foundElements === 0) {
      this.logger.warn('未找到任何帖子元素，返回空结果');
      return [];
    }

    this.logger.info(`使用选择器: ${debugInfo.selectedSelector}, 找到 ${debugInfo.foundElements} 个元素`);

    // 提取帖子数据
    const posts = await this.extractPostsData(debugInfo.selectedSelector);
    this.logger.debug(`成功提取 ${posts.length} 个帖子`);
    
    return posts;
  }

  /**
   * 获取调试信息
   */
  private async getDebugInfo() {
    return await this.safeEvaluate(() => {
      const selectors = [
        'section.note-item',
        '.note-item',
        '.note-card',
        '[data-testid="note-item"]',
        '.feeds-page .note-item',
        '.search-item',
        '.note-list .item'
      ];

      const debug = {
        pageTitle: document.title,
        pageUrl: window.location.href,
        htmlLength: document.documentElement.outerHTML.length,
        selectorResults: {} as Record<string, number>,
        bodyStructure: [] as string[],
        foundElements: 0,
        selectedSelector: ''
      };

      // 测试所有选择器
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        debug.selectorResults[selector] = elements.length;
        if (elements.length > 0 && !debug.selectedSelector) {
          debug.selectedSelector = selector;
          debug.foundElements = elements.length;
        }
      }

      // 测试其他可能的选择器
      const alternativeSelectors = [
        '.search-item', 
        '.feeds-item',
        '.content-item',
        '[class*="note"]',
        '[class*="item"]',
        '[class*="card"]',
        'div[class*="note"]',
        'div[class*="item"]',
        'section'
      ];
      
      for (const selector of alternativeSelectors) {
        if (!debug.selectorResults[selector]) {
          debug.selectorResults[selector] = document.querySelectorAll(selector).length;
        }
      }

      // 获取页面主要结构
      const bodyChildren = document.body.children;
      for (let i = 0; i < Math.min(bodyChildren.length, 10); i++) {
        const child = bodyChildren[i];
        debug.bodyStructure.push(`<${child.tagName.toLowerCase()}> class="${child.className}" id="${child.id}"`);
      }

      return debug;
    }) || {
      pageTitle: '',
      pageUrl: '',
      htmlLength: 0,
      selectorResults: {},
      bodyStructure: [],
      foundElements: 0,
      selectedSelector: ''
    };
  }

  /**
   * 输出调试信息
   */
  private logDebugInfo(debugInfo: any): void {
    this.logger.info('=== 小红书页面调试信息 ===');
    this.logger.info(`页面标题: ${debugInfo.pageTitle}`);
    this.logger.info(`页面URL: ${debugInfo.pageUrl}`);
    this.logger.info(`页面HTML长度: ${debugInfo.htmlLength}`);
    this.logger.info(`选择器测试结果:`);
    for (const [selector, count] of Object.entries(debugInfo.selectorResults)) {
      this.logger.info(`  ${selector}: ${count} 个元素`);
    }
    this.logger.info(`页面主要结构:`);
    debugInfo.bodyStructure.forEach((structure: string, index: number) => {
      this.logger.info(`  ${index}: ${structure}`);
    });
  }

  /**
   * 提取帖子数据
   */
  private async extractPostsData(selectedSelector: string): Promise<PostData[]> {
    const result = await this.safeEvaluate((selector: string) => {
      const posts: any[] = [];
      const debugInfo: any[] = [];
      const elements = document.querySelectorAll(selector);

      if (!elements || elements.length === 0) {
        return { posts, debugInfo: ['没有找到元素'] };
      }

      elements.forEach((section, index) => {
        try {
          // 调试：记录前几个元素的详细信息
          if (index < 3) {
            debugInfo.push(`=== 调试帖子 ${index + 1} ===`);
            debugInfo.push(`元素HTML: ${section.outerHTML.substring(0, 500)}`);
            debugInfo.push(`所有链接: ${Array.from(section.querySelectorAll('a')).map(a => a.href).slice(0, 5).join(', ')}`);
            debugInfo.push(`所有文本: ${section.textContent?.substring(0, 200)}`);
          }

          // 抓取链接
          const linkSelectors = [
            'a[href^="/explore/"]',
            'a[href*="/explore/"]',
            '.note-link',
            'a'
          ];

          let linkElement: HTMLAnchorElement | null = null;
          for (const linkSelector of linkSelectors) {
            linkElement = section.querySelector(linkSelector) as HTMLAnchorElement;
            if (linkElement && linkElement.href.includes('/explore/')) {
              if (index < 3) {
                debugInfo.push(`找到链接: ${linkElement.href} 使用选择器: ${linkSelector}`);
              }
              break;
            }
          }

          if (!linkElement && index < 3) {
            debugInfo.push('未找到有效链接');
          }

          if (!linkElement || !linkElement.href.includes('/explore/')) {
            return;
          }

          const url = linkElement.href.startsWith('http') 
            ? linkElement.href 
            : `https://www.xiaohongshu.com${linkElement.href}`;

          // 抓取标题
          const titleSelectors = [
            '.note-title',
            '.title',
            '.content',
            '.note-content',
            'span[class*="title"]',
            'div[class*="title"]'
          ];

          let titleElement: HTMLElement | null = null;
          for (const titleSelector of titleSelectors) {
            titleElement = section.querySelector(titleSelector) as HTMLElement;
            if (titleElement && titleElement.innerText?.trim()) {
              break;
            }
          }

          if (!titleElement || !titleElement.innerText?.trim()) {
            return;
          }

          // 抓取时间 - 简化版本
          let publishTime = '时间未知';
          const allElements = section.querySelectorAll('*');
          for (const element of allElements) {
            const text = (element as HTMLElement).innerText?.trim();
            if (text && text.length > 2 && text.length < 50) {
              // 检查时间格式
              if (text.match(/\d+[分时天月年]前/) || 
                  text.match(/编辑于.*?[前天小时分钟]/) ||
                  text.match(/发布于.*?[前天小时分钟]/) ||
                  text.match(/昨天|今天|前天/)) {
                publishTime = text;
                break;
              }
            }
          }

          // 抓取作者
          const authorSelectors = [
            '.author',
            '.username',
            '.user-name',
            '.nickname',
            '[class*="author"]',
            '[class*="user"]'
          ];

          let author = '作者未知';
          for (const authorSelector of authorSelectors) {
            const authorElement = section.querySelector(authorSelector) as HTMLElement;
            if (authorElement && authorElement.innerText?.trim()) {
              author = authorElement.innerText.trim();
              break;
            }
          }

          posts.push({
            url: url,
            previewTitle: titleElement.innerText.trim(),
            publishTime: publishTime,
            author: author
          });

        } catch (error) {
          if (index < 3) {
            debugInfo.push(`处理第 ${index} 个帖子元素时出错: ${error}`);
          }
        }
      });

      return { posts, debugInfo };
    }, selectedSelector);

    if (result) {
      // 输出调试信息
      this.logger.info('=== 帖子提取调试信息 ===');
      result.debugInfo.forEach((info: string) => this.logger.info(info));
      
      return result.posts;
    }

    return [];
  }
}
