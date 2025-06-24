#!/usr/bin/env ts-node
import { sgpmConfig } from '../config'
import puppeteer from 'puppeteer'
import { sendTelegramMessage } from '../utils/sendTelegramMessage'

// 只在第一个页面检测并点击 Cookie 弹窗
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

// 主流程
export async function runSgpmJob() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  for (let i = 0; i < sgpmConfig.productUrls.length; i++) {
    const url = sgpmConfig.productUrls[i];
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    try {
      console.log(`\n==============================`);
      console.log(`[INFO] 正在检查商品页面: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      if (i === 0) {
        await handleCookiePopup(page); // 只在第一个页面处理
      }
      const { title, inStock } = await checkProduct(page, url);
      if (inStock) {
        console.log(`\x1b[32m[SUCCESS] ✅ 有货！\x1b[0m`);
        // 推送到 Telegram
        const msg = `\uD83D\uDEA8 <b>PopMart 补货提醒</b>\n\n<b>商品：</b>${title}\n<b>链接：</b><a href=\"${url}\">${url}</a>\n<b>状态：</b><b>有货！</b>\n<b>时间：</b>${new Date().toLocaleString()}`;
        await sendTelegramMessage(msg);
      } else {
        console.log(`\x1b[33m[INFO] ❌ 暂无库存\x1b[0m`);
      }
      console.log(`商品：${title}`);
      console.log(`链接：${url}`);
      console.log(`状态：${inStock ? '有货' : '缺货'}`);
      console.log(`==============================\n`);
    } catch (e: any) {
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