"# Labubu Watcher 🎯

一个自动化监控系统，用于监控小红书和新加坡 PopMart 的 Labubu 相关产品信息，并通过 Telegram 发送实时通知。

## ✨ 功能特性

- 🔍 **小红书监控**: 自动搜索和过滤包含特定关键词的新帖子
- 🛒 **PopMart 监控**: 监控新加坡 PopMart 网站的产品库存状态
- 📱 **Telegram 通知**: 实时推送监控结果到 Telegram
- 🔄 **自动去重**: 避免重复推送相同内容
- 🚀 **高性能**: 优化的 Puppeteer 配置，支持代理和反检测
- 📊 **完善日志**: 详细的日志记录和性能监控
- 🐳 **容器化**: 支持 Docker 和 Railway 部署

## 🚀 快速开始

### 1. 环境准备

```bash
# 克隆项目
git clone <your-repo-url>
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

```bash
# 运行所有监控任务
yarn run:all

# 仅运行小红书监控
yarn run:xhs

# 仅运行 PopMart 监控
yarn run:sgpm

# 调试模式
yarn debug:all
```"
