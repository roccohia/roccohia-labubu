#!/usr/bin/env ts-node
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { sendTelegramMessage } from '../utils/sendTelegramMessage';
import { logger, LoggerInstance } from '../utils/logger';
import fs from 'fs';
import { xhsConfig } from '../config';
import { launchWithRandomProxy } from '../utils/proxyLauncher';
import { StatusManager } from '../utils/statusManager';
import { Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

/**
 * 帖子数据接口
 */
interface PostData {
  url: string;
  previewTitle: string;
  publishTime?: string;
  author?: string;
  isRecent?: boolean;
}

/**
 * 提取结果接口
 */
interface ExtractionResult {
  posts: PostData[];
  success: boolean;
  error?: string;
}

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

/**
 * 提取所有帖子链接和标题，兼容多种结构
 * @param page - Puppeteer 页面对象
 * @returns 提取结果
 */
async function extractPosts(page: Page): Promise<ExtractionResult> {
  try {
    logger.debug('开始提取帖子数据');

    const posts = await page.evaluate(() => {
      const posts: PostData[] = [];
      const selectors = [
        'section.note-item',
        '.note-item',
        '.note-card',
        '[data-testid="note-item"]',
        '.feeds-page .note-item',
        '.search-item',
        '.note-list .item'
      ];

      // 尝试多种选择器
      let elements: NodeListOf<Element> | null = null;
      for (const selector of selectors) {
        elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log(`使用选择器: ${selector}, 找到 ${elements.length} 个元素`);
          break;
        }
      }

      if (!elements || elements.length === 0) {
        console.warn('未找到任何帖子元素');
        // 输出页面的基本信息用于调试
        console.log('页面标题:', document.title);
        console.log('页面URL:', window.location.href);
        console.log('页面HTML长度:', document.documentElement.outerHTML.length);
        console.log('可能的帖子容器:', document.querySelectorAll('div[class*="note"], div[class*="item"], section').length);

        // 尝试查找其他可能的选择器
        const alternativeSelectors = [
          '.note-item',
          '.search-item',
          '.feeds-item',
          '.content-item',
          '[class*="note"]',
          '[class*="item"]',
          '[class*="card"]'
        ];

        console.log('尝试其他选择器:');
        for (const selector of alternativeSelectors) {
          const count = document.querySelectorAll(selector).length;
          console.log(`  ${selector}: ${count} 个元素`);
        }

        // 输出页面的主要结构
        const bodyChildren = document.body.children;
        console.log(`页面主要结构 (${bodyChildren.length} 个子元素):`);
        for (let i = 0; i < Math.min(bodyChildren.length, 10); i++) {
          const child = bodyChildren[i];
          console.log(`  ${i}: <${child.tagName.toLowerCase()}> class="${child.className}" id="${child.id}"`);
        }

        return posts;
      }

      elements.forEach((section, index) => {
        try {
          // 抓取以 /explore/ 开头的直达链接
          const linkSelectors = [
            'a[href^="/explore/"]',
            'a[href*="/explore/"]',
            '.note-link',
            'a'
          ];

          let linkElement: HTMLAnchorElement | null = null;
          for (const linkSelector of linkSelectors) {
            linkElement = section.querySelector(linkSelector) as HTMLAnchorElement;
            if (linkElement && linkElement.href.includes('/explore/')) {
              break;
            }
          }

          // 抓取标题
          const titleSelectors = [
            'div.footer > a.title > span',
            'span.title',
            '.note-title',
            '.title',
            'span',
            '.text'
          ];

          let titleElement: HTMLElement | null = null;
          for (const titleSelector of titleSelectors) {
            titleElement = section.querySelector(titleSelector) as HTMLElement;
            if (titleElement && titleElement.innerText?.trim()) {
              break;
            }
          }

          // 抓取发布时间 - 使用更全面的小红书选择器和调试
          let publishTime = '';
          const timeSelectors = [
            'span[data-v-610be4fa][class="date"]',  // 精确匹配你提供的选择器
            'span.date[selected-disabled-search]',  // 带属性的选择器
            'span.date',  // 通用的 date 类选择器
            'span[class="date"]',  // 精确类匹配
            '[selected-disabled-search]',  // 通过特殊属性查找
            '.footer .time',
            '.note-time',
            '.publish-time',
            '.date',
            '.time',
            '[class*="time"]',
            '[class*="date"]',
            '.footer span:last-child',
            '.footer > span',
            '.note-item .footer span',
            '.footer .desc',
            '.desc',
            '.meta',
            '.info',
            '.note-meta',
            'span[class*="date"]',
            'div[class*="date"]'
          ];

          // 记录调试信息
          console.log(`开始查找时间信息，帖子标题: ${titleElement?.innerText?.trim()}`);

          for (const timeSelector of timeSelectors) {
            const timeElement = section.querySelector(timeSelector) as HTMLElement;
            if (timeElement && timeElement.innerText?.trim()) {
              const timeText = timeElement.innerText.trim();
              console.log(`检查选择器 ${timeSelector}: "${timeText}"`);

              // 验证是否看起来像时间格式，包含新的格式 "编辑于 6天前 新加坡"
              if (timeText.match(/\d+[分时天月年前]|ago|\d{1,2}[-/]\d{1,2}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|昨天|今天|前天|\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|编辑于\s*\d+[天小时分钟]前|编辑于\s*\d{2}-\d{2}|发布于|更新于/)) {
                publishTime = timeText;
                console.log(`✓ 找到发布时间: ${publishTime} 使用选择器: ${timeSelector}`);
                break;
              }

              // 特殊处理：如果包含数字和"w"（可能是浏览量），跳过
              if (timeText.match(/\d+\.?\d*w/)) {
                console.log(`跳过浏览量数据: ${timeText}`);
                continue;
              }
            }
          }

          // 如果没有找到时间，尝试从所有文本中提取
          if (!publishTime) {
            const allText = (section as HTMLElement).innerText || '';
            console.log(`未找到时间元素，从全文本中搜索: "${allText.substring(0, 200)}..."`);

            const timePatterns = [
              /(编辑于\s*\d+天前[^0-9]*)/,      // 匹配 "编辑于 6天前 新加坡"
              /(编辑于\s*\d+小时前[^0-9]*)/,    // 匹配 "编辑于 2小时前 新加坡"
              /(编辑于\s*\d+分钟前[^0-9]*)/,    // 匹配 "编辑于 30分钟前 新加坡"
              /(编辑于\s*\d{2}-\d{2}[^0-9]*)/,  // 匹配 "编辑于 06-15 新加坡"
              /(发布于\s*\d+天前[^0-9]*)/,      // 匹配 "发布于 X天前"
              /(发布于\s*\d{2}-\d{2}[^0-9]*)/,  // 匹配 "发布于 XX-XX"
              /(更新于\s*\d+天前[^0-9]*)/,      // 匹配 "更新于 X天前"
              /(更新于\s*\d{2}-\d{2}[^0-9]*)/,  // 匹配 "更新于 XX-XX"
              /(\d+分钟前)/,
              /(\d+小时前)/,
              /(\d+天前)/,
              /(\d+月前)/,
              /(\d+年前)/,
              /(昨天)/,
              /(今天)/,
              /(前天)/,
              /(\d{1,2}-\d{1,2})/,
              /(\d{4}-\d{1,2}-\d{1,2})/,
              /(\d{1,2}:\d{2})/,
              /(\d{4}年\d{1,2}月\d{1,2}日)/,
              /(\d{1,2}月\d{1,2}日)/,
              /(刚刚)/,
              /(\d+秒前)/
            ];

            for (const pattern of timePatterns) {
              const match = allText.match(pattern);
              if (match) {
                publishTime = match[1];
                console.log(`✓ 从文本中提取时间: ${publishTime}`);
                break;
              }
            }
          }

          // 如果还是没找到，输出详细调试信息
          if (!publishTime) {
            console.log(`❌ 未找到时间信息，帖子HTML:`, section.outerHTML.substring(0, 1000));
            console.log(`❌ 帖子所有文本内容:`, (section as HTMLElement).innerText?.substring(0, 500));

            // 尝试查找所有可能包含时间的元素
            const allSpans = section.querySelectorAll('span');
            console.log(`❌ 所有span元素内容:`, Array.from(allSpans).map(span => span.textContent?.trim()).filter(text => text));

            const allDivs = section.querySelectorAll('div');
            console.log(`❌ 所有div元素内容:`, Array.from(allDivs).slice(0, 10).map(div => div.textContent?.trim()).filter(text => text && text.length < 50));
          }

          // 抓取作者信息 - 使用更精确的小红书选择器
          let author = '';
          const authorSelectors = [
            '.author-wrapper .author-name',
            '.user-info .username',
            '.author',
            '.username',
            '.user-name',
            '.nickname',
            '[class*="author"]',
            '[class*="user"]',
            '.note-item .author',
            '.footer .author'
          ];

          for (const authorSelector of authorSelectors) {
            const authorElement = section.querySelector(authorSelector) as HTMLElement;
            if (authorElement && authorElement.innerText?.trim()) {
              const authorText = authorElement.innerText.trim();
              // 过滤掉明显不是作者名的文本
              if (authorText.length > 0 && authorText.length < 50 &&
                  !authorText.includes('点赞') && !authorText.includes('收藏') &&
                  !authorText.includes('分享') && !authorText.includes('评论')) {
                author = authorText;
                console.log(`找到作者: ${author} 使用选择器: ${authorSelector}`);
                break;
              }
            }
          }

          if (linkElement && titleElement && titleElement.innerText.trim()) {
            const url = linkElement.href.startsWith('http')
              ? linkElement.href
              : `https://www.xiaohongshu.com${linkElement.href}`;

            // 调试信息
            console.log(`提取帖子信息:`, {
              title: titleElement.innerText.trim(),
              publishTime: publishTime || '时间未知',
              author: author || '作者未知',
              url: url
            });

            // 检查时间是否在10小时内
            const isWithin10Hours = checkTimeWithin10Hours(publishTime || '时间未知');

            posts.push({
              url,
              previewTitle: titleElement.innerText.trim(),
              publishTime: publishTime || '时间未知',
              author: author || '作者未知',
              isRecent: isWithin10Hours
            });
          }
        } catch (error) {
          console.warn(`处理第 ${index} 个帖子元素时出错:`, error);
        }
      });

      return posts;
    });

    logger.debug(`成功提取 ${posts.length} 个帖子`);
    return {
      posts,
      success: true
    };

  } catch (error) {
    logger.error('提取帖子数据失败', error);
    return {
      posts: [],
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 检查时间是否在10小时内
 */
function checkTimeWithin10Hours(timeText: string): boolean {
  if (!timeText || timeText === '时间未知') {
    return false;
  }

  // 匹配不同的时间格式
  const patterns = [
    /(\d+)分钟前/,
    /(\d+)小时前/,
    /编辑于\s*(\d+)分钟前/,
    /编辑于\s*(\d+)小时前/,
    /发布于\s*(\d+)分钟前/,
    /发布于\s*(\d+)小时前/
  ];

  for (const pattern of patterns) {
    const match = timeText.match(pattern);
    if (match) {
      const value = parseInt(match[1]);
      if (timeText.includes('分钟前')) {
        return value <= 600; // 10小时 = 600分钟
      } else if (timeText.includes('小时前')) {
        return value <= 10;
      }
    }
  }

  // 如果是"刚刚"、"今天"等，认为是最近的
  if (timeText.includes('刚刚') || timeText.includes('今天')) {
    return true;
  }

  // 如果包含"天前"、"月前"、"年前"，认为不是最近的
  if (timeText.includes('天前') || timeText.includes('月前') || timeText.includes('年前')) {
    return false;
  }

  // 默认返回 true，避免错过重要信息
  console.log(`无法判断时间范围，默认保留: ${timeText}`);
  return true;
}

/**
 * 运行小红书 Labubu 监控任务
 * @param customLogger - 自定义日志记录器
 * @param debugMode - 调试模式
 */
export async function runLabubuJob(customLogger: LoggerInstance = logger, debugMode = false): Promise<void> {
  const startTime = Date.now();
  customLogger.info('=== 开始执行小红书 Labubu 监控任务 ===');

  try {
    const seenPostsManager = new StatusManager<string[]>(xhsConfig.seenPostsFile, customLogger, []);
    let seenPosts = seenPostsManager.get();
    let extractionResult: ExtractionResult;

    if (debugMode && process.env.XHS_REAL_TEST !== 'true') {
      customLogger.info('[DEBUG] 调试模式，使用模拟数据');
      extractionResult = {
        posts: [
          {
            url: 'https://www.xiaohongshu.com/post/1',
            previewTitle: 'Labubu 补货啦！速来 sg',
            publishTime: '2小时前',
            author: '新加坡购物达人'
          },
          {
            url: 'https://www.xiaohongshu.com/post/2',
            previewTitle: '无关内容',
            publishTime: '1天前',
            author: '普通用户'
          },
          {
            url: 'https://www.xiaohongshu.com/post/3',
            previewTitle: '新加坡 labubu 突击！',
            publishTime: '30分钟前',
            author: 'Labubu收藏家'
          },
        ],
        success: true
      };

      customLogger.debug('调试模式帖子数据', extractionResult.posts);
    } else {
      extractionResult = await scrapeXiaohongshu(customLogger);
    }

    if (!extractionResult.success) {
      customLogger.error('数据抓取失败', { error: extractionResult.error });
      return;
    }

    // 处理抓取到的帖子
    await processExtractedPosts(extractionResult.posts, seenPosts, seenPostsManager, customLogger);

    const duration = Date.now() - startTime;
    customLogger.success(`小红书监控任务完成，耗时: ${duration}ms`);

  } catch (error) {
    customLogger.error('小红书监控任务执行失败', error);
    throw error;
  }
}

/**
 * 抓取小红书数据
 * @param customLogger - 日志记录器
 * @returns 抓取结果
 */
async function scrapeXiaohongshu(customLogger: LoggerInstance): Promise<ExtractionResult> {
  let browser, page, proxy;

  try {
    customLogger.info('启动浏览器和代理');

    try {
      ({ browser, page, proxy } = await launchWithRandomProxy());

      if (proxy) {
        customLogger.info(`使用代理: ${proxy.ip}:${proxy.port}`);
      } else {
        customLogger.warn('未配置代理，可能影响小红书访问');
      }
    } catch (proxyError) {
      customLogger.warn('代理启动失败，尝试直接连接:', proxyError);

      // 备用方案：直接启动浏览器（无代理）
      browser = await puppeteer.launch({
        headless: true,
        args: [
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
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: null,
        timeout: 30000
      });

      page = await browser.newPage();
      proxy = null;

      customLogger.info('使用直接连接模式（无代理）');
    }

    // 设置代理认证（如果有代理）
    if (proxy?.username && proxy?.password) {
      await page.authenticate({
        username: proxy.username,
        password: proxy.password
      });
      customLogger.debug('代理认证设置完成');
    } else if (proxy) {
      customLogger.debug('代理无需认证');
    } else {
      customLogger.debug('无代理模式，跳过认证设置');
    }

    // 加载 cookies
    await loadCookies(page, customLogger);

    // 导航到搜索页面
    const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(xhsConfig.searchKeyword)}`;
    customLogger.info(`导航到搜索页: ${xhsConfig.searchKeyword}`);

    try {
      await page.goto(searchUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      customLogger.info('页面导航成功');
    } catch (navError) {
      customLogger.error('页面导航失败:', navError);
      throw navError;
    }

    // 等待页面加载完成
    customLogger.debug('等待页面内容加载');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // 检查页面状态
    const currentUrl = await page.url();
    const pageTitle = await page.title();
    customLogger.info(`当前页面URL: ${currentUrl}`);
    customLogger.info(`页面标题: ${pageTitle}`);

    // 尝试滚动加载更多内容
    await scrollToLoadMore(page, customLogger);

    // 提取帖子数据
    return await extractPosts(page);

  } catch (error) {
    customLogger.error(`抓取过程中发生错误 [代理: ${proxy?.ip}:${proxy?.port}]`, error);
    return {
      posts: [],
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
        customLogger.debug('浏览器已关闭');
      } catch (error) {
        customLogger.warn('关闭浏览器时出错', error);
      }
    }
  }
}

/**
 * 加载 cookies
 * @param page - 页面对象
 * @param customLogger - 日志记录器
 */
async function loadCookies(page: Page, customLogger: LoggerInstance): Promise<void> {
  try {
    if (fs.existsSync(xhsConfig.cookiesFile)) {
      const cookiesData = fs.readFileSync(xhsConfig.cookiesFile, 'utf-8');
      const cookies = JSON.parse(cookiesData);

      if (Array.isArray(cookies) && cookies.length > 0) {
        await page.setCookie(...cookies);
        customLogger.info(`已加载 ${cookies.length} 个 cookies`);
      } else {
        customLogger.warn('Cookies 文件为空或格式不正确');
      }
    } else {
      customLogger.info('未找到 cookies 文件，将使用默认状态访问');
    }
  } catch (error) {
    customLogger.warn('加载 cookies 失败', error);
  }
}

/**
 * 滚动页面以加载更多内容
 * @param page - 页面对象
 * @param customLogger - 日志记录器
 */
async function scrollToLoadMore(page: Page, customLogger: LoggerInstance): Promise<void> {
  try {
    customLogger.debug('开始滚动加载更多内容');

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    customLogger.debug('滚动加载完成');
  } catch (error) {
    customLogger.warn('滚动加载过程中出错', error);
  }
}

/**
 * 处理提取到的帖子数据
 * @param posts - 帖子列表
 * @param seenPosts - 已见过的帖子URL列表
 * @param seenPostsManager - 状态管理器
 * @param customLogger - 日志记录器
 */
async function processExtractedPosts(
  posts: PostData[],
  seenPosts: string[],
  seenPostsManager: StatusManager<string[]>,
  customLogger: LoggerInstance
): Promise<void> {
  if (posts.length === 0) {
    customLogger.info('未抓取到任何帖子');
    return;
  }

  customLogger.info(`开始处理 ${posts.length} 个帖子，进行关键词匹配和去重`);

  let found = false;
  const newlySentPosts: string[] = [];
  const matchedPosts: PostData[] = [];
  const duplicatePosts: PostData[] = [];

  // 分析帖子
  for (const post of posts) {
    try {
      const isKeywordMatch = xhsConfig.matchKeywords.some(keyword =>
        post.previewTitle.toLowerCase().includes(keyword.toLowerCase())
      );
      const isAlreadySeen = seenPosts.includes(post.url);

      if (isKeywordMatch) {
        // 检查时间是否在10小时内
        const isRecent = (post as any).isRecent !== false; // 默认为true，除非明确为false
        if (!isRecent) {
          customLogger.info(`跳过超过10小时的帖子: ${post.previewTitle} (${post.publishTime})`);
          continue;
        }

        matchedPosts.push(post);

        if (!isAlreadySeen) {
          customLogger.success(`发现新的关键词匹配帖子: ${post.previewTitle} (${post.publishTime})`);

          // 发送通知
          const message = formatTelegramMessage(post);
          await sendTelegramMessage(message);

          found = true;
          newlySentPosts.push(post.url);
        } else {
          duplicatePosts.push(post);
          customLogger.debug(`帖子已发送过，跳过: ${post.previewTitle}`);
        }
      }
    } catch (error) {
      customLogger.error(`处理帖子时出错: ${post.previewTitle}`, error);
    }
  }

  // 更新已发送列表
  if (newlySentPosts.length > 0) {
    await updateSeenPosts(newlySentPosts, seenPosts, seenPostsManager, customLogger);
  }

  // 输出统计信息
  customLogger.info(`处理完成 - 总帖子: ${posts.length}, 关键词匹配: ${matchedPosts.length}, 新发送: ${newlySentPosts.length}, 重复: ${duplicatePosts.length}`);

  if (!found) {
    customLogger.info('暂无符合条件的新帖子');
  }
}

/**
 * 格式化 Telegram 消息
 * @param post - 帖子数据
 * @returns 格式化的消息
 */
function formatTelegramMessage(post: PostData): string {
  const timestamp = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const author = post.author && post.author !== '作者未知' ? post.author : '未知作者';
  const publishTime = post.publishTime && post.publishTime !== '时间未知' ? post.publishTime : '时间未知';

  return `🚨 <b>小红书关键词新帖</b>

<b>📝 标题：</b>${post.previewTitle}
<b>👤 作者：</b>${author}
<b>📅 发布时间：</b>${publishTime}
<b>🔗 直达链接：</b><a href="${post.url}">点击查看</a>
<b>⏰ 推送时间：</b>${timestamp}`;
}

/**
 * 更新已发送帖子列表
 * @param newPosts - 新发送的帖子URL列表
 * @param currentSeenPosts - 当前已见过的帖子列表
 * @param seenPostsManager - 状态管理器
 * @param customLogger - 日志记录器
 */
async function updateSeenPosts(
  newPosts: string[],
  currentSeenPosts: string[],
  seenPostsManager: StatusManager<string[]>,
  customLogger: LoggerInstance
): Promise<void> {
  try {
    const maxSeenPosts = xhsConfig.maxSeenPosts || 500;
    const updatedSeenPosts = [...currentSeenPosts, ...newPosts];

    // 如果超过最大限制，移除最旧的记录
    if (updatedSeenPosts.length > maxSeenPosts) {
      const removeCount = updatedSeenPosts.length - maxSeenPosts;
      updatedSeenPosts.splice(0, removeCount);
      customLogger.debug(`移除了 ${removeCount} 个最旧的记录以保持列表大小`);
    }

    seenPostsManager.set(updatedSeenPosts);
    seenPostsManager.save();

    customLogger.info(`已更新 ${newPosts.length} 个新帖URL到 ${xhsConfig.seenPostsFile}`);
  } catch (error) {
    customLogger.error('更新已发送帖子列表失败', error);
    throw error;
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

