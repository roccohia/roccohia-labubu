"# Labubu Watcher 🎯

一个自动化监控系统，用于监控小红书和新加坡 PopMart 的 Labubu 相关产品信息，并通过 Telegram 发送实时通知。

## ✨ 功能特性

- 🔍 **小红书监控**: 自动搜索和过滤包含特定关键词的新帖子，支持2天内时间过滤
- 🛒 **PopMart 监控**: 监控新加坡 PopMart 网站的产品库存状态，准确识别商品名称和库存状态
- 📱 **Telegram 通知**: 实时推送监控结果到 Telegram
- 🔄 **智能去重**: 避免重复推送相同内容，支持状态持久化
- 🚀 **高性能**: 优化的架构设计，支持缓存机制和并发控制
- 📊 **完善日志**: 详细的日志记录和性能监控
- 🏗️ **模块化架构**: 清晰的服务分层，易于维护和扩展
- 🐳 **容器化**: 支持 Docker 和 Railway 部署

## 🚀 快速开始

### 1. 环境准备

```bash
# 克隆项目
git clone https://github.com/roccohia/roccohia-labubu.git
cd labubu_watcher

# 安装依赖
yarn install
```

### 2. 环境配置

复制 `.env.example` 为 `.env` 并填入你的配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# Telegram Bot 配置
BOT_TOKEN=your_telegram_bot_token_here
CHAT_ID=your_telegram_chat_id_here

# 代理配置（可选）
PROXY_1_IP=your_proxy_ip_1
PROXY_1_PORT=your_proxy_port_1
PROXY_1_USERNAME=your_proxy_username_1
PROXY_1_PASSWORD=your_proxy_password_1

# 调试模式
DEBUG_MODE=false
```

### 3. 本地运行

#### 标准版本
```bash
# 运行小红书监控
yarn start

# 仅运行小红书监控（调试模式）
yarn dev

# 仅运行小红书监控
yarn run:xhs
```

#### 优化版本（推荐）
```bash
# 运行优化版本（所有任务）
yarn optimized

# 仅运行小红书监控（优化版）
yarn optimized:xhs

# 调试模式（优化版）
yarn optimized:debug
```

#### SGPM 监控
```bash
# 运行 SGPM 监控
yarn sgpm

# 运行 SGPM 监控（调试模式）
yarn sgpm:dev

# 运行 SGPM 优化版本
yarn sgpm:optimized
```

#### 性能测试
```bash
# 运行性能测试
yarn performance:test
```

## 🔧 版本说明

### 标准版本 vs 优化版本

- **标准版本** (`yarn start`): 稳定的原版本，适合生产环境使用
- **优化版本** (`yarn optimized`): 高性能版本，包含以下优化：
  - 浏览器实例池管理
  - 智能缓存机制
  - 资源自动清理
  - 内存压力监控
  - 批量数据处理
  - 网络请求优化

### 推荐使用

- **生产环境**: 使用优化版本 `yarn optimized`
- **开发调试**: 使用标准版本 `yarn dev`
- **性能测试**: 使用 `yarn performance:test`
