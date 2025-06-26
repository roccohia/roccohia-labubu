#!/bin/bash

# 专门测试去重功能的脚本

echo "🔄 测试安全验证去重功能..."

# 设置测试环境变量
export BOT_TOKEN="test_token"
export CHAT_ID="test_chat_id"
export GITHUB_WORKFLOW="Test Workflow"
export GITHUB_RUN_NUMBER="123"

# 清理之前的状态文件
rm -f security-verification-status.json

# 创建测试日志
cat > monitoring.log << EOF
[2024-01-01T10:00:00.000Z] [INFO] 开始小红书监控
[2024-01-01T10:00:01.000Z] [INFO] 页面导航成功
[2024-01-01T10:00:02.000Z] [INFO] 页面标题: Security Verification
[2024-01-01T10:00:03.000Z] [INFO] 需要验证
EOF

# 创建修改版的检测脚本（模拟成功发送）
cat > test-check-script.sh << 'SCRIPT_EOF'
#!/bin/bash

# 复制原始脚本内容，但修改curl命令为模拟成功
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
    
    echo "调试: 当前模式='$current_pattern', 上次模式='$last_pattern', 已发送='$notification_sent'"
    
    # 如果是不同的验证模式，或者之前没有成功发送，则发送通知
    if [ "$last_pattern" != "$current_pattern" ] || [ "$notification_sent" != "true" ]; then
        return 0  # 应该发送
    else
        return 1  # 不应该发送
    fi
}

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

# 如果检测到安全验证，检查是否需要发送通知
if [ "$VERIFICATION_DETECTED" = true ]; then
    # 获取当前时间
    CURRENT_TIME=$(date '+%Y-%m-%d %H:%M:%S')
    
    # 检查是否应该发送通知（去重逻辑）
    if should_send_notification "$MATCHED_PATTERN" "$CURRENT_TIME"; then
        echo "发送安全验证通知到Telegram..."
        
        # 模拟成功的Telegram响应
        RESPONSE='{"ok":true,"result":{"message_id":123}}'
        
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
    
    # 设置退出码表示检测到验证
    exit 2
else
    echo "✅ 未检测到安全验证要求"
    # 如果没有检测到验证，清除状态（表示验证已解决）
    if [ -f "$STATUS_FILE" ]; then
        save_status "" "" "false"
        echo "🧹 已清除安全验证状态（验证已解决）"
    fi
    exit 0
fi
SCRIPT_EOF

chmod +x test-check-script.sh

echo ""
echo "--- 第一次检测：应该发送通知 ---"
./test-check-script.sh
echo "退出码: $?"
echo "状态文件内容:"
cat security-verification-status.json 2>/dev/null || echo "状态文件不存在"

echo ""
echo "--- 第二次检测：应该跳过通知（去重） ---"
./test-check-script.sh
echo "退出码: $?"

echo ""
echo "--- 修改为不同的验证类型 ---"
cat > monitoring.log << EOF
[2024-01-01T10:00:00.000Z] [INFO] 开始小红书监控
[2024-01-01T10:00:01.000Z] [INFO] 页面导航成功
[2024-01-01T10:00:02.000Z] [INFO] 安全验证
[2024-01-01T10:00:03.000Z] [INFO] 需要验证
EOF

./test-check-script.sh
echo "退出码: $?"

echo ""
echo "--- 正常页面：应该清除状态 ---"
cat > monitoring.log << EOF
[2024-01-01T10:00:00.000Z] [INFO] 开始小红书监控
[2024-01-01T10:00:01.000Z] [INFO] 页面导航成功
[2024-01-01T10:00:02.000Z] [INFO] 页面标题: labubu - 小红书搜索
[2024-01-01T10:00:03.000Z] [INFO] 找到 25 个帖子
EOF

./test-check-script.sh
echo "退出码: $?"
echo "状态文件内容:"
cat security-verification-status.json 2>/dev/null || echo "状态文件不存在"

# 清理测试文件
rm -f test-check-script.sh monitoring.log security-verification-status.json

echo ""
echo "✅ 去重功能测试完成！"
