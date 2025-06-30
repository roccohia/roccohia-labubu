import dotenv from 'dotenv';
import { SgpmMonitorService } from './services/SgpmMonitorService';
import { logger } from './utils/logger';

// 加载环境变量
dotenv.config();

// SGPM产品URL列表
const SGPM_PRODUCT_URLS = [
  'https://www.popmart.com/sg/products/5631/Hirono%20Living%20Wild-Fight%20for%20Joy%20Plush%20Doll',
  'https://www.popmart.com/sg/pop-now/set/64',
  'https://www.popmart.com/sg/products/5629/THE%20MONSTERS%20Wacky%20Mart%20Series-Earphone%20Case',
  'https://www.popmart.com/sg/products/5628/LABUBU%20HIDE%20AND%20SEEK%20IN%20SINGAPORE%20SERIES-Vinyl%20Plush%20Doll%20Pendant',
  'https://www.popmart.com/sg/products/5627/THE%20MONSTERS%20COCA%20COLA%20SERIES-Vinyl%20Face%20Blind%20Box',
  'https://www.popmart.com/sg/products/5626/THE%20MONSTERS%20FALL%20IN%20WILD%20SERIES-Vinyl%20Plush%20Doll%20Pendant',
  'https://www.popmart.com/sg/products/5625/THE%20MONSTERS%20FALL%20IN%20WILD%20SERIES-Vinyl%20Plush%20Doll',
  'https://www.popmart.com/sg/products/5624/TwinkleTwinkle%20Bee%20Your%20Honey%20Figure'
];

async function main(): Promise<void> {
  const startTime = Date.now();
  
  try {
    logger.info('=== SGPM监控系统启动 ===');
    
    // 检查Telegram配置
    const botToken = process.env.SGPM_BOT_TOKEN;
    const chatId = process.env.SGPM_CHAT_ID;
    
    if (botToken && chatId) {
      logger.info('📱 Telegram通知: ✅ 已配置');
    } else {
      logger.warn('📱 Telegram通知: ❌ 未配置');
      logger.warn('⚠️ 需要设置 SGPM_BOT_TOKEN 和 SGPM_CHAT_ID 环境变量');
    }
    
    logger.info(`📊 监控产品数量: ${SGPM_PRODUCT_URLS.length}`);
    logger.info(`🌐 运行环境: ${process.env.NODE_ENV || '本地环境'}`);

    // 创建监控服务
    const monitor = new SgpmMonitorService(botToken, chatId);

    // 初始化浏览器
    await monitor.initBrowser();

    // 开始监控
    logger.info('🚀 开始SGPM监控...');
    await monitor.monitorProducts(SGPM_PRODUCT_URLS);
    
    // 关闭浏览器
    await monitor.closeBrowser();
    
    const duration = Date.now() - startTime;
    logger.info(`✅ 监控完成，总耗时: ${duration}ms`);
    
  } catch (error) {
    logger.error('❌ 监控过程中发生错误:', error);
    process.exit(1);
  }
}

// 处理未捕获的异常
process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的Promise拒绝:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('未捕获的异常:', error);
  process.exit(1);
});

// 运行主程序
if (require.main === module) {
  main().catch(error => {
    logger.error('主程序执行失败:', error);
    process.exit(1);
  });
}

export { main as sgpmMonitorMain };
