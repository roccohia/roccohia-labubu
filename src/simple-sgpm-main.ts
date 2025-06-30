#!/usr/bin/env node

/**
 * 简化的SGPM监控系统 - 主入口
 * 
 * 特点：
 * - 简单可靠的浏览器管理
 * - 基于按钮文字的库存检测
 * - 直接的价格提取
 * - 最小化的错误处理
 */

import { logger } from './utils/logger';
import { SimpleSgpmService } from './services/SimpleSgpmService';

/**
 * 产品配置
 */
const PRODUCT_URLS = [
  'https://www.popmart.com/sg/products/5631/Hirono%20Living%20Wild-Fight%20for%20Joy%20Plush%20Doll',
  'https://www.popmart.com/sg/pop-now/set/64',
  'https://www.popmart.com/sg/products/5629/THE%20MONSTERS%20Wacky%20Mart%20Series-Earphone%20Case',
  'https://www.popmart.com/sg/products/5628/LABUBU%20HIDE%20AND%20SEEK%20IN%20SINGAPORE%20SERIES-Vinyl%20Plush%20Doll%20Pendant',
  'https://www.popmart.com/sg/products/5627/THE%20MONSTERS%20COCA%20COLA%20SERIES-Vinyl%20Face%20Blind%20Box',
  'https://www.popmart.com/sg/products/5626/THE%20MONSTERS%20FALL%20IN%20WILD%20SERIES-Vinyl%20Plush%20Doll%20Pendant',
  'https://www.popmart.com/sg/products/5625/THE%20MONSTERS%20FALL%20IN%20WILD%20SERIES-Vinyl%20Plush%20Doll',
  'https://www.popmart.com/sg/products/5624/TwinkleTwinkle%20Bee%20Your%20Honey%20Figure'
];

/**
 * 环境变量配置
 */
function getConfig() {
  const botToken = process.env.SGPM_BOT_TOKEN || process.env.BOT_TOKEN;
  const chatId = process.env.SGMP_CHAT_ID || process.env.CHAT_ID;

  if (!botToken || !chatId) {
    logger.warn('⚠️ Telegram配置缺失，将跳过通知功能');
    logger.warn(`Bot Token: ${botToken ? '✅' : '❌'}`);
    logger.warn(`Chat ID: ${chatId ? '✅' : '❌'}`);
  }

  return {
    botToken: botToken || '',
    chatId: chatId || '',
    isGitHubActions: process.env.GITHUB_ACTIONS === 'true'
  };
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  const startTime = Date.now();
  logger.info('=== 简化SGPM监控系统启动 ===');

  try {
    // 获取配置
    const config = getConfig();
    
    // GitHub Actions 环境设置超时
    if (config.isGitHubActions) {
      setTimeout(() => {
        logger.warn('GitHub Actions环境：达到5分钟安全限制，强制退出');
        process.exit(0);
      }, 5 * 60 * 1000);
    }

    logger.info(`📊 监控产品数量: ${PRODUCT_URLS.length}`);
    logger.info(`📱 Telegram通知: ${config.botToken && config.chatId ? '✅ 已配置' : '❌ 未配置'}`);
    logger.info(`🌐 运行环境: ${config.isGitHubActions ? 'GitHub Actions' : '本地环境'}`);

    // 创建服务实例
    const sgmpService = new SimpleSgpmService(
      logger,
      PRODUCT_URLS,
      config.botToken,
      config.chatId
    );

    // 执行监控
    await sgmpService.checkProducts();

    // 输出执行结果
    const duration = Date.now() - startTime;
    logger.info(`✅ 监控完成，总耗时: ${duration}ms`);

  } catch (error) {
    logger.error('❌ 监控系统执行失败:', error);
    process.exit(1);
  } finally {
    // GitHub Actions 中立即退出
    if (process.env.GITHUB_ACTIONS === 'true') {
      logger.info('🔄 GitHub Actions环境，立即退出');
      process.exit(0);
    }
  }
}

/**
 * 优雅关闭处理
 */
function setupGracefulShutdown(): void {
  const shutdown = (signal: string) => {
    logger.info(`📡 接收到 ${signal} 信号，开始关闭...`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  // 处理未捕获的异常
  process.on('uncaughtException', (error) => {
    logger.error('❌ 未捕获的异常:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('❌ 未处理的Promise拒绝:', reason);
    process.exit(1);
  });
}

// 设置优雅关闭
setupGracefulShutdown();

// 启动应用
if (require.main === module) {
  main().catch(error => {
    logger.error('❌ 应用启动失败:', error);
    process.exit(1);
  });
}

export { main as simpleSgpmMain };
