#!/bin/bash

# 测试workflow成功执行功能
# 验证安全验证检测不会导致workflow失败

echo "🔧 测试workflow成功执行功能..."

# 设置测试环境变量
export BOT_TOKEN="test_token"
export CHAT_ID="test_chat_id"
export GITHUB_WORKFLOW="Test Workflow"
export GITHUB_RUN_NUMBER="123"

# 清理之前的状态文件
rm -f security-verification-status.json

echo ""
echo "=== 测试场景1: 检测到安全验证，workflow应该成功 ==="
cat > monitoring.log << EOF
[2024-01-01T10:00:00.000Z] [INFO] 开始小红书监控
[2024-01-01T10:00:01.000Z] [INFO] 页面导航成功
[2024-01-01T10:00:02.000Z] [INFO] 🔐 SECURITY_VERIFICATION_DETECTED 🔐
[2024-01-01T10:00:03.000Z] [INFO] 需要验证
EOF

echo "运行检测脚本..."
./scripts/check-security-verification.sh
EXIT_CODE=$?
echo "退出码: $EXIT_CODE"

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ 测试通过：检测到安全验证但workflow成功"
else
    echo "❌ 测试失败：workflow应该成功但退出码为 $EXIT_CODE"
fi

echo ""
echo "=== 测试场景2: 重复检测安全验证，workflow应该成功 ==="
echo "运行检测脚本..."
./scripts/check-security-verification.sh
EXIT_CODE=$?
echo "退出码: $EXIT_CODE"

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ 测试通过：重复检测但workflow成功"
else
    echo "❌ 测试失败：workflow应该成功但退出码为 $EXIT_CODE"
fi

echo ""
echo "=== 测试场景3: 正常页面，workflow应该成功 ==="
cat > monitoring.log << EOF
[2024-01-01T10:00:00.000Z] [INFO] 开始小红书监控
[2024-01-01T10:00:01.000Z] [INFO] 页面导航成功
[2024-01-01T10:00:02.000Z] [INFO] 页面标题: labubu - 小红书搜索
[2024-01-01T10:00:03.000Z] [INFO] 找到 25 个帖子
EOF

echo "运行检测脚本..."
./scripts/check-security-verification.sh
EXIT_CODE=$?
echo "退出码: $EXIT_CODE"

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ 测试通过：正常页面workflow成功"
else
    echo "❌ 测试失败：workflow应该成功但退出码为 $EXIT_CODE"
fi

echo ""
echo "=== 测试场景4: 24小时后重新检测，应该发送通知 ==="

# 创建一个24小时前的状态文件
YESTERDAY=$(date -d "25 hours ago" '+%Y-%m-%d %H:%M:%S')
cat > security-verification-status.json << EOF
{
    "last_verification_time": "$YESTERDAY",
    "last_pattern": "🔐 SECURITY_VERIFICATION_DETECTED 🔐",
    "notification_sent": true
}
EOF

cat > monitoring.log << EOF
[2024-01-01T10:00:00.000Z] [INFO] 开始小红书监控
[2024-01-01T10:00:01.000Z] [INFO] 页面导航成功
[2024-01-01T10:00:02.000Z] [INFO] 🔐 SECURITY_VERIFICATION_DETECTED 🔐
[2024-01-01T10:00:03.000Z] [INFO] 需要验证
EOF

echo "运行检测脚本..."
./scripts/check-security-verification.sh
EXIT_CODE=$?
echo "退出码: $EXIT_CODE"

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ 测试通过：24小时后重新检测workflow成功"
else
    echo "❌ 测试失败：workflow应该成功但退出码为 $EXIT_CODE"
fi

echo ""
echo "=== 测试场景5: 脚本执行错误，workflow应该成功 ==="

# 创建一个无效的日志文件路径来模拟错误
export LOG_FILE="non-existent-file.log"

echo "运行检测脚本..."
./scripts/check-security-verification.sh
EXIT_CODE=$?
echo "退出码: $EXIT_CODE"

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ 测试通过：即使脚本遇到错误，workflow仍然成功"
else
    echo "❌ 测试失败：workflow应该成功但退出码为 $EXIT_CODE"
fi

# 恢复环境
export LOG_FILE="monitoring.log"

# 清理测试文件
rm -f monitoring.log security-verification-status.json

echo ""
echo "✅ Workflow成功执行测试完成！"
echo ""
echo "📋 测试总结:"
echo "1. 检测到安全验证 → workflow应该成功"
echo "2. 重复检测安全验证 → workflow应该成功"
echo "3. 正常页面 → workflow应该成功"
echo "4. 24小时后重新检测 → workflow应该成功"
echo "5. 脚本执行错误 → workflow应该成功"
echo ""
echo "🎯 核心目标：无论安全验证检测结果如何，workflow都应该成功完成"
