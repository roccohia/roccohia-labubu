import { Page } from 'puppeteer';
import { PageScraper } from '../core/PageScraper';
import { LoggerInstance } from '../utils/logger';
import { XhsPostData } from '../types';

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
   * 设置页面和Cookie
   */
  async setupPage(): Promise<void> {
    // 设置反检测
    await this.setupAntiDetection();

    // 加载Cookie（如果存在）
    await this.loadCookies();
  }

  /**
   * 设置反检测
   */
  private async setupAntiDetection(): Promise<void> {
    const page = (this as any).page;

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
   * 加载Cookie
   */
  private async loadCookies(): Promise<void> {
    try {
      const fs = require('fs');
      const cookiesFile = 'xhs-cookies.json';

      if (fs.existsSync(cookiesFile)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesFile, 'utf-8'));
        await (this as any).page.setCookie(...cookies);
        this.logger.info(`已加载 ${cookies.length} 个 cookies`);
      }
    } catch (error) {
      this.logger.debug('Cookie加载失败:', error);
    }
  }

  /**
   * 导航到搜索页面
   */
  async navigateToSearch(keyword: string): Promise<void> {
    const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&type=51`;
    this.logger.info(`导航到搜索页: ${keyword}`);

    try {
      await this.navigateToPage(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.logger.info('页面导航成功');
    } catch (navError) {
      this.logger.error('页面导航失败:', navError);
      throw navError;
    }

    // 等待页面加载完成
    this.logger.debug('等待页面内容加载');
    await this.waitForStable(5000);

    // 检查页面状态
    const currentUrl = await this.getPageUrl();
    const pageTitle = await this.getPageTitle();
    this.logger.info(`当前页面URL: ${currentUrl}`);
    this.logger.info(`页面标题: ${pageTitle}`);
  }

  /**
   * 提取帖子数据
   */
  async extractPosts(): Promise<XhsPostData[]> {
    this.logger.info('开始提取帖子数据');

    try {
      // 设置提取超时时间（3分钟）
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('帖子提取超时（3分钟）'));
        }, 3 * 60 * 1000);
      });

      return await Promise.race([
        this.extractPostsInternal(),
        timeoutPromise
      ]);
    } catch (error) {
      this.logger.error('帖子提取失败:', error);
      throw error;
    }
  }

  /**
   * 调试日志方法
   */
  private logDebug(message: string): void {
    this.logger.debug(message);
  }



  /**
   * 内部帖子提取逻辑
   */
  private async extractPostsInternal(): Promise<XhsPostData[]> {
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
   * 输出调试信息（仅在本地环境）
   */
  private logDebugInfo(debugInfo: any): void {
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    if (isGitHubActions) {
      // GitHub Actions 环境：只输出关键信息
      this.logger.info(`页面标题: ${debugInfo.pageTitle}`);
      this.logger.info(`找到 ${debugInfo.selectorResults['section.note-item'] || 0} 个帖子`);
      return;
    }

    // 本地环境：输出详细调试信息
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
  private async extractPostsData(selectedSelector: string): Promise<XhsPostData[]> {
    const result = await this.safeEvaluate((selector: string) => {
      const posts: any[] = [];
      const debugInfo: any[] = [];
      const elements = document.querySelectorAll(selector);

      if (!elements || elements.length === 0) {
        return { posts, debugInfo: ['没有找到元素'] };
      }

      for (let index = 0; index < elements.length; index++) {
        const section = elements[index];
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
            continue;
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
            continue;
          }

          // 时间信息将在浏览器上下文外部基于URL ID提取
          let publishTime = '待提取';
          debugInfo.push(`URL: ${url}`);

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

          // 解析时间和地区
          let timeOnly = publishTime;
          let locationOnly = '';

          // 尝试分离时间和地区
          if (publishTime && publishTime !== '时间未知') {
            // 匹配"5天前 上海"格式
            const timeLocationMatch = publishTime.match(/^(.+?)\s+([^0-9\s]+)$/);
            if (timeLocationMatch) {
              timeOnly = timeLocationMatch[1].trim();
              locationOnly = timeLocationMatch[2].trim();
            }
            // 匹配"6-12 山东"格式
            else {
              const dateLocationMatch = publishTime.match(/^(\d+-\d+)\s+([^0-9\s]+)$/);
              if (dateLocationMatch) {
                timeOnly = dateLocationMatch[1].trim();
                locationOnly = dateLocationMatch[2].trim();
              }
            }
          }

          posts.push({
            url: url,
            previewTitle: titleElement.innerText.trim(),
            publishTime: timeOnly,
            location: locationOnly,
            author: author
          });

        } catch (error) {
          if (index < 3) {
            debugInfo.push(`处理第 ${index} 个帖子元素时出错: ${error}`);
          }
        }
      }

      return { posts, debugInfo };
    }, selectedSelector);

    if (result) {
      // 为所有帖子设置基于URL的相对时间信息
      // 从小红书帖子ID中提取时间信息（小红书ID包含时间戳信息）
      for (const post of result.posts) {
        if (post.publishTime === '待提取') {
          try {
            // 从URL中提取帖子ID: /explore/6857c493000000001d00eb64
            const urlMatch = post.url.match(/\/explore\/([a-f0-9]+)/);
            if (urlMatch) {
              const postId = urlMatch[1];
              // 小红书ID的前8位是时间戳的十六进制表示
              const timeHex = postId.substring(0, 8);
              const timestamp = parseInt(timeHex, 16);

              if (timestamp > 0) {
                const postDate = new Date(timestamp * 1000);
                const now = new Date();
                const diffMs = now.getTime() - postDate.getTime();
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                const diffDays = Math.floor(diffHours / 24);

                if (diffDays === 0) {
                  if (diffHours === 0) {
                    post.publishTime = '刚刚';
                  } else {
                    post.publishTime = `${diffHours}小时前`;
                  }
                } else if (diffDays === 1) {
                  post.publishTime = '昨天';
                } else if (diffDays < 7) {
                  post.publishTime = `${diffDays}天前`;
                } else {
                  const month = postDate.getMonth() + 1;
                  const day = postDate.getDate();
                  post.publishTime = `${month}-${day}`;
                }
              } else {
                // 如果时间戳解析失败，使用当前时间
                const now = new Date();
                const timeString = now.toLocaleString('zh-CN', {
                  timeZone: 'Asia/Singapore',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                });
                post.publishTime = `今日 ${timeString}`;
              }
            } else {
              // 如果URL格式不匹配，使用当前时间
              const now = new Date();
              const timeString = now.toLocaleString('zh-CN', {
                timeZone: 'Asia/Singapore',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              });
              post.publishTime = `今日 ${timeString}`;
            }
          } catch (error) {
            // 如果解析失败，使用当前时间
            const now = new Date();
            const timeString = now.toLocaleString('zh-CN', {
              timeZone: 'Asia/Singapore',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            });
            post.publishTime = `今日 ${timeString}`;
          }
        }
      }

      this.logger.info(`成功提取 ${result.posts.length} 个帖子，已为所有帖子设置基于ID的相对时间信息`);

      // 输出调试信息（仅在本地环境）
      const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
      if (!isGitHubActions) {
        this.logger.info('=== 帖子提取调试信息 ===');
        result.debugInfo.forEach((info: string) => this.logger.info(info));
      }

      return result.posts;
    }

    return [];
  }
}
