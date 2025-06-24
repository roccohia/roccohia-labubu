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

      // 每个产品检查后等待一段时间，避免被检测（减少等待时间提高效率）
      if (i < urls.length - 1) {
        const waitTime = process.env.NODE_ENV === 'production' ? 3000 : 2000; // 生产环境稍微保守一些
        console.log(`等待 ${waitTime/1000} 秒后检查下一个产品...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

    } catch (error) {
      console.error(`检查产品 ${url} 时出错:`, error);
      results.push({ status: 'rejected', reason: error });
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          console.warn('关闭页面时出错:', closeError);
        }
      }
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
 * 检查单个产品
 */
async function checkSingleProduct(page: any, url: string, statusCache: Record<string, boolean>) {
  try {
    console.log(`\n==============================`);
    console.log(`[INFO] 正在检查商品页面: ${url}`);

    // 导航到产品页面，使用更保守的策略
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 120000
    });

    // 等待页面稳定
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 处理可能的 Cookie 弹窗
    await handleCookiePopup(page);

    // 等待关键元素加载
    try {
      await page.waitForSelector('h1, .title, [class*="title"]', { timeout: 10000 });
    } catch (error) {
      console.warn('等待标题元素超时，继续执行');
    }

    // 再次等待确保页面完全加载
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 检查产品状态，使用更安全的方式
    const { title, inStock } = await checkProductSafely(page, url);

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

  } catch (error) {
    console.error(`[ERROR] 检查商品 ${url} 时出错:`, error);

    // 保存调试信息
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await page.screenshot({
        path: `debug-popmart-${timestamp}.png`,
        fullPage: true
      });

      const html = await page.content();
      require('fs').writeFileSync(`debug-popmart-${timestamp}.html`, html, 'utf-8');

      console.log(`调试文件已保存: debug-popmart-${timestamp}.png/html`);
    } catch (debugError) {
      console.warn('保存调试文件失败:', debugError);
    }

    throw error;
  }
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
 * 安全地检查产品状态，避免执行上下文被销毁的问题
 */
async function checkProductSafely(page: any, url: string): Promise<{ title: string; inStock: boolean }> {
  let retries = 3;

  while (retries > 0) {
    try {
      // 检查页面是否仍然可用
      await page.evaluate(() => document.readyState);

      // 等待关键元素加载
      await page.waitForSelector('body', { timeout: 10000 });

      // 尝试获取产品信息
      const result = await page.evaluate(() => {
        try {
          // 获取产品标题 - 使用更精确的选择器
          let title = '';
          const titleSelectors = [
            'h1[class*="index_title"]',  // PopMart 特定的标题选择器
            'h1.product-title',
            '.product-name',
            'h1',
            '.title',
            '[data-testid="product-title"]',
            '.product-detail-title',
            '.item-title'
          ];

          for (const selector of titleSelectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent?.trim()) {
              title = element.textContent.trim();
              console.log(`找到标题使用选择器: ${selector}, 标题: ${title}`);
              break;
            }
          }

          if (!title) {
            // 从页面标题获取，并清理
            const pageTitle = document.title || '';
            title = pageTitle.replace(/\s*\|\s*POPMART.*$/i, '').trim();
            console.log(`页面标题: "${pageTitle}", 清理后: "${title}"`);

            // 如果页面标题也没有有用信息，从 URL 提取
            if (!title || title === 'POPMART' || title.length < 3) {
              const urlParts = window.location.pathname.split('/');
              const productPart = urlParts[urlParts.length - 1];
              title = productPart.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown Product';
              console.log(`从URL提取标题: ${title}`);
            }
          }

          // 记录页面的基本信息用于调试
          console.log(`页面URL: ${window.location.href}`);
          console.log(`页面标题: ${document.title}`);
          console.log(`页面就绪状态: ${document.readyState}`);
          console.log(`页面HTML长度: ${document.documentElement.outerHTML.length}`);

          // 检查库存状态 - 使用更精确的 PopMart 特定逻辑
          let inStock = false;

          // 1. 检查添加到购物车按钮
          const addToCartSelectors = [
            'button[class*="index_addToCartBtn"]',  // PopMart 特定的添加按钮
            'button[data-testid="add-to-cart"]',
            '.add-to-cart',
            '.btn-add-cart',
            '.product-add-btn',
            'button[class*="addCart"]'
          ];

          for (const selector of addToCartSelectors) {
            const button = document.querySelector(selector);
            if (button) {
              const isDisabled = button.hasAttribute('disabled') ||
                               button.classList.contains('disabled') ||
                               window.getComputedStyle(button).pointerEvents === 'none';

              if (!isDisabled) {
                console.log(`找到可用的添加按钮: ${selector}`);
                inStock = true;
                break;
              } else {
                console.log(`找到但已禁用的按钮: ${selector}`);
              }
            }
          }

          // 2. 检查缺货相关的文本和元素
          const outOfStockSelectors = [
            '[class*="soldOut"]',
            '[class*="outOfStock"]',
            '.notify-me',
            '.sold-out'
          ];

          for (const selector of outOfStockSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              console.log(`找到缺货元素: ${selector}`);
              inStock = false;
              break;
            }
          }

          // 3. 检查缺货文本
          const outOfStockTexts = [
            'out of stock',
            'sold out',
            'unavailable',
            'notify me when available',
            '缺货',
            '售罄',
            'notify me'
          ];

          const pageText = document.body.textContent?.toLowerCase() || '';
          const foundOutOfStockText = outOfStockTexts.find(text =>
            pageText.includes(text.toLowerCase())
          );

          if (foundOutOfStockText) {
            console.log(`找到缺货文本: ${foundOutOfStockText}`);
            inStock = false;
          }

          // 4. 检查价格是否存在
          const priceSelectors = [
            '[class*="index_price"]',  // PopMart 特定的价格选择器
            '.price',
            '.product-price',
            '[data-testid="price"]',
            '.cost',
            '.amount'
          ];

          let hasPrice = false;
          let priceText = '';
          for (const selector of priceSelectors) {
            const priceElement = document.querySelector(selector);
            if (priceElement && priceElement.textContent) {
              priceText = priceElement.textContent;
              if (priceText.includes('$') || priceText.includes('S$')) {
                hasPrice = true;
                console.log(`找到价格: ${priceText} 使用选择器: ${selector}`);
                break;
              }
            }
          }

          // 5. 综合判断库存状态
          console.log(`库存判断 - 有添加按钮: ${inStock}, 有价格: ${hasPrice}, 页面文本包含缺货: ${!!foundOutOfStockText}`);

          // 如果没有明确的缺货标识，且有价格，则认为有货
          if (!foundOutOfStockText && hasPrice) {
            inStock = true;
          }

          return { title, inStock };
        } catch (error) {
          console.error('页面评估出错:', error);
          return { title: 'Error getting title', inStock: false };
        }
      });

      console.log(`产品信息获取成功: ${result.title}, 库存: ${result.inStock ? '有货' : '缺货'}`);
      return result;

    } catch (error) {
      retries--;
      console.warn(`获取产品信息失败，剩余重试次数: ${retries}`, error);

      if (retries > 0) {
        // 重新加载页面
        try {
          await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (reloadError) {
          console.warn('页面重新加载失败:', reloadError);
        }
      }
    }
  }

  // 所有重试都失败了，返回默认值
  console.error(`无法获取产品信息: ${url}`);
  return { title: 'Failed to get product info', inStock: false };
}

// CLI 入口
if (require.main === module) {
  runSgpmJob();
} 