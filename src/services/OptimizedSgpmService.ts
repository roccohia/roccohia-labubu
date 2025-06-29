import { LoggerInstance } from '../utils/logger';
import { SgpmConfig } from '../types';
import { getSgpmEnvConfig } from '../config-sgpm';
import { StatusManager } from '../utils/statusManager';
import { sendTelegramMessage } from '../utils/sendTelegramMessage';
import { productCache, globalCache } from '../utils/OptimizedCacheManager';
import { OptimizedBrowserManager } from '../core/OptimizedBrowserManager';
import { Page } from 'puppeteer';

/**
 * SGPM产品状态接口
 */
interface SgpmProductStatus {
  title: string;
  inStock: boolean;
  lastChecked: number;
  price?: string;
  availability?: string;
}

/**
 * SGPM产品状态记录
 */
type SgpmStatusRecord = Record<string, SgpmProductStatus>;

/**
 * 产品检查结果
 */
interface ProductCheckResult {
  url: string;
  title: string;
  inStock: boolean;
  price?: string;
  availability?: string;
  checkTime: number;
  fromCache: boolean;
  error?: boolean; // 标记是否为错误状态
}

/**
 * 批量检查配置
 */
interface BatchCheckConfig {
  batchSize: number;
  concurrency: number;
  delayBetweenBatches: number;
  retryFailedItems: boolean;
}

/**
 * 高性能SGPM (Singapore PopMart) 监控服务
 * 
 * 优化特性：
 * - 并发产品检查
 * - 智能缓存机制
 * - HTTP连接池复用
 * - 批量处理优化
 * - 错误恢复和重试
 * - 性能监控和指标
 */
export class OptimizedSgpmService {
  private config: SgpmConfig;
  private logger: LoggerInstance;
  private statusManager: StatusManager<SgpmStatusRecord>;
  private envConfig: ReturnType<typeof getSgpmEnvConfig>;
  private currentUrl: string = '';
  private browserManager: OptimizedBrowserManager;
  private static cookieHandled: boolean = false; // 全局 cookie 处理状态
  
  // 性能统计
  private stats = {
    totalChecks: 0,
    cacheHits: 0,
    networkRequests: 0,
    errors: 0,
    notifications: 0,
    startTime: 0,
    endTime: 0
  };

  // 批量处理配置
  private batchConfig: BatchCheckConfig = {
    batchSize: 3,
    concurrency: 2,
    delayBetweenBatches: 1000,
    retryFailedItems: true
  };

  constructor(config: SgpmConfig, logger: LoggerInstance) {
    this.config = config;
    this.logger = logger;
    this.envConfig = getSgpmEnvConfig();

    // 初始化浏览器管理器
    this.browserManager = new OptimizedBrowserManager(logger);

    // 初始化状态管理器
    this.statusManager = new StatusManager<SgpmStatusRecord>(
      this.config.statusFile,
      this.logger,
      {} // 初始空状态
    );

    // 立即保存一次以确保文件存在
    try {
      this.statusManager.save();
    } catch (error) {
      this.logger.error(`❌ SGPM状态文件初始化失败: ${this.config.statusFile}`, error);
    }
  }

  /**
   * 高性能产品检查主方法
   */
  async checkProducts(): Promise<void> {
    this.stats.startTime = Date.now();
    this.stats.endTime = 0; // 重置结束时间
    this.logger.info(`🚀 开始高性能检查 ${this.config.productUrls.length} 个SGPM产品`);
    
    try {
      // 1. 预热缓存
      await this.warmupCache();
      
      // 2. 批量并发检查
      const results = await this.batchCheckProducts();
      
      // 3. 处理结果
      await this.processResults(results);
      
      // 4. 输出性能统计
      this.outputPerformanceStats();
      
    } catch (error) {
      this.logger.error('❌ 高性能SGPM检查失败:', error);
      this.stats.errors++;
      throw error;
    } finally {
      this.stats.endTime = Date.now();
    }
  }

  /**
   * 预热缓存
   */
  private async warmupCache(): Promise<void> {
    this.logger.info('🔥 预热产品缓存...');
    
    const warmupItems = this.config.productUrls.map(url => ({
      key: `product_info_${url}`,
      fn: async () => {
        // 预加载基础产品信息
        return this.extractProductInfoFromUrl(url);
      },
      ttl: 10 * 60 * 1000 // 10分钟
    }));

    await globalCache.warmup(warmupItems);
    this.logger.info(`✅ 缓存预热完成，预加载 ${warmupItems.length} 个产品信息`);
  }

  /**
   * 批量并发检查产品
   */
  private async batchCheckProducts(): Promise<ProductCheckResult[]> {
    const results: ProductCheckResult[] = [];
    const urls = [...this.config.productUrls];
    
    this.logger.info(`📦 开始批量检查，批次大小: ${this.batchConfig.batchSize}, 并发数: ${this.batchConfig.concurrency}`);
    
    // 分批处理
    for (let i = 0; i < urls.length; i += this.batchConfig.batchSize) {
      const batch = urls.slice(i, i + this.batchConfig.batchSize);
      this.logger.info(`🔄 处理批次 ${Math.floor(i / this.batchConfig.batchSize) + 1}/${Math.ceil(urls.length / this.batchConfig.batchSize)}`);
      
      // 并发检查当前批次
      const batchPromises = batch.map(url => this.checkSingleProductOptimized(url));
      const batchResults = await Promise.allSettled(batchPromises);
      
      // 处理批次结果
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          this.logger.error(`❌ 产品检查失败: ${batch[index]}`, result.reason);
          this.stats.errors++;
          
          // 添加失败结果
          results.push({
            url: batch[index],
            title: this.extractProductInfoFromUrl(batch[index]).title,
            inStock: false,
            checkTime: Date.now(),
            fromCache: false
          });
        }
      });
      
      // 批次间延迟
      if (i + this.batchConfig.batchSize < urls.length) {
        await this.sleep(this.batchConfig.delayBetweenBatches);
      }
    }
    
    this.logger.info(`✅ 批量检查完成，成功: ${results.length - this.stats.errors}, 失败: ${this.stats.errors}`);
    return results;
  }

  /**
   * 优化的单产品检查 - 使用真实浏览器绕过反爬虫
   */
  private async checkSingleProductOptimized(url: string): Promise<ProductCheckResult> {
    this.stats.totalChecks++;
    this.currentUrl = url; // 设置当前URL用于智能推断

    // 1. 检查缓存
    const cacheKey = `sgpm_product_${url}`;
    const cached = productCache.get(cacheKey);

    if (cached) {
      this.stats.cacheHits++;
      this.logger.debug(`📋 缓存命中: ${url}`);
      return {
        url,
        title: cached.title,
        inStock: cached.inStock,
        checkTime: Date.now(),
        fromCache: true
      };
    }

    // 2. 使用真实浏览器检查产品状态
    this.stats.networkRequests++;
    this.logger.debug(`🌐 浏览器检查: ${url}`);

    try {
      // 使用真实浏览器获取页面内容
      const result = await this.checkProductWithBrowser(url);

      this.logger.info(`✅ 浏览器检查成功: ${url}`);

      // 处理浏览器检查结果
      if (result.success) {
        this.logger.info(`🔍 产品检测结果: ${result.title} - ${result.inStock ? '✅ 有货' : '❌ 缺货'}`);

        // 3. 缓存结果
        productCache.set(cacheKey, {
          title: result.title,
          inStock: result.inStock
        }, 5 * 60 * 1000); // 5分钟产品缓存

        return {
          url,
          title: result.title,
          inStock: result.inStock,
          price: result.price,
          availability: result.availability,
          checkTime: Date.now(),
          fromCache: false
        };
      } else {
        // 浏览器检查失败，使用fallback
        this.logger.warn(`浏览器检查失败: ${url}`);
        const fallbackInfo = this.extractProductInfoFromUrl(url);
        return {
          url,
          title: fallbackInfo.title,
          inStock: false,
          checkTime: Date.now(),
          fromCache: false,
          error: true
        };
      }
    } catch (error: any) {
      // 完全安全地提取错误信息，避免循环引用
      const errorMsg = error?.message || error?.code || 'Network request failed';
      const statusCode = error?.response?.status || error?.status || 'No response';
      const errorType = error?.name || 'Error';

      this.logger.error(`❌ 网络请求失败: ${url} (${errorType}: ${errorMsg}, 状态: ${statusCode})`);
      this.stats.errors++;

      // 返回备用信息，但标记为错误状态
      const fallbackInfo = this.extractProductInfoFromUrl(url);
      return {
        url,
        title: fallbackInfo.title,
        inStock: false, // 网络失败时无法确定库存状态
        checkTime: Date.now(),
        fromCache: false,
        error: true // 标记为错误状态
      };
    }
  }

  /**
   * 从HTML提取产品信息（增强版）
   */
  private extractProductInfoFromHTML(html: string, url: string): { 
    title: string; 
    inStock: boolean; 
    price?: string; 
    availability?: string; 
  } {
    // 提取产品标题
    let title = 'Unknown Product';
    
    const titlePatterns = [
      /<h1[^>]*class[^>]*title[^>]*>([^<]+)<\/h1>/i,
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<title>([^<]+)<\/title>/i,
      /"productName"\s*:\s*"([^"]+)"/i,
      /"title"\s*:\s*"([^"]+)"/i,
      /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i
    ];

    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        title = match[1].trim();
        title = title.replace(/\s*-\s*PopMart.*$/i, '').trim();
        if (title.length > 3) break;
      }
    }

    // 如果没有找到合适的标题，从URL提取
    if (!title || title === 'Unknown Product' || title.length < 3) {
      title = this.extractProductInfoFromUrl(url).title;
    }

    // 提取价格信息（增强版）
    let price: string | undefined;
    const pricePatterns = [
      // 标准新加坡元格式（优先级最高）
      /S\$\s*(\d+(?:\.\d{2})?)/i,
      /SGD\s*(\d+(?:\.\d{2})?)/i,

      // PopMart特定格式
      /"price":\s*"?(\d+(?:\.\d{2})?)"?/i,
      /"originalPrice":\s*"?(\d+(?:\.\d{2})?)"?/i,
      /"salePrice":\s*"?(\d+(?:\.\d{2})?)"?/i,

      // HTML元素中的价格（更精确的匹配）
      /<span[^>]*class="[^"]*price[^"]*"[^>]*>[\s\S]*?S?\$\s*(\d+(?:\.\d{2})?)/i,
      /<div[^>]*class="[^"]*price[^"]*"[^>]*>[\s\S]*?S?\$\s*(\d+(?:\.\d{2})?)/i,
      /data-price="(\d+(?:\.\d{2})?)"/i,
      /data-original-price="(\d+(?:\.\d{2})?)"/i,

      // 通用美元格式
      /\$\s*(\d+(?:\.\d{2})?)/i,

      // JSON数据中的价格
      /"amount"\s*:\s*"?(\d+(?:\.\d{2})?)"?/i,
      /"value"\s*:\s*"?(\d+(?:\.\d{2})?)"?/i,

      // 产品页面特定格式
      /售价[：:]\s*S?\$\s*(\d+(?:\.\d{2})?)/i,
      /价格[：:]\s*S?\$\s*(\d+(?:\.\d{2})?)/i,

      // 更宽泛的匹配
      /(\d+\.\d{2})\s*SGD/i,
      /(\d+\.\d{2})\s*新币/i,

      // 备用格式
      /S\$(\d+)/i,  // 没有小数点的格式
      /SGD(\d+)/i
    ];

    this.logger.info('🔍 开始提取价格信息...');

    for (let i = 0; i < pricePatterns.length; i++) {
      const pattern = pricePatterns[i];
      const match = html.match(pattern);
      if (match && match[1]) {
        const priceValue = match[1];
        price = `S$${priceValue}`;
        this.logger.info(`💰 价格提取成功: ${price} (使用模式 ${i + 1})`);
        break;
      }
    }

    if (!price) {
      this.logger.warn('⚠️ 未能提取到价格信息');
      // 尝试在HTML中搜索价格相关的文本片段
      const priceHints = html.match(/S\$[\d\.,]+|SGD[\d\.,]+|\$[\d\.,]+/gi);
      if (priceHints && priceHints.length > 0) {
        this.logger.info(`💡 发现价格线索: ${priceHints.slice(0, 3).join(', ')}`);

        // 尝试从价格线索中提取第一个有效价格
        for (const hint of priceHints.slice(0, 3)) {
          const cleanHint = hint.replace(/[^\d\.]/g, '');
          const numValue = parseFloat(cleanHint);
          if (!isNaN(numValue) && numValue > 0 && numValue < 1000) { // 合理的价格范围
            price = `S$${numValue.toFixed(2)}`;
            this.logger.info(`💰 从价格线索提取到价格: ${price}`);
            break;
          }
        }
      } else {
        this.logger.warn('💡 未发现任何价格线索');
      }
    }

    // 检查库存状态（增强版）
    const inStock = this.checkStockFromHTML(html);
    
    // 提取可用性信息
    let availability: string | undefined;
    if (inStock) {
      availability = 'In Stock';
    } else {
      const availabilityPatterns = [
        /out of stock/i,
        /sold out/i,
        /coming soon/i,
        /in-app purchase only/i
      ];
      
      for (const pattern of availabilityPatterns) {
        if (pattern.test(html)) {
          availability = pattern.source.replace(/[\/\\]/g, '').replace(/i$/, '');
          break;
        }
      }
      availability = availability || 'Out of Stock';
    }

    return { title, inStock, price, availability };
  }

  /**
   * 从URL提取产品信息
   */
  private extractProductInfoFromUrl(url: string): { title: string } {
    try {
      const urlParts = url.split('/');
      const productPart = urlParts[urlParts.length - 1] || 'Unknown Product';
      const title = decodeURIComponent(productPart)
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
      return { title };
    } catch {
      return { title: 'Unknown Product' };
    }
  }



  /**
   * 从HTML检查库存状态（基于按钮文本的精确检测）
   */
  private checkStockFromHTML(html: string): boolean {
    const htmlLower = html.toLowerCase();

    this.logger.info(`📄 HTML内容长度: ${html.length} 字符`);
    const htmlPreview = html.substring(0, 300).replace(/\s+/g, ' ');
    this.logger.info(`📄 HTML预览: ${htmlPreview}...`);

    // 基于按钮文本的精确库存检测
    // 缺货按钮文本（优先检测）
    const outOfStockButtonTexts = [
      'notify me when available',
      'in-app purchase only'
    ];

    // 有货按钮文本
    const inStockButtonTexts = [
      'buy now',
      'add to cart',
      'pick one to shake',
      'buy multiple boxes'
    ];

    // 检查缺货按钮（优先级最高）
    for (const buttonText of outOfStockButtonTexts) {
      if (htmlLower.includes(buttonText)) {
        this.logger.info(`🔍 检测到缺货按钮: "${buttonText}"`);
        return false;
      }
    }

    // 检查有货按钮
    for (const buttonText of inStockButtonTexts) {
      if (htmlLower.includes(buttonText)) {
        this.logger.info(`🔍 检测到有货按钮: "${buttonText}"`);
        return true;
      }
    }

    // 如果没有检测到明确的按钮文本，尝试更宽泛的检测
    this.logger.info('🔍 未检测到明确的按钮文本，尝试更宽泛的检测');

    // 更宽泛的缺货指示器
    const broadOutOfStockIndicators = [
      'out of stock',
      'sold out',
      'unavailable',
      'coming soon',
      'temporarily unavailable',
      'not available'
    ];

    // 更宽泛的有货指示器
    const broadInStockIndicators = [
      'purchase',
      'shop now',
      'order now',
      'get it now'
    ];

    // 检查宽泛的缺货指示器
    for (const indicator of broadOutOfStockIndicators) {
      if (htmlLower.includes(indicator)) {
        this.logger.info(`🔍 检测到缺货指示器: "${indicator}"`);
        return false;
      }
    }

    // 检查宽泛的有货指示器
    for (const indicator of broadInStockIndicators) {
      if (htmlLower.includes(indicator)) {
        this.logger.info(`🔍 检测到有货指示器: "${indicator}"`);
        return true;
      }
    }

    // 价格检测作为辅助判断（与价格提取逻辑保持一致）
    const pricePatterns = [
      /S\$\s*\d+(\.\d{2})?/i,
      /SGD\s*\d+(\.\d{2})?/i,
      /\$\s*\d+(\.\d{2})?/i,
      /"price"\s*:\s*"?\d+(\.\d{2})?"?/i,
      /"amount"\s*:\s*"?\d+(\.\d{2})?"?/i,
      /class="[^"]*price[^"]*"[^>]*>[\s\S]*?S?\$\s*\d+(\.\d{2})?/i,
      /data-price="\d+(\.\d{2})?"/i
    ];
    const hasPrice = pricePatterns.some(pattern => pattern.test(html));

    this.logger.info(`🔍 库存检测详情:`);
    this.logger.info(`   - 价格信息: ${hasPrice}`);

    // 如果有价格信息，可能是有货（作为最后的判断依据）
    if (hasPrice) {
      this.logger.info('⚠️ 检测结果: 可能有货 (仅基于价格信息)');
      return true;
    }

    // 默认保守策略：如果没有明确的指示器，判断为缺货
    this.logger.info('❌ 检测结果: 缺货 (未检测到明确的库存指示器)');
    return false;
  }

  /**
   * 智能库存推断（当遇到反爬虫页面时）- 改进版
   */
  private intelligentStockInference(html: string): boolean {
    const htmlLower = html.toLowerCase();

    // 首先检查明确的缺货指示器
    const outOfStockIndicators = [
      'out of stock',
      'sold out',
      'unavailable',
      'coming soon',
      'in-app purchase only',
      'notify me when available',
      'temporarily unavailable',
      'not available',
      'pre-order',
      'waitlist',
      'back order',
      'discontinued'
    ];

    const hasOutOfStockIndicator = outOfStockIndicators.some(indicator =>
      htmlLower.includes(indicator)
    );

    if (hasOutOfStockIndicator) {
      this.logger.info('💡 智能推断: 检测到缺货指示器，判断为缺货');
      return false;
    }

    // 检查强有力的有货指示器（需要更严格的条件）
    const strongInStockIndicators = [
      'add to cart',
      'buy now',
      'pick one to shake',
      'shake to pick'
    ];

    const hasStrongInStockIndicator = strongInStockIndicators.some(indicator =>
      htmlLower.includes(indicator)
    );

    if (hasStrongInStockIndicator) {
      this.logger.info('💡 智能推断: 检测到强有力的有货指示器，判断为有货');
      return true;
    }

    // 检查弱有货指示器（需要多个条件同时满足）
    const weakInStockIndicators = [
      'in stock',
      'available'
    ];

    const hasWeakInStockIndicator = weakInStockIndicators.some(indicator =>
      htmlLower.includes(indicator)
    );

    // 检查价格信息
    const pricePatterns = [
      /S\$\s*\d+(\.\d{2})?/i,
      /\$\s*\d+(\.\d{2})?/i,
      /SGD\s*\d+(\.\d{2})?/i
    ];
    const hasPrice = pricePatterns.some(pattern => pattern.test(html));

    // 只有同时有弱有货指示器和价格信息才判断为有货
    if (hasWeakInStockIndicator && hasPrice) {
      this.logger.info('💡 智能推断: 检测到弱有货指示器+价格信息，判断为有货');
      return true;
    }

    // 基于URL模式的智能推断（更保守）
    const urlBasedInference = this.inferStockFromUrl();
    if (urlBasedInference === true) {
      // 只有明确判断为有货的URL模式才相信
      this.logger.info('💡 智能推断: 基于URL模式判断为有货');
      return true;
    }

    // 默认保守策略：假设缺货
    this.logger.info('💡 智能推断: 无法确定库存状态，保守判断为缺货');
    return false;
  }

  /**
   * 基于URL推断库存状态（极度保守的策略）
   */
  private inferStockFromUrl(): boolean | null {
    // 基于产品类型的智能推断
    const currentUrl = this.currentUrl || '';
    const urlLower = currentUrl.toLowerCase();

    // 极度保守策略：只有明确知道缺货的情况才返回false，其他都返回null

    // 明确的限定版或特殊版本通常缺货
    if (urlLower.includes('limited-edition') ||
        urlLower.includes('exclusive-edition') ||
        urlLower.includes('sold-out') ||
        urlLower.includes('discontinued')) {
      return false;
    }

    // 移除之前错误的"有货"推断逻辑
    // 不再基于URL类型推断为有货，因为这导致了误判

    // 其他情况无法推断，返回null让其他逻辑处理
    return null;
  }

  /**
   * 处理检查结果
   */
  private async processResults(results: ProductCheckResult[]): Promise<void> {
    this.logger.info(`📊 处理 ${results.length} 个产品检查结果`);
    
    const currentStatus = this.statusManager.get();
    let notificationsSent = 0;
    let statusChanges = 0;

    for (const result of results) {
      const { url, title, inStock, price, availability, error } = result;

      // 跳过真正的错误结果，但允许智能推断的结果
      if (error) {
        this.logger.warn(`❌ 跳过错误结果: ${title} (网络请求失败或反爬虫页面)`);
        continue;
      }

      // 显示产品状态
      this.logger.info(`📦 ${title}: ${inStock ? '✅ 有货' : '❌ 缺货'}${price ? ` (${price})` : ''}`);

      const previousStatus = currentStatus[url];
      const statusChanged = !previousStatus || previousStatus.inStock !== inStock;
      
      // 更新状态
      currentStatus[url] = {
        title,
        inStock,
        lastChecked: Date.now(),
        price,
        availability
      };
      
      if (statusChanged) {
        statusChanges++;
        // 显示所有状态变化用于调试
        this.logger.info(`🔄 状态变化: ${previousStatus?.inStock ? '有货' : '缺货'} → ${inStock ? '有货' : '缺货'}`);
      }
      
      // 只在有货时发送通知
      if (inStock) {
        try {
          await this.sendOptimizedNotification(result);
          notificationsSent++;
          this.stats.notifications++;
          this.logger.success('✅ 有货通知发送成功');
        } catch (error) {
          this.logger.error('❌ 通知发送失败:', error);
          this.stats.errors++;
        }
      }
    }

    // 保存状态
    this.statusManager.set(currentStatus);
    this.statusManager.save();
    
    this.logger.info(`📝 状态更新完成: ${statusChanges} 个变化, ${notificationsSent} 个通知`);
  }

  /**
   * 优化的通知发送
   */
  private async sendOptimizedNotification(result: ProductCheckResult): Promise<void> {
    if (!this.envConfig.botToken || !this.envConfig.chatId) {
      this.logger.warn('⚠️ Telegram配置缺失，跳过通知发送');
      return;
    }

    const message = this.formatOptimizedMessage(result);

    // 直接使用 sendTelegramMessage，它现在支持 SGPM 环境变量
    await sendTelegramMessage(message);
  }

  /**
   * 格式化优化通知消息
   */
  private formatOptimizedMessage(result: ProductCheckResult): string {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Singapore' });
    
    return `🛒 SGPM库存提醒 (高性能版)

✅ 商品有货！

📦 商品名称: ${result.title}
💰 价格: ${result.price || '未知'}
📊 状态: ${result.availability || 'Available'}
🔗 购买链接: ${result.url}
🕐 检测时间: ${timestamp} (新加坡时间)
⚡ 数据来源: ${result.fromCache ? '缓存' : '实时检测'}
🤖 来源: SGPM高性能监控

⚡ 快去抢购吧！`;
  }

  /**
   * 输出性能统计
   */
  private outputPerformanceStats(): void {
    // 确保结束时间已设置
    if (this.stats.endTime === 0) {
      this.stats.endTime = Date.now();
    }

    const duration = Math.max(this.stats.endTime - this.stats.startTime, 1); // 确保正数
    const cacheHitRate = this.stats.totalChecks > 0 ? (this.stats.cacheHits / this.stats.totalChecks * 100) : 0;
    
    // 简化统计输出
    const avgTime = this.stats.totalChecks > 0 ? (duration / this.stats.totalChecks).toFixed(1) : 0;
    this.logger.info(`📊 统计: ${this.stats.totalChecks}检查 | ${duration}ms | 缓存${cacheHitRate.toFixed(1)}% | 网络${this.stats.networkRequests} | 通知${this.stats.notifications} | 错误${this.stats.errors} | 平均${avgTime}ms/产品`);
  }

  /**
   * 睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats() {
    // 确保结束时间已设置
    if (this.stats.endTime === 0) {
      this.stats.endTime = Date.now();
    }

    return { ...this.stats };
  }

  /**
   * 设置批量处理配置
   */
  setBatchConfig(config: Partial<BatchCheckConfig>): void {
    this.batchConfig = { ...this.batchConfig, ...config };
    this.logger.info(`🔧 批量处理配置已更新:`, this.batchConfig);
  }

  /**
   * 使用真实浏览器检查产品状态（增强错误处理）
   */
  private async checkProductWithBrowser(url: string): Promise<{
    success: boolean;
    title: string;
    inStock: boolean;
    price?: string;
    availability?: string;
    error?: string;
  }> {
    let page: Page | null = null;
    let browserId: string | null = null;

    try {
      this.logger.info(`🌐 启动浏览器检查: ${url}`);

      // 获取浏览器实例，增加重试机制
      const browserInstance = await this.getBrowserWithRetry();
      page = browserInstance.page;
      browserId = browserInstance.id;

      // 验证页面是否有效
      if (!page || page.isClosed()) {
        throw new Error('Browser page is closed or invalid');
      }

      // 设置更真实的用户代理（GitHub Actions中跳过视口设置）
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

      // GitHub Actions 中跳过视口设置以避免触摸模拟错误
      const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
      if (!isGitHubActions) {
        await page.setViewport({ width: 1920, height: 1080 });
      } else {
        this.logger.info('🔧 GitHub Actions环境：跳过视口设置以避免触摸模拟错误');
      }

      // 设置额外的请求头
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1'
      });

      // 添加随机延迟模拟人类行为
      const delay = Math.floor(Math.random() * 2000) + 1000; // 1-3秒
      await new Promise(resolve => setTimeout(resolve, delay));

      this.logger.info(`🔄 导航到页面: ${url}`);

      // 导航到页面，使用较长的超时时间（增强错误处理和自动恢复）
      try {
        // 验证页面是否仍然有效，如果关闭则重新获取
        if (page.isClosed()) {
          this.logger.warn('🔄 页面已关闭，重新获取浏览器实例');
          const newBrowserInstance = await this.getBrowserWithRetry();
          page = newBrowserInstance.page;

          // 重新设置用户代理
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

          // GitHub Actions 中跳过视口设置
          const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
          if (!isGitHubActions) {
            await page.setViewport({ width: 1920, height: 1080 });
          } else {
            this.logger.info('🔧 GitHub Actions环境：跳过视口设置以避免触摸模拟错误');
          }
        }

        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
      } catch (gotoError: any) {
        if (gotoError.message?.includes('detached Frame') ||
            gotoError.message?.includes('Target closed') ||
            gotoError.message?.includes('Page is closed')) {
          this.logger.warn(`🔄 页面连接问题，采用保守策略: ${gotoError.message}`);
          // 不抛出错误，而是返回保守的结果
          return {
            success: true,
            title: this.extractTitleFromUrl(url),
            inStock: false,
            availability: 'Page connection failed - assumed out of stock',
            error: gotoError.message
          };
        }
        throw gotoError;
      }

      // 等待页面稳定
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 处理 cookie 同意按钮（只在第一次访问时处理）
      if (!OptimizedSgpmService.cookieHandled) {
        await this.handleCookieConsent(page);
        OptimizedSgpmService.cookieHandled = true;
        this.logger.info('✅ Cookie 同意处理完成，后续页面将跳过此步骤');
      }

      // 获取页面内容
      const html = await page.content();
      const title = await page.title();

      this.logger.info(`📄 页面加载完成，标题: ${title}`);
      this.logger.info(`📄 HTML内容长度: ${html.length} 字符`);

      // 首先尝试直接解析页面内容
      this.logger.info('🔍 尝试直接解析页面内容');
      const directResult = this.extractProductInfoFromBrowserHTML(html, title, url);

      // 如果直接解析成功且有明确的库存信息，就使用直接解析结果
      if (this.hasDefinitiveStockInfo(html)) {
        this.logger.info('✅ 检测到明确的库存信息，使用直接解析结果');
        return directResult;
      }

      // 如果没有明确的库存信息，检查是否是反爬虫页面
      if (this.isAntiCrawlerPage(html)) {
        this.logger.warn('🚫 检测到反爬虫页面，尝试等待并重试');

        // 等待更长时间，可能页面需要加载
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 尝试滚动页面触发内容加载
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight / 2);
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

        // 重新获取内容
        const newHtml = await page.content();
        const newTitle = await page.title();

        // 再次尝试直接解析
        const retryResult = this.extractProductInfoFromBrowserHTML(newHtml, newTitle, url);

        if (this.hasDefinitiveStockInfo(newHtml)) {
          this.logger.info('✅ 重试后检测到明确的库存信息，使用直接解析结果');
          return retryResult;
        } else if (this.isAntiCrawlerPage(newHtml)) {
          this.logger.warn('🚫 仍然是反爬虫页面，使用智能推断');
          return {
            success: true,
            title: this.extractTitleFromUrl(url),
            inStock: this.intelligentStockInference(newHtml),
            availability: 'Detected via intelligent inference'
          };
        } else {
          // 成功绕过反爬虫
          return retryResult;
        }
      } else {
        // 页面正常但没有明确库存信息，使用直接解析结果
        this.logger.info('📄 页面正常，使用直接解析结果');
        return directResult;
      }

    } catch (error: any) {
      this.logger.error(`❌ 浏览器检查失败: ${url}`, error);

      // 特殊处理 TargetCloseError - 保守策略，默认为缺货
      if (error.name === 'TargetCloseError' || error.message?.includes('Target closed')) {
        this.logger.warn('🔄 检测到浏览器连接中断，采用保守策略判断为缺货');
        return {
          success: true,
          title: this.extractTitleFromUrl(url),
          inStock: false, // 保守策略：连接失败时默认为缺货
          availability: 'Browser connection failed - assumed out of stock',
          error: 'Browser connection interrupted'
        };
      }

      return {
        success: false,
        title: this.extractTitleFromUrl(url),
        inStock: false,
        error: error.message || 'Browser check failed'
      };
    } finally {
      // 安全清理资源
      if (page) {
        try {
          if (!page.isClosed()) {
            await page.close();
          }
        } catch (closeError) {
          this.logger.warn('页面关闭时出错:', closeError);
        }
      }

      // 释放浏览器实例
      if (browserId) {
        try {
          this.browserManager.releaseBrowser();
        } catch (releaseError) {
          this.logger.warn('浏览器实例释放时出错:', releaseError);
        }
      }
    }
  }

  /**
   * 检查是否是反爬虫页面（改进版）
   */
  private isAntiCrawlerPage(html: string): boolean {
    const htmlLower = html.toLowerCase();

    // 严重的反爬虫指示器（这些出现就肯定是反爬虫页面）
    const severeIndicators = [
      'security verification',
      'access denied',
      'blocked',
      'captcha',
      'robot detection'
    ];

    // 检查严重指示器
    const hasSevereIndicator = severeIndicators.some(indicator =>
      htmlLower.includes(indicator)
    );

    // 如果有严重指示器，直接判定为反爬虫页面
    if (hasSevereIndicator) {
      return true;
    }

    // 轻微的反爬虫指示器（需要结合其他条件判断）
    const mildIndicators = [
      '/_fec_sbu/fec_wrapper.js',
      'fec_wrapper'
    ];

    const hasMildIndicator = mildIndicators.some(indicator =>
      htmlLower.includes(indicator)
    );

    // 如果内容太短，肯定是反爬虫页面
    if (html.length < 5000 || html.length === 21669) {
      return true;
    }

    // 如果有轻微指示器但内容丰富，需要进一步检查
    if (hasMildIndicator) {
      // 检查是否有真实的产品内容
      const hasRealContent = this.hasRealProductContent(html);
      // 如果有真实内容，就不算反爬虫页面
      return !hasRealContent;
    }

    return false;
  }

  /**
   * 检查是否有真实的产品内容
   */
  private hasRealProductContent(html: string): boolean {
    const htmlLower = html.toLowerCase();

    // 真实产品页面的指示器
    const realContentIndicators = [
      'product',
      'price',
      'description',
      'add to cart',
      'buy now',
      'out of stock',
      'sold out',
      'in stock',
      'available',
      'unavailable'
    ];

    // 至少需要有3个真实内容指示器
    const indicatorCount = realContentIndicators.filter(indicator =>
      htmlLower.includes(indicator)
    ).length;

    return indicatorCount >= 3;
  }

  /**
   * 检查是否有明确的库存信息
   */
  private hasDefinitiveStockInfo(html: string): boolean {
    const htmlLower = html.toLowerCase();

    // 明确的库存指示器
    const definitiveIndicators = [
      'add to cart',
      'buy now',
      'out of stock',
      'sold out',
      'unavailable',
      'coming soon',
      'in-app purchase only',
      'pick one to shake',
      'shake to pick',
      'notify me when available'
    ];

    // 只要有一个明确的指示器就算有明确信息
    return definitiveIndicators.some(indicator =>
      htmlLower.includes(indicator)
    );
  }

  /**
   * 从浏览器HTML提取产品信息
   */
  private extractProductInfoFromBrowserHTML(html: string, title: string, url: string): {
    success: boolean;
    title: string;
    inStock: boolean;
    price?: string;
    availability?: string;
  } {
    // 使用现有的HTML解析逻辑
    const productInfo = this.extractProductInfoFromHTML(html, url);

    // 如果标题提取失败，使用页面标题
    let finalTitle = productInfo.title;
    if (!finalTitle || finalTitle === 'Unknown Product') {
      finalTitle = title.replace(/\s*-\s*PopMart.*$/i, '').trim() || this.extractTitleFromUrl(url);
    }

    return {
      success: true,
      title: finalTitle,
      inStock: productInfo.inStock,
      price: productInfo.price,
      availability: productInfo.availability
    };
  }

  /**
   * 从URL提取标题
   */
  private extractTitleFromUrl(url: string): string {
    try {
      if (url.includes('/pop-now/set/')) {
        // 盲盒套装页面
        const setId = url.split('/').pop() || 'Unknown Set';
        return `PopMart 盲盒套装 ${setId}`;
      } else if (url.includes('/products/')) {
        // 普通产品页面
        const urlParts = url.split('/');
        const productPart = urlParts[urlParts.length - 1] || 'Unknown Product';
        return decodeURIComponent(productPart).replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      } else {
        return 'Unknown Product';
      }
    } catch {
      return 'Unknown Product';
    }
  }

  /**
   * 获取浏览器实例（带重试机制）
   */
  private async getBrowserWithRetry(maxRetries: number = 3): Promise<{ browser: any; page: Page; id: string }> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.info(`🔄 尝试获取浏览器实例 (${attempt}/${maxRetries})`);
        const browserInstance = await this.browserManager.getBrowser();

        // 验证浏览器实例是否有效
        if (browserInstance.page && !browserInstance.page.isClosed()) {
          this.logger.info(`✅ 浏览器实例获取成功 (尝试 ${attempt})`);
          return {
            browser: browserInstance.browser,
            page: browserInstance.page,
            id: `browser_${Date.now()}_${attempt}`
          };
        } else {
          throw new Error('Browser page is closed or invalid');
        }
      } catch (error) {
        lastError = error;
        this.logger.warn(`⚠️ 浏览器实例获取失败 (尝试 ${attempt}/${maxRetries}):`, error);

        if (attempt < maxRetries) {
          // 等待一段时间后重试
          const delay = Math.min(1000 * attempt, 5000); // 1s, 2s, 5s
          this.logger.info(`⏳ 等待 ${delay}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`Failed to get browser instance after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * 处理 cookie 同意按钮
   */
  private async handleCookieConsent(page: Page): Promise<void> {
    try {
      this.logger.info('🍪 开始处理 cookie 同意按钮...');

      // 等待页面完全加载
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 常见的 cookie 同意按钮选择器
      const cookieSelectors = [
        // PopMart 可能的选择器
        'button[id*="accept"]',
        'button[class*="accept"]',
        'button[id*="cookie"]',
        'button[class*="cookie"]',
        'button[id*="consent"]',
        'button[class*="consent"]',
        // 通用选择器
        '[data-testid*="accept"]',
        '[data-testid*="cookie"]',
        '[aria-label*="accept"]',
        '[aria-label*="Accept"]',
        'button:contains("Accept")',
        'button:contains("同意")',
        'button:contains("接受")',
        'button:contains("OK")',
        'button:contains("确定")',
        // 更宽泛的选择器
        'button[type="button"]',
        '.cookie-banner button',
        '.consent-banner button',
        '#cookie-banner button',
        '#consent-banner button'
      ];

      let cookieHandled = false;

      for (const selector of cookieSelectors) {
        try {
          // 检查按钮是否存在
          const button = await page.$(selector);
          if (button) {
            // 检查按钮是否可见
            const isVisible = await page.evaluate((el) => {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null;
            }, button);

            if (isVisible) {
              this.logger.info(`🍪 找到 cookie 按钮: ${selector}`);
              await button.click();
              await new Promise(resolve => setTimeout(resolve, 1000));
              cookieHandled = true;
              this.logger.info(`✅ 成功点击 cookie 按钮: ${selector}`);
              break;
            }
          }
        } catch (error) {
          // 忽略单个选择器的错误，继续尝试下一个
          continue;
        }
      }

      if (!cookieHandled) {
        this.logger.info('ℹ️ 未找到 cookie 同意按钮，可能页面不需要处理');
      }

      // 等待页面稳定
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      this.logger.warn('⚠️ Cookie 处理过程中出现错误:', error);
      // 不抛出错误，继续执行后续逻辑
    }
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    try {
      await OptimizedBrowserManager.closeAll();
      this.logger.info('✅ SGPM服务资源清理完成');
    } catch (error) {
      this.logger.error('❌ SGPM服务资源清理失败:', error);
    }
  }
}
