#!/usr/bin/env node

/**
 * SGPM (Singapore PopMart) 监控系统 - 独立入口
 * 专门监控新加坡PopMart产品库存状态
 */

import { logger } from './utils/logger';
import { sgpmConfig, validateSgpmConfig, validateSgpmEnvironment, getSgpmEnvConfig } from './config-sgpm';
import { SgpmService } from './services/SgpmService';

/**
 * SGPM监控主函数
 */
async function main(): Promise<void> {
  const startTime = Date.now();
  logger.info('=== SGPM (Singapore PopMart) 监控系统启动 ===');

  try {
    // 1. 验证配置
    logger.info('验证SGPM配置...');
    const configValidation = validateSgpmConfig();
    if (!configValidation.valid) {
      throw new Error(`SGPM配置验证失败: ${configValidation.errors.join(', ')}`);
    }
    logger.info('✅ SGPM配置验证通过');

    // 2. 验证环境变量
    logger.info('验证SGPM环境变量...');
    const envValidation = validateSgpmEnvironment();
    if (!envValidation.valid) {
      throw new Error(`SGPM环境变量验证失败，缺少: ${envValidation.missing.join(', ')}`);
    }
    logger.info('✅ SGPM环境变量验证通过');

    // 3. 获取环境配置
    const envConfig = getSgpmEnvConfig();
    logger.info(`📊 监控配置: ${sgpmConfig.productUrls.length} 个产品`);
    logger.info(`🤖 Telegram Bot: ${envConfig.botToken ? '已配置' : '未配置'}`);
    logger.info(`💬 Chat ID: ${envConfig.chatId ? '已配置' : '未配置'}`);
    logger.info(`🌐 使用代理: ${envConfig.useProxy ? '是' : '否'}`);

    // 4. 创建SGPM服务
    logger.info('初始化SGPM监控服务...');
    const sgpmService = new SgpmService(sgpmConfig, logger);

    // 5. 执行监控
    logger.info('开始执行SGPM产品库存监控...');
    await sgpmService.checkProducts();

    // 6. 完成
    const duration = Date.now() - startTime;
    logger.success(`=== SGPM监控完成，总耗时: ${duration}ms ===`);

  } catch (error) {
    logger.error('SGPM监控系统执行失败:', error);
    process.exit(1);
  } finally {
    // GitHub Actions环境立即退出
    if (process.env.GITHUB_ACTIONS === 'true') {
      logger.info('GitHub Actions环境，立即退出');
      process.exit(0);
    }
  }
}

/**
 * 错误处理
 */
process.on('uncaughtException', (error) => {
  logger.error('未捕获的异常:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('未处理的Promise拒绝:', reason);
  process.exit(1);
});

// 启动应用
if (require.main === module) {
  main().catch(error => {
    logger.error('SGPM应用启动失败:', error);
    process.exit(1);
  });
}

export { main as sgpmMain };
