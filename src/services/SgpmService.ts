import { LoggerInstance } from '../utils/logger';
import { SgpmConfig } from '../types';
import { getSgpmEnvConfig } from '../config-sgpm';
import { StatusManager } from '../utils/statusManager';
import { sendTelegramMessage } from '../utils/sendTelegramMessage';
import axios from 'axios';

/**
 * SGPM产品状态接口
 */
interface SgpmProductStatus {
  title: string;
  inStock: boolean;
  lastChecked: number;
}

/**
 * SGPM产品状态记录
 */
type SgpmStatusRecord = Record<string, SgpmProductStatus>;

/**
 * SGPM (Singapore PopMart) 监控服务
 * 独立的PopMart新加坡产品库存监控服务
 */
export class SgpmService {
  private config: SgpmConfig;
  private logger: LoggerInstance;
  private statusManager: StatusManager<SgpmStatusRecord>;
  private envConfig: ReturnType<typeof getSgpmEnvConfig>;

  constructor(config: SgpmConfig, logger: LoggerInstance) {
    this.config = config;
    this.logger = logger;
    this.envConfig = getSgpmEnvConfig();

    this.logger.info(`初始化SGPM状态管理器，文件路径: ${this.config.statusFile}`);

    // 初始化状态管理器
    this.statusManager = new StatusManager<SgpmStatusRecord>(
      this.config.statusFile,
      this.logger,
      {} // 初始空状态
    );

    // 立即保存一次以确保文件存在
    try {
      this.statusManager.save();
      this.logger.info(`✅ SGPM状态文件初始化成功: ${this.config.statusFile}`);
    } catch (error) {
      this.logger.error(`❌ SGPM状态文件初始化失败: ${this.config.statusFile}`, error);
    }
  }

  /**
   * 检查所有产品
   */
  async checkProducts(): Promise<void> {
    this.logger.info(`开始检查 ${this.config.productUrls.length} 个SGPM产品`);

    let checkedCount = 0;
    let inStockCount = 0;
    let notificationsSent = 0;
    let errorCount = 0;

    for (const url of this.config.productUrls) {
      try {
        this.logger.info(`检查产品 ${checkedCount + 1}/${this.config.productUrls.length}: ${url}`);

        const result = await this.checkSingleProduct(url);
        await this.processProductResult(url, result);

        checkedCount++;
        if (result.inStock) {
          inStockCount++;
          notificationsSent++;
        }

        this.logger.info(`✅ 产品检查完成: ${result.title} - ${result.inStock ? '有货' : '缺货'}`);

        // 添加延迟避免请求过快
        await this.sleep(2000);

      } catch (error) {
        this.logger.error(`❌ 检查产品失败: ${url}`, error);
        errorCount++;
        checkedCount++;
      }
    }

    // 最终保存状态
    try {
      this.statusManager.save();
      this.logger.info(`📝 最终状态已保存到: ${this.config.statusFile}`);
    } catch (error) {
      this.logger.error(`❌ 最终状态保存失败:`, error);
    }

    this.logger.info(`📊 SGPM检查完成统计:`);
    this.logger.info(`   - 总产品数: ${this.config.productUrls.length}`);
    this.logger.info(`   - 已检查: ${checkedCount}`);
    this.logger.info(`   - 有货产品: ${inStockCount}`);
    this.logger.info(`   - 发送通知: ${notificationsSent}`);
    this.logger.info(`   - 错误数量: ${errorCount}`);
  }

  /**
   * 检查单个产品
   */
  private async checkSingleProduct(url: string): Promise<{ title: string; inStock: boolean }> {
    this.logger.debug(`开始检查单个产品: ${url}`);
    
    try {
      // 使用axios进行HTTP请求
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.config.userAgent,
          ...this.config.headers
        },
        timeout: this.config.timeout,
        validateStatus: (status) => status < 500 // 接受所有非5xx状态码
      });

      if (response.status >= 200 && response.status < 400) {
        const html = response.data;
        const result = this.extractProductInfoFromHTML(html, url);
        this.logger.debug(`产品检查结果: ${result.title} - ${result.inStock ? '有货' : '缺货'}`);
        return result;
      } else {
        this.logger.warn(`HTTP请求失败 (${response.status}): ${url}`);
        return this.getFallbackProductInfo(url);
      }
    } catch (error) {
      this.logger.warn(`网络请求失败: ${url}`, error);
      return this.getFallbackProductInfo(url);
    }
  }

  /**
   * 从HTML提取产品信息
   */
  private extractProductInfoFromHTML(html: string, url: string): { title: string; inStock: boolean } {
    // 提取产品标题
    let title = 'Unknown Product';
    
    const titlePatterns = [
      /<h1[^>]*class[^>]*title[^>]*>([^<]+)<\/h1>/i,
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<title>([^<]+)<\/title>/i,
      /"productName"\s*:\s*"([^"]+)"/i,
      /"title"\s*:\s*"([^"]+)"/i
    ];

    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        title = match[1].trim();
        // 清理标题
        title = title.replace(/\s*-\s*PopMart.*$/i, '').trim();
        if (title.length > 3) break;
      }
    }

    // 如果没有找到合适的标题，从URL提取
    if (!title || title === 'Unknown Product' || title.length < 3) {
      title = this.extractTitleFromUrl(url);
    }

    // 检查库存状态
    const inStock = this.checkStockFromHTML(html);

    return { title, inStock };
  }

  /**
   * 从URL提取产品标题
   */
  private extractTitleFromUrl(url: string): string {
    try {
      const urlParts = url.split('/');
      const productPart = urlParts[urlParts.length - 1] || 'Unknown Product';
      return decodeURIComponent(productPart)
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
    } catch {
      return 'Unknown Product';
    }
  }

  /**
   * 从HTML检查库存状态
   */
  private checkStockFromHTML(html: string): boolean {
    const htmlLower = html.toLowerCase();

    // 缺货指示器
    const outOfStockIndicators = [
      'out of stock', 'sold out', 'unavailable', 'not available',
      'coming soon', 'notify me when available', 'in-app purchase only',
      'app purchase only', '缺货', '售罄', '暂无库存', 'disabled', 'btn-disabled'
    ];

    // 有货指示器
    const inStockIndicators = [
      'add to cart', 'buy now', 'purchase', 'in stock', 'available',
      'pick one to shake', 'shake to pick', 'add to bag', 'shop now',
      'order now', 'get it now', '立即购买', '加入购物车', '现货', '有库存'
    ];

    // 盲盒抽取按钮
    const shakeButtonPatterns = [
      /pick\s+one\s+to\s+shake/i,
      /shake\s+to\s+pick/i,
      /class[^>]*chooseRandomlyBtn/i
    ];

    // 价格模式
    const pricePatterns = [
      /\$\d+\.\d{2}/, /S\$\d+\.\d{2}/, /SGD\s*\d+/i
    ];

    // 检查各种指示器
    const hasOutOfStockIndicator = outOfStockIndicators.some(indicator => 
      htmlLower.includes(indicator.toLowerCase())
    );
    const hasInStockIndicator = inStockIndicators.some(indicator => 
      htmlLower.includes(indicator.toLowerCase())
    );
    const hasShakeButton = shakeButtonPatterns.some(pattern => pattern.test(html));
    const hasPricePattern = pricePatterns.some(pattern => pattern.test(html));

    // 判断库存状态
    if (hasShakeButton) {
      return true; // 有盲盒抽取按钮
    } else if (hasInStockIndicator && !hasOutOfStockIndicator) {
      return true; // 有有货指示器且无缺货指示器
    } else if (hasPricePattern && !hasOutOfStockIndicator) {
      return true; // 有价格信息且无缺货指示器
    } else {
      return false; // 默认缺货
    }
  }

  /**
   * 获取备用产品信息
   */
  private getFallbackProductInfo(url: string): { title: string; inStock: boolean } {
    return {
      title: this.extractTitleFromUrl(url),
      inStock: false // 网络错误时默认缺货
    };
  }

  /**
   * 处理产品检查结果
   */
  private async processProductResult(url: string, result: { title: string; inStock: boolean }): Promise<void> {
    const { title, inStock } = result;
    
    this.logger.info(`商品：${title}`);
    this.logger.info(`状态：${inStock ? '✅ 有货' : '❌ 缺货'}`);

    const currentStatus = this.statusManager.get();
    const previousStatus = currentStatus[url];
    const statusChanged = !previousStatus || previousStatus.inStock !== inStock;

    // 更新状态
    currentStatus[url] = {
      title,
      inStock,
      lastChecked: Date.now()
    };

    // 只在有货时发送通知
    if (inStock) {
      this.logger.info('检测到有货商品，发送通知');
      try {
        await this.sendNotification({ title, inStock, url });
        this.logger.success('✅ 有货通知发送成功');
      } catch (error) {
        this.logger.error('通知发送失败:', error);
      }
    } else {
      this.logger.debug('商品缺货，不发送通知');
    }

    if (statusChanged) {
      this.logger.info(`状态变化: ${previousStatus?.inStock ? '有货' : '缺货'} → ${inStock ? '有货' : '缺货'}`);
    }

    // 保存状态
    this.statusManager.set(currentStatus);
    this.statusManager.save();
  }

  /**
   * 发送Telegram通知
   */
  private async sendNotification(product: { title: string; inStock: boolean; url: string }): Promise<void> {
    if (!this.envConfig.botToken || !this.envConfig.chatId) {
      this.logger.warn('Telegram配置缺失，跳过通知发送');
      return;
    }

    const message = this.formatMessage(product);
    
    // 使用SGPM专用的Telegram配置
    const originalBotToken = process.env.BOT_TOKEN;
    const originalChatId = process.env.CHAT_ID;
    
    // 临时设置SGPM配置
    process.env.BOT_TOKEN = this.envConfig.botToken;
    process.env.CHAT_ID = this.envConfig.chatId;
    
    try {
      await sendTelegramMessage(message);
    } finally {
      // 恢复原始配置
      if (originalBotToken) process.env.BOT_TOKEN = originalBotToken;
      if (originalChatId) process.env.CHAT_ID = originalChatId;
    }
  }

  /**
   * 格式化通知消息
   */
  private formatMessage(product: { title: string; inStock: boolean; url: string }): string {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Singapore' });
    
    return `🛒 SGPM库存提醒

✅ 商品有货！

📦 商品名称: ${product.title}
🔗 购买链接: ${product.url}
🕐 检测时间: ${timestamp} (新加坡时间)
🤖 来源: SGPM自动监控

⚡ 快去抢购吧！`;
  }

  /**
   * 睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
