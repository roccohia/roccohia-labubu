# 🔄 功能分离指南

## 📋 分离概述

为了更好的管理和独立配置，我们已将监控系统分离为两个独立的功能：

### **🔴 XHS (小红书) 监控**
- **文件**: `src/main.ts`
- **配置**: `src/config.ts`
- **Workflow**: `.github/workflows/labubu.yml`
- **Telegram**: 使用原有的 `BOT_TOKEN` 和 `CHAT_ID`

### **🟢 SGPM (新加坡PopMart) 监控**
- **文件**: `src/sgpm-main.ts`
- **配置**: `src/config-sgpm.ts`
- **Workflow**: `.github/workflows/sgpm-monitor.yml`
- **Telegram**: 使用新的 `SGPM_BOT_TOKEN` 和 `SGPM_CHAT_ID`

## 🚀 使用方法

### **本地运行**

#### XHS监控
```bash
# 运行XHS监控
npm start

# 开发模式
npm run dev

# 只运行XHS
npm run run:xhs

# XHS调试模式
npm run debug:xhs
```

#### SGPM监控
```bash
# 运行SGPM监控
npm run sgpm

# SGPM开发模式
npm run sgpm:dev
```

### **GitHub Actions**

#### XHS Workflow
- **名称**: `XHS (Xiaohongshu) Monitor`
- **频率**: 每10分钟
- **触发文件**: 
  - `src/main.ts`
  - `src/config.ts`
  - `src/services/XhsService.ts`
  - `src/scrapers/XhsScraper.ts`

#### SGPM Workflow
- **名称**: `SGPM (Singapore PopMart) Monitor`
- **频率**: 每15分钟
- **触发文件**:
  - `src/sgpm-main.ts`
  - `src/config-sgpm.ts`
  - `src/services/SgpmService.ts`

## 🔧 环境变量配置

### **XHS监控 (保持不变)**
```
BOT_TOKEN=你的小红书监控Bot Token
CHAT_ID=你的小红书监控Chat ID
PROXY_LIST=代理列表（可选）
```

### **SGPM监控 (新增)**
```
SGPM_BOT_TOKEN=你的SGPM监控Bot Token
SGPM_CHAT_ID=你的SGPM监控Chat ID
PROXY_LIST=代理列表（可选，共用）
```

## 📱 Telegram Bot 设置

### **方法1: 使用两个不同的Bot**
1. **XHS Bot**: 继续使用现有的Bot
2. **SGPM Bot**: 创建新的Bot
   - 与 @BotFather 对话
   - 发送 `/newbot`
   - 设置Bot名称和用户名
   - 获取新的Token

### **方法2: 使用相同Bot但不同Chat**
1. **XHS**: 发送到原有的Chat ID
2. **SGPM**: 发送到新的Chat ID（可以是同一个Bot）

### **推荐配置**
```bash
# GitHub Secrets 设置
BOT_TOKEN=原有的XHS Bot Token
CHAT_ID=原有的XHS Chat ID
SGPM_BOT_TOKEN=新的SGPM Bot Token
SGPM_CHAT_ID=新的SGPM Chat ID
```

## 📊 监控频率

### **XHS监控**: 每10分钟
- 小红书内容更新较频繁
- 需要及时捕获新帖子

### **SGPM监控**: 每15分钟
- PopMart库存变化相对较慢
- 减少不必要的请求

## 🔍 调试和日志

### **XHS调试**
- 日志文件: `xhs-monitoring.log`
- 状态文件: `xhs-seen-posts.json`
- 调试脚本: `scripts/debug-xhs-dedup.sh`

### **SGPM调试**
- 日志文件: `sgpm-monitoring.log`
- 状态文件: `sgpm-status.json`
- 上传工件: `sgpm-logs-{run_number}`

## 🎯 优势

### **独立性**
- 两个功能完全独立运行
- 一个失败不影响另一个
- 独立的配置和环境变量

### **灵活性**
- 可以独立调整监控频率
- 可以使用不同的Telegram Bot
- 可以独立开启/关闭功能

### **可维护性**
- 代码结构更清晰
- 更容易调试和修改
- 独立的日志和状态管理

## 🔄 迁移步骤

### **1. 设置新的Telegram Bot (可选)**
如果要使用独立的SGPM Bot：
1. 创建新的Telegram Bot
2. 获取新的Token和Chat ID
3. 在GitHub Secrets中添加 `SGPM_BOT_TOKEN` 和 `SGPM_CHAT_ID`

### **2. 使用相同Bot (简单方式)**
如果继续使用相同的Bot：
1. 在GitHub Secrets中设置：
   ```
   SGPM_BOT_TOKEN = BOT_TOKEN (相同值)
   SGPM_CHAT_ID = CHAT_ID (相同值)
   ```

### **3. 验证配置**
1. 手动触发两个workflow
2. 检查是否正常运行
3. 验证通知是否发送到正确的Chat

## 📝 注意事项

### **文件变更**
- `src/config.ts`: 移除了SGPM配置
- `src/main.ts`: 移除了PopMart相关代码
- 新增 `src/config-sgpm.ts` 和 `src/sgpm-main.ts`

### **兼容性**
- 原有的XHS功能完全保持不变
- 原有的环境变量继续有效
- 可以逐步迁移到新的分离架构

### **监控状态**
- XHS和SGPM使用独立的状态文件
- 不会相互影响
- 可以独立重置状态

## 🎉 总结

通过功能分离，您现在拥有：
- ✅ 独立的XHS监控系统
- ✅ 独立的SGPM监控系统  
- ✅ 灵活的Telegram Bot配置
- ✅ 更好的可维护性和调试能力
- ✅ 独立的运行频率和配置
