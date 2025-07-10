import { SgpmConfig } from './types';

/**
 * 新加坡 PopMart 监控专用配置
 * 独立的配置文件，用于SGPM专用workflow
 */
export const sgpmConfig: SgpmConfig = {
  productUrls: [
    'https://www.popmart.com/sg/pop-now/set/64',
    'https://www.popmart.com/sg/products/5629/THE%20MONSTERS%20Wacky%20Mart%20Series-Earphone%20Case',
    'https://www.popmart.com/sg/products/5628/LABUBU%20HIDE%20AND%20SEEK%20IN%20SINGAPORE%20SERIES-Vinyl%20Plush%20Doll%20Pendant',
    'https://www.popmart.com/sg/products/5627/THE%20MONSTERS%20COCA%20COLA%20SERIES-Vinyl%20Face%20Blind%20Box',
    'https://www.popmart.com/sg/products/5626/THE%20MONSTERS%20FALL%20IN%20WILD%20SERIES-Vinyl%20Plush%20Doll%20Pendant',
    'https://www.popmart.com/sg/products/5625/THE%20MONSTERS%20FALL%20IN%20WILD%20SERIES-Vinyl%20Plush%20Doll'
  ],
  statusFile: './sgpm-products-status.json',
  maxRetries: 3,
  retryDelay: 2000,
  timeout: 30000,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  headers: {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0'
  }
};

/**
 * SGPM监控配置验证
 */
export function validateSgpmConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!sgpmConfig.productUrls || sgpmConfig.productUrls.length === 0) {
    errors.push('产品URL列表不能为空');
  }

  // 验证URL格式
  sgpmConfig.productUrls.forEach((url, index) => {
    try {
      new URL(url);
      if (!url.includes('popmart.com/sg/products/') && !url.includes('popmart.com/sg/pop-now/set/')) {
        errors.push(`URL ${index + 1} 不是有效的PopMart新加坡产品URL: ${url}`);
      }
    } catch {
      errors.push(`URL ${index + 1} 格式无效: ${url}`);
    }
  });

  if (!sgpmConfig.statusFile) {
    errors.push('状态文件路径不能为空');
  }

  if (sgpmConfig.maxRetries < 1 || sgpmConfig.maxRetries > 10) {
    errors.push('最大重试次数应在1-10之间');
  }

  if (sgpmConfig.retryDelay < 1000 || sgpmConfig.retryDelay > 10000) {
    errors.push('重试延迟应在1000-10000毫秒之间');
  }

  if (sgpmConfig.timeout < 10000 || sgpmConfig.timeout > 60000) {
    errors.push('超时时间应在10000-60000毫秒之间');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 获取SGPM环境变量配置
 */
export function getSgpmEnvConfig() {
  return {
    botToken: process.env.SGPM_BOT_TOKEN || process.env.BOT_TOKEN,
    chatId: process.env.SGPM_CHAT_ID || process.env.CHAT_ID,
    debugMode: process.env.DEBUG_MODE === 'true',
    isGitHubActions: process.env.GITHUB_ACTIONS === 'true'
  };
}

/**
 * SGPM专用环境变量验证
 */
export function validateSgpmEnvironment(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  const envConfig = getSgpmEnvConfig();

  if (!envConfig.botToken) {
    missing.push('SGPM_BOT_TOKEN (或 BOT_TOKEN)');
  }

  if (!envConfig.chatId) {
    missing.push('SGPM_CHAT_ID (或 CHAT_ID)');
  }

  return {
    valid: missing.length === 0,
    missing
  };
}
