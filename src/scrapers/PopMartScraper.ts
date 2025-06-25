import { Page } from 'puppeteer';
import { PageScraper } from '../core/PageScraper';
import { LoggerInstance } from '../utils/logger';

export interface ProductInfo {
  title: string;
  inStock: boolean;
}

/**
 * PopMart专用抓取器
 */
export class PopMartScraper extends PageScraper {
  constructor(page: Page, logger: LoggerInstance) {
    super(page, logger);
  }

  /**
   * 设置页面反检测
   */
  async setupPage(): Promise<void> {
    const page = (this as any).page;

    // 设置用户代理
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 设置视口
    await page.setViewport({ width: 1920, height: 1080 });

    // 监听框架分离事件
    page.on('framedetached', () => {
      this.logger.warn('检测到框架分离事件');
    });
  }

  /**
   * 导航到产品页面
   */
  async navigateToProduct(url: string): Promise<void> {
    this.logger.info(`正在检查商品页面: ${url}`);

    try {
      await this.navigateToPage(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.logger.info(`成功导航到: ${url}`);
    } catch (error) {
      this.logger.error(`导航失败: ${url}`, error);
      throw error;
    }

    // 处理Cookie弹窗
    await this.handleCookiePopup();

    // 等待页面元素加载
    this.logger.debug('等待页面元素加载');
    try {
      await this.waitForStable(3000);
    } catch (error) {
      this.logger.warn('页面元素等待过程中出错，继续执行:', error);
    }
  }

  /**
   * 检查产品状态
   */
  async checkProductStatus(url: string): Promise<ProductInfo> {
    this.logger.info('开始安全检查产品状态');

    // 统一使用正常检查方法，简化逻辑
    return this.checkProductNormal(url);
  }



  /**
   * 正常环境中的产品检查
   */
  private async checkProductNormal(url: string): Promise<ProductInfo> {
    try {
      await this.waitForStable(3000);
      
      const pageContent = await this.getPageContent();
      const pageTitle = await this.getPageTitle();
      const currentUrl = await this.getPageUrl();
      
      this.logger.info(`✓ 页面标题: ${pageTitle}`);
      this.logger.info(`✓ 当前URL: ${currentUrl}`);
      this.logger.info(`✓ 页面内容长度: ${pageContent.length}`);
      
      const result = this.extractProductInfoFromHTML(pageContent, pageTitle, url);
      this.logger.info(`✓ 产品信息提取结果:`, result);
      return result;
      
    } catch (error) {
      this.logger.warn(`本地方法失败: ${error instanceof Error ? error.message : String(error)}`);
      
      const urlParts = url.split('/');
      const productPart = urlParts[urlParts.length - 1] || 'Unknown Product';
      const title = productPart.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      
      return { title, inStock: false };
    }
  }

  /**
   * 从HTML内容中提取产品信息
   */
  private extractProductInfoFromHTML(html: string, pageTitle: string, url: string): ProductInfo {
    // 提取产品标题
    let title = 'Unknown Product';

    // 首先尝试从HTML中提取真实的产品标题
    const titlePatterns = [
      /<h1[^>]*class[^>]*title[^>]*>([^<]+)<\/h1>/i,
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<title>([^<]+)<\/title>/i,
      /"productName"\s*:\s*"([^"]+)"/i,
      /"title"\s*:\s*"([^"]+)"/i,
      /class="[^"]*title[^"]*"[^>]*>([^<]+)</i
    ];

    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        let extractedTitle = match[1].trim();
        // 清理标题
        extractedTitle = extractedTitle.replace(/\s*\|\s*POPMART.*$/i, '').trim();
        extractedTitle = extractedTitle.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

        if (extractedTitle.length > 3 && !extractedTitle.includes('POPMART') && !extractedTitle.includes('404')) {
          title = extractedTitle;
          this.logger.debug(`从HTML提取到产品标题: ${title}`);
          break;
        }
      }
    }

    // 如果HTML提取失败，使用页面标题
    if (title === 'Unknown Product' && pageTitle && pageTitle !== 'POPMART' && !pageTitle.includes('404')) {
      title = pageTitle.replace(/\s*\|\s*POPMART.*$/i, '').trim();
      this.logger.debug(`使用页面标题: ${title}`);
    }

    // 最后才从URL提取
    if (!title || title === 'Unknown Product' || title.length < 3) {
      const urlParts = url.split('/');
      const productPart = urlParts[urlParts.length - 1] || 'Unknown Product';
      title = decodeURIComponent(productPart).replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      this.logger.debug(`从URL提取产品标题: ${title}`);
    }

    // 检查库存状态
    let inStock = false;

    // 检查缺货指示器（包括新的IN-APP PURCHASE ONLY）
    const outOfStockIndicators = [
      'out of stock',
      'sold out',
      'unavailable',
      'not available',
      'coming soon',
      'notify me when available',
      'in-app purchase only',  // 新增：应用内购买专用
      'app purchase only',
      '缺货',
      '售罄',
      '暂无库存',
      'disabled',
      'btn-disabled'
    ];

    const hasOutOfStockIndicator = outOfStockIndicators.some(indicator =>
      html.toLowerCase().includes(indicator.toLowerCase())
    );

    // 检查有货指示器
    const inStockIndicators = [
      'add to cart',
      'add to bag',
      'buy now',
      'purchase',
      'in stock',
      'available',
      'pick one to shake',  // 新的盲盒抽取按钮
      'shake',
      'choose randomly',
      'random',
      '加入购物车',
      '立即购买',
      '现货',
      '有库存',
      '抽取',
      '随机选择'
    ];

    const hasInStockIndicator = inStockIndicators.some(indicator =>
      html.toLowerCase().includes(indicator.toLowerCase())
    );

    // 特别检查新的盲盒页面格式
    const hasShakeButton = html.includes('Pick One to Shake') ||
                          html.includes('chooseRandomlyBtn') ||
                          html.includes('ant-btn-primary');

    // 检查价格信息（有价格通常表示有货）
    const hasPricePattern = /\$\d+|\$\s*\d+|s\$\d+|s\$\s*\d+/i.test(html);

    // 特别检查IN-APP PURCHASE ONLY状态
    const hasInAppPurchaseOnly = html.toLowerCase().includes('in-app purchase only') ||
                                html.toLowerCase().includes('app purchase only');

    // 判断库存状态
    if (hasInAppPurchaseOnly) {
      inStock = false;
      this.logger.info('检测到"IN-APP PURCHASE ONLY"，判断为缺货（应用内购买专用）');
    } else if (hasShakeButton) {
      inStock = true;
      this.logger.info('检测到盲盒抽取按钮，判断为有货');
    } else if (hasInStockIndicator && !hasOutOfStockIndicator) {
      inStock = true;
      this.logger.info('检测到有货指示器，判断为有货');
    } else if (hasPricePattern && !hasOutOfStockIndicator) {
      inStock = true;
      this.logger.info('检测到价格信息且无缺货指示器，判断为有货');
    } else if (hasOutOfStockIndicator) {
      inStock = false;
      this.logger.info('检测到缺货指示器，判断为缺货');
    } else {
      inStock = false;
      this.logger.info('未检测到明确的库存信息，默认为缺货');
    }

    this.logger.info(`最终库存状态: ${inStock ? '有货' : '缺货'}`);
    return { title, inStock };
  }

  /**
   * 处理框架分离错误
   */
  async handleFrameDetached(): Promise<boolean> {
    if (await this.isFrameDetached()) {
      this.logger.warn('检测到框架分离事件');
      return true;
    }
    return false;
  }
}
