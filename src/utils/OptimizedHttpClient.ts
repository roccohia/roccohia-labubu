import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { LoggerInstance } from './logger';
import { httpCache } from './OptimizedCacheManager';

/**
 * 扩展的 Axios 请求配置，包含元数据
 */
interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
  metadata?: {
    startTime: number;
  };
}

/**
 * 请求重试配置
 */
interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  retryCondition?: (error: any) => boolean;
}

/**
 * 优化的HTTP客户端
 * 支持缓存、重试、超时控制等功能
 */
export class OptimizedHttpClient {
  private client: AxiosInstance;
  private logger: LoggerInstance;
  private defaultRetryConfig: RetryConfig;

  constructor(logger: LoggerInstance, baseConfig?: AxiosRequestConfig) {
    this.logger = logger;
    this.defaultRetryConfig = {
      maxRetries: 3,
      retryDelay: 1000,
      retryCondition: (error) => {
        // 重试网络错误和5xx服务器错误
        return !error.response || (error.response.status >= 500 && error.response.status < 600);
      }
    };

    // 创建axios实例
    this.client = axios.create({
      timeout: 30000, // 30秒超时
      validateStatus: (status) => status < 500, // 接受所有非5xx状态码，与原始SgpmService保持一致
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      ...baseConfig
    });

    // 设置请求拦截器
    this.setupRequestInterceptor();
    
    // 设置响应拦截器
    this.setupResponseInterceptor();
  }

  /**
   * 设置请求拦截器
   */
  private setupRequestInterceptor(): void {
    this.client.interceptors.request.use(
      (config: ExtendedAxiosRequestConfig) => {
        // 添加请求时间戳
        config.metadata = { startTime: Date.now() };

        // 记录请求日志
        this.logger.debug(`HTTP请求: ${config.method?.toUpperCase()} ${config.url}`);

        return config;
      },
      (error) => {
        this.logger.error('HTTP请求拦截器错误:', error);
        return Promise.reject(error);
      }
    );
  }

  /**
   * 设置响应拦截器
   */
  private setupResponseInterceptor(): void {
    this.client.interceptors.response.use(
      (response) => {
        // 计算请求耗时
        const config = response.config as ExtendedAxiosRequestConfig;
        const duration = Date.now() - (config.metadata?.startTime || 0);
        this.logger.debug(`HTTP响应: ${response.status} ${response.config.url} (${duration}ms)`);

        return response;
      },
      (error) => {
        // 计算请求耗时
        const config = error.config as ExtendedAxiosRequestConfig;
        const duration = Date.now() - (config?.metadata?.startTime || 0);
        this.logger.warn(`HTTP错误: ${error.response?.status || 'NETWORK_ERROR'} ${error.config?.url} (${duration}ms)`);

        return Promise.reject(error);
      }
    );
  }

  /**
   * 带缓存的GET请求
   */
  async get(url: string, config?: AxiosRequestConfig & { cache?: boolean; cacheTTL?: number }): Promise<AxiosResponse> {
    const { cache = true, cacheTTL = 5 * 60 * 1000, ...axiosConfig } = config || {};
    
    // 检查缓存
    if (cache) {
      const cacheKey = this.getCacheKey('GET', url, axiosConfig);
      const cached = httpCache.get(cacheKey);
      if (cached) {
        this.logger.debug(`缓存命中: GET ${url}`);
        return JSON.parse(cached);
      }
    }

    // 发送请求
    const response = await this.requestWithRetry(() => this.client.get(url, axiosConfig));
    
    // 缓存响应
    if (cache && response.status === 200) {
      const cacheKey = this.getCacheKey('GET', url, axiosConfig);
      httpCache.set(cacheKey, JSON.stringify(response), cacheTTL);
    }

    return response;
  }

  /**
   * POST请求
   */
  async post(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.requestWithRetry(() => this.client.post(url, data, config));
  }

  /**
   * PUT请求
   */
  async put(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.requestWithRetry(() => this.client.put(url, data, config));
  }

  /**
   * DELETE请求
   */
  async delete(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.requestWithRetry(() => this.client.delete(url, config));
  }

  /**
   * 带重试的请求
   */
  private async requestWithRetry(
    requestFn: () => Promise<AxiosResponse>,
    retryConfig?: Partial<RetryConfig>
  ): Promise<AxiosResponse> {
    const config = { ...this.defaultRetryConfig, ...retryConfig };
    let lastError: any;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;
        
        // 检查是否应该重试
        if (attempt === config.maxRetries || !config.retryCondition?.(error)) {
          break;
        }

        // 等待后重试
        const delay = config.retryDelay * Math.pow(2, attempt); // 指数退避
        this.logger.debug(`请求失败，${delay}ms后重试 (${attempt + 1}/${config.maxRetries})`);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * 批量请求
   */
  async batchRequest<T>(
    requests: Array<() => Promise<T>>,
    options?: { concurrency?: number; failFast?: boolean }
  ): Promise<Array<T | Error>> {
    const { concurrency = 3, failFast = false } = options || {};
    
    if (failFast) {
      // 快速失败模式：任何一个请求失败就停止
      const results: T[] = [];
      for (let i = 0; i < requests.length; i += concurrency) {
        const batch = requests.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(req => req()));
        results.push(...batchResults);
      }
      return results;
    } else {
      // 容错模式：收集所有结果，包括错误
      const results: Array<T | Error> = [];
      for (let i = 0; i < requests.length; i += concurrency) {
        const batch = requests.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(batch.map(req => req()));
        
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            results.push(result.reason);
          }
        }
      }
      return results;
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(url: string, timeout: number = 5000): Promise<boolean> {
    try {
      const response = await this.client.get(url, { 
        timeout,
        validateStatus: (status) => status < 500 // 4xx也算健康
      });
      return true;
    } catch (error) {
      this.logger.debug(`健康检查失败: ${url}`, error);
      return false;
    }
  }

  /**
   * 生成缓存键
   */
  private getCacheKey(method: string, url: string, config?: AxiosRequestConfig): string {
    const configStr = config ? JSON.stringify({
      params: config.params,
      headers: config.headers
    }) : '';
    return `${method}:${url}:${Buffer.from(configStr).toString('base64')}`;
  }

  /**
   * 睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    httpCache.clear();
    this.logger.debug('HTTP缓存已清理');
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; hitRate: number } {
    return httpCache.getStats();
  }

  /**
   * 设置默认重试配置
   */
  setDefaultRetryConfig(config: Partial<RetryConfig>): void {
    this.defaultRetryConfig = { ...this.defaultRetryConfig, ...config };
  }

  /**
   * 获取客户端实例（用于高级用法）
   */
  getClient(): AxiosInstance {
    return this.client;
  }
}

/**
 * 全局HTTP客户端实例
 */
let globalHttpClient: OptimizedHttpClient | null = null;

/**
 * 获取全局HTTP客户端
 */
export function getHttpClient(logger: LoggerInstance): OptimizedHttpClient {
  if (!globalHttpClient) {
    globalHttpClient = new OptimizedHttpClient(logger);
  }
  return globalHttpClient;
}

/**
 * Telegram API专用客户端
 */
export class TelegramHttpClient extends OptimizedHttpClient {
  constructor(logger: LoggerInstance, botToken: string) {
    super(logger, {
      baseURL: `https://api.telegram.org/bot${botToken}`,
      timeout: 15000, // Telegram API使用较短超时
    });

    // Telegram API特定的重试配置
    this.setDefaultRetryConfig({
      maxRetries: 2,
      retryDelay: 500,
      retryCondition: (error) => {
        // Telegram API重试条件
        if (!error.response) return true; // 网络错误
        const status = error.response.status;
        return status === 429 || status >= 500; // 限流或服务器错误
      }
    });
  }

  /**
   * 发送消息
   */
  async sendMessage(chatId: string, text: string, options?: any): Promise<AxiosResponse> {
    return this.post('/sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...options
    });
  }
}
