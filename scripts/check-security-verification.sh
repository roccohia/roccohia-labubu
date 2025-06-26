#!/bin/bash

# 安全验证检测脚本
# 用于检测小红书是否需要安全验证并发送Telegram通知
# 支持去重功能，避免重复推送相同的安全验证通知

LOG_FILE="monitoring.log"
BOT_TOKEN="${BOT_TOKEN}"
CHAT_ID="${CHAT_ID}"
STATUS_FILE="security-verification-status.json"

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

# 状态管理函数
load_status() {
    if [ -f "$STATUS_FILE" ]; then
        cat "$STATUS_FILE"
    else
        echo '{"last_verification_time": "", "last_pattern": "", "notification_sent": false}'
    fi
}

save_status() {
    local verification_time="$1"
    local pattern="$2"
    local notification_sent="$3"

    cat > "$STATUS_FILE" << EOF
{
    "last_verification_time": "$verification_time",
    "last_pattern": "$pattern",
    "notification_sent": $notification_sent
}
EOF
}

should_send_notification() {
    local current_pattern="$1"
    local current_time="$2"

    # 加载当前状态
    local status=$(load_status)
    local last_pattern=$(echo "$status" | grep -o '"last_pattern": "[^"]*"' | cut -d'"' -f4)
    local last_time=$(echo "$status" | grep -o '"last_verification_time": "[^"]*"' | cut -d'"' -f4)
    local notification_sent=$(echo "$status" | grep -o '"notification_sent": [^,}]*' | cut -d':' -f2 | tr -d ' ')

    echo "调试信息:"
    echo "  当前模式: '$current_pattern'"
    echo "  上次模式: '$last_pattern'"
    echo "  上次时间: '$last_time'"
    echo "  已发送通知: '$notification_sent'"

    # 如果已经成功发送过通知，且是相同的验证模式，检查24小时时间差
    if [ "$notification_sent" = "true" ] && [ "$last_pattern" = "$current_pattern" ]; then
        if [ -n "$last_time" ]; then
            # 计算时间差（24小时 = 86400秒）
            local current_timestamp=$(date +%s)
            local last_timestamp=$(date -d "$last_time" +%s 2>/dev/null || echo 0)
            local time_diff=$((current_timestamp - last_timestamp))

            echo "  时间差: ${time_diff}秒 (24小时=${86400}秒)"

            if [ $time_diff -lt 86400 ]; then
                echo "  决策: 不发送（24小时内已通知，剩余$((86400 - time_diff))秒）"
                return 1  # 不应该发送
            else
                echo "  决策: 发送通知（超过24小时）"
                return 0  # 应该发送
            fi
        else
            echo "  决策: 不发送（相同验证已通知，但时间信息缺失）"
            return 1  # 不应该发送
        fi
    fi

    # 如果是不同的验证模式，或者之前没有成功发送，则发送通知
    echo "  决策: 发送通知（新验证或之前未成功发送）"
    return 0  # 应该发送
}

echo "开始检查安全验证状态..."

# 定义需要检测的安全验证关键词
SECURITY_PATTERNS=(
    "🔐 SECURITY_VERIFICATION_DETECTED 🔐"
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

# 如果检测到安全验证，检查是否需要发送通知
if [ "$VERIFICATION_DETECTED" = true ]; then
    # 获取当前时间
    CURRENT_TIME=$(date '+%Y-%m-%d %H:%M:%S')

    # 检查是否应该发送通知（去重逻辑）
    if should_send_notification "$MATCHED_PATTERN" "$CURRENT_TIME"; then
        echo "发送安全验证通知到Telegram..."

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
5. 等待下次自动监控运行

🔄 注意: 相同的验证提醒在24小时内只会发送一次"

        # 发送Telegram消息
        RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
            -d chat_id="${CHAT_ID}" \
            -d text="$MESSAGE" \
            -d parse_mode="HTML")

        # 检查发送结果
        if echo "$RESPONSE" | grep -q '"ok":true'; then
            echo "✅ 安全验证通知发送成功"
            # 保存状态，标记已发送通知
            save_status "$CURRENT_TIME" "$MATCHED_PATTERN" "true"
        else
            echo "❌ 安全验证通知发送失败: $RESPONSE"
            # 保存状态，但标记未成功发送
            save_status "$CURRENT_TIME" "$MATCHED_PATTERN" "false"
        fi
    else
        echo "🔕 检测到安全验证，但相同通知已在24小时内发送过，跳过推送"
        echo "   检测到的内容: $MATCHED_PATTERN"
        echo "   如需重新发送，请删除状态文件: $STATUS_FILE"
    fi

    # 注意：我们不再使用exit 2，而是继续执行，让workflow成功完成
    echo "📝 安全验证检测完成，workflow将继续执行其他任务"
else
    echo "✅ 未检测到安全验证要求"

    # 检查是否有之前的验证状态需要清除
    if [ -f "$STATUS_FILE" ]; then
        status=$(load_status)
        notification_sent=$(echo "$status" | grep -o '"notification_sent": [^,}]*' | cut -d':' -f2 | tr -d ' ')

        # 只有在之前确实发送过通知的情况下才清除状态
        if [ "$notification_sent" = "true" ]; then
            save_status "" "" "false"
            echo "🧹 已清除安全验证状态（验证已解决）"
        else
            echo "📝 保持当前状态（之前的通知未成功发送）"
        fi
    fi
fi

# 总是以成功状态退出，确保workflow不会因为安全验证检测而失败
echo "🎯 安全验证检测流程完成"
exit 0
