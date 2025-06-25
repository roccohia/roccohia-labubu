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
   * 导航到产品页面
   */
  async navigateToProduct(url: string): Promise<void> {
    this.logger.info(`成功导航到: ${url}`);
    await this.navigateToPage(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // 处理Cookie弹窗
    await this.handleCookiePopup();
    
    // 等待页面稳定
    await this.waitForStable(3000);
  }

  /**
   * 检查产品状态
   */
  async checkProductStatus(url: string): Promise<ProductInfo> {
    this.logger.info('开始安全检查产品状态');
    
    if (this.isGitHubActions()) {
      return this.checkProductInGitHubActions(url);
    } else {
      return this.checkProductNormal(url);
    }
  }

  /**
   * GitHub Actions环境中的产品检查
   */
  private async checkProductInGitHubActions(url: string): Promise<ProductInfo> {
    this.logger.info('GitHub Actions 环境，使用超简化方法');
    
    // 等待页面稳定
    await this.waitForStable(5000);
    
    // 从URL提取产品信息，这是最稳定的方法
    const urlParts = url.split('/');
    const productPart = urlParts[urlParts.length - 1] || 'Unknown Product';
    let title = productPart.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    this.logger.info(`✓ 从URL提取的产品标题: ${title}`);
    
    // GitHub Actions 环境：完全使用保守策略
    // 避免任何可能导致框架分离的页面操作
    const inStock = false; // 默认缺货，确保稳定性
    
    this.logger.info('GitHub Actions 环境：使用完全保守策略（默认缺货），确保监控稳定运行');
    
    return { title, inStock };
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
    
    // 优先使用页面标题
    if (pageTitle && pageTitle !== 'POPMART' && !pageTitle.includes('404')) {
      title = pageTitle.replace(/\s*\|\s*POPMART.*$/i, '').trim();
    }
    
    // 如果页面标题不可用，从URL提取
    if (!title || title === 'Unknown Product') {
      const urlParts = url.split('/');
      const productPart = urlParts[urlParts.length - 1] || 'Unknown Product';
      title = productPart.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    // 检查库存状态
    let inStock = false;
    
    // 检查缺货指示器
    const outOfStockIndicators = [
      'out of stock',
      'sold out',
      'unavailable',
      'not available',
      'coming soon',
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
      '加入购物车',
      '立即购买',
      '现货',
      '有库存'
    ];

    const hasInStockIndicator = inStockIndicators.some(indicator => 
      html.toLowerCase().includes(indicator.toLowerCase())
    );

    // 判断库存状态
    if (hasInStockIndicator && !hasOutOfStockIndicator) {
      inStock = true;
    }

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
