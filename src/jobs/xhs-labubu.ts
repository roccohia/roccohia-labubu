#!/usr/bin/env ts-node
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { sendTelegramMessage } from '../utils/sendTelegramMessage'
import { logger, Logger } from '../utils/logger'
import fs from 'fs'
import { xhsConfig } from '../config'
import { launchWithRandomProxy } from '../utils/proxyLauncher'
import { StatusManager } from '../utils/statusManager'

puppeteer.use(StealthPlugin())

// 增强 stealth 配置
try {
  const stealth = StealthPlugin();
  // 可选：移除 navigator.webdriver
  stealth.enabledEvasions.delete('webdriver');
  // 可选：自定义 user-agent
  // puppeteer.use(stealth); // 已在下方 use
  puppeteer.use(stealth);
} catch (e) {
  logger.warn('StealthPlugin 配置增强失败: ' + (e instanceof Error ? e.message : String(e)));
}

// 提取所有帖子链接和标题，兼容多种结构
async function extractPosts(page: any) {
  return await page.evaluate(() => {
    const posts: { url: string, previewTitle: string }[] = [];
    document.querySelectorAll('section.note-item, .note-item, .note-card').forEach(section => {
      // 抓取以 /explore/ 开头的直达链接
      const a = section.querySelector('a[href^="/explore/"]') as HTMLAnchorElement | null;
      let span = section.querySelector('div.footer > a.title > span') as HTMLElement | null;
      if (!span) span = section.querySelector('span.title') as HTMLElement | null;
      if (!span) span = section.querySelector('span') as HTMLElement | null;
      if (a && span && span.innerText.trim()) {
        posts.push({
          url: a.href,
          previewTitle: span.innerText.trim()
        });
      }
    });
    return posts;
  });
}

export async function runLabubuJob(customLogger: Logger = logger, debugMode = false) {
  const seenPostsManager = new StatusManager<string[]>(xhsConfig.seenPostsFile, customLogger, []);
  let seenPosts = seenPostsManager.get();

  let posts: {url: string, previewTitle: string}[] = []

  if (debugMode) {
    customLogger.info('[DEBUG] 调试模式，使用模拟数据');
    posts = [
      { url: 'https://www.xiaohongshu.com/post/1', previewTitle: 'Labubu 补货啦！速来 sg' },
      { url: 'https://www.xiaohongshu.com/post/2', previewTitle: '无关内容' },
      { url: 'https://www.xiaohongshu.com/post/3', previewTitle: '新加坡 labubu 突击！' },
    ]
  } else {
    customLogger.info('--- 开始执行小红书Labubu监控任务 ---');
    const { browser, page, proxy } = await launchWithRandomProxy();
    try {
      if (proxy && proxy.username && proxy.password) {
        await page.authenticate({ username: proxy.username, password: proxy.password }); // 保证认证
      }
      let cookies = null;
      try {
        if (fs.existsSync(xhsConfig.cookiesFile)) {
          cookies = JSON.parse(fs.readFileSync(xhsConfig.cookiesFile, 'utf-8'));
        }
      } catch (e) {
        customLogger.warn('Cookies 文件读取失败: ' + (e instanceof Error ? e.message : String(e)));
      }
      if (cookies) {
        await page.setCookie(...cookies);
        customLogger.info('已加载小红书 cookies');
      }
      customLogger.info(`打开搜索页: ${xhsConfig.searchKeyword}`);
      await page.goto(`https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(xhsConfig.searchKeyword)}`, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      await new Promise(resolve => setTimeout(resolve, 8000));
      posts = await extractPosts(page);
      customLogger.info(`初步抓取到 ${posts.length} 个帖子`);
    } catch (e: any) {
      customLogger.error(`[代理 ${proxy.ip}:${proxy.port}] 执行任务时发生严重错误: ${e.message}`);
    } finally {
      try {
        await browser.close();
        customLogger.info('浏览器已关闭');
      } catch (e) {
        customLogger.warn('关闭浏览器时出错: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
  }

  // --- 2. 过滤和发送通知 ---
  let found = false;
  const newlySentPosts: string[] = [];

  if (posts.length > 0) {
    customLogger.info(`共抓取到 ${posts.length} 个帖子，将进行过滤和去重...`);
    for (const post of posts) {
      const isKeywordMatch = xhsConfig.matchKeywords.some(k => post.previewTitle.toLowerCase().includes(k.toLowerCase()));
      const isAlreadySeen = seenPosts.includes(post.url);

      if (isKeywordMatch && !isAlreadySeen) {
        const msg = `🚨 <b>小红书关键词新帖</b>\n\n<b>📝 标题：</b>${post.previewTitle}\n<b>🔗 直达链接：</b><a href="${post.url}">${post.url}</a>\n<b>⏰ 推送时间：</b>${new Date().toLocaleString()}`
        customLogger.success(`发现新帖: ${post.previewTitle}`);
        await sendTelegramMessage(msg);
        found = true;
        newlySentPosts.push(post.url);
      } else if (isKeywordMatch && isAlreadySeen) {
        customLogger.info(`帖子 "${post.previewTitle}" 已发送过，跳过。`);
      }
    }
  }
  
  // 3. 更新已发送列表
  if (newlySentPosts.length > 0) {
    // @ts-ignore
    const maxSeenPosts = xhsConfig.maxSeenPosts || 500;
    const updatedSeenPosts = [...seenPosts, ...newlySentPosts];
    if (updatedSeenPosts.length > maxSeenPosts) {
      updatedSeenPosts.splice(0, updatedSeenPosts.length - maxSeenPosts);
    }
    seenPostsManager.set(updatedSeenPosts);
    seenPostsManager.save();
    customLogger.info(`已将 ${newlySentPosts.length} 个新帖URL更新到 ${xhsConfig.seenPostsFile}`);
  }

  if (!found) {
    customLogger.info('暂无符合条件的关键词新帖')
  }
}

// CLI 入口
if (require.main === module) {
  if (process.env.NODE_ENV === 'production' && process.env.USE_PROXY !== 'true') {
    console.error('线上环境必须设置 USE_PROXY=true，所有请求必须走代理！');
    process.exit(1);
  }
  const debugMode = process.argv.includes('--debug') || process.env.DEBUG_MODE === 'true'
  runLabubuJob(logger, debugMode)
}

