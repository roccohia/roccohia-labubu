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
  private botToken: string;
  private chatId: string;

  constructor(botToken?: string, chatId?: string) {
    this.botToken = botToken || process.env.SGPM_BOT_TOKEN || '';
    this.chatId = chatId || process.env.SGPM_CHAT_ID || '';
  }

  /**
   * 初始化浏览器
   */
  async initBrowser(): Promise<void> {
    try {
      logger.info('🚀 启动浏览器...');
      
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });
      
      logger.info('✅ 浏览器启动成功');
    } catch (error) {
      logger.error('❌ 浏览器启动失败:', error);
      throw error;
    }
  }

  /**
   * 关闭浏览器
   */
  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('🧹 浏览器已关闭');
    }
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 处理Cookie同意按钮 - 第一件事
   */
  private async handleCookieAccept(page: Page): Promise<void> {
    try {
      logger.info('🍪 第一步：查找并点击Accept按钮...');
      
      // PopMart精确的Cookie Accept按钮选择器
      const cookieSelector = '#__next > div > div > div.policy_aboveFixedContainer__KfeZi > div > div.policy_acceptBtn__ZNU71';
      
      // 等待按钮出现
      await page.waitForSelector(cookieSelector, { timeout: 5000 });
      
      // 点击Accept按钮
      await page.click(cookieSelector);
      logger.info('✅ Accept按钮点击成功');
      
      // 等待页面重新加载
      await this.delay(3000);
      logger.info('✅ 页面重新加载完成');
      
    } catch (error) {
      logger.warn('⚠️ Accept按钮未找到或已处理:', error);
    }
  }

  /**
   * 检测库存状态
   */
  private async detectStockStatus(page: Page): Promise<{ inStock: boolean; buttonText: string }> {
    logger.info('🔍 开始检测库存状态...');
    
    // 用户提供的精确库存按钮选择器
    const stockSelectors = [
      '#__next > div > div > div.layout_pcLayout__49ZwP > div.products_container__T0mpL > div.products_headerBlock__CESKr > div.products_rightBlock__bf2x5 > div > div.index_actionContainer__EqFYe > div',
      '#topBoxContainer > div.index_cardContainer__a7YPF > div > div.index_bottomBtn___D0Qh > button > span',
      '#topBoxContainer > div.index_cardContainer__a7YPF > div:nth-child(1) > div.index_bottomBtn___D0Qh > button.ant-btn.ant-btn-primary.index_chooseRandomlyBtn__upKXA',
      '#topBoxContainer > div.index_cardContainer__a7YPF > div:nth-child(1) > div.index_bottomBtn___D0Qh > button.ant-btn.ant-btn-ghost.index_chooseMulitityBtn__n0MoA'
    ];

    let buttonText = '';
    
    for (const selector of stockSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await page.evaluate(el => el.textContent?.trim(), element);
          if (text) {
            buttonText = text;
            logger.info(`📝 找到按钮文字: "${text}"`);
            break;
          }
        }
      } catch (error) {
        continue;
      }
    }

    if (!buttonText) {
      logger.warn('⚠️ 未找到库存按钮');
      return { inStock: false, buttonText: '未找到按钮' };
    }

    // 判断库存状态
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
    // 提取标题
    let title = 'Unknown Product';
    try {
      const titleElement = await page.$('h1, .product-title, .product-name');
      if (titleElement) {
        title = await page.evaluate(el => el.textContent?.trim(), titleElement) || title;
      }
    } catch (error) {
      // 从URL提取
      const url = page.url();
      title = decodeURIComponent(url.split('/').pop() || 'Unknown Product');
    }

    // 提取价格
    let price: string | null = null;
    try {
      const priceElement = await page.$('.price, .product-price, [class*="price"]');
      if (priceElement) {
        price = await page.evaluate(el => el.textContent?.trim(), priceElement) || null;
      }
    } catch (error) {
      logger.warn('⚠️ 价格提取失败');
    }

    // 检测库存状态
    const { inStock, buttonText } = await this.detectStockStatus(page);

    return { title, price, inStock, buttonText };
  }

  /**
   * 检查单个产品
   */
  async checkProduct(url: string): Promise<ProductInfo> {
    if (!this.browser) {
      throw new Error('浏览器未初始化');
    }

    const page = await this.browser.newPage();
    
    try {
      // 设置用户代理
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      logger.info(`🌐 访问产品页面: ${url}`);
      
      // 导航到页面
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // 第一件事：处理Cookie Accept按钮
      await this.handleCookieAccept(page);
      
      // 等待页面稳定
      await this.delay(5000);
      
      // 提取产品信息
      const productInfo = await this.extractProductInfo(page);
      
      logger.info(`📊 ${productInfo.title}: ${productInfo.inStock ? '✅ 有货' : '❌ 缺货'} | 价格: ${productInfo.price || '未知'}`);
      
      return productInfo;
      
    } finally {
      await page.close();
    }
  }

  /**
   * 发送Telegram通知
   */
  async sendTelegramNotification(product: ProductInfo): Promise<void> {
    if (!this.botToken || !this.chatId) {
      logger.warn('⚠️ Telegram未配置，跳过通知');
      return;
    }

    const message = `🎉 商品有货提醒！

📦 商品: ${product.title}
💰 价格: ${product.price || '未知'}
🔘 状态: ${product.buttonText}
⏰ 时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

快去抢购吧！`;

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: 'HTML'
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
   * 监控多个产品
   */
  async monitorProducts(urls: string[]): Promise<void> {
    logger.info(`📊 开始监控 ${urls.length} 个产品`);
    
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      logger.info(`📦 检查产品 ${i + 1}/${urls.length}: ${url}`);
      
      try {
        const productInfo = await this.checkProduct(url);
        
        // 如果有货，发送通知
        if (productInfo.inStock) {
          await this.sendTelegramNotification(productInfo);
        }
        
        // 产品间延迟
        if (i < urls.length - 1) {
          await this.delay(2000);
        }
        
      } catch (error) {
        logger.error(`❌ 检查产品失败 ${url}:`, error);
      }
    }
    
    logger.info('✅ 监控完成');
  }
}
