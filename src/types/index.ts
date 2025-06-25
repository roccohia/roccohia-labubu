/**
 * 项目通用类型定义
 */

/**
 * 代理配置接口
 */
export interface ProxyConfig {
  ip: string;
  port: number;
  username: string;
  password: string;
}

/**
 * 日志记录器接口
 */
export interface ILogger {
  info(message: string, data?: any): void;
  success(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, error?: Error | any): void;
  debug(message: string, data?: any): void;
}

/**
 * 小红书帖子数据接口
 */
export interface XhsPostData {
  url: string;
  previewTitle: string;
  publishTime?: string;
  author?: string;
  isRecent?: boolean;
}

/**
 * 小红书提取结果接口
 */
export interface XhsExtractionResult {
  posts: XhsPostData[];
  success: boolean;
  error?: string;
}

/**
 * PopMart 产品数据接口
 */
export interface PopMartProductData {
  title: string;
  inStock: boolean;
  url: string;
}

/**
 * PopMart 检查结果接口
 */
export interface PopMartCheckResult {
  title: string;
  inStock: boolean;
  url: string;
  previousStatus?: boolean;
  statusChanged: boolean;
}

/**
 * 状态管理器接口
 */
export interface IStatusManager<T> {
  get(): T;
  set(newData: T): void;
  save(): void;
  getFileStats(): { exists: boolean; size?: number; lastModified?: Date };
}

/**
 * 配置接口
 */
export interface XhsConfig {
  searchKeyword: string;
  matchKeywords: string[];
  seenPostsFile: string;
  cookiesFile: string;
  maxSeenPosts: number;
}

export interface SgpmConfig {
  productUrls: string[];
  statusFile: string;
}

/**
 * 环境变量接口
 */
export interface EnvironmentConfig {
  BOT_TOKEN: string;
  CHAT_ID: string;
  DEBUG_MODE?: string;
  NODE_ENV?: string;
  USE_PROXY?: string;
  // 代理配置
  [key: `PROXY_${number}_IP`]: string;
  [key: `PROXY_${number}_PORT`]: string;
  [key: `PROXY_${number}_USERNAME`]: string;
  [key: `PROXY_${number}_PASSWORD`]: string;
}

/**
 * Telegram 消息发送选项
 */
export interface TelegramMessageOptions {
  retries?: number;
  timeout?: number;
  parseMode?: 'HTML' | 'Markdown';
  disableWebPagePreview?: boolean;
}

/**
 * 浏览器启动选项
 */
export interface BrowserLaunchOptions {
  headless?: boolean | 'new';
  proxy?: ProxyConfig;
  timeout?: number;
  args?: string[];
}

/**
 * 页面导航选项
 */
export interface PageNavigationOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  timeout?: number;
}

/**
 * 任务执行结果
 */
export interface TaskResult {
  success: boolean;
  message: string;
  data?: any;
  error?: Error;
  duration?: number;
}

/**
 * 监控任务配置
 */
export interface MonitoringTaskConfig {
  name: string;
  enabled: boolean;
  interval?: number;
  timeout?: number;
  retries?: number;
}

/**
 * 性能监控数据
 */
export interface PerformanceMetrics {
  taskName: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  memoryUsage?: NodeJS.MemoryUsage;
  error?: string;
}

/**
 * Cookie 数据接口
 */
export interface CookieData {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * 错误类型枚举
 */
export enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  PARSING_ERROR = 'PARSING_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  PROXY_ERROR = 'PROXY_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * 自定义错误类
 */
export class CustomError extends Error {
  public readonly type: ErrorType;
  public readonly details?: any;

  constructor(message: string, type: ErrorType = ErrorType.UNKNOWN_ERROR, details?: any) {
    super(message);
    this.name = 'CustomError';
    this.type = type;
    this.details = details;
  }
}
