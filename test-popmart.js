#!/usr/bin/env node

/**
 * PopMart网站访问测试脚本
 * 用于诊断网页访问问题
 */

const axios = require('axios');

async function testPopMartAccess() {
  const testUrl = 'https://www.popmart.com/sg/products/3651/TwinkleTwinkle-Bee-Your-Honey-Figure';
  
  console.log('🔍 测试PopMart网站访问...');
  console.log(`📍 测试URL: ${testUrl}`);
  
  const strategies = [
    {
      name: '基础请求',
      config: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 30000
      }
    },
    {
      name: '完整浏览器模拟',
      config: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0',
          'DNT': '1'
        },
        timeout: 30000
      }
    },
    {
      name: '移动浏览器',
      config: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        timeout: 30000
      }
    }
  ];

  for (const strategy of strategies) {
    console.log(`\n🔄 尝试策略: ${strategy.name}`);
    
    try {
      const response = await axios.get(testUrl, strategy.config);
      
      console.log(`✅ 状态码: ${response.status}`);
      console.log(`📄 内容长度: ${response.data.length} 字符`);
      
      // 检查内容类型
      const html = response.data;
      const htmlPreview = html.substring(0, 200).replace(/\s+/g, ' ');
      console.log(`📄 内容预览: ${htmlPreview}...`);
      
      // 检查是否是反爬虫页面
      const isAntiCrawler = html.includes('/_fec_sbu/fec_wrapper.js') || 
                           html.includes('fec_wrapper') ||
                           html.length < 5000;
      
      if (isAntiCrawler) {
        console.log('🚫 检测到反爬虫页面');
      } else {
        console.log('✅ 获取到正常页面内容');
        
        // 简单的库存检测
        const htmlLower = html.toLowerCase();
        const hasInStock = htmlLower.includes('add to cart') || 
                          htmlLower.includes('buy now') ||
                          htmlLower.includes('pick one to shake') ||
                          htmlLower.includes('purchase');
        const hasOutOfStock = htmlLower.includes('out of stock') ||
                             htmlLower.includes('sold out') ||
                             htmlLower.includes('coming soon') ||
                             htmlLower.includes('in-app purchase only');
        
        console.log(`🛒 库存状态检测:`);
        console.log(`   - 有货指示器: ${hasInStock}`);
        console.log(`   - 缺货指示器: ${hasOutOfStock}`);
        
        if (hasInStock && !hasOutOfStock) {
          console.log('✅ 推断状态: 有货');
        } else if (hasOutOfStock) {
          console.log('❌ 推断状态: 缺货');
        } else {
          console.log('❓ 推断状态: 未知');
        }
        
        // 成功获取正常页面，退出测试
        break;
      }
      
    } catch (error) {
      console.log(`❌ 请求失败: ${error.message}`);
      if (error.response) {
        console.log(`   状态码: ${error.response.status}`);
      }
    }
    
    // 策略间延迟
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// 运行测试
testPopMartAccess().catch(console.error);
