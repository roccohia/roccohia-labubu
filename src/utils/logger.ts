/**
 * 增强的日志记录器，支持时间戳、颜色和结构化日志
 */
export class Logger {
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = this.getTimestamp();
    const baseMessage = `[${timestamp}] [${level}] ${message}`;

    if (data) {
      try {
        // 安全的JSON序列化，避免循环引用
        return `${baseMessage}\n${JSON.stringify(data, this.getCircularReplacer(), 2)}`;
      } catch (error) {
        // 如果序列化失败，返回字符串表示
        return `${baseMessage}\n${String(data)}`;
      }
    }

    return baseMessage;
  }

  /**
   * 处理循环引用的replacer函数
   */
  private getCircularReplacer() {
    const seen = new WeakSet();
    return (key: string, value: any) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return "[Circular]";
        }
        seen.add(value);
      }
      return value;
    };
  }

  info(message: string, data?: any): void {
    console.log('\x1b[36m%s\x1b[0m', this.formatMessage('INFO', message, data));
  }

  success(message: string, data?: any): void {
    console.log('\x1b[32m%s\x1b[0m', this.formatMessage('SUCCESS', message, data));
  }

  warn(message: string, data?: any): void {
    console.warn('\x1b[33m%s\x1b[0m', this.formatMessage('WARN', message, data));
  }

  error(message: string, error?: Error | any): void {
    let errorData: any;

    if (error instanceof Error) {
      errorData = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    } else if (error && typeof error === 'object') {
      // 安全地提取对象属性，避免循环引用
      errorData = {
        message: error.message || error.code || 'Unknown error',
        name: error.name || error.constructor?.name || 'Error',
        status: error.status || error.response?.status,
        type: typeof error
      };
    } else {
      errorData = String(error);
    }

    console.error('\x1b[31m%s\x1b[0m', this.formatMessage('ERROR', message, errorData));
  }

  debug(message: string, data?: any): void {
    if (process.env.DEBUG_MODE === 'true' || process.argv.includes('--debug')) {
      console.log('\x1b[35m%s\x1b[0m', this.formatMessage('DEBUG', message, data));
    }
  }
}

// 创建全局日志实例
export const logger = new Logger();

// 保持向后兼容的类型定义
export type LoggerInstance = Logger;