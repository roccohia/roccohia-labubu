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

// 主流程
export async function runSgpmJob() {
  // 始终使用 headless: 'new'，并加 --no-sandbox 避免云端报错
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const firstPage = await browser.newPage();
  const statusCache = loadStatusCache(sgpmConfig.statusFile);
  for (let i = 0; i < sgpmConfig.productUrls.length; i++) {
    const url = sgpmConfig.productUrls[i];
    const page = i === 0 ? firstPage : await browser.newPage();
    // 极致伪装：设置真实 UA、语言、时区、分辨率等
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      Object.defineProperty(navigator, 'language', { get: () => 'zh-CN' });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      (window as any).chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(screen, 'width', { get: () => 1920 });
      Object.defineProperty(screen, 'height', { get: () => 1080 });
      Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
      Object.defineProperty(screen, 'availHeight', { get: () => 1040 });
      Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
      Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
      // 伪装时区
      const date = Date;
      class NewDate extends date {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super();
            (this as any).getTimezoneOffset = () => -480;
          } else {
            // @ts-ignore
            super(...(args as [any]));
          }
        }
      }
      (window as any).Date = NewDate;
    });
    // 启用所有 Stealth evasions（已自动生效）
    // 添加常用浏览器启动参数（已在 proxyLauncher.ts 内 args 设置）
    try {
      console.log(`\n==============================`);
      console.log(`[INFO] 正在检查商品页面: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      // 只在第一个页面检测并关闭 Cookie 弹窗
      if (i === 0) {
        await handleCookiePopup(page);
      }
      const { title, inStock } = await checkProduct(page, url);
      if (statusCache[url] !== inStock) {
        statusCache[url] = inStock;
        saveStatusCache(sgpmConfig.statusFile, statusCache);
        if (inStock) {
          console.log(`\x1b[32m[SUCCESS] ✅ 有货！\x1b[0m`);
          // 推送到 Telegram
          const msg = `\uD83D\uDEA8 <b>PopMart 补货提醒</b>\n\n<b>商品：</b>${title}\n<b>链接：</b><a href=\"${url}\">${url}</a>\n<b>状态：</b><b>有货！</b>\n<b>时间：</b>${new Date().toLocaleString()}`;
          await sendTelegramMessage(msg);
        } else {
          console.log(`\x1b[33m[INFO] ❌ 暂无库存\x1b[0m`);
        }
      } else {
        console.log(`[INFO] 状态无变化，跳过推送`);
      }
      console.log(`商品：${title}`);
      console.log(`链接：${url}`);
      console.log(`状态：${inStock ? '有货' : '缺货'}`);
      console.log(`==============================\n`);
    } catch (e: any) {
      await page.screenshot({ path: `debug-popmart-${i}.png` });
      const html = await page.content();
      require('fs').writeFileSync(`debug-popmart-${i}.html`, html, 'utf-8');
      console.error(`[ERROR] 检查商品 ${url} 时出错: ${e.message}`);
    } finally {
      await page.close();
    }
  }
  await browser.close();
  console.log('[INFO] 浏览器已关闭');
}

// CLI 入口
if (require.main === module) {
  runSgpmJob();
} 