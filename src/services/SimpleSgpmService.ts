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
      
      // 导航到页面
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });
      
      // 等待页面加载
      await this.delay(3000);
      
      // 处理Cookie同意按钮
      await this.handleCookieConsent(page);
      
      // 提取产品信息
      const productInfo = await this.extractProductInfo(page);
      
      return productInfo;
      
    } finally {
      await page.close();
    }
  }

  /**
   * 处理Cookie同意按钮
   */
  private async handleCookieConsent(page: Page): Promise<void> {
    try {
      // 常见的Cookie按钮选择器
      const cookieSelectors = [
        'button[id*="accept"]',
        'button[class*="accept"]',
        'button:contains("Accept")',
        'button:contains("同意")',
        'button:contains("OK")',
        '[data-testid*="accept"]',
        '.cookie-banner button',
        '#cookie-banner button'
      ];

      for (const selector of cookieSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            await button.click();
            this.logger.info('🍪 Cookie同意按钮已点击');
            await this.delay(1000);
            break;
          }
        } catch (error) {
          // 忽略单个选择器的错误
        }
      }
    } catch (error) {
      this.logger.warn('⚠️ Cookie处理失败:', error);
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
    // 等待页面稳定
    await this.delay(2000);

    // 提取产品标题
    const title = await this.extractTitle(page);
    
    // 提取价格
    const price = await this.extractPrice(page);
    
    // 提取按钮文字并判断库存状态
    const { inStock, buttonText } = await this.extractStockStatus(page);

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
   * 提取库存状态（基于按钮文字）
   */
  private async extractStockStatus(page: Page): Promise<{ inStock: boolean; buttonText: string }> {
    // 等待页面完全加载
    await this.delay(3000);

    // 更具体的PopMart按钮选择器
    const buttonSelectors = [
      // PopMart 特定的按钮选择器
      '.ant-btn',
      '.index_chooseRandomlyBtn__upKXA', // Pick One to Shake 按钮
      '.index_addToCartBtn__xxx', // Add to Cart 按钮
      '.index_buyNowBtn__xxx', // Buy Now 按钮
      '.index_notifyBtn__xxx', // Notify Me 按钮
      // 通用选择器
      'button[class*="btn"]',
      'button[class*="Button"]',
      'button[class*="add"]',
      'button[class*="buy"]',
      'button[class*="cart"]',
      'button[class*="notify"]',
      'button',
      '.btn',
      '.button',
      '[role="button"]'
    ];

    let allButtonTexts: string[] = [];
    let importantButtons: string[] = [];

    for (const selector of buttonSelectors) {
      try {
        const buttons = await page.$$(selector);
        for (const button of buttons) {
          const text = await page.evaluate(el => el.textContent?.trim(), button);
          const className = await page.evaluate(el => el.className, button);

          if (text && text.length > 0) {
            allButtonTexts.push(text);

            // 重要按钮（包含关键词的）
            const textLower = text.toLowerCase();
            if (textLower.includes('buy') ||
                textLower.includes('cart') ||
                textLower.includes('notify') ||
                textLower.includes('shake') ||
                textLower.includes('purchase') ||
                textLower.includes('available') ||
                className.includes('chooseRandomlyBtn') ||
                className.includes('addToCartBtn') ||
                className.includes('buyNowBtn') ||
                className.includes('notifyBtn')) {
              importantButtons.push(text);
            }
          }
        }
      } catch (error) {
        // 继续尝试下一个选择器
      }
    }

    // 优先使用重要按钮，如果没有则使用所有按钮
    const relevantButtons = importantButtons.length > 0 ? importantButtons : allButtonTexts;
    const buttonText = relevantButtons.join(' | ');

    this.logger.info(`🔍 发现的按钮文字: ${buttonText}`);
    this.logger.info(`🎯 重要按钮: ${importantButtons.join(' | ') || '无'}`);

    // 判断库存状态
    const inStockKeywords = [
      'buy now', 'add to cart', 'purchase', 'buy', 'cart',
      'pick one to shake', 'buy multiple boxes', 'order now',
      'add to bag', 'shop now'
    ];

    const outOfStockKeywords = [
      'notify me when available', 'out of stock', 'sold out',
      'in-app purchase only', 'unavailable', 'coming soon',
      'notify when available', 'notify me'
    ];

    const buttonTextLower = buttonText.toLowerCase();

    // 检查缺货关键词
    for (const keyword of outOfStockKeywords) {
      if (buttonTextLower.includes(keyword)) {
        return { inStock: false, buttonText };
      }
    }

    // 检查有货关键词
    for (const keyword of inStockKeywords) {
      if (buttonTextLower.includes(keyword)) {
        return { inStock: true, buttonText };
      }
    }

    // 默认判断为缺货（保守策略）
    return { inStock: false, buttonText };
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
