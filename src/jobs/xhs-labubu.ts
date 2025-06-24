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
        '.feeds-page .note-item'
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

          // 抓取发布时间 - 使用更精确的小红书选择器
          let publishTime = '';
          const timeSelectors = [
            '.footer .time',
            '.note-time',
            '.publish-time',
            '.date',
            '.time',
            '[class*="time"]',
            '[class*="date"]',
            '.footer span:last-child',
            '.footer > span',
            '.note-item .footer span'
          ];

          for (const timeSelector of timeSelectors) {
            const timeElement = section.querySelector(timeSelector) as HTMLElement;
            if (timeElement && timeElement.innerText?.trim()) {
              const timeText = timeElement.innerText.trim();
              // 验证是否看起来像时间格式
              if (timeText.match(/\d+[分时天月年前]|ago|\d{1,2}[-/]\d{1,2}|\d{4}[-/]\d{1,2}[-/]\d{1,2}/)) {
                publishTime = timeText;
                console.log(`找到发布时间: ${publishTime} 使用选择器: ${timeSelector}`);
                break;
              }
            }
          }

          // 如果没有找到时间，尝试从所有文本中提取
          if (!publishTime) {
            const allText = (section as HTMLElement).innerText || '';
            const timePatterns = [
              /(\d+分钟前)/,
              /(\d+小时前)/,
              /(\d+天前)/,
              /(\d+月前)/,
              /(\d+年前)/,
              /(\d{1,2}-\d{1,2})/,
              /(\d{4}-\d{1,2}-\d{1,2})/
            ];

            for (const pattern of timePatterns) {
              const match = allText.match(pattern);
              if (match) {
                publishTime = match[1];
                console.log(`从文本中提取时间: ${publishTime}`);
                break;
              }
            }
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

            posts.push({
              url,
              previewTitle: titleElement.innerText.trim(),
              publishTime: publishTime || '时间未知',
              author: author || '作者未知'
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

    if (debugMode) {
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
    ({ browser, page, proxy } = await launchWithRandomProxy());

    // 设置代理认证
    if (proxy?.username && proxy?.password) {
      await page.authenticate({
        username: proxy.username,
        password: proxy.password
      });
      customLogger.debug('代理认证设置完成');
    }

    // 加载 cookies
    await loadCookies(page, customLogger);

    // 导航到搜索页面
    const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(xhsConfig.searchKeyword)}`;
    customLogger.info(`导航到搜索页: ${xhsConfig.searchKeyword}`);

    await page.goto(searchUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // 等待页面加载完成
    customLogger.debug('等待页面内容加载');
    await new Promise(resolve => setTimeout(resolve, 8000));

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
        matchedPosts.push(post);

        if (!isAlreadySeen) {
          customLogger.success(`发现新的关键词匹配帖子: ${post.previewTitle}`);

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

