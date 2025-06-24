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
      return `${baseMessage}\n${JSON.stringify(data, null, 2)}`;
    }

    return baseMessage;
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
    const errorData = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : error;

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
export type LoggerType = Logger;