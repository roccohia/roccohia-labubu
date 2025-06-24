import puppeteer, { Browser, Page } from 'puppeteer';

export interface ProxyConfig {
  ip: string;
  port: number;
  username: string;
  password: string;
}

const proxies: ProxyConfig[] = [
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

function getRandomProxy(): ProxyConfig {
  const idx = Math.floor(Math.random() * proxies.length);
  return proxies[idx];
}

export async function launchWithRandomProxy(): Promise<{ browser: Browser, page: Page, proxy: any }> {
  let args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-infobars',
    '--window-position=0,0',
    '--ignore-certificate-errors',
    '--ignore-certificate-errors-spki-list',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
  ];
  let proxy: any = null;

  if (process.env.HTTP_PROXY) {
    // 只将 HTTP_PROXY 注入 puppeteer，不影响全局
    args = [`--proxy-server=${process.env.HTTP_PROXY}`, ...args];
    // 解析代理信息（如有用户名密码）
    try {
      const url = new URL(process.env.HTTP_PROXY);
      proxy = { ip: url.hostname, port: url.port, username: url.username, password: url.password };
    } catch {
      proxy = { raw: process.env.HTTP_PROXY };
    }
  } else {
    // 兼容本地代理池
    proxy = getRandomProxy();
    args = [`--proxy-server=http://${proxy.ip}:${proxy.port}`, ...args];
  }

  const browser = await puppeteer.launch({ headless: 'new', args });
  const page = await browser.newPage();
  // 仅在有用户名密码时认证
  if (proxy && proxy.username && proxy.password) {
    await page.authenticate({ username: proxy.username, password: proxy.password });
  }
  return { browser, page, proxy };
} 