#!/usr/bin/env node

/**
 * 小红书(XHS)监控系统 - 主入口
 *
 * 功能：
 * - 小红书关键词监控
 * - Telegram 通知推送
 *
 * 注意：SGPM监控已分离到独立的 sgpm-main.ts
 */

import { logger } from './utils/logger';
import { validateConfig, xhsConfig } from './config';
import { validateEnvironmentVariables } from './utils/helpers';
import { XhsMonitoringTask, TaskExecutor } from './core/MonitoringTask';

/**
 * 主函数
 */
async function main(): Promise<void> {
  const startTime = Date.now();
  logger.info('=== Labubu 监控系统启动 ===');

  // GitHub Actions环境的绝对安全退出机制
  const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
  if (isGitHubActions) {
    // 5分钟后强制退出，无论任务是否完成
    setTimeout(() => {
      logger.warn('GitHub Actions环境：达到5分钟安全限制，强制退出');
      process.exit(0);
    }, 5 * 60 * 1000);
  }

  try {
    // 1. 环境检查
    await performEnvironmentChecks();

    // 2. 创建监控任务
    const tasks = createMonitoringTasks();

    // 3. 执行监控任务
    const executor = new TaskExecutor(logger);
    await executor.executeAll(tasks);

    // 4. 输出执行结果
    const duration = Date.now() - startTime;
    logger.success(`=== 监控系统执行完成，总耗时: ${duration}ms ===`);

    // 5. 在GitHub Actions中立即强制退出，避免卡住
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    if (isGitHubActions) {
      logger.info('GitHub Actions环境：立即退出进程');
      process.exit(0);
    }

    // 6. 本地环境给一点时间清理，然后退出
    setTimeout(() => {
      logger.debug('本地环境：延迟退出进程');
      process.exit(0);
    }, 1000);

  } catch (error) {
    logger.error('监控系统执行失败', error);
    process.exit(1);
  }
}

/**
 * 环境检查
 */
async function performEnvironmentChecks(): Promise<void> {
  logger.info('开始环境检查...');

  // 验证环境变量
  const requiredVars = ['BOT_TOKEN', 'CHAT_ID'];
  const envValidation = validateEnvironmentVariables(requiredVars);
  if (!envValidation.valid) {
    throw new Error(`环境变量验证失败: ${envValidation.missing.join(', ')}`);
  }

  // 验证配置
  const configValidation = validateConfig();
  if (!configValidation.valid) {
    throw new Error(`配置验证失败: ${configValidation.errors.join(', ')}`);
  }

  logger.success('环境检查通过');
}

/**
 * 创建监控任务
 */
function createMonitoringTasks() {
  const tasks = [];

  // 创建小红书监控任务
  if (shouldRunXhsTask()) {
    tasks.push(new XhsMonitoringTask(logger, xhsConfig));
  }

  // 注意：PopMart监控任务已移至 sgpm-main.ts

  if (tasks.length === 0) {
    throw new Error('没有可执行的监控任务');
  }

  logger.info(`创建了 ${tasks.length} 个监控任务`);
  return tasks;
}

/**
 * 判断是否运行小红书任务
 */
function shouldRunXhsTask(): boolean {
  const args = process.argv;
  if (args.includes('--xhs-only')) return true;
  if (args.includes('--popmart-only')) return false;
  return true; // 默认运行
}

/**
 * 注意：PopMart任务判断函数已移除，因为SGPM已分离
 */

/**
 * 全局清理函数
 */
let isShuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`收到 ${signal} 信号，正在优雅退出...`);

  try {
    // 给正在运行的任务一些时间完成
    await new Promise(resolve => setTimeout(resolve, 5000));
  } catch (error) {
    logger.error('优雅退出时出错:', error);
  }

  process.exit(0);
}

/**
 * 处理未捕获的异常
 */
process.on('uncaughtException', (error) => {
  logger.error('未捕获的异常:', error);
  if (!isShuttingDown) {
    gracefulShutdown('uncaughtException');
  }
});

process.on('unhandledRejection', (reason) => {
  logger.error('未处理的Promise拒绝:', reason);
  if (!isShuttingDown) {
    gracefulShutdown('unhandledRejection');
  }
});

/**
 * 优雅退出处理
 */
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// GitHub Actions特殊处理
if (process.env.GITHUB_ACTIONS === 'true') {
  // 设置更短的超时，避免GitHub Actions卡住
  setTimeout(() => {
    logger.warn('GitHub Actions环境：达到最大运行时间，强制退出');
    process.exit(0);
  }, 22 * 60 * 1000); // 22分钟强制退出
}

// 启动应用
if (require.main === module) {
  main()
    .then(() => {
      // 主函数成功完成，确保进程退出
      logger.debug('主函数执行完成，准备退出进程');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('应用启动失败:', error);
      process.exit(1);
    });
}

export { main };
