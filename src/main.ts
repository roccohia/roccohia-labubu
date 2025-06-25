#!/usr/bin/env node

/**
 * Labubu 监控系统 - 优化版主入口
 * 
 * 功能：
 * - 小红书关键词监控
 * - PopMart 库存监控
 * - Telegram 通知推送
 */

import { logger } from './utils/logger';
import { validateConfig, xhsConfig, sgpmConfig } from './config';
import { validateEnvironmentVariables } from './utils/helpers';
import { XhsMonitoringTask, PopMartMonitoringTask, TaskExecutor } from './core/MonitoringTask';

/**
 * 主函数
 */
async function main(): Promise<void> {
  const startTime = Date.now();
  logger.info('=== Labubu 监控系统启动 ===');

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

  // 创建PopMart监控任务
  if (shouldRunPopMartTask()) {
    tasks.push(new PopMartMonitoringTask(logger, sgpmConfig));
  }

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
 * 判断是否运行PopMart任务
 */
function shouldRunPopMartTask(): boolean {
  const args = process.argv;
  if (args.includes('--popmart-only')) return true;
  if (args.includes('--xhs-only')) return false;
  return true; // 默认运行
}

/**
 * 处理未捕获的异常
 */
process.on('uncaughtException', (error) => {
  logger.error('未捕获的异常:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的Promise拒绝:', reason);
  process.exit(1);
});

/**
 * 优雅退出处理
 */
process.on('SIGINT', () => {
  logger.info('收到 SIGINT 信号，正在优雅退出...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('收到 SIGTERM 信号，正在优雅退出...');
  process.exit(0);
});

// 启动应用
if (require.main === module) {
  main().catch((error) => {
    logger.error('应用启动失败:', error);
    process.exit(1);
  });
}

export { main };
