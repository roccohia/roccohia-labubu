#!/usr/bin/env ts-node
import { sgpmConfig } from '../config'
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { sendTelegramMessage } from '../utils/sendTelegramMessage'
import { launchWithRandomProxy } from '../utils/proxyLauncher'

puppeteer.use(StealthPlugin())

/**
 * 处理 Cookie 弹窗，使用更安全的方式
 */
async function handleCookiePopup(page: any): Promise<void> {
  try {
    console.log('[INFO] 检查 Cookie 弹窗...');

    // 等待页面稳定（减少等待时间）
    await new Promise(resolve => setTimeout(resolve, 1000));

    const cookieSelectors = [
      'div[class*="policy_acceptBtn"]',
      'button[aria-label="Accept Cookies"]',
      'button[aria-label="Accept All Cookies"]',
      'button[id*="accept"]',
      'button[class*="accept"]',
      '.cookie-accept',
      '.accept-cookies',
      '#cookie-accept',
      '[data-testid="accept-cookies"]'
    ];

    for (let attempt = 0; attempt < 8; attempt++) {
      let found = false;

      // 首先尝试具体的选择器
      for (const selector of cookieSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            // 检查元素是否可见和可点击
            const isVisible = await page.evaluate((el: any) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 &&
                     window.getComputedStyle(el).visibility !== 'hidden' &&
                     window.getComputedStyle(el).display !== 'none';
            }, element);

            if (isVisible) {
              await element.click();
              console.log(`[INFO] 已点击 Cookie 弹窗: ${selector}`);
              await new Promise(resolve => setTimeout(resolve, 1000));
              found = true;
              break;
            }
          }
        } catch (error) {
          // 忽略单个选择器的错误，继续尝试其他选择器
          continue;
        }
      }

      // 如果具体选择器没找到，尝试通用方法
      if (!found) {
        try {
          const acceptClicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button,div,a'));
            for (const btn of btns) {
              const text = btn.textContent?.toLowerCase() || '';
              if (text.includes('accept') || text.includes('同意') || text.includes('确定')) {
                const rect = btn.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  (btn as HTMLElement).click();
                  return true;
                }
              }
            }
            return false;
          });

          if (acceptClicked) {
            console.log('[INFO] 已点击 Cookie 弹窗 (通用方法)');
            await new Promise(resolve => setTimeout(resolve, 1000));
            found = true;
          }
        } catch (error) {
          // 忽略评估错误
        }
      }

      if (found) {
        break;
      }

      // 等待一段时间后重试
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('[INFO] Cookie 弹窗处理完成');
  } catch (error) {
    console.warn('[WARN] 处理 Cookie 弹窗时出错:', error);
  }
}

// 判断商品库存状态
async function checkProduct(page: any, url: string): Promise<{ title: string, inStock: boolean, url: string }> {
  // 优先用 h1[class^="index_title"]，否则用 document.title
  let title = '';
  try {
    await page.waitForSelector('h1[class^="index_title"]', { timeout: 8000 });
    title = await page.$eval('h1[class^="index_title"]', (el: any) => el.textContent?.trim() || '');
  } catch {
    title = await page.title();
  }
  if (!title) title = '未知商品';

  // 检查页面是否有"NOTIFY ME WHEN AVAILABLE"或"IN-APP PURCHASE ONLY"
  const isOutOfStock = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('button,div,span'));
    return nodes.some(node => {
      const txt = node.textContent?.toUpperCase() || '';
      return txt.includes('NOTIFY ME WHEN AVAILABLE') || txt.includes('IN-APP PURCHASE ONLY');
    });
  });

  return { title, inStock: !isOutOfStock, url };
}

// 读取本地商品状态缓存
function loadStatusCache(file: string): Record<string, boolean> {
  try {
    if (require('fs').existsSync(file)) {
      return JSON.parse(require('fs').readFileSync(file, 'utf-8'));
    }
  } catch {}
  return {};
}
// 保存本地商品状态缓存
function saveStatusCache(file: string, data: Record<string, boolean>) {
  try {
    require('fs').writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {}
}

/**
 * 运行新加坡 PopMart 监控任务
 */
export async function runSgpmJob(): Promise<void> {
  const startTime = Date.now();
  console.log('=== 开始执行新加坡 PopMart Labubu 监控任务 ===');

  let browser;
  try {
    // 使用优化的浏览器启动参数
    browser = await launchOptimizedBrowser();
    const statusCache = loadStatusCache(sgpmConfig.statusFile);

    // 串行检查所有产品（避免并发导致的反爬虫检测）
    const results = await processProductsSequentially(browser, statusCache);

    // 保存更新的状态
    saveStatusCache(sgpmConfig.statusFile, statusCache);

    const duration = Date.now() - startTime;
    console.log(`\x1b[32m[SUCCESS] PopMart 监控任务完成，耗时: ${duration}ms\x1b[0m`);

  } catch (error) {
    console.error('\x1b[31m[ERROR] PopMart 监控任务执行失败:\x1b[0m', error);
    throw error;
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('\x1b[36m[INFO] 浏览器已关闭\x1b[0m');
      } catch (error) {
        console.warn('\x1b[33m[WARN] 关闭浏览器时出错:\x1b[0m', error);
      }
    }
  }
}

/**
 * 启动优化的浏览器实例
 */
async function launchOptimizedBrowser() {
  const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

  console.log('[INFO] PopMart 监控不使用代理，直接连接');

  const optimizedArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=TranslateUI',
    '--disable-ipc-flooding-protection',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-translate',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=VizDisplayCompositor',
    '--disable-infobars',
    '--disable-web-security',
    '--ignore-certificate-errors',
    '--ignore-certificate-errors-spki-list',
    '--window-size=1920,1080'
  ];

  // GitHub Actions 环境的特殊配置
  if (isGitHubActions) {
    optimizedArgs.push(
      '--disable-features=VizDisplayCompositor',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=site-per-process',
      '--single-process', // 在 CI 环境中使用单进程模式
      '--no-zygote'
    );
    console.log('[INFO] 检测到 GitHub Actions 环境，使用特殊配置');
  }

  // 不使用代理，直接启动浏览器
  return await puppeteer.launch({
    headless: true,
    args: optimizedArgs,
    ignoreDefaultArgs: ['--enable-automation'],
    defaultViewport: null,
    timeout: 30000
  });
}

/**
 * 串行处理产品检查（避免并发导致的反爬虫检测）
 */
async function processProductsSequentially(browser: any, statusCache: Record<string, boolean>) {
  const urls = sgpmConfig.productUrls;
  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    let page;

    try {
      page = await browser.newPage();
      await setupPageAntiDetection(page);

      const result = await checkSingleProduct(page, url, statusCache);
      results.push({ status: 'fulfilled', value: result });

    } catch (error) {
      console.error(`检查产品 ${url} 时出错:`, error);
      results.push({ status: 'rejected', reason: error });

      // 保存调试信息
      if (page) {
        try {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          await page.screenshot({
            path: `debug-popmart-error-${timestamp}.png`,
            fullPage: true
          });

          const html = await page.content();
          require('fs').writeFileSync(`debug-popmart-error-${timestamp}.html`, html, 'utf-8');

          console.log(`调试文件已保存: debug-popmart-error-${timestamp}.png/html`);
        } catch (debugError) {
          console.warn('保存调试文件失败:', debugError);
        }
      }
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          console.warn('关闭页面时出错:', closeError);
        }
      }
    }

    // 每个产品检查后等待一段时间，避免被检测（减少等待时间提高效率）
    if (i < urls.length - 1) {
      const waitTime = process.env.NODE_ENV === 'production' ? 3000 : 2000;
      console.log(`等待 ${waitTime/1000} 秒后检查下一个产品...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  return results;
}

/**
 * 设置页面反检测
 */
async function setupPageAntiDetection(page: any): Promise<void> {
  // 随机化用户代理
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
  ];

  const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
  await page.setUserAgent(randomUA);

  // 随机化视口大小
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 }
  ];

  const randomViewport = viewports[Math.floor(Math.random() * viewports.length)];
  await page.setViewport(randomViewport);

  // 设置额外的 headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Sec-Fetch-Dest': 'document'
  });

  // 注入反检测脚本
  await page.evaluateOnNewDocument(() => {
    // 移除 webdriver 标识
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // 伪造基本属性
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'zh-CN', 'zh'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

    // 伪造 chrome 对象
    if (!(window as any).chrome) {
      (window as any).chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
      };
    }

    // 伪造 plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // 伪造屏幕属性
    Object.defineProperty(screen, 'width', { get: () => 1920 });
    Object.defineProperty(screen, 'height', { get: () => 1080 });
    Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
    Object.defineProperty(screen, 'availHeight', { get: () => 1040 });
    Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
    Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });

    // 伪装时区（新加坡时区 UTC+8）
    const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function() {
      return -480; // UTC+8 新加坡时区
    };
  });
}
/**
 * 检查单个产品 - 增强的错误处理和重试机制
 */
async function checkSingleProduct(page: any, url: string, statusCache: Record<string, boolean>) {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`\n==============================`);
      console.log(`[INFO] 正在检查商品页面: ${url} (尝试 ${attempt}/${maxRetries})`);

      // 重新创建页面上下文（如果不是第一次尝试）
      if (attempt > 1) {
        console.log(`[INFO] 第 ${attempt} 次尝试，重新初始化页面...`);
        try {
          await page.close();
        } catch (closeError) {
          console.warn('关闭页面时出错:', closeError);
        }
        const browser = page.browser();
        page = await browser.newPage();
        await setupPageAntiDetection(page);
      }

      // 导航到产品页面，使用更保守的策略
      await navigateToProductPage(page, url);

      // 处理可能的 Cookie 弹窗
      await handleCookiePopup(page);

      // 等待关键元素加载（如果失败不影响后续流程）
      await waitForPageElements(page);

      // 检查产品状态，使用更安全的方式
      const { title, inStock } = await checkProductSafely(page, url);

      // 如果成功获取到信息，处理结果
      return await processProductResult(title, inStock, url, statusCache);

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[ERROR] 第 ${attempt} 次尝试失败:`, lastError.message);

      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000; // 指数退避
        console.log(`[INFO] 等待 ${waitTime/1000} 秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  // 所有重试都失败了
  console.error(`[ERROR] 检查商品 ${url} 失败，已达到最大重试次数`);
  throw lastError || new Error('未知错误');
}

/**
 * 安全地导航到产品页面
 */
async function navigateToProductPage(page: any, url: string): Promise<void> {
  try {
    // 设置页面事件监听器
    page.on('framedetached', () => {
      console.warn('[WARN] 检测到框架分离事件');
    });

    page.on('error', (error: Error) => {
      console.warn('[WARN] 页面错误:', error.message);
    });

    // 导航到页面
    await page.goto(url, {
      waitUntil: 'domcontentloaded', // 改用更快的等待策略
      timeout: 60000
    });

    // 等待页面稳定
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 验证页面是否正确加载
    const currentUrl = await page.url();
    if (!currentUrl.includes('popmart.com')) {
      throw new Error(`页面导航失败，当前URL: ${currentUrl}`);
    }

    console.log(`[INFO] 成功导航到: ${currentUrl}`);

  } catch (error) {
    console.error('[ERROR] 页面导航失败:', error);
    throw error;
  }
}

/**
 * 等待页面关键元素加载 - 增强的错误处理
 */
async function waitForPageElements(page: any): Promise<void> {
  try {
    // 首先检查页面是否仍然可用
    await page.evaluate(() => document.readyState);

    // 使用更短的超时时间，避免长时间等待分离的框架
    const shortTimeout = 5000;

    // 尝试等待元素，但不强制要求成功
    try {
      await Promise.race([
        page.waitForSelector('h1', { timeout: shortTimeout }),
        page.waitForSelector('[class*="title"]', { timeout: shortTimeout }),
        page.waitForSelector('.product-name', { timeout: shortTimeout }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), shortTimeout))
      ]);
      console.log('[INFO] 页面关键元素已加载');
    } catch (elementError) {
      console.warn('[WARN] 等待特定元素失败，使用通用等待策略');
      // 如果特定元素等待失败，只是简单等待一段时间
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

  } catch (error) {
    console.warn('[WARN] 页面元素等待过程中出错，继续执行:', error instanceof Error ? error.message : String(error));
    // 即使出错也要等待一段时间确保页面稳定
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

/**
 * 处理产品检查结果
 */
async function processProductResult(title: string, inStock: boolean, url: string, statusCache: Record<string, boolean>) {

  // 检查状态是否发生变化
  const previousStatus = statusCache[url];
  if (previousStatus !== inStock) {
    statusCache[url] = inStock;

    if (inStock) {
      console.log(`\x1b[32m[SUCCESS] ✅ 有货！\x1b[0m`);

      // 发送补货通知
      const message = formatStockMessage(title, url, true);
      await sendTelegramMessage(message);
    } else {
      console.log(`\x1b[33m[INFO] ❌ 暂无库存\x1b[0m`);
    }
  } else {
    console.log(`[INFO] 状态无变化 (${inStock ? '有货' : '缺货'})，跳过推送`);
  }

  // 输出商品信息
  console.log(`商品：${title}`);
  console.log(`链接：${url}`);
  console.log(`状态：${inStock ? '有货' : '缺货'}`);
  console.log(`==============================\n`);

  return { title, inStock, url };
}

/**
 * 格式化库存消息
 */
function formatStockMessage(title: string, url: string, inStock: boolean): string {
  const timestamp = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const status = inStock ? '<b>有货！</b>' : '暂无库存';
  const emoji = inStock ? '🚨' : 'ℹ️';

  return `${emoji} <b>PopMart 库存更新</b>

<b>商品：</b>${title}
<b>状态：</b>${status}
<b>链接：</b><a href="${url}">点击查看</a>
<b>时间：</b>${timestamp} (新加坡时间)`;
}

/**
 * 安全地检查产品状态 - 使用多种方法避免框架分离问题
 */
async function checkProductSafely(page: any, url: string): Promise<{ title: string; inStock: boolean }> {
  console.log('[INFO] 开始安全检查产品状态');

  let pageContent = '';
  let pageTitle = '';
  let currentUrl = '';

  // 方法1: 尝试直接获取页面信息
  try {
    console.log('[INFO] 尝试方法1: 直接获取页面信息');
    await new Promise(resolve => setTimeout(resolve, 3000));

    pageContent = await page.content();
    pageTitle = await page.title();
    currentUrl = await page.url();

    console.log(`✓ 方法1成功 - 页面标题: ${pageTitle}`);
    console.log(`✓ 当前URL: ${currentUrl}`);
    console.log(`✓ 页面内容长度: ${pageContent.length}`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`✗ 方法1失败: ${errorMessage}`);

    // 如果是框架分离错误，尝试重新创建页面
    if (errorMessage.includes('detached Frame')) {
      console.log('[INFO] 检测到框架分离，尝试重新创建页面...');
      try {
        const browser = page.browser();
        await page.close();
        page = await browser.newPage();
        await setupPageAntiDetection(page);

        // 重新导航到页面
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 再次尝试获取内容
        pageContent = await page.content();
        pageTitle = await page.title();
        currentUrl = await page.url();

        console.log(`✓ 页面重建成功 - 页面标题: ${pageTitle}`);
        console.log(`✓ 当前URL: ${currentUrl}`);
        console.log(`✓ 页面内容长度: ${pageContent.length}`);

      } catch (rebuildError) {
        console.log(`✗ 页面重建失败: ${rebuildError instanceof Error ? rebuildError.message : String(rebuildError)}`);

        // 方法3: 从URL提取基本信息
        console.log('[INFO] 使用方法3: 从URL提取基本信息');
        const urlParts = url.split('/');
        const productPart = urlParts[urlParts.length - 1] || 'Unknown Product';
        const title = productPart.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        return {
          title: title,
          inStock: false // 默认为缺货
        };
      }
    } else {
      // 方法2: 使用evaluate获取基本信息
      try {
        console.log('[INFO] 尝试方法2: 使用evaluate获取基本信息');

        const basicInfo = await page.evaluate(() => {
          return {
            title: document.title || '',
            url: window.location.href || '',
            bodyText: document.body ? document.body.innerText.substring(0, 5000) : '',
            htmlLength: document.documentElement ? document.documentElement.outerHTML.length : 0
          };
        });

        pageTitle = basicInfo.title;
        currentUrl = basicInfo.url;
        pageContent = `<html><head><title>${basicInfo.title}</title></head><body>${basicInfo.bodyText}</body></html>`;

        console.log(`✓ 方法2成功 - 页面标题: ${pageTitle}`);
        console.log(`✓ 当前URL: ${currentUrl}`);
        console.log(`✓ 页面文本长度: ${basicInfo.bodyText.length}`);

      } catch (error2) {
        console.log(`✗ 方法2失败: ${error2 instanceof Error ? error2.message : String(error2)}`);

        // 方法3: 从URL提取基本信息
        console.log('[INFO] 使用方法3: 从URL提取基本信息');
        const urlParts = url.split('/');
        const productPart = urlParts[urlParts.length - 1] || 'Unknown Product';
        const title = productPart.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        return {
          title: title,
          inStock: false // 默认为缺货
        };
      }
    }
  }

  // 从获取的内容中提取产品信息
  try {
    const result = extractProductInfoFromHTML(pageContent, pageTitle, url);
    console.log(`✓ 产品信息提取结果:`, result);
    return result;
  } catch (extractError) {
    console.error('[ERROR] 产品信息提取失败:', extractError);

    // 最后的备用方案
    const urlParts = url.split('/');
    const productPart = urlParts[urlParts.length - 1] || 'Unknown Product';
    const title = productPart.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    return {
      title: title,
      inStock: false
    };
  }
}

/**
 * 从HTML内容中提取产品信息
 */
function extractProductInfoFromHTML(html: string, pageTitle: string, url: string): { title: string; inStock: boolean } {
  console.log('[INFO] 从HTML内容中提取产品信息');

  // 提取产品标题
  let title = '';

  // 从页面标题提取
  if (pageTitle && pageTitle !== 'POPMART') {
    title = pageTitle.replace(/\s*\|\s*POPMART.*$/i, '').trim();
  }

  // 如果页面标题没有有用信息，从URL提取
  if (!title || title.length < 3) {
    const urlParts = url.split('/');
    const productPart = urlParts[urlParts.length - 1] || '';
    title = productPart.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  // 检查库存状态
  let inStock = false;

  // 检查HTML中的关键词
  const htmlLower = html.toLowerCase();

  // 缺货关键词
  const outOfStockKeywords = [
    'out of stock',
    'sold out',
    'unavailable',
    'notify me when available',
    'notify me',
    'coming soon'
  ];

  const hasOutOfStockKeyword = outOfStockKeywords.some(keyword =>
    htmlLower.includes(keyword)
  );

  // 有货关键词
  const inStockKeywords = [
    'add to cart',
    'add to bag',
    'buy now',
    'purchase',
    'in stock'
  ];

  const hasInStockKeyword = inStockKeywords.some(keyword =>
    htmlLower.includes(keyword)
  );

  // 价格检查
  const hasPricePattern = /\$\d+|\$\s*\d+|s\$\d+|s\$\s*\d+/i.test(html);

  // 综合判断
  if (hasOutOfStockKeyword) {
    inStock = false;
    console.log('[INFO] 检测到缺货关键词');
  } else if (hasInStockKeyword && hasPricePattern) {
    inStock = true;
    console.log('[INFO] 检测到有货关键词和价格');
  } else if (hasPricePattern) {
    inStock = true;
    console.log('[INFO] 检测到价格，推测有货');
  } else {
    inStock = false;
    console.log('[INFO] 未检测到明确的库存信息，默认为缺货');
  }

  console.log(`最终结果 - 标题: ${title}, 库存: ${inStock ? '有货' : '缺货'}`);

  return { title, inStock };
}



// CLI 入口
if (require.main === module) {
  runSgpmJob();
} 