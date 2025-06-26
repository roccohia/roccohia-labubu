import { LoggerInstance } from '../utils/logger';
import { SgpmConfig } from '../types';
import { getSgpmEnvConfig } from '../config-sgpm';
import { StatusManager } from '../utils/statusManager';
import { sendTelegramMessage } from '../utils/sendTelegramMessage';
import { productCache, globalCache } from '../utils/OptimizedCacheManager';
import axios from 'axios';

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
   * 优化的单产品检查
   */
  private async checkSingleProductOptimized(url: string): Promise<ProductCheckResult> {
    this.stats.totalChecks++;
    
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
    
    // 2. 网络请求 - 使用原始axios方法，与原始SgmpService保持一致
    this.stats.networkRequests++;
    this.logger.debug(`🌐 网络请求: ${url}`);

    try {
      // 使用完整的浏览器headers，不使用代理
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0',
          'DNT': '1',
          'Referer': 'https://www.popmart.com/'
        },
        timeout: this.config.timeout,
        validateStatus: (status) => status < 500,
        maxRedirects: 5
      });

      this.logger.info(`✅ 网络请求成功: ${url} (状态: ${response.status})`);

      // 检查响应状态码，与原始SgpmService保持一致
      if (response.status >= 200 && response.status < 400) {
        const html = response.data;
        this.logger.info(`📄 HTML内容长度: ${html.length} 字符`);

        // 简单检查：如果HTML太短，可能是错误页面
        if (html.length < 1000) {
          this.logger.warn(`⚠️ HTML内容过短，可能是错误页面: ${url}`);
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

        const productInfo = this.extractProductInfoFromHTML(html, url);
        this.logger.info(`🔍 产品检测结果: ${productInfo.title} - ${productInfo.inStock ? '✅ 有货' : '❌ 缺货'}`);

        // 3. 缓存结果
        productCache.set(cacheKey, {
          title: productInfo.title,
          inStock: productInfo.inStock
        }, 5 * 60 * 1000); // 5分钟产品缓存

        return {
          url,
          title: productInfo.title,
          inStock: productInfo.inStock,
          price: productInfo.price,
          availability: productInfo.availability,
          checkTime: Date.now(),
          fromCache: false
        };
      } else {
        // 状态码不是2xx或3xx，使用fallback
        this.logger.warn(`HTTP请求状态码异常 (${response.status}): ${url}`);
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

    // 提取价格信息
    let price: string | undefined;
    const pricePatterns = [
      /S\$\s*(\d+(?:\.\d{2})?)/i,
      /\$\s*(\d+(?:\.\d{2})?)/i,
      /"price"\s*:\s*"?(\d+(?:\.\d{2})?)"?/i
    ];

    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        price = `S$${match[1]}`;
        break;
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
   * 从HTML检查库存状态（增强版）
   */
  private checkStockFromHTML(html: string): boolean {
    const htmlLower = html.toLowerCase();

    this.logger.info(`📄 HTML内容长度: ${html.length} 字符`);
    const htmlPreview = html.substring(0, 300).replace(/\s+/g, ' ');
    this.logger.info(`📄 HTML预览: ${htmlPreview}...`);

    // 检查是否是反爬虫页面
    const isAntiCrawler = html.includes('/_fec_sbu/fec_wrapper.js') ||
                         html.includes('fec_wrapper') ||
                         html.length < 5000;

    if (isAntiCrawler) {
      this.logger.warn('🚫 检测到反爬虫页面，无法获取真实库存信息');
      return false;
    }

    // 库存检测指示器
    const outOfStockIndicators = [
      'out of stock', 'sold out', 'unavailable', 'coming soon',
      'in-app purchase only', 'notify me when available', '缺货', '售罄'
    ];

    const inStockIndicators = [
      'add to cart', 'buy now', 'purchase', 'in stock', 'available',
      'pick one to shake', 'shake to pick', 'add to bag', 'shop now',
      '立即购买', '加入购物车', '现货'
    ];

    const hasOutOfStock = outOfStockIndicators.some(indicator =>
      htmlLower.includes(indicator)
    );
    const hasInStock = inStockIndicators.some(indicator =>
      htmlLower.includes(indicator)
    );

    // 检查价格信息
    const hasPrice = /S\$\d+|\$\d+|SGD\s*\d+/i.test(html);

    // 检查盲盒按钮
    const hasShakeButton = /pick\s+one\s+to\s+shake/i.test(html) ||
                          /shake\s+to\s+pick/i.test(html) ||
                          /chooseRandomlyBtn/i.test(html);

    this.logger.info(`🔍 库存检测详情:`);
    this.logger.info(`   - 缺货指示器: ${hasOutOfStock}`);
    this.logger.info(`   - 有货指示器: ${hasInStock}`);
    this.logger.info(`   - 价格信息: ${hasPrice}`);
    this.logger.info(`   - 抽取按钮: ${hasShakeButton}`);

    // 判断逻辑
    if (hasShakeButton) {
      this.logger.info('✅ 检测结果: 有货 (盲盒抽取按钮)');
      return true;
    }

    if (hasInStock && !hasOutOfStock) {
      this.logger.info('✅ 检测结果: 有货 (有货指示器)');
      return true;
    }

    if (hasPrice && !hasOutOfStock) {
      this.logger.info('✅ 检测结果: 有货 (价格信息)');
      return true;
    }

    if (hasOutOfStock) {
      this.logger.info('❌ 检测结果: 缺货 (缺货指示器)');
      return false;
    }

    this.logger.info('❌ 检测结果: 缺货 (默认)');
    return false;
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
}
