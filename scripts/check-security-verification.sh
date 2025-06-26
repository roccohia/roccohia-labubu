#!/bin/bash

# 安全验证检测脚本
# 用于检测小红书是否需要安全验证并发送Telegram通知

LOG_FILE="monitoring.log"
BOT_TOKEN="${BOT_TOKEN}"
CHAT_ID="${CHAT_ID}"

# 检查必要的环境变量
if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
    echo "错误: BOT_TOKEN 或 CHAT_ID 环境变量未设置"
    exit 1
fi

# 检查日志文件是否存在
if [ ! -f "$LOG_FILE" ]; then
    echo "警告: 监控日志文件 $LOG_FILE 不存在"
    exit 0
fi

echo "开始检查安全验证状态..."

# 定义需要检测的安全验证关键词
SECURITY_PATTERNS=(
    "页面标题: Security Verification"
    "安全验证"
    "扫码验证"
    "人机验证"
    "验证码"
    "Verification Required"
    "Please verify"
    "需要验证"
    "账号异常"
    "登录验证"
)

# 检查是否匹配任何安全验证模式
VERIFICATION_DETECTED=false
MATCHED_PATTERN=""

for pattern in "${SECURITY_PATTERNS[@]}"; do
    if grep -q "$pattern" "$LOG_FILE"; then
        VERIFICATION_DETECTED=true
        MATCHED_PATTERN="$pattern"
        echo "检测到安全验证: $pattern"
        break
    fi
done

# 如果检测到安全验证，发送通知
if [ "$VERIFICATION_DETECTED" = true ]; then
    echo "发送安全验证通知到Telegram..."
    
    # 获取当前时间
    CURRENT_TIME=$(date '+%Y-%m-%d %H:%M:%S')
    
    # 构建通知消息
    MESSAGE="🔐 小红书安全验证提醒

检测到小红书需要安全验证！

🔍 检测到的内容: $MATCHED_PATTERN
📱 请打开小红书APP进行扫码认证
🕐 检测时间: $CURRENT_TIME UTC
🤖 来源: GitHub Actions 自动监控
📋 工作流: ${GITHUB_WORKFLOW:-未知}
🔢 运行编号: ${GITHUB_RUN_NUMBER:-未知}

⚠️ 在完成验证之前，监控功能可能无法正常工作。

💡 处理步骤:
1. 打开小红书手机APP
2. 进入个人中心
3. 查看是否有验证提示
4. 完成扫码或其他验证步骤
5. 等待下次自动监控运行"

    # 发送Telegram消息
    RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
        -d chat_id="${CHAT_ID}" \
        -d text="$MESSAGE" \
        -d parse_mode="HTML")
    
    # 检查发送结果
    if echo "$RESPONSE" | grep -q '"ok":true'; then
        echo "✅ 安全验证通知发送成功"
    else
        echo "❌ 安全验证通知发送失败: $RESPONSE"
    fi
    
    # 设置退出码表示检测到验证
    exit 2
else
    echo "✅ 未检测到安全验证要求"
    exit 0
fi
