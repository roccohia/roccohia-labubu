/**
 * 通用工具函数
 */

import { PerformanceMetrics, TaskResult } from '../types';

/**
 * 延迟执行
 * @param ms - 延迟时间（毫秒）
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 重试执行函数
 * @param fn - 要执行的函数
 * @param maxRetries - 最大重试次数
 * @param delayMs - 重试间隔（毫秒）
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxRetries) {
        throw lastError;
      }
      
      // 指数退避
      const waitTime = delayMs * Math.pow(2, attempt - 1);
      await delay(waitTime);
    }
  }
  
  throw lastError!;
}

/**
 * 安全的 JSON 解析
 * @param jsonString - JSON 字符串
 * @param defaultValue - 解析失败时的默认值
 */
export function safeJsonParse<T>(jsonString: string, defaultValue: T): T {
  try {
    return JSON.parse(jsonString);
  } catch {
    return defaultValue;
  }
}

/**
 * 安全的 JSON 字符串化
 * @param obj - 要序列化的对象
 * @param space - 缩进空格数
 */
export function safeJsonStringify(obj: any, space?: number): string {
  try {
    return JSON.stringify(obj, null, space);
  } catch {
    return '{}';
  }
}

/**
 * 验证 URL 格式
 * @param url - 要验证的 URL
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * 格式化文件大小
 * @param bytes - 字节数
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * 格式化持续时间
 * @param ms - 毫秒数
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

/**
 * 获取当前时间戳字符串
 */
export function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * 获取格式化的本地时间
 * @param timezone - 时区
 */
export function getFormattedTime(timezone: string = 'Asia/Shanghai'): string {
  return new Date().toLocaleString('zh-CN', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * 清理字符串（移除多余空格和特殊字符）
 * @param str - 要清理的字符串
 */
export function cleanString(str: string): string {
  return str
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\u4e00-\u9fff]/g, '')
    .trim();
}

/**
 * 截断字符串
 * @param str - 要截断的字符串
 * @param maxLength - 最大长度
 * @param suffix - 后缀
 */
export function truncateString(str: string, maxLength: number, suffix: string = '...'): string {
  if (str.length <= maxLength) {
    return str;
  }
  
  return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * 生成随机字符串
 * @param length - 长度
 */
export function generateRandomString(length: number = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
}

/**
 * 性能监控装饰器
 * @param taskName - 任务名称
 */
export function measurePerformance<T extends (...args: any[]) => Promise<any>>(
  taskName: string,
  fn: T
): T {
  return (async (...args: any[]) => {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    
    try {
      const result = await fn(...args);
      const endTime = Date.now();
      const endMemory = process.memoryUsage();
      
      const metrics: PerformanceMetrics = {
        taskName,
        startTime,
        endTime,
        duration: endTime - startTime,
        success: true,
        memoryUsage: {
          rss: endMemory.rss - startMemory.rss,
          heapTotal: endMemory.heapTotal - startMemory.heapTotal,
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          external: endMemory.external - startMemory.external,
          arrayBuffers: endMemory.arrayBuffers - startMemory.arrayBuffers
        }
      };
      
      console.log(`[PERF] ${taskName}: ${formatDuration(metrics.duration)}`);
      
      return result;
    } catch (error) {
      const endTime = Date.now();
      
      const metrics: PerformanceMetrics = {
        taskName,
        startTime,
        endTime,
        duration: endTime - startTime,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      
      console.log(`[PERF] ${taskName} FAILED: ${formatDuration(metrics.duration)}`);
      
      throw error;
    }
  }) as T;
}

/**
 * 创建任务结果
 * @param success - 是否成功
 * @param message - 消息
 * @param data - 数据
 * @param error - 错误
 * @param duration - 持续时间
 */
export function createTaskResult(
  success: boolean,
  message: string,
  data?: any,
  error?: Error,
  duration?: number
): TaskResult {
  return {
    success,
    message,
    data,
    error,
    duration
  };
}

/**
 * 环境变量验证
 * @param requiredVars - 必需的环境变量列表
 */
export function validateEnvironmentVariables(requiredVars: string[]): { valid: boolean; missing: string[] } {
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  return {
    valid: missing.length === 0,
    missing
  };
}
