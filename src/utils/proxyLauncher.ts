import puppeteer, { Browser, Page } from 'puppeteer';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

export interface ProxyConfig {
  ip: string;
  port: number;
  username: string;
  password: string;
}

// 从环境变量加载代理配置
function loadProxyConfig(): ProxyConfig[] {
  const proxies: ProxyConfig[] = [];

  // 支持多个代理配置，格式：PROXY_1_IP, PROXY_1_PORT, PROXY_1_USERNAME, PROXY_1_PASSWORD
  let index = 1;
  while (process.env[`PROXY_${index}_IP`]) {
    const ip = process.env[`PROXY_${index}_IP`];
    const port = parseInt(process.env[`PROXY_${index}_PORT`] || '0');
    const username = process.env[`PROXY_${index}_USERNAME`];
    const password = process.env[`PROXY_${index}_PASSWORD`];

    if (ip && port && username && password) {
      proxies.push({ ip, port, username, password });
    }
    index++;
  }

  return proxies;
}

// 主代理池 - 从环境变量加载
const mainProxies: ProxyConfig[] = loadProxyConfig();

// 备用代理池（如有更多代理可补充）
const backupProxies: ProxyConfig[] = [
  // 可以在这里添加备用代理配置
];

/**
 * 尝试使用指定代理启动浏览器
 * @param proxy - 代理配置
 * @param headless - 无头模式设置
 * @returns 浏览器实例和页面对象，失败时返回 null
 */
async function tryLaunchWithProxy(proxy: ProxyConfig, headless: boolean | 'new' = 'new'): Promise<{ browser: Browser, page: Page, proxy: ProxyConfig } | null> {
  const optimizedArgs = [
    // 基础安全参数
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',

    // 性能优化
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

    // 反检测增强
    '--disable-blink-features=AutomationControlled',
    '--disable-features=VizDisplayCompositor',
    '--disable-infobars',
    '--disable-web-security',
    '--disable-features=site-per-process',
    '--ignore-certificate-errors',
    '--ignore-certificate-errors-spki-list',
    '--ignore-ssl-errors',
    '--allow-running-insecure-content',
    '--disable-component-extensions-with-background-pages',

    // 代理设置
    `--proxy-server=http://${proxy.ip}:${proxy.port}`,

    // 窗口设置
    '--window-position=0,0',
    '--window-size=1920,1080',

    // 用户代理
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];

  try {
    console.log(`尝试启动浏览器 [代理: ${proxy.ip}:${proxy.port}]`);

    const browser = await puppeteer.launch({
      headless: headless === 'new' ? true : headless,
      args: optimizedArgs,
      ignoreDefaultArgs: ['--enable-automation'],
      defaultViewport: null,
      timeout: 30000
    });

    const page = await browser.newPage();

    // 设置代理认证
    if (proxy.username && proxy.password) {
      await page.authenticate({
        username: proxy.username,
        password: proxy.password
      });
    }

    // 增强反检测设置
    await enhanceAntiDetection(page);

    // 简单的连接测试（不访问目标网站）
    await testProxyConnection(page);

    console.log(`浏览器启动成功 [代理: ${proxy.ip}:${proxy.port}]`);
    return { browser, page, proxy };

  } catch (error) {
    console.warn(`浏览器启动失败 [代理: ${proxy.ip}:${proxy.port}]:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * 增强反检测设置
 * @param page - 页面对象
 */
async function enhanceAntiDetection(page: Page): Promise<void> {
  try {
    // 设置视口
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false
    });

    // 设置用户代理
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 设置额外的 headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0'
    });

    // 注入反检测脚本
    await page.evaluateOnNewDocument(() => {
      // 移除 webdriver 标识
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // 伪造 plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // 伪造 languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en'],
      });

      // 伪造 permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission } as any) :
          originalQuery(parameters)
      );

      // 伪造 chrome 对象
      if (!(window as any).chrome) {
        (window as any).chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        };
      }
    });

  } catch (error) {
    console.warn('设置反检测功能时出错:', error);
  }
}

/**
 * 测试代理连接
 * @param page - 页面对象
 */
async function testProxyConnection(page: Page): Promise<void> {
  try {
    // 使用一个简单的测试页面而不是目标网站
    await page.goto('https://httpbin.org/ip', {
      waitUntil: 'networkidle2',
      timeout: 15000
    });

    const content = await page.content();
    if (content.includes('origin')) {
      console.log('代理连接测试成功');
    } else {
      throw new Error('代理连接测试失败');
    }
  } catch (error) {
    throw new Error(`代理连接测试失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function launchWithAutoProxy(options?: { headless?: boolean | 'new' }): Promise<{ browser: Browser, page: Page, proxy: ProxyConfig }> {
  const headless = options?.headless ?? 'new';

  // 检查是否有可用的代理配置
  if (mainProxies.length === 0 && backupProxies.length === 0) {
    throw new Error('未找到代理配置，请检查环境变量中的代理设置');
  }

  for (const proxy of mainProxies) {
    const result = await tryLaunchWithProxy(proxy, headless);
    if (result) return result;
  }
  for (const proxy of backupProxies) {
    const result = await tryLaunchWithProxy(proxy, headless);
    if (result) return result;
  }
  throw new Error('所有代理均不可用，请检查代理池配置');
}

export const launchWithRandomProxy = launchWithAutoProxy; 