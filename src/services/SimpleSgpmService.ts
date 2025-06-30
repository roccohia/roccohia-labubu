import puppeteer, { Browser, Page } from 'puppeteer';
import { LoggerInstance } from '../utils/logger';
import { sendTelegramMessage } from '../utils/sendTelegramMessage';

/**
 * 简化的SGPM监控服务
 * 专注于可靠性和准确性，使用按钮文字判断库存状态
 */
export class SimpleSgpmService {
  private logger: LoggerInstance;
  private browser: Browser | null = null;
  private productUrls: string[];
  private botToken: string;
  private chatId: string;

  constructor(logger: LoggerInstance, productUrls: string[], botToken: string, chatId: string) {
    this.logger = logger;
    this.productUrls = productUrls;
    this.botToken = botToken;
    this.chatId = chatId;
  }

  /**
   * 检查所有产品
   */
  async checkProducts(): Promise<void> {
    this.logger.info('🚀 开始简化SGPM监控...');
    
    try {
      // 创建浏览器实例
      await this.createBrowser();
      
      // 检查每个产品
      for (let i = 0; i < this.productUrls.length; i++) {
        const url = this.productUrls[i];
        this.logger.info(`📦 检查产品 ${i + 1}/${this.productUrls.length}: ${url}`);
        
        try {
          const result = await this.checkSingleProduct(url);
          this.logger.info(`📊 ${result.title}: ${result.inStock ? '✅ 有货' : '❌ 缺货'} | 价格: ${result.price || '未知'}`);
          
          // 如果有货，发送通知
          if (result.inStock) {
            await this.sendStockAlert(result);
          }
        } catch (error) {
          this.logger.error(`❌ 检查产品失败: ${url}`, error);
        }
        
        // 产品间延迟
        if (i < this.productUrls.length - 1) {
          await this.delay(2000);
        }
      }
      
    } finally {
      await this.cleanup();
    }
  }

  /**
   * 创建浏览器实例
   */
  private async createBrowser(): Promise<void> {
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--disable-translate',
        '--mute-audio',
        '--hide-scrollbars'
      ],
      defaultViewport: { width: 1920, height: 1080 },
      timeout: 30000
    };

    // GitHub Actions 额外配置
    if (isGitHubActions) {
      launchOptions.args.push(
        '--single-process',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      );
    }

    this.browser = await puppeteer.launch(launchOptions);
    this.logger.info('✅ 浏览器实例创建成功');
  }

  /**
   * 检查单个产品
   */
  private async checkSingleProduct(url: string): Promise<{
    title: string;
    price: string | null;
    inStock: boolean;
    buttonText: string;
  }> {
    if (!this.browser) {
      throw new Error('浏览器实例未创建');
    }

    const page = await this.browser.newPage();

    try {
      // 设置用户代理
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      this.logger.info(`🌐 导航到页面: ${url}`);

      // 导航到页面
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // 等待页面初始加载
      await this.delay(2000);

      // 第一件事：处理Cookie同意按钮
      this.logger.info('🍪 第一步：处理Cookie同意按钮');
      await this.handleCookieConsent(page);

      // Cookie处理后，等待页面完全重新加载
      this.logger.info('⏳ 等待页面完全加载...');
      await this.delay(8000);

      // 滚动页面确保所有内容加载
      await this.scrollPage(page);

      // 提取产品信息
      const productInfo = await this.extractProductInfo(page);

      return productInfo;

    } finally {
      await page.close();
    }
  }

  /**
   * 滚动页面确保所有内容加载
   */
  private async scrollPage(page: Page): Promise<void> {
    try {
      this.logger.info('📜 滚动页面加载所有内容...');

      // 滚动到页面底部
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await this.delay(2000);

      // 滚动回顶部
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await this.delay(1000);

      // 滚动到中间位置
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2);
      });
      await this.delay(1000);

      this.logger.info('✅ 页面滚动完成');
    } catch (error) {
      this.logger.warn('⚠️ 页面滚动失败:', error);
    }
  }

  /**
   * 处理Cookie同意按钮
   */
  private async handleCookieConsent(page: Page): Promise<void> {
    try {
      this.logger.info('🍪 开始处理Cookie同意按钮...');

      // 等待页面稳定
      await this.delay(2000);

      // PopMart 特定的Cookie按钮选择器（优先使用）
      const popMartCookieSelector = '#__next > div > div > div.policy_aboveFixedContainer__KfeZi > div > div.policy_acceptBtn__ZNU71';

      // 备用Cookie按钮选择器
      const cookieSelectors = [
        // PopMart 特定选择器（最高优先级）
        popMartCookieSelector,
        '.policy_acceptBtn__ZNU71',
        '[class*="policy_acceptBtn"]',
        '[class*="acceptBtn"]',
        // 通用Cookie按钮
        'button[id*="accept"]',
        'button[class*="accept"]',
        'button[id*="cookie"]',
        'button[class*="cookie"]',
        'button[id*="consent"]',
        'button[class*="consent"]',
        // 数据属性
        '[data-testid*="accept"]',
        '[data-testid*="cookie"]',
        // 容器内的按钮
        '.cookie-banner button',
        '.cookie-notice button',
        '.consent-banner button',
        '#cookie-banner button',
        '#cookie-notice button',
        '#consent-banner button'
      ];

      let cookieHandled = false;

      // 首先尝试等待PopMart特定的Cookie按钮出现
      try {
        this.logger.info('🍪 等待PopMart Cookie按钮出现...');
        await page.waitForSelector(popMartCookieSelector, { timeout: 5000 });

        const popMartButton = await page.$(popMartCookieSelector);
        if (popMartButton) {
          const isVisible = await page.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' &&
                   style.visibility !== 'hidden' &&
                   (el as HTMLElement).offsetParent !== null;
          }, popMartButton);

          if (isVisible) {
            const text = await page.evaluate(el => el.textContent?.trim(), popMartButton);
            this.logger.info(`🍪 找到PopMart Cookie按钮: "${text}"`);
            await popMartButton.click();
            cookieHandled = true;
            this.logger.info(`✅ 成功点击PopMart Cookie按钮`);
          }
        }
      } catch (error) {
        this.logger.info('🍪 PopMart特定Cookie按钮未找到，尝试其他选择器...');
      }

      // 如果PopMart特定按钮没有找到，尝试其他选择器
      if (!cookieHandled) {
        for (const selector of cookieSelectors.slice(1)) { // 跳过第一个（已经尝试过）
          try {
            const button = await page.$(selector);
            if (button) {
              const isVisible = await page.evaluate(el => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' &&
                       style.visibility !== 'hidden' &&
                       (el as HTMLElement).offsetParent !== null;
              }, button);

              if (isVisible) {
                const text = await page.evaluate(el => el.textContent?.trim(), button);
                this.logger.info(`🍪 找到Cookie按钮: ${selector} - "${text}"`);
                await button.click();
                cookieHandled = true;
                this.logger.info(`✅ 成功点击Cookie按钮: ${selector}`);
                break;
              }
            }
          } catch (error) {
            // 忽略单个选择器的错误，继续尝试下一个
            continue;
          }
        }
      }

      if (cookieHandled) {
        // Cookie处理成功，等待页面重新加载
        this.logger.info('🔄 Cookie处理成功，等待页面重新加载...');

        // 等待页面开始重新加载
        await this.delay(2000);

        // 等待页面完全稳定
        await this.delay(5000);

        // 额外等待确保动态内容加载
        await this.delay(3000);

        this.logger.info('✅ 页面重新加载完成');
      } else {
        this.logger.info('ℹ️ 未找到Cookie同意按钮，可能页面不需要处理');
      }

    } catch (error) {
      this.logger.warn('⚠️ Cookie处理过程中出现错误:', error);
      // 不抛出错误，继续执行后续逻辑
    }
  }

  /**
   * 提取产品信息
   */
  private async extractProductInfo(page: Page): Promise<{
    title: string;
    price: string | null;
    inStock: boolean;
    buttonText: string;
  }> {
    this.logger.info('📊 开始提取产品信息...');

    // 等待页面完全稳定
    await this.delay(3000);

    // 检查页面是否正确加载（不是Cookie页面）
    const pageContent = await page.content();
    if (pageContent.length < 5000) {
      this.logger.warn('⚠️ 页面内容较少，可能未完全加载');
    }

    // 检查是否还有Cookie弹窗
    const hasCookieModal = await page.evaluate(() => {
      const cookieKeywords = ['cookie', 'consent', 'privacy', 'accept'];
      const modals = document.querySelectorAll('[role="dialog"], .modal, .popup, .overlay');
      for (const modal of modals) {
        const text = modal.textContent?.toLowerCase() || '';
        if (cookieKeywords.some(keyword => text.includes(keyword))) {
          return true;
        }
      }
      return false;
    });

    if (hasCookieModal) {
      this.logger.warn('⚠️ 检测到Cookie弹窗仍然存在，尝试再次处理...');
      await this.handleCookieConsent(page);
    }

    // 提取产品标题
    const title = await this.extractTitle(page);

    // 提取价格
    const price = await this.extractPrice(page);

    // 提取按钮文字并判断库存状态（排除Cookie按钮）
    const { inStock, buttonText } = await this.extractStockStatus(page);

    this.logger.info(`📊 产品信息提取完成: ${title} | ${price || '无价格'} | ${inStock ? '有货' : '缺货'}`);
    return { title, price, inStock, buttonText };
  }

  /**
   * 提取产品标题
   */
  private async extractTitle(page: Page): Promise<string> {
    const titleSelectors = [
      // PopMart 特定选择器
      '.index_productName__xxx',
      '.product-detail-name',
      '.product-title',
      '.product-name',
      // 通用选择器
      'h1',
      'h2',
      '[data-testid="product-title"]',
      '.title',
      // CSS类名模式匹配
      '[class*="productName"]',
      '[class*="product-name"]',
      '[class*="title"]'
    ];

    for (const selector of titleSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await page.evaluate(el => el.textContent?.trim(), element);
          if (text && text.length > 5) { // 确保标题有意义
            this.logger.info(`📝 找到产品标题: ${text}`);
            return text;
          }
        }
      } catch (error) {
        // 继续尝试下一个选择器
      }
    }

    // 尝试从页面标题获取
    try {
      const pageTitle = await page.title();
      if (pageTitle && !pageTitle.includes('PopMart') && pageTitle.length > 5) {
        this.logger.info(`📝 从页面标题获取: ${pageTitle}`);
        return pageTitle;
      }
    } catch (error) {
      // 忽略错误
    }

    // 从URL提取标题作为后备
    const url = page.url();
    const urlParts = url.split('/');
    const lastPart = urlParts[urlParts.length - 1];
    const decodedTitle = decodeURIComponent(lastPart).replace(/[-_]/g, ' ');
    this.logger.info(`📝 从URL提取标题: ${decodedTitle}`);
    return decodedTitle || 'Unknown Product';
  }

  /**
   * 提取价格
   */
  private async extractPrice(page: Page): Promise<string | null> {
    const priceSelectors = [
      // PopMart 特定选择器
      '.index_price__xxx',
      '.product-price',
      '.price-current',
      '.current-price',
      // 通用选择器
      '.price',
      '[data-testid="price"]',
      '.cost',
      '.amount',
      // CSS类名模式匹配
      '[class*="price"]',
      '[class*="Price"]',
      '[class*="cost"]',
      '[class*="amount"]'
    ];

    for (const selector of priceSelectors) {
      try {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const text = await page.evaluate(el => el.textContent?.trim(), element);
          if (text && /[S$SGD\d.,]+/.test(text)) {
            // 检查是否包含价格模式
            const priceMatch = text.match(/[S$]?\s*[\d.,]+|SGD\s*[\d.,]+/);
            if (priceMatch) {
              this.logger.info(`💰 找到价格: ${text}`);
              return text;
            }
          }
        }
      } catch (error) {
        // 继续尝试下一个选择器
      }
    }

    // 尝试从页面内容中搜索价格模式
    try {
      const bodyText = await page.evaluate(() => document.body.textContent || '');
      const pricePatterns = [
        /S\$\s*[\d.,]+/g,
        /SGD\s*[\d.,]+/g,
        /\$\s*[\d.,]+/g
      ];

      for (const pattern of pricePatterns) {
        const matches = bodyText.match(pattern);
        if (matches && matches.length > 0) {
          const price = matches[0];
          this.logger.info(`💰 从页面内容找到价格: ${price}`);
          return price;
        }
      }
    } catch (error) {
      // 忽略错误
    }

    this.logger.warn('💰 未找到价格信息');
    return null;
  }

  /**
   * 提取库存状态（使用精确的PopMart选择器）
   */
  private async extractStockStatus(page: Page): Promise<{ inStock: boolean; buttonText: string }> {
    this.logger.info('🔍 开始提取库存状态...');

    // 等待页面完全加载
    await this.delay(3000);

    // 用户提供的精确库存按钮选择器
    const stockButtonSelectors = [
      // 主要产品页面的库存按钮
      '#__next > div > div > div.layout_pcLayout__49ZwP > div.products_container__T0mpL > div.products_headerBlock__CESKr > div.products_rightBlock__bf2x5 > div > div.index_actionContainer__EqFYe > div',
      // 盲盒页面的按钮
      '#topBoxContainer > div.index_cardContainer__a7YPF > div > div.index_bottomBtn___D0Qh > button > span',
      '#topBoxContainer > div.index_cardContainer__a7YPF > div:nth-child(1) > div.index_bottomBtn___D0Qh > button.ant-btn.ant-btn-primary.index_chooseRandomlyBtn__upKXA',
      '#topBoxContainer > div.index_cardContainer__a7YPF > div:nth-child(1) > div.index_bottomBtn___D0Qh > button.ant-btn.ant-btn-ghost.index_chooseMulitityBtn__n0MoA',
      // 备用选择器
      '.index_actionContainer__EqFYe',
      '.index_chooseRandomlyBtn__upKXA',
      '.index_chooseMulitityBtn__n0MoA',
      '.index_bottomBtn___D0Qh button',
      '.ant-btn.ant-btn-primary',
      '.ant-btn.ant-btn-ghost'
    ];

    let foundButtons: string[] = [];
    let foundSelectors: string[] = [];

    // 使用精确选择器检测库存按钮
    for (const selector of stockButtonSelectors) {
      try {
        this.logger.info(`🔍 尝试选择器: ${selector}`);

        const elements = await page.$$(selector);
        if (elements.length > 0) {
          this.logger.info(`✅ 找到 ${elements.length} 个元素`);

          for (const element of elements) {
            // 检查元素是否可见
            const isVisible = await page.evaluate(el => {
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return style.display !== 'none' &&
                     style.visibility !== 'hidden' &&
                     rect.width > 0 &&
                     rect.height > 0;
            }, element);

            if (isVisible) {
              const text = await page.evaluate(el => el.textContent?.trim(), element);
              const tagName = await page.evaluate(el => el.tagName, element);
              const className = await page.evaluate(el => el.className, element);

              if (text && text.length > 0) {
                foundButtons.push(text);
                foundSelectors.push(selector);
                this.logger.info(`📝 找到按钮文字: "${text}" (${tagName}, ${className})`);
              }
            }
          }
        }
      } catch (error) {
        this.logger.warn(`⚠️ 选择器失败: ${selector}`, error);
        continue;
      }
    }

    const buttonText = foundButtons.join(' | ');
    this.logger.info(`🔍 所有发现的按钮文字: ${buttonText}`);
    this.logger.info(`🎯 使用的选择器: ${foundSelectors.join(' | ')}`);

    // 如果没有找到任何按钮，尝试通用方法
    if (foundButtons.length === 0) {
      this.logger.warn('⚠️ 精确选择器未找到按钮，尝试通用方法...');
      return await this.fallbackButtonDetection(page);
    }

    // 判断库存状态（基于PopMart的实际按钮文字）
    const buttonTextLower = buttonText.toLowerCase();

    // PopMart 有货关键词
    const inStockKeywords = [
      'buy now', 'add to cart', 'purchase', 'buy', 'cart',
      'pick one to shake', 'buy multiple boxes', 'order now',
      'add to bag', 'shop now', '立即购买', '加入购物车',
      'choose randomly', 'multiple boxes'
    ];

    // PopMart 缺货关键词
    const outOfStockKeywords = [
      'notify me when available', 'out of stock', 'sold out',
      'in-app purchase only', 'unavailable', 'coming soon',
      'notify when available', 'notify me', '到货通知', '缺货',
      'this item is not available in your region', 'not available in your region'
    ];

    // 检查缺货关键词
    for (const keyword of outOfStockKeywords) {
      if (buttonTextLower.includes(keyword)) {
        this.logger.info(`✅ 检测到缺货关键词: "${keyword}"`);
        return { inStock: false, buttonText };
      }
    }

    // 检查有货关键词
    for (const keyword of inStockKeywords) {
      if (buttonTextLower.includes(keyword)) {
        this.logger.info(`✅ 检测到有货关键词: "${keyword}"`);
        return { inStock: true, buttonText };
      }
    }

    // 如果找到了按钮但没有匹配关键词，记录详细信息
    this.logger.warn(`⚠️ 找到按钮但未匹配关键词: "${buttonText}"`);
    return { inStock: false, buttonText };
  }

  /**
   * 备用按钮检测方法
   */
  private async fallbackButtonDetection(page: Page): Promise<{ inStock: boolean; buttonText: string }> {
    this.logger.info('🔄 使用备用按钮检测方法...');

    try {
      // 通用按钮选择器
      const buttons = await page.$$('button, .btn, [role="button"]');
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

        if (isVisible && text && text.length > 0) {
          const textLower = text.toLowerCase();
          // 排除Cookie和导航按钮
          if (!textLower.includes('accept') &&
              !textLower.includes('cookie') &&
              !textLower.includes('menu') &&
              !textLower.includes('search') &&
              text.length < 50) { // 避免长文本
            buttonTexts.push(text);
          }
        }
      }

      const allButtonText = buttonTexts.join(' | ');
      this.logger.info(`🔍 备用方法找到的按钮: ${allButtonText}`);

      return { inStock: false, buttonText: allButtonText || '未找到按钮' };

    } catch (error) {
      this.logger.error('❌ 备用按钮检测失败:', error);
      return { inStock: false, buttonText: '检测失败' };
    }
  }

  /**
   * 发送库存提醒
   */
  private async sendStockAlert(product: {
    title: string;
    price: string | null;
    inStock: boolean;
    buttonText: string;
  }): Promise<void> {
    // 只有配置了Telegram才发送通知
    if (!this.botToken || !this.chatId) {
      this.logger.warn('⚠️ Telegram未配置，跳过通知');
      return;
    }

    const message = `🎉 商品有货提醒！

📦 商品: ${product.title}
💰 价格: ${product.price || '未知'}
🔘 按钮状态: ${product.buttonText}
⏰ 时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

快去抢购吧！`;

    try {
      // 临时设置环境变量供sendTelegramMessage使用
      const originalBotToken = process.env.SGPM_BOT_TOKEN;
      const originalChatId = process.env.SGPM_CHAT_ID;

      process.env.SGPM_BOT_TOKEN = this.botToken;
      process.env.SGPM_CHAT_ID = this.chatId;

      await sendTelegramMessage(message);
      this.logger.info('📱 Telegram通知发送成功');

      // 恢复原始环境变量
      if (originalBotToken) {
        process.env.SGPM_BOT_TOKEN = originalBotToken;
      } else {
        delete process.env.SGPM_BOT_TOKEN;
      }

      if (originalChatId) {
        process.env.SGPM_CHAT_ID = originalChatId;
      } else {
        delete process.env.SGPM_CHAT_ID;
      }

    } catch (error) {
      this.logger.error('❌ Telegram通知发送失败:', error);
    }
  }

  /**
   * 延迟函数
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 清理资源
   */
  private async cleanup(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
        this.logger.info('🧹 浏览器实例已关闭');
      } catch (error) {
        this.logger.warn('⚠️ 关闭浏览器失败:', error);
      }
      this.browser = null;
    }
  }
}
