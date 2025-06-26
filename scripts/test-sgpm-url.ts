#!/usr/bin/env node

/**
 * 测试SGPM URL访问性
 */

import { logger } from '../src/utils/logger';
import { getHttpClient } from '../src/utils/OptimizedHttpClient';
import { sgpmConfig } from '../src/config-sgpm';

async function testSgpmUrls(): Promise<void> {
  logger.info('🔍 开始测试SGPM URL访问性...');
  
  const httpClient = getHttpClient(logger);
  
  for (const url of sgpmConfig.productUrls) {
    logger.info(`\n🌐 测试: ${url}`);
    
    try {
      const startTime = Date.now();
      const response = await httpClient.get(url, {
        cache: false,
        timeout: 10000
      });
      
      const duration = Date.now() - startTime;
      const html = response.data;
      
      logger.info(`✅ 成功: ${response.status} (${duration}ms)`);
      logger.info(`📄 HTML长度: ${html.length} 字符`);
      
      // 检查关键内容
      const hasTitle = html.includes('<title>');
      const hasPrice = /\$\d+\.\d{2}/.test(html) || /S\$\d+\.\d{2}/.test(html);
      const hasAddToCart = /add to cart/i.test(html);
      const hasOutOfStock = /out of stock/i.test(html);
      const hasShakeButton = /pick one to shake/i.test(html);
      
      logger.info(`📊 内容分析:`);
      logger.info(`   - 标题: ${hasTitle ? '✅' : '❌'}`);
      logger.info(`   - 价格: ${hasPrice ? '✅' : '❌'}`);
      logger.info(`   - 购买按钮: ${hasAddToCart ? '✅' : '❌'}`);
      logger.info(`   - 缺货标识: ${hasOutOfStock ? '⚠️' : '✅'}`);
      logger.info(`   - 抽取按钮: ${hasShakeButton ? '✅' : '❌'}`);
      
      // 简单的库存判断
      let stockStatus = 'Unknown';
      if (hasShakeButton) {
        stockStatus = 'In Stock (Shake Button)';
      } else if (hasAddToCart && !hasOutOfStock) {
        stockStatus = 'In Stock (Add to Cart)';
      } else if (hasOutOfStock) {
        stockStatus = 'Out of Stock';
      } else if (hasPrice && !hasOutOfStock) {
        stockStatus = 'Likely In Stock (Has Price)';
      }
      
      logger.info(`📦 库存状态: ${stockStatus}`);
      
    } catch (error: any) {
      const errorMsg = error?.message || error?.code || 'Unknown error';
      const statusCode = error?.response?.status || 'No response';
      logger.error(`❌ 失败: ${errorMsg} (状态: ${statusCode})`);
      
      if (error?.response?.data) {
        logger.debug(`响应数据: ${error.response.data.substring(0, 200)}...`);
      }
    }
    
    // 延迟避免请求过快
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  logger.info('\n✅ URL测试完成');
}

// 运行测试
if (require.main === module) {
  testSgpmUrls().catch(error => {
    logger.error('❌ 测试失败:', error);
    process.exit(1);
  });
}
