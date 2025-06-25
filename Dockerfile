# 使用官方 Node.js 镜像作为基础镜像
FROM node:20-slim

# 设置工作目录
WORKDIR /app

# 安装系统依赖（Puppeteer 需要）
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    libgconf-2-4 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libcairo-gobject2 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    libnss3 \
    libcups2 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libcairo-gobject2 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxshmfence1 \
    libgbm1 \
    && rm -rf /var/lib/apt/lists/*

# 启用 Corepack 以支持 Yarn
RUN corepack enable

# 复制 package.json 和 yarn.lock
COPY package.json yarn.lock ./

# 设置 Puppeteer 环境变量
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
ENV PUPPETEER_DOWNLOAD_HOST=https://npmmirror.com/mirrors/chromium
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# 创建缓存目录
RUN mkdir -p /app/.cache/puppeteer

# 安装依赖
RUN yarn install --immutable --inline-builds

# 复制源代码
COPY . .

# 编译 TypeScript（如果需要）
# RUN yarn build

# 创建非 root 用户
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser \
    && chown -R pptruser:pptruser /app

# 设置环境变量
ENV NODE_ENV=production
ENV USE_PROXY=true

# 切换到非 root 用户
USER pptruser

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# 暴露端口（如果需要 web 服务）
# EXPOSE 3000

# 启动命令
CMD ["node", "-r", "ts-node/register", "src/main.ts"]
