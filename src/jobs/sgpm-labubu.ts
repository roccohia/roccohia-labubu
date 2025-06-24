#!/usr/bin/env ts-node
import { sgpmConfig } from '../config'
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { sendTelegramMessage } from '../utils/sendTelegramMessage'
import { launchWithRandomProxy } from '../utils/proxyLauncher'

puppeteer.use(StealthPlugin())

// 只在每个页面检测并点击 Cookie 弹窗
async function handleCookiePopup(page: any) {
  for (let i = 0; i < 15; i++) {
    // 1. 精确 class 检查
    const divBtn = await page.$('div[class*="policy_acceptBtn"]');
    if (divBtn) {
      await divBtn.click();
      console.log('[INFO] 已点击 Cookie 弹窗 (policy_acceptBtn)');
      return;
    }
    // 2. aria-label 检测
    const btn = await page.$('button[aria-label="Accept Cookies"]');
    if (btn) {
      await btn.click();
      console.log('[INFO] 已点击 Cookie 弹窗 (aria-label)');
      return;
    }
    // 3. 兼容所有包含 Accept 的按钮
    const acceptClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button,div'));
      for (const btn of btns) {
        if (btn.textContent && btn.textContent.toLowerCase().includes('accept')) {
          (btn as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    if (acceptClicked) {
      console.log('[INFO] 已点击 Cookie 弹窗 (textContent)');
      return;
    }
    await new Promise(res => setTimeout(res, 1000));
  }
  console.log('[INFO] 未发现 Cookie 弹窗，跳过');
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

    // 并发检查所有产品（限制并发数量以避免被检测）
    const concurrencyLimit = 2;
    const results = await processConcurrentProducts(browser, statusCache, concurrencyLimit);

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

  return await puppeteer.launch({
    headless: 'new',
    args: optimizedArgs,
    ignoreDefaultArgs: ['--enable-automation'],
    defaultViewport: null,
    timeout: 30000
  });
}

/**
 * 并发处理产品检查
 */
async function processConcurrentProducts(browser: any, statusCache: Record<string, boolean>, concurrencyLimit: number) {
  const urls = sgpmConfig.productUrls;
  const results = [];

  for (let i = 0; i < urls.length; i += concurrencyLimit) {
    const batch = urls.slice(i, i + concurrencyLimit);
    const batchPromises = batch.map(async (url, index) => {
      const page = await browser.newPage();
      try {
        await setupPageAntiDetection(page);
        return await checkSingleProduct(page, url, statusCache);
      } finally {
        await page.close();
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);
    results.push(...batchResults);

    // 批次间延迟，避免过于频繁的请求
    if (i + concurrencyLimit < urls.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  return results;
}

/**
 * 设置页面反检测
 */
async function setupPageAntiDetection(page: any): Promise<void> {
  // 设置用户代理和视口
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });

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
    if (!window.chrome) {
      window.chrome = {
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
    const originalDate = Date;
    class MockDate extends originalDate {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super();
        } else {
          super(...args);
        }
      }

      getTimezoneOffset() {
        return -480; // UTC+8
      }
    }
    window.Date = MockDate as any;
  });
}
/**
 * 检查单个产品
 */
async function checkSingleProduct(page: any, url: string, statusCache: Record<string, boolean>) {
  try {
    console.log(`\n==============================`);
    console.log(`[INFO] 正在检查商品页面: ${url}`);

    // 导航到产品页面
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });

    // 处理可能的 Cookie 弹窗
    await handleCookiePopup(page);

    // 检查产品状态
    const { title, inStock } = await checkProduct(page, url);

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

// CLI 入口
if (require.main === module) {
  runSgpmJob();
} 