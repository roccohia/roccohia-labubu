import puppeteer, { Browser, Page } from 'puppeteer';

export interface ProxyConfig {
  ip: string;
  port: number;
  username: string;
  password: string;
}

// 主代理池
const mainProxies: ProxyConfig[] = [
  {
    ip: '112.28.237.135',
    port: 35226,
    username: 'uOXiWasQBg_1',
    password: 'lV2IgHZ1',
  },
  {
    ip: '112.28.237.136',
    port: 30010,
    username: 'uOXiWasQBg_3',
    password: 'lV2IgHZ1',
  },
  {
    ip: '112.28.237.136',
    port: 39142,
    username: 'uOXiWasQBg_2',
    password: 'lV2IgHZ1',
  },
];
// 备用代理池（如有更多代理可补充）
const backupProxies: ProxyConfig[] = [
  // 示例：
  // { ip: '备用IP', port: 12345, username: 'user', password: 'pass' },
];

async function tryLaunchWithProxy(proxy: ProxyConfig, headless: boolean | 'new' = 'new'): Promise<{ browser: Browser, page: Page, proxy: ProxyConfig } | null> {
  let args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-infobars',
    '--window-position=0,0',
    '--ignore-certificate-errors',
    '--ignore-certificate-errors-spki-list',
    `--proxy-server=http://${proxy.ip}:${proxy.port}`,
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
  ];
  try {
    const browser = await puppeteer.launch({ headless, args });
    const page = await browser.newPage();
    if (proxy.username && proxy.password) {
      await page.authenticate({ username: proxy.username, password: proxy.password });
    }
    // 谨慎修正：注释掉检测网址，避免因目标站点反爬导致代理全部被判为不可用
    // await page.goto('https://www.popmart.com/sg', { timeout: 15000 });
    return { browser, page, proxy };
  } catch (e) {
    return null;
  }
}

export async function launchWithAutoProxy(options?: { headless?: boolean | 'new' }): Promise<{ browser: Browser, page: Page, proxy: ProxyConfig }> {
  const headless = options?.headless ?? 'new';
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