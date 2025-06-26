#!/bin/bash

# 测试安全验证修复功能
# 验证去重逻辑是否正确工作

echo "🔧 测试安全验证修复功能..."

# 设置测试环境变量
export BOT_TOKEN="test_token"
export CHAT_ID="test_chat_id"
export GITHUB_WORKFLOW="Test Workflow"
export GITHUB_RUN_NUMBER="123"

# 清理之前的状态文件
rm -f security-verification-status.json

# 创建修改版的检测脚本（模拟成功发送）
cat > test-security-script.sh << 'SCRIPT_EOF'
#!/bin/bash

LOG_FILE="monitoring.log"
BOT_TOKEN="${BOT_TOKEN}"
CHAT_ID="${CHAT_ID}"
STATUS_FILE="security-verification-status.json"

if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
    echo "错误: BOT_TOKEN 或 CHAT_ID 环境变量未设置"
    exit 1
fi

if [ ! -f "$LOG_FILE" ]; then
    echo "警告: 监控日志文件 $LOG_FILE 不存在"
    exit 0
fi

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
    
    local status=$(load_status)
    local last_pattern=$(echo "$status" | grep -o '"last_pattern": "[^"]*"' | cut -d'"' -f4)
    local last_time=$(echo "$status" | grep -o '"last_verification_time": "[^"]*"' | cut -d'"' -f4)
    local notification_sent=$(echo "$status" | grep -o '"notification_sent": [^,}]*' | cut -d':' -f2 | tr -d ' ')
    
    echo "调试信息:"
    echo "  当前模式: '$current_pattern'"
    echo "  上次模式: '$last_pattern'"
    echo "  上次时间: '$last_time'"
    echo "  已发送通知: '$notification_sent'"
    
    if [ "$notification_sent" = "true" ] && [ "$last_pattern" = "$current_pattern" ]; then
        echo "  决策: 不发送（相同验证已通知）"
        return 1
    fi
    
    echo "  决策: 发送通知"
    return 0
}

echo "开始检查安全验证状态..."

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

if [ "$VERIFICATION_DETECTED" = true ]; then
    CURRENT_TIME=$(date '+%Y-%m-%d %H:%M:%S')
    
    if should_send_notification "$MATCHED_PATTERN" "$CURRENT_TIME"; then
        echo "发送安全验证通知到Telegram..."
        
        # 模拟成功的Telegram响应
        RESPONSE='{"ok":true,"result":{"message_id":123}}'
        
        if echo "$RESPONSE" | grep -q '"ok":true'; then
            echo "✅ 安全验证通知发送成功"
            save_status "$CURRENT_TIME" "$MATCHED_PATTERN" "true"
        else
            echo "❌ 安全验证通知发送失败: $RESPONSE"
            save_status "$CURRENT_TIME" "$MATCHED_PATTERN" "false"
        fi
    else
        echo "🔕 检测到安全验证，但相同通知已在24小时内发送过，跳过推送"
        echo "   检测到的内容: $MATCHED_PATTERN"
    fi
    
    exit 2
else
    echo "✅ 未检测到安全验证要求"
    
    if [ -f "$STATUS_FILE" ]; then
        local status=$(load_status)
        local notification_sent=$(echo "$status" | grep -o '"notification_sent": [^,}]*' | cut -d':' -f2 | tr -d ' ')
        
        if [ "$notification_sent" = "true" ]; then
            save_status "" "" "false"
            echo "🧹 已清除安全验证状态（验证已解决）"
        else
            echo "📝 保持当前状态（之前的通知未成功发送）"
        fi
    fi
    exit 0
fi
SCRIPT_EOF

chmod +x test-security-script.sh

echo ""
echo "=== 测试场景1: 首次检测到安全验证 ==="
cat > monitoring.log << EOF
[2024-01-01T10:00:00.000Z] [INFO] 开始小红书监控
[2024-01-01T10:00:01.000Z] [INFO] 页面导航成功
[2024-01-01T10:00:02.000Z] [INFO] 🔐 SECURITY_VERIFICATION_DETECTED 🔐
[2024-01-01T10:00:03.000Z] [INFO] 需要验证
EOF

echo "运行检测脚本..."
./test-security-script.sh
echo "退出码: $?"
echo "状态文件内容:"
cat security-verification-status.json 2>/dev/null || echo "状态文件不存在"

echo ""
echo "=== 测试场景2: 再次检测到相同安全验证（应该跳过） ==="
echo "运行检测脚本..."
./test-security-script.sh
echo "退出码: $?"

echo ""
echo "=== 测试场景3: 检测到不同的安全验证 ==="
cat > monitoring.log << EOF
[2024-01-01T10:00:00.000Z] [INFO] 开始小红书监控
[2024-01-01T10:00:01.000Z] [INFO] 页面导航成功
[2024-01-01T10:00:02.000Z] [INFO] 安全验证
[2024-01-01T10:00:03.000Z] [INFO] 需要验证
EOF

echo "运行检测脚本..."
./test-security-script.sh
echo "退出码: $?"

echo ""
echo "=== 测试场景4: 正常页面（应该清除状态） ==="
cat > monitoring.log << EOF
[2024-01-01T10:00:00.000Z] [INFO] 开始小红书监控
[2024-01-01T10:00:01.000Z] [INFO] 页面导航成功
[2024-01-01T10:00:02.000Z] [INFO] 页面标题: labubu - 小红书搜索
[2024-01-01T10:00:03.000Z] [INFO] 找到 25 个帖子
EOF

echo "运行检测脚本..."
./test-security-script.sh
echo "退出码: $?"
echo "状态文件内容:"
cat security-verification-status.json 2>/dev/null || echo "状态文件不存在"

echo ""
echo "=== 测试场景5: 再次检测到安全验证（状态已清除，应该发送） ==="
cat > monitoring.log << EOF
[2024-01-01T10:00:00.000Z] [INFO] 开始小红书监控
[2024-01-01T10:00:01.000Z] [INFO] 页面导航成功
[2024-01-01T10:00:02.000Z] [INFO] 🔐 SECURITY_VERIFICATION_DETECTED 🔐
[2024-01-01T10:00:03.000Z] [INFO] 需要验证
EOF

echo "运行检测脚本..."
./test-security-script.sh
echo "退出码: $?"

# 清理测试文件
rm -f test-security-script.sh monitoring.log security-verification-status.json

echo ""
echo "✅ 安全验证修复测试完成！"
echo ""
echo "📋 测试总结:"
echo "1. 首次检测 → 应该发送通知"
echo "2. 重复检测 → 应该跳过通知"
echo "3. 不同验证 → 应该发送新通知"
echo "4. 正常页面 → 应该清除状态"
echo "5. 状态清除后 → 应该重新发送通知"
