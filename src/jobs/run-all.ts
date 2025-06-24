#!/usr/bin/env ts-node

/**
 * 主任务调度器
 * 负责协调和执行所有监控任务
 */

import { runLabubuJob as runXhsLabubuJob } from './xhs-labubu';
import { runSgpmJob } from './sgpm-labubu';
import { logger } from '../utils/logger';
import { validateConfig, appConfig } from '../config';
import { measurePerformance, createTaskResult, validateEnvironmentVariables } from '../utils/helpers';
import { TaskResult } from '../types';

/**
 * 主函数 - 执行所有监控任务
 */
async function main(): Promise<void> {
  const startTime = Date.now();
  logger.info('=== Labubu 监控系统启动 ===');

  try {
    // 1. 环境检查
    await performEnvironmentChecks();

    // 2. 执行监控任务
    const results = await executeMonitoringTasks();

    // 3. 输出执行结果
    logExecutionSummary(results, startTime);

  } catch (error) {
    logger.error('监控系统执行失败', error);
    process.exit(1);
  }
}

/**
 * 执行环境检查
 */
async function performEnvironmentChecks(): Promise<void> {
  logger.info('开始环境检查...');

  // 检查必需的环境变量
  const envCheck = validateEnvironmentVariables(['BOT_TOKEN', 'CHAT_ID']);
  if (!envCheck.valid) {
    throw new Error(`缺少必需的环境变量: ${envCheck.missing.join(', ')}`);
  }

  // 检查配置有效性
  const configCheck = validateConfig();
  if (!configCheck.valid) {
    throw new Error(`配置验证失败: ${configCheck.errors.join(', ')}`);
  }

  // 输出运行环境信息
  logger.info('环境信息', {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    isProduction: appConfig.isProduction,
    useProxy: appConfig.useProxy,
    debugMode: appConfig.debugMode
  });

  logger.success('环境检查通过');
}

/**
 * 执行监控任务
 */
async function executeMonitoringTasks(): Promise<TaskResult[]> {
  const debugMode = appConfig.debugMode;
  const results: TaskResult[] = [];

  // 执行小红书监控任务
  logger.info('=== 开始执行小红书 Labubu 监控 ===');
  try {
    const xhsTask = measurePerformance('XHS_LABUBU_MONITOR', runXhsLabubuJob);
    await xhsTask(logger, debugMode);

    results.push(createTaskResult(
      true,
      '小红书监控任务执行成功',
      { taskName: 'XHS_LABUBU_MONITOR' }
    ));
  } catch (error) {
    logger.error('小红书监控任务执行失败', error);
    results.push(createTaskResult(
      false,
      '小红书监控任务执行失败',
      { taskName: 'XHS_LABUBU_MONITOR' },
      error instanceof Error ? error : new Error(String(error))
    ));
  }

  // 执行 PopMart 监控任务
  logger.info('=== 开始执行新加坡 PopMart Labubu 监控 ===');
  try {
    const sgpmTask = measurePerformance('SGPM_LABUBU_MONITOR', runSgpmJob);
    await sgpmTask();

    results.push(createTaskResult(
      true,
      'PopMart 监控任务执行成功',
      { taskName: 'SGPM_LABUBU_MONITOR' }
    ));
  } catch (error) {
    logger.error('PopMart 监控任务执行失败', error);
    results.push(createTaskResult(
      false,
      'PopMart 监控任务执行失败',
      { taskName: 'SGPM_LABUBU_MONITOR' },
      error instanceof Error ? error : new Error(String(error))
    ));
  }

  return results;
}

/**
 * 输出执行摘要
 */
function logExecutionSummary(results: TaskResult[], startTime: number): void {
  const duration = Date.now() - startTime;
  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;

  logger.info('=== 执行摘要 ===', {
    totalTasks: results.length,
    successful: successCount,
    failed: failureCount,
    duration: `${duration}ms`,
    memoryUsage: process.memoryUsage()
  });

  // 输出详细结果
  results.forEach((result, index) => {
    const status = result.success ? '✅' : '❌';
    const taskName = result.data?.taskName || `Task ${index + 1}`;

    if (result.success) {
      logger.success(`${status} ${taskName}: ${result.message}`);
    } else {
      logger.error(`${status} ${taskName}: ${result.message}`, result.error);
    }
  });

  if (failureCount > 0) {
    logger.warn(`有 ${failureCount} 个任务执行失败，请检查日志`);
  } else {
    logger.success('所有监控任务执行成功！');
  }
}

// 程序入口点
if (require.main === module) {
  main().catch(error => {
    console.error('程序执行失败:', error);
    process.exit(1);
  });
}