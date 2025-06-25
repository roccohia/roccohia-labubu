import { XhsConfig, SgpmConfig } from './types';

/**
 * 小红书监控配置
 * 包含搜索关键词、匹配规则、文件路径等设置
 */
export const xhsConfig: XhsConfig = {
  searchKeyword: 'labubu',
  matchKeywords: [
      // 品牌与角色关键词
  "labubu", "LABUBU", "Labubu", "LaBuBu", "拉布布",

  // 国家/地区关键词
  "sg", "SG", "新加坡", "Singapore", "🇸🇬",

  // 补货 / 上新 / 抢购类关键词
  "补货", "现货", "上新", "发售", "突击", "突袭", "到货", "预售", "抢购", "抽签", "发货", "开抢", "上架",

  // 表示稀缺、热销的词
  "限量", "限定", "爆款", "热卖", "官方", "独家", "带回", "入手",

  // 泡泡玛特品牌及其组合
  "popmart", "POP MART", "泡泡玛特", "泡泡", "泡玛",

  // 拼写组合形式（提高命中率）
  "sglabubu", "sg-labubu", "sg_labubu", "sg labubu",
  "labubu sg", "拉布布 sg", "labubu🇸🇬", "🇸🇬labubu",
  "labubu新加坡", "labubu 到货", "popmart sg", "sg popmart",
  "labubu popmart", "popmart labubu"
  ],
  seenPostsFile: 'xhs-seen-posts.json',
  cookiesFile: 'xhs-cookies.json',
  maxSeenPosts: 500,
};

/**
 * 新加坡 PopMart 监控配置
 * 包含要监控的产品URL列表和状态文件路径
 */
export const sgpmConfig: SgpmConfig = {
  productUrls: [
    'https://www.popmart.com/sg/products/3877/THE-MONSTERS-Wacky-Mart-Series-Earphone-Case',
    'https://www.popmart.com/sg/products/1149/LABUBU-HIDE-AND-SEEK-IN-SINGAPORE-SERIES-Vinyl-Plush-Doll-Pendant',
    'https://www.popmart.com/sg/products/1712/THE-MONSTERS-COCA-COLA-SERIES-Vinyl-Face-Blind-Box',
    'https://www.popmart.com/sg/products/4123/LABUBU-THE-MONSTERS-TASTY-MACARONS-SERIES-Vinyl-Face-Blind-Box',
    'https://www.popmart.com/sg/pop-now/set/100'
  ],
  statusFile: 'sgpm-products-status.json',
};

/**
 * 应用程序通用配置
 */
export const appConfig = {
  // 任务执行间隔（毫秒）
  defaultTaskInterval: 10 * 60 * 1000, // 10分钟

  // 网络请求超时时间（毫秒）
  networkTimeout: 60000, // 60秒

  // 浏览器操作超时时间（毫秒）
  browserTimeout: 120000, // 2分钟

  // 最大重试次数
  maxRetries: 3,

  // 并发限制
  concurrencyLimit: 2,

  // 调试模式
  debugMode: process.env.DEBUG_MODE === 'true' || process.argv.includes('--debug'),

  // 生产环境检查
  isProduction: process.env.NODE_ENV === 'production',

  // 代理使用检查
  useProxy: process.env.USE_PROXY === 'true',
} as const;

/**
 * 验证配置的有效性
 */
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 验证环境变量
  if (!process.env.BOT_TOKEN) {
    errors.push('缺少环境变量: BOT_TOKEN');
  }

  if (!process.env.CHAT_ID) {
    errors.push('缺少环境变量: CHAT_ID');
  }

  // 验证生产环境代理设置
  if (appConfig.isProduction && !appConfig.useProxy) {
    errors.push('生产环境必须启用代理 (USE_PROXY=true)');
  }

  // 验证小红书配置
  if (!xhsConfig.searchKeyword) {
    errors.push('小红书搜索关键词不能为空');
  }

  if (xhsConfig.matchKeywords.length === 0) {
    errors.push('小红书匹配关键词列表不能为空');
  }

  // 验证 PopMart 配置
  if (sgpmConfig.productUrls.length === 0) {
    errors.push('PopMart 产品URL列表不能为空');
  }

  // 验证URL格式
  for (const url of sgpmConfig.productUrls) {
    try {
      new URL(url);
    } catch {
      errors.push(`无效的产品URL: ${url}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}