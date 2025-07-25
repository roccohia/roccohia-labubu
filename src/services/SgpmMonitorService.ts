import puppeteer, { Browser, Page } from 'puppeteer';
import { logger } from '../utils/logger';

interface ProductInfo {
  title: string;
  price: string | null;
  inStock: boolean;
  buttonText: string;
}

export class SgpmMonitorService {
  private browser: Browser | null = null;
  private page: Page | null = null; // 复用页面实例
  private botToken: string;
  private chatId: string;
  private sessionEstablished: boolean = false; // 会话状态

  constructor(botToken?: string, chatId?: string) {
    this.botToken = botToken || process.env.SGPM_BOT_TOKEN || '';
    this.chatId = chatId || process.env.SGPM_CHAT_ID || '';
  }

  /**
   * 初始化浏览器和复用页面
   */
  async initBrowser(): Promise<void> {
    try {
      logger.info('🚀 启动高效浏览器...');

      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-blink-features=AutomationControlled',
          '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          // 性能优化参数
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection'
        ]
      });

      // 创建复用页面实例
      this.page = await this.browser.newPage();
      await this.setupAntiDetection(this.page);

      logger.info('✅ 高效浏览器启动成功');
    } catch (error) {
      logger.error('❌ 浏览器启动失败:', error);
      throw error;
    }
  }

  /**
   * 关闭浏览器
   */
  async closeBrowser(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      logger.info('🧹 浏览器已关闭');
    } catch (error) {
      logger.warn('⚠️ 浏览器关闭时出现警告:', error);
    }
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 设置反检测措施
   */
  private async setupAntiDetection(page: Page): Promise<void> {
    try {
      logger.info('🛡️ 设置增强反检测措施...');

      // 设置随机用户代理
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
      ];
      const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
      await page.setUserAgent(randomUA);

      // 设置随机视口
      const viewports = [
        { width: 1366, height: 768 },
        { width: 1920, height: 1080 },
        { width: 1440, height: 900 },
        { width: 1280, height: 720 }
      ];
      const randomViewport = viewports[Math.floor(Math.random() * viewports.length)];
      await page.setViewport(randomViewport);

      // 增强的反检测脚本
      await page.evaluateOnNewDocument(() => {
        // 移除webdriver标识
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });

        // 移除自动化标识
        if ((window as any).chrome && (window as any).chrome.runtime) {
          delete (window as any).chrome.runtime.onConnect;
        }

        // 模拟真实浏览器属性
        Object.defineProperty(navigator, 'plugins', {
          get: () => Array.from({ length: 5 }, (_, i) => ({ name: `Plugin ${i}` })),
        });

        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en', 'zh-CN'],
        });

        // 模拟真实的屏幕属性
        Object.defineProperty(screen, 'availHeight', {
          get: () => window.innerHeight,
        });

        Object.defineProperty(screen, 'availWidth', {
          get: () => window.innerWidth,
        });

        // 移除自动化检测
        try {
          const originalQuery = window.navigator.permissions.query;
          (window.navigator.permissions as any).query = (parameters: any) => (
            parameters.name === 'notifications' ?
              Promise.resolve({ state: Notification.permission } as any) :
              originalQuery(parameters)
          );
        } catch (e) {
          // 忽略权限API错误
        }

        // 模拟真实的时区
        Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
          value: function() {
            return { timeZone: 'Asia/Singapore' };
          }
        });
      });

      // 设置更真实的请求头
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'DNT': '1',
        'Connection': 'keep-alive'
      });

      logger.info('✅ 增强反检测措施设置完成');
    } catch (error) {
      logger.warn('⚠️ 反检测设置失败:', error);
    }
  }

  /**
   * 建立全局会话 - 只执行一次
   */
  private async establishGlobalSession(): Promise<void> {
    if (this.sessionEstablished || !this.page) {
      return; // 会话已建立或页面不存在
    }

    try {
      logger.info('🏠 建立全局会话：先访问主页...');

      // 访问主页
      await this.page.goto('https://www.popmart.com/sg', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // 模拟人类行为：优化等待时间
      const randomWait = 800 + Math.random() * 1200; // 进一步减少等待时间
      await this.delay(randomWait);

      // 模拟鼠标移动
      await this.page.mouse.move(100, 100);
      await this.delay(150);
      await this.page.mouse.move(200, 200);

      // 滚动页面
      await this.page.evaluate(() => {
        window.scrollTo(0, 300);
      });
      await this.delay(300);

      // 处理主页的Cookie和弹窗
      await this.handleLocationModal(this.page);
      await this.handleCookieAccept(this.page);

      this.sessionEstablished = true;
      logger.info('✅ 全局会话建立完成');
    } catch (error) {
      logger.warn('⚠️ 会话建立失败，继续直接访问:', error);
    }
  }

  /**
   * CI环境页面健康检查
   */
  private async performCIHealthCheck(page: Page): Promise<void> {
    try {
      logger.info('🔍 CI环境页面健康检查...');

      const url = page.url();
      const title = await page.title();
      const bodyLength = await page.evaluate(() => document.body.textContent?.length || 0);

      logger.info(`🔍 健康检查 - URL: ${url}`);
      logger.info(`🔍 健康检查 - 标题: ${title}`);
      logger.info(`🔍 健康检查 - 页面内容长度: ${bodyLength} 字符`);

      // 检查是否是错误页面
      if (bodyLength < 1000) {
        logger.warn('⚠️ 页面内容过少，可能加载失败');

        // 尝试截图（如果可能）
        try {
          await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
          logger.info('📸 已保存调试截图: debug-screenshot.png');
        } catch (screenshotError) {
          logger.warn('⚠️ 截图失败');
        }
      }

      // 检查是否有错误信息或WAF拦截
      const errorMessages = await page.evaluate(() => {
        const errorKeywords = ['error', '404', '500', 'not found', 'access denied', 'waf', 'blocked', 'security'];
        const bodyText = document.body.textContent?.toLowerCase() || '';
        return errorKeywords.filter(keyword => bodyText.includes(keyword));
      });

      if (errorMessages.length > 0) {
        logger.warn(`⚠️ 检测到错误关键词: ${errorMessages.join(', ')}`);

        // 如果检测到WAF或访问被拒绝，尝试多种恢复策略
        if (errorMessages.some(msg => ['access denied', 'waf', 'blocked', 'security'].includes(msg))) {
          logger.warn('🚫 检测到WAF拦截，尝试恢复策略...');

          // 策略1：等待并重新加载
          await this.delay(8000 + Math.random() * 5000);
          await page.reload({ waitUntil: 'domcontentloaded' });
          await this.delay(5000);

          // 策略2：如果还是失败，尝试重新访问主页
          const stillBlocked = await page.evaluate(() => {
            const bodyText = document.body.textContent?.toLowerCase() || '';
            return bodyText.includes('access denied') || bodyText.includes('waf');
          });

          if (stillBlocked) {
            logger.warn('🔄 重新建立会话...');
            await this.establishGlobalSession();

            // 重新访问目标页面
            const currentUrl = page.url();
            if (!currentUrl.includes('/products/')) {
              logger.warn('🔄 重新访问产品页面...');
              await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
              await this.delay(5000);
            }
          }
        }
      }

    } catch (error) {
      logger.warn('⚠️ CI健康检查失败:', error);
    }
  }

  /**
   * 滚动页面确保所有内容加载
   */
  private async scrollPageToLoadContent(page: Page): Promise<void> {
    try {
      logger.info('📜 滚动页面加载所有内容...');

      // 滚动到页面底部
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await this.delay(1000); // 减少等待时间

      // 滚动回顶部
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await this.delay(500); // 减少等待时间

      // 滚动到中间位置
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2);
      });
      await this.delay(500); // 减少等待时间

      logger.info('✅ 页面滚动完成');
    } catch (error) {
      logger.warn('⚠️ 页面滚动失败:', error);
    }
  }

  /**
   * 快速滚动页面（优化版）
   */
  private async quickScrollToLoadContent(page: Page): Promise<void> {
    try {
      // 快速滚动到底部和顶部
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        setTimeout(() => window.scrollTo(0, 0), 200);
        setTimeout(() => window.scrollTo(0, document.body.scrollHeight / 2), 400);
      });
      await this.delay(600); // 总共只等待600ms

    } catch (error) {
      logger.warn('⚠️ 快速滚动失败:', error);
    }
  }

  /**
   * 处理地区弹窗
   */
  private async handleLocationModal(page: Page): Promise<void> {
    try {
      logger.info('🌍 检查地区弹窗...');

      // 检查是否有地区弹窗
      const locationModalSelectors = [
        '.layout_wafErrorModalButton__yJdyc',
        'button:contains("OK")',
        '[class*="modal"] button',
        '[class*="Modal"] button'
      ];

      for (const selector of locationModalSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            const text = await page.evaluate(el => el.textContent?.trim(), button);
            if (text && text.toLowerCase().includes('ok')) {
              logger.info(`🌍 找到地区弹窗按钮: "${text}"`);
              await button.click();
              logger.info('✅ 地区弹窗已处理');
              await this.delay(3000);
              return;
            }
          }
        } catch (error) {
          continue;
        }
      }

      logger.info('ℹ️ 未发现地区弹窗');
    } catch (error) {
      logger.warn('⚠️ 地区弹窗处理失败:', error);
    }
  }

  /**
   * 处理Cookie同意按钮 - 第一件事
   */
  private async handleCookieAccept(page: Page): Promise<void> {
    try {
      logger.info('🍪 第一步：查找并点击Accept按钮...');

      // 检测是否在CI环境
      const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
      if (isCI) {
        logger.info('🔍 检测到CI环境，使用增强等待策略');
      }

      // PopMart精确的Cookie Accept按钮选择器
      const cookieSelector = '#__next > div > div > div.policy_aboveFixedContainer__KfeZi > div > div.policy_acceptBtn__ZNU71';

      // 等待按钮出现
      await page.waitForSelector(cookieSelector, { timeout: 10000 });

      // 点击Accept按钮
      await page.click(cookieSelector);
      logger.info('✅ Accept按钮点击成功');

      // CI环境需要更长的等待时间（优化）
      const waitTime = isCI ? 10000 : 6000; // 减少等待时间
      await this.delay(waitTime);
      logger.info('✅ 页面重新加载完成');

    } catch (error) {
      logger.warn('⚠️ Accept按钮未找到或已处理');
      // 即使没有Cookie按钮，也要等待页面稳定
      const waitTime = process.env.CI === 'true' ? 8000 : 3000;
      await this.delay(waitTime);
    }
  }

  /**
   * 检测库存状态
   */
  private async detectStockStatus(page: Page): Promise<{ inStock: boolean; buttonText: string }> {
    logger.info('🔍 开始检测库存状态...');

    // 等待页面完全稳定（优化）
    await this.delay(3000); // 减少等待时间

    // 调试：输出页面基本信息
    try {
      const url = page.url();
      const title = await page.title();
      const bodyText = await page.evaluate(() => document.body.textContent?.substring(0, 500) || '');
      logger.info(`🔍 调试信息 - URL: ${url}`);
      logger.info(`🔍 调试信息 - 页面标题: ${title}`);
      logger.info(`🔍 调试信息 - 页面内容前500字符: ${bodyText}`);
    } catch (error) {
      logger.warn('⚠️ 调试信息获取失败');
    }

    // 用户提供的精确库存按钮选择器
    const stockSelectors = [
      '#__next > div > div > div.layout_pcLayout__49ZwP > div.products_container__T0mpL > div.products_headerBlock__CESKr > div.products_rightBlock__bf2x5 > div > div.index_actionContainer__EqFYe > div',
      '#topBoxContainer > div.index_cardContainer__a7YPF > div > div.index_bottomBtn___D0Qh > button > span',
      '#topBoxContainer > div.index_cardContainer__a7YPF > div:nth-child(1) > div.index_bottomBtn___D0Qh > button.ant-btn.ant-btn-primary.index_chooseRandomlyBtn__upKXA',
      '#topBoxContainer > div.index_cardContainer__a7YPF > div:nth-child(1) > div.index_bottomBtn___D0Qh > button.ant-btn.ant-btn-ghost.index_chooseMulitityBtn__n0MoA',
      // 备用选择器
      '.index_actionContainer__EqFYe',
      '.index_chooseRandomlyBtn__upKXA',
      '.index_chooseMulitityBtn__n0MoA',
      '.index_bottomBtn___D0Qh button',
      'button[class*="chooseRandomlyBtn"]',
      'button[class*="chooseMulitityBtn"]'
    ];

    let buttonText = '';
    let foundSelector = '';

    for (const selector of stockSelectors) {
      try {
        logger.info(`🔍 尝试选择器: ${selector}`);
        const elements = await page.$$(selector);

        if (elements.length > 0) {
          logger.info(`✅ 找到 ${elements.length} 个元素`);

          for (const element of elements) {
            const text = await page.evaluate(el => el.textContent?.trim(), element);
            if (text && text.length > 0) {
              buttonText = text;
              foundSelector = selector;
              logger.info(`📝 找到按钮文字: "${text}" (选择器: ${selector})`);
              break;
            }
          }

          if (buttonText) break;
        }
      } catch (error) {
        logger.warn(`⚠️ 选择器失败: ${selector}`);
        continue;
      }
    }

    if (!buttonText) {
      // 调试：输出页面中所有按钮
      try {
        logger.info('🔍 调试：查找页面中所有按钮...');
        const allButtons = await page.$$('button, .btn, [role="button"], .ant-btn, input[type="button"], input[type="submit"]');
        logger.info(`🔍 调试：找到 ${allButtons.length} 个按钮元素`);

        for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
          const button = allButtons[i];
          const text = await page.evaluate(el => el.textContent?.trim(), button);
          const className = await page.evaluate(el => el.className, button);
          const id = await page.evaluate(el => el.id, button);
          logger.info(`🔍 调试按钮 ${i + 1}: "${text}" (class: ${className}, id: ${id})`);
        }
      } catch (error) {
        logger.warn('⚠️ 按钮调试失败');
      }

      // 尝试通用按钮检测
      logger.warn('⚠️ 精确选择器未找到，尝试通用检测...');
      return await this.fallbackButtonDetection(page);
    }

    // 使用通用的库存判断方法
    return this.judgeStockStatus(buttonText);
  }

  /**
   * 备用按钮检测方法
   */
  private async fallbackButtonDetection(page: Page): Promise<{ inStock: boolean; buttonText: string }> {
    logger.info('🔄 使用备用按钮检测方法...');

    try {
      // 通用按钮选择器
      const buttons = await page.$$('button, .btn, [role="button"], .ant-btn');
      const buttonTexts: string[] = [];

      for (const button of buttons) {
        const text = await page.evaluate(el => el.textContent?.trim(), button);
        const isVisible = await page.evaluate(el => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' &&
                 style.visibility !== 'hidden' &&
                 rect.width > 0 &&
                 rect.height > 0;
        }, button);

        if (isVisible && text && text.length > 0 && text.length < 100) {
          const textLower = text.toLowerCase();
          // 排除导航和Cookie按钮
          if (!textLower.includes('accept') &&
              !textLower.includes('cookie') &&
              !textLower.includes('menu') &&
              !textLower.includes('search') &&
              !textLower.includes('login') &&
              !textLower.includes('sign')) {
            buttonTexts.push(text);
          }
        }
      }

      const allButtonText = buttonTexts.join(' | ');
      logger.info(`🔍 备用方法找到的按钮: ${allButtonText}`);

      if (buttonTexts.length > 0) {
        // 使用相同的库存判断逻辑
        return this.judgeStockStatus(allButtonText);
      }

      return { inStock: false, buttonText: '未找到任何按钮' };

    } catch (error) {
      logger.error('❌ 备用按钮检测失败:', error);
      return { inStock: false, buttonText: '检测失败' };
    }
  }

  /**
   * 判断库存状态的通用方法
   */
  private judgeStockStatus(buttonText: string): { inStock: boolean; buttonText: string } {
    const buttonTextLower = buttonText.toLowerCase();

    // 有货关键词
    const inStockKeywords = [
      'buy now', 'add to cart', 'purchase', 'buy', 'cart',
      'pick one to shake', 'buy multiple boxes', 'order now'
    ];

    // 缺货关键词
    const outOfStockKeywords = [
      'notify me when available', 'out of stock', 'sold out',
      'in-app purchase only', 'unavailable', 'coming soon',
      'this item is not available in your region'
    ];

    // 检查缺货关键词
    for (const keyword of outOfStockKeywords) {
      if (buttonTextLower.includes(keyword)) {
        logger.info(`❌ 检测到缺货: "${keyword}"`);
        return { inStock: false, buttonText };
      }
    }

    // 检查有货关键词
    for (const keyword of inStockKeywords) {
      if (buttonTextLower.includes(keyword)) {
        logger.info(`✅ 检测到有货: "${keyword}"`);
        return { inStock: true, buttonText };
      }
    }

    // 默认缺货
    logger.info(`⚠️ 未匹配关键词，默认缺货: "${buttonText}"`);
    return { inStock: false, buttonText };
  }

  /**
   * 提取产品信息
   */
  private async extractProductInfo(page: Page): Promise<ProductInfo> {
    logger.info('📊 开始提取产品信息...');

    // 调试：输出页面HTML结构
    try {
      const htmlStructure = await page.evaluate(() => {
        const elements = document.querySelectorAll('h1, h2, h3, .price, [class*="price"], [class*="title"], [class*="product"]');
        const structure: string[] = [];
        elements.forEach((el, index) => {
          if (index < 20) { // 限制输出数量
            structure.push(`${el.tagName}.${el.className}: "${el.textContent?.trim().substring(0, 50)}"`);
          }
        });
        return structure;
      });
      logger.info(`🔍 调试：页面结构 - ${htmlStructure.join(' | ')}`);
    } catch (error) {
      logger.warn('⚠️ 页面结构调试失败');
    }

    // 提取标题
    let title = 'Unknown Product';
    const titleSelectors = [
      'h1',
      'h2',
      '.product-title',
      '.product-name',
      '[class*="productName"]',
      '[class*="product-name"]',
      '[class*="title"]'
    ];

    for (const selector of titleSelectors) {
      try {
        const titleElement = await page.$(selector);
        if (titleElement) {
          const extractedTitle = await page.evaluate(el => el.textContent?.trim(), titleElement);
          if (extractedTitle && extractedTitle.length > 3) {
            title = extractedTitle;
            logger.info(`📝 找到产品标题: "${title}"`);
            break;
          }
        }
      } catch (error) {
        continue;
      }
    }

    // 如果还是没找到，从URL提取
    if (title === 'Unknown Product') {
      const url = page.url();
      const urlParts = url.split('/');
      const lastPart = urlParts[urlParts.length - 1];
      title = decodeURIComponent(lastPart).replace(/%20/g, ' ');
      logger.info(`📝 从URL提取标题: "${title}"`);
    }

    // 提取价格
    let price: string | null = null;
    const priceSelectors = [
      '.price',
      '.product-price',
      '[class*="price"]',
      '[class*="Price"]',
      '[class*="cost"]',
      '[class*="amount"]'
    ];

    for (const selector of priceSelectors) {
      try {
        const priceElements = await page.$$(selector);
        for (const priceElement of priceElements) {
          const extractedPrice = await page.evaluate(el => el.textContent?.trim(), priceElement);
          if (extractedPrice && /[S$\d]/.test(extractedPrice)) {
            price = extractedPrice;
            logger.info(`💰 找到价格: "${price}"`);
            break;
          }
        }
        if (price) break;
      } catch (error) {
        continue;
      }
    }

    if (!price) {
      logger.warn('⚠️ 价格提取失败');
    }

    // 检测库存状态
    const { inStock, buttonText } = await this.detectStockStatus(page);

    logger.info(`📊 产品信息提取完成: ${title} | ${price || '未知'} | ${inStock ? '有货' : '缺货'}`);
    return { title, price, inStock, buttonText };
  }

  /**
   * 检查单个产品
   */
  async checkProduct(url: string): Promise<ProductInfo & { url: string }> {
    if (!this.browser || !this.page) {
      throw new Error('浏览器或页面未初始化');
    }

    try {
      // 确保全局会话已建立（只执行一次）
      await this.establishGlobalSession();

      logger.info(`🌐 访问产品页面: ${url}`);

      // 导航到页面
      await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // 等待初始加载（减少等待时间）
      await this.delay(1500);

      // 处理弹窗（由于会话已建立，通常不需要）
      await this.handleLocationModal(this.page!);

      // 快速滚动确保内容加载
      await this.quickScrollToLoadContent(this.page!);

      // 等待页面稳定（大幅减少等待时间）
      const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
      const waitTime = isCI ? 3000 : 1500; // 大幅减少等待时间
      await this.delay(waitTime);

      // 提取产品信息
      const productInfo = await this.extractProductInfo(this.page!);

      logger.info(`📊 ${productInfo.title}: ${productInfo.inStock ? '✅ 有货' : '❌ 缺货'} | 价格: ${productInfo.price || '未知'}`);

      return { ...productInfo, url };

    } catch (error) {
      logger.error(`❌ 检查产品失败 ${url}:`, error);
      throw error;
    }
  }

  /**
   * 发送Telegram通知
   */
  async sendTelegramNotification(product: ProductInfo & { url: string }): Promise<void> {
    if (!this.botToken || !this.chatId) {
      logger.warn('⚠️ Telegram未配置，跳过通知');
      return;
    }

    // 优化的Telegram消息格式
    const message = `🎉 <b>PopMart 有货提醒！</b>

📦 <b>商品名称:</b> ${product.title}
💰 <b>价格:</b> <code>${product.price || '未知'}</code>
📊 <b>库存状态:</b> <i>${product.buttonText}</i>
🔗 <b>商品链接:</b> <a href="${product.url}">立即购买</a>
⏰ <b>检测时间:</b> ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

🚀 <b>快去抢购吧！</b>`;

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: false
        })
      });

      if (response.ok) {
        logger.info('📱 Telegram通知发送成功');
      } else {
        logger.error('❌ Telegram通知发送失败:', await response.text());
      }
    } catch (error) {
      logger.error('❌ Telegram通知发送错误:', error);
    }
  }

  /**
   * 监控多个产品（优化版本）
   */
  async monitorProducts(urls: string[]): Promise<void> {
    logger.info(`📊 开始高效监控 ${urls.length} 个产品`);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      logger.info(`📦 检查产品 ${i + 1}/${urls.length}: ${url}`);

      try {
        const productInfo = await this.checkProduct(url);

        // 如果有货，发送通知
        if (productInfo.inStock) {
          await this.sendTelegramNotification(productInfo);
        }

        // 优化：大幅减少产品间延迟
        if (i < urls.length - 1) {
          await this.delay(500); // 从1秒减少到0.5秒
        }

      } catch (error) {
        logger.error(`❌ 检查产品失败 ${url}:`, error);
        // 错误时也要短暂延迟，避免过快重试
        if (i < urls.length - 1) {
          await this.delay(300); // 减少错误延迟
        }
      }
    }

    logger.info('✅ 高效监控完成');
  }
}
